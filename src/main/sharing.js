// "Share profiles with Prism Launcher": Havi Hub's engine and Havi Hub itself
// use Prism Launcher's instances folder (and its icons folder, so profile
// images match). Accounts, the engine, Java, downloads and launcher settings
// stay separate. The switch happens through InstanceDir/IconsDir in Havi Hub's
// own prismlauncher.cfg (see engine.prepareData).
const path = require('node:path');
const fsp = require('node:fs/promises');
const { PrismContext, isPrismDataDir } = require('./prism/paths');
const { Instances } = require('./prism/instances');
const groups = require('./prism/groups');
const { IniFile } = require('./util/ini');
const { exists, listDir, uniqueDirName } = require('./util/fsx');
const { walkFiles } = require('./importer');
const { UserError, tr } = require('../shared/usertext');

const ICON_EXTS = ['png', 'svg', 'jpg', 'jpeg', 'webp', 'gif', 'ico'];
const same = (a, b) => Boolean(a && b) && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Prism Launcher's own instances and icons folders
async function prismFolders(prismDir) {
  if (!(await isPrismDataDir(prismDir))) {
    const e = new UserError('Esa carpeta no parece ser de Prism Launcher (no tiene prismlauncher.cfg ni la carpeta instances).');
    e.code = 'BAD_SOURCE';
    throw e;
  }
  const ctx = new PrismContext(path.resolve(prismDir), null);
  const d = await ctx.dirs();
  return { ctx, instancesDir: d.primaryInstanceDir, iconsDir: d.iconsDir };
}

async function countInstances(dir) {
  let n = 0;
  for (const e of await listDir(dir)) if (e.isDirectory() && (await exists(path.join(dir, e.name, 'instance.cfg')))) n++;
  return n;
}

class Sharing {
  // ownCtx(): PrismContext of Havi Hub's data folder with its OWN folders
  // (instances / icons), whatever the current sharing state is.
  constructor({ dataDir, appConfig, tasks, isRunning }) {
    this.dataDir = dataDir;
    this.appConfig = appConfig;
    this.tasks = tasks;
    this.isRunning = isRunning || (() => false);
  }

  ownDirs() {
    return { instancesDir: path.join(this.dataDir(), 'instances'), iconsDir: path.join(this.dataDir(), 'icons') };
  }

  // Folders the engine and Havi Hub should use now
  async activeDirs() {
    const s = this.appConfig.get().sharedInstances || {};
    if (s.enabled && s.prismDir) {
      try {
        const f = await prismFolders(s.prismDir);
        return { shared: true, instancesDir: f.instancesDir, iconsDir: f.iconsDir };
      } catch {
        /* Prism's folder is gone: fall back to our own */
      }
    }
    return { shared: false, ...this.ownDirs() };
  }

  async status() {
    const s = this.appConfig.get().sharedInstances || {};
    const a = await this.activeDirs();
    return { enabled: Boolean(s.enabled), prismDir: s.prismDir || '', active: a.shared, instancesDir: a.instancesDir, iconsDir: a.iconsDir, missing: Boolean(s.enabled) && !a.shared };
  }

  // What would happen: Prism's folder and Havi Hub's own profiles
  async preview(prismDir) {
    const f = await prismFolders(prismDir);
    const own = this.ownDirs();
    if (same(f.instancesDir, own.instancesDir)) throw new UserError('Esa es la carpeta de Havi Hub.');
    const prismIds = new Set((await listDir(f.instancesDir)).filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase()));
    const ownCtx = this.ownContext();
    const { instances } = await new Instances(ownCtx, this.appConfig).list();
    return {
      prismDir: path.resolve(prismDir),
      instancesDir: f.instancesDir,
      iconsDir: f.iconsDir,
      prismCount: await countInstances(f.instancesDir),
      own: instances.filter((i) => !i.broken).map((i) => ({ id: i.id, name: i.name, icon: i.icon, loader: i.loader, mcVersion: i.mcVersion, group: i.group || '', inPrism: prismIds.has(i.id.toLowerCase()), running: this.isRunning(i.id) })),
    };
  }

  // A context that always points at Havi Hub's own folders
  ownContext() {
    const own = this.ownDirs();
    const ctx = new PrismContext(this.dataDir(), null);
    const real = ctx.dirs.bind(ctx);
    ctx.dirs = async () => ({ ...(await real()), instanceDirs: [own.instancesDir], primaryInstanceDir: own.instancesDir, iconsDir: own.iconsDir });
    return ctx;
  }

  // Moves the chosen profiles into Prism's folder, then turns sharing on
  async enable({ prismDir, move = [] }) {
    const f = await prismFolders(prismDir);
    const ownCtx = this.ownContext();
    const own = this.ownDirs();
    const ownInstances = new Instances(ownCtx, this.appConfig);
    const ownGroups = await groups.loadGroupsSafe(ownCtx);
    return this.tasks.run(tr('Compartiendo perfiles con Prism Launcher'), { kind: 'share', cancelable: false }, async (task) => {
      const moved = [];
      const failed = [];
      let i = 0;
      for (const id of move) {
        task.progress(move.length ? i / move.length : 1, id);
        i++;
        if (this.isRunning(id)) {
          failed.push({ id, error: 'Está abierto en el juego' });
          continue;
        }
        try {
          const from = await ownInstances.locate(id);
          let destId = id;
          let renamed = false;
          if (await exists(path.join(f.instancesDir, id))) {
            destId = await uniqueDirName(f.instancesDir, `${id} (Havi Hub)`);
            renamed = true;
          }
          const dest = path.join(f.instancesDir, destId);
          await fsp.mkdir(f.instancesDir, { recursive: true });
          try {
            await fsp.rename(from, dest);
          } catch (e) {
            if (e.code !== 'EXDEV') throw e;
            const { files } = await walkFiles(from);
            for (const file of files) {
              const target = path.join(dest, path.relative(from, file.full));
              await fsp.mkdir(path.dirname(target), { recursive: true });
              if (!file.link) await fsp.copyFile(file.full, target);
            }
            await fsp.rm(from, { recursive: true, force: true });
          }
          const cfgPath = path.join(dest, 'instance.cfg');
          const cfg = await IniFile.load(cfgPath);
          if (renamed) {
            cfg.set('name', `${cfg.get('name') || id} (Havi Hub)`);
            await cfg.save(cfgPath);
          }
          // its image goes along, so Prism shows it too
          const key = cfg.get('iconKey');
          if (key && key !== 'default') {
            for (const ext of ICON_EXTS) {
              const src = path.join(own.iconsDir, `${key}.${ext}`);
              if (!(await exists(src))) continue;
              const to = path.join(f.iconsDir, `${key}.${ext}`);
              if (!(await exists(to))) {
                await fsp.mkdir(f.iconsDir, { recursive: true });
                await fsp.copyFile(src, to);
              }
              break;
            }
          }
          const g = ownGroups.map.get(id);
          if (g) await groups.setInstanceGroup(f.ctx, destId, g).catch(() => {});
          await groups.removeInstance(ownCtx, id).catch(() => {});
          moved.push({ from: id, id: destId, renamed });
        } catch (e) {
          failed.push({ id, error: String(e.message || e) });
        }
      }
      await this.appConfig.update({ sharedInstances: { enabled: true, prismDir: path.resolve(prismDir) } });
      task.progress(1, '');
      return { moved, failed, instancesDir: f.instancesDir };
    });
  }

  async disable() {
    await this.appConfig.update({ sharedInstances: { enabled: false } });
    return this.status();
  }
}

module.exports = { Sharing, prismFolders, same };
