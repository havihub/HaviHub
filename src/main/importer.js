// Import instances (with their groups, images, accounts and skins) from an
// existing Prism Launcher / PolyMC / MultiMC installation into Havi Hub's
// own data folder. Copying is the default; moving frees the space instantly
// when both folders are on the same drive.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { PrismContext, dataDirCandidates, isPrismDataDir } = require('./prism/paths');
const { Instances } = require('./prism/instances');
const groups = require('./prism/groups');
const { IniFile } = require('./util/ini');
const { exists, listDir, uniqueDirName, isInside, readJson, writeJson, parseLenientJson, safeName } = require('./util/fsx');
const { mergeAccounts } = require('./engine');
const cfImport = require('./importers/curseforge');
const mrImport = require('./importers/modrinth');
const { writeMetadata } = require('./prism/content');
const { isPlainFileName } = require('./util/safepath');
const { hashFile } = require('./util/hash');
const { fileUrl } = require('./urls');
const { throwIfCancelled } = require('./util/cancel');
const { cleanEnv } = require('../shared/envvars');
const { UserError, tr } = require('../shared/usertext');

const LOADER_INFO = {
  fabric: { uid: 'net.fabricmc.fabric-loader', name: 'Fabric' },
  quilt: { uid: 'org.quiltmc.quilt-loader', name: 'Quilt' },
  forge: { uid: 'net.minecraftforge', name: 'Forge' },
  neoforge: { uid: 'net.neoforged', name: 'NeoForge' },
};
const SOURCE_LABEL = { curseforge: 'CurseForge', modrinth: 'Modrinth' };

const ICON_EXTS = ['png', 'svg', 'jpg', 'jpeg', 'webp', 'gif', 'ico'];

// The general settings brought from another Prism Launcher: how games start
// (Java, memory, arguments, variables, commands, native libraries, window,
// console, play time). Havi Hub's own (theme, language, folders, keys) stay.
const GLOBAL_KEYS = [
  'JavaPath', 'AutomaticJavaSwitch', 'AutomaticJavaDownload', 'IgnoreJavaCompatibility',
  'MinMemAlloc', 'MaxMemAlloc', 'PermGen', 'LowMemWarning', 'JvmArgs', 'Env',
  'PreLaunchCommand', 'WrapperCommand', 'PostExitCommand',
  'UseNativeGLFW', 'CustomGLFWPath', 'UseNativeOpenAL', 'CustomOpenALPath', 'OnlineFixes',
  'EnableFeralGamemode', 'EnableMangoHud', 'UseDiscreteGpu', 'UseZink',
  'LaunchMaximized', 'MinecraftWinWidth', 'MinecraftWinHeight',
  'ShowConsole', 'AutoCloseConsole', 'RecordGameTime', 'ShowGameTime', 'ShowGlobalGameTime',
];

function otherLauncherDirs() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [path.join(appdata, 'PolyMC'), path.join(appdata, 'MultiMC')];
  }
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'PolyMC')];
  return [path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'PolyMC'), path.join(home, '.local', 'share', 'multimc')];
}

async function walkFiles(dir) {
  const files = [];
  let bytes = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of await listDir(cur)) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) {
        const st = await fsp.stat(full).catch(() => null);
        if (st) {
          files.push({ full, size: st.size });
          bytes += st.size;
        }
      } else if (ent.isSymbolicLink()) files.push({ full, size: 0, link: true });
    }
  }
  return { files, bytes };
}

class Importer {
  constructor({ ctxProvider, appConfig, tasks, emit, allowRoot }) {
    this.ctxProvider = ctxProvider;
    this.appConfig = appConfig;
    this.tasks = tasks;
    this.emit = emit;
    this.allowRoot = allowRoot || (() => {});
  }

  label(dir) {
    const base = path.basename(dir).toLowerCase();
    if (base.includes('polymc')) return 'PolyMC';
    if (base.includes('multimc')) return 'MultiMC';
    return 'Prism Launcher';
  }

  async detect() {
    const own = this.ctxProvider() ? path.resolve(this.ctxProvider().dataDir) : '';
    const seen = new Set();
    const out = [];
    const extra = (process.env.HAVIHUB_IMPORT_DIRS || '').split(path.delimiter).filter(Boolean);
    for (const dir of [...extra, ...dataDirCandidates(), ...otherLauncherDirs()]) {
      const abs = path.resolve(dir);
      if (seen.has(abs.toLowerCase()) || abs === own || !(await isPrismDataDir(abs))) continue;
      seen.add(abs.toLowerCase());
      let count = 0;
      try {
        const ctx = new PrismContext(abs, null);
        for (const d of (await ctx.dirs()).instanceDirs) {
          for (const ent of await listDir(d)) if (ent.isDirectory() && (await exists(path.join(d, ent.name, 'instance.cfg')))) count++;
        }
      } catch {
        /* unreadable */
      }
      out.push({ dataDir: abs, label: this.label(abs), count, shared: await this.isShared(abs) });
    }
    return out;
  }

  // true when Havi Hub already uses this installation's profiles folder
  async isShared(srcDir) {
    const ctx = this.ctxProvider();
    if (!ctx) return false;
    try {
      const own = (await ctx.dirs()).primaryInstanceDir;
      const theirs = (await new PrismContext(path.resolve(srcDir), null).dirs()).primaryInstanceDir;
      return path.resolve(own).toLowerCase() === path.resolve(theirs).toLowerCase();
    } catch {
      return false;
    }
  }

  async refuseShared(srcDir) {
    if (await this.isShared(srcDir)) {
      const e = new UserError('Havi Hub ya comparte los perfiles con esta instalación de Prism Launcher: no hace falta importarlos.');
      e.code = 'SHARED';
      throw e;
    }
  }

  async list(srcDir) {
    await this.refuseShared(srcDir);
    if (!(await isPrismDataDir(srcDir))) {
      const e = new UserError('Esa carpeta no parece ser de Prism Launcher (no tiene prismlauncher.cfg ni la carpeta instances).');
      e.code = 'BAD_SOURCE';
      throw e;
    }
    const src = new PrismContext(path.resolve(srcDir), null);
    const d = await src.dirs();
    this.allowRoot([src.dataDir, ...d.instanceDirs, d.iconsDir]);
    const { instances, groups: groupNames } = await new Instances(src, this.appConfig).list();
    const ctx = this.ctxProvider();
    const ownIds = new Set();
    if (ctx) for (const dir of (await ctx.dirs()).instanceDirs) for (const ent of await listDir(dir)) ownIds.add(ent.name);
    const accounts = await readJson(src.accountsFile(), { accounts: [] });
    const skinsIndex = await readJson(path.join(d.skinsDir, 'index.json'), { skins: [] });
    return {
      dataDir: src.dataDir,
      label: this.label(src.dataDir),
      instances: instances.filter((i) => !i.broken).map((i) => ({ ...i, exists: ownIds.has(i.id) })),
      groups: groupNames,
      accounts: (accounts.accounts || []).filter((a) => a.profile && a.profile.name).map((a) => ({ name: a.profile.name, type: a.type || 'MSA' })),
      skins: Array.isArray(skinsIndex.skins) ? skinsIndex.skins.length : 0,
    };
  }

  async sizes(srcDir, ids) {
    const src = new PrismContext(path.resolve(srcDir), null);
    const insts = new Instances(src, this.appConfig);
    const out = {};
    for (const id of ids) {
      try {
        out[id] = (await walkFiles(await insts.locate(id))).bytes;
      } catch {
        out[id] = null;
      }
    }
    return out;
  }

  // opts: { srcDir, ids, move, accounts, skins, groups, shared, globals }
  async run(opts) {
    const ctx = this.ctxProvider();
    if (!ctx) throw new UserError('La carpeta de datos de Havi Hub no está disponible.');
    await this.refuseShared(opts.srcDir);
    const src = new PrismContext(path.resolve(opts.srcDir), null);
    const srcInstances = new Instances(src, this.appConfig);
    const srcDirs = await src.dirs();
    const ownDirs = await ctx.dirs();
    await fsp.mkdir(ownDirs.primaryInstanceDir, { recursive: true });
    const srcGroups = opts.groups !== false ? await groups.loadGroupsSafe(src) : null;
    const label = this.label(src.dataDir);

    return this.tasks.run(tr('Importando desde {from}', { from: label }), { kind: 'import' }, async (task) => {
      const plan = [];
      let totalBytes = 0;
      task.progress(0, tr('Calculando tamaño…'));
      for (const id of opts.ids || []) {
        const root = await srcInstances.locate(id);
        const walk = opts.move ? { files: [], bytes: 0 } : await walkFiles(root);
        totalBytes += walk.bytes;
        plan.push({ id, root, walk });
      }
      let doneBytes = 0;
      const imported = [];
      const failed = [];
      for (const item of plan) {
        task.check(); // stopped: the profiles already copied stay, the rest is skipped
        const destId = await uniqueDirName(ownDirs.primaryInstanceDir, item.id);
        const dest = path.join(ownDirs.primaryInstanceDir, destId);
        task.progress(totalBytes ? doneBytes / totalBytes : imported.length / plan.length, item.id);
        try {
          let moved = false;
          if (opts.move) {
            try {
              await fsp.rename(item.root, dest);
              moved = true;
            } catch (e) {
              if (e.code !== 'EXDEV') throw e;
              item.walk = await walkFiles(item.root);
              totalBytes += item.walk.bytes;
            }
          }
          if (!moved) {
            for (const f of item.walk.files) {
              if (!opts.move) task.check();
              const rel = path.relative(item.root, f.full);
              const target = path.join(dest, rel);
              await fsp.mkdir(path.dirname(target), { recursive: true });
              if (f.link) {
                const link = await fsp.readlink(f.full);
                await fsp.symlink(link, target).catch(() => {});
              } else await fsp.copyFile(f.full, target);
              doneBytes += f.size;
              task.progress(totalBytes ? doneBytes / totalBytes : 0, `${item.id} · ${Math.round(doneBytes / 1048576)} / ${Math.round(totalBytes / 1048576)} MB`);
            }
            for (const ent of await listDir(item.root)) if (ent.isDirectory()) await fsp.mkdir(path.join(dest, ent.name), { recursive: true });
            if (opts.move) await fsp.rm(item.root, { recursive: true, force: true });
          }
          await this.fixInstance(dest, src, srcDirs, ownDirs, opts.shared !== false);
          if (srcGroups) {
            const g = srcGroups.map.get(item.id);
            if (g) await groups.setInstanceGroup(ctx, destId, g);
          }
          if (opts.move && srcGroups) await groups.removeInstance(src, item.id).catch(() => {});
          imported.push({ from: item.id, id: destId });
        } catch (e) {
          if (!opts.move) await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
          if (task.cancelled()) {
            this.emit('instances:changed', {});
            throw e;
          }
          failed.push({ id: item.id, error: String(e.message || e) });
        }
      }
      let accounts = 0;
      if (opts.accounts) {
        try {
          const data = parseLenientJson(await fsp.readFile(src.accountsFile(), 'utf8'));
          const list = (data.accounts || []).filter((a) => a.profile && a.profile.id);
          if (list.length) {
            await mergeAccounts(ctx.accountsFile(), list);
            accounts = list.length;
          }
        } catch {
          /* no accounts */
        }
      }
      let skins = 0;
      if (opts.skins) skins = await this.copySkins(srcDirs.skinsDir, ownDirs.skinsDir).catch(() => 0);
      let globals = 0;
      if (opts.globals !== false) globals = await this.copyGlobals(src, ctx, opts.shared !== false).catch(() => 0);
      // Game files Prism already downloaded (assets, libraries, Java…): linked,
      // not copied, so the first launch doesn't download them again
      let shared = 0;
      if (opts.shared !== false) {
        shared = await this.linkShared(src.dataDir, ctx.dataDir, (n) => task.progress(1, tr('Reusando archivos del juego ya descargados… {n}', { n }))).catch(() => 0);
      }
      task.progress(1, '');
      this.emit('instances:changed', {});
      if (accounts) this.emit('accounts:changed', {});
      if (skins) this.emit('skins:changed', {});
      return { imported, failed, accounts, skins, shared, globals };
    });
  }

  // A path inside the other installation (its own Java, say) points to the
  // same file in Havi Hub's folder when those files were brought too
  movePath(p, src, ctx, linked) {
    if (!p || !linked || !isInside(p, src.dataDir) || !fs.existsSync(p)) return p;
    return path.join(ctx.dataDir, path.relative(src.dataDir, p));
  }

  async copyGlobals(src, ctx, linked) {
    const from = await src.loadCfg();
    const to = await ctx.loadCfg();
    let n = 0;
    for (const key of GLOBAL_KEYS) {
      if (!from.has(key)) continue;
      let v = from.get(key);
      if (key === 'JavaPath') v = this.movePath(v, src, ctx, linked);
      if (key === 'Env') v = cleanEnv(v);
      if (String(to.get(key)) === String(v)) continue;
      to.set(key, v);
      n++;
    }
    if (n) await to.save();
    return n;
  }

  // ------------------------------------------------ CurseForge / Modrinth app
  async detectAll() {
    const prism = await this.detect().catch(() => []);
    const seen = new Set();
    const curseforge = [];
    for (const c of cfImport.candidates()) {
      const root = await cfImport.resolveRoot(c);
      if (!root || seen.has(root.toLowerCase()) || !(await exists(root))) continue;
      seen.add(root.toLowerCase());
      const list = await cfImport.listProfiles(root).catch(() => []);
      if (list.length) curseforge.push({ dir: root, label: 'CurseForge', count: list.length });
    }
    const modrinth = [];
    for (const c of mrImport.candidates()) {
      const root = await mrImport.resolveRoot(c);
      if (!root || seen.has(root.toLowerCase()) || !(await mrImport.isApp(root))) continue;
      seen.add(root.toLowerCase());
      try {
        const { profiles } = await mrImport.readApp(root);
        if (profiles.length) modrinth.push({ dir: root, label: 'Modrinth', count: profiles.length });
      } catch (e) {
        modrinth.push({ dir: root, label: 'Modrinth', count: 0, error: String(e.message || e) });
      }
    }
    return { prism, curseforge, modrinth };
  }

  // Profiles of a CurseForge / Modrinth installation, normalized
  async externalProfiles(source, dir) {
    if (source === 'curseforge') {
      const root = await cfImport.resolveRoot(dir);
      const profiles = root && (await exists(root)) ? await cfImport.listProfiles(root) : [];
      if (!profiles.length) throw Object.assign(new UserError('No se encontraron perfiles de CurseForge en esa carpeta (busca la carpeta "Instances" de CurseForge).'), { code: 'BAD_SOURCE' });
      return { root, profiles, shared: cfImport.sharedDirs(root), skip: cfImport.SKIP };
    }
    if (source === 'modrinth') {
      const root = await mrImport.resolveRoot(dir);
      if (!(await mrImport.isApp(root))) throw Object.assign(new UserError('Esa carpeta no parece ser de la app de Modrinth (no tiene app.db ni la carpeta profiles).'), { code: 'BAD_SOURCE' });
      const { configDir, profiles, launch } = await mrImport.readApp(root);
      return { root, profiles, launch, shared: mrImport.sharedDirs(configDir), skip: mrImport.SKIP };
    }
    throw new Error(`Origen desconocido: ${source}`);
  }

  async listFrom(source, dir) {
    if (source === 'prism') return { source, ...(await this.list(dir)) };
    const { root, profiles } = await this.externalProfiles(source, dir);
    this.allowRoot([root, ...profiles.map((p) => p.dir), ...profiles.filter((p) => p.image).map((p) => path.dirname(p.image))]);
    const ctx = this.ctxProvider();
    const own = new Set();
    if (ctx) {
      const { instances } = await new Instances(ctx, this.appConfig).list().catch(() => ({ instances: [] }));
      for (const i of instances) own.add(String(i.name).toLowerCase());
    }
    return {
      source,
      dataDir: root,
      label: SOURCE_LABEL[source],
      groups: [...new Set(profiles.map((p) => p.group).filter(Boolean))],
      accounts: [],
      skins: 0,
      instances: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        mcVersion: p.mcVersion,
        loader: p.loader ? { id: p.loader.id, name: LOADER_INFO[p.loader.id].name, version: p.loader.version } : null,
        icon: p.image ? fileUrl(p.image) : null,
        group: p.group || '',
        lastLaunch: p.lastPlayed || 0,
        exists: own.has(String(p.name).toLowerCase()),
        incomplete: Boolean(p.incomplete),
      })),
    };
  }

  async sizesFrom(source, dir, ids) {
    if (source === 'prism') return this.sizes(dir, ids);
    const { profiles } = await this.externalProfiles(source, dir);
    const out = {};
    for (const id of ids) {
      const p = profiles.find((x) => x.id === id);
      out[id] = p ? (await walkFiles(p.dir).catch(() => ({ bytes: null }))).bytes : null;
    }
    return out;
  }

  // opts: { source, srcDir, ids, groups, shared } (+ the Prism options)
  async runFrom(opts) {
    if (opts.source === 'prism' || !opts.source) return this.run(opts);
    const ctx = this.ctxProvider();
    if (!ctx) throw new UserError('La carpeta de datos de Havi Hub no está disponible.');
    const { profiles, shared, skip, launch } = await this.externalProfiles(opts.source, opts.srcDir);
    const chosen = profiles.filter((p) => (opts.ids || []).includes(p.id));
    const ownDirs = await ctx.dirs();
    await fsp.mkdir(ownDirs.primaryInstanceDir, { recursive: true });
    const instances = new Instances(ctx, this.appConfig);
    const label = SOURCE_LABEL[opts.source];
    return this.tasks.run(tr('Importando desde {from}', { from: label }), { kind: 'import' }, async (task) => {
      task.progress(0, tr('Calculando tamaño…'));
      let totalBytes = 0;
      for (const p of chosen) {
        // a profile synced by Havi Hub is a link to the shared folder: copy what it points to
        p.dir = await fsp.realpath(p.dir).catch(() => p.dir);
        p.bytes = (await walkFiles(p.dir).catch(() => ({ bytes: 0 }))).bytes;
        totalBytes += p.bytes;
      }
      let doneBytes = 0;
      const imported = [];
      const failed = [];
      for (const p of chosen) {
        const destId = await uniqueDirName(ownDirs.primaryInstanceDir, safeName(p.name, p.id));
        const dest = path.join(ownDirs.primaryInstanceDir, destId);
        const game = path.join(dest, 'minecraft');
        try {
          await copyTree(p.dir, game, {
            skip: new Set([...skip, '.havihub']),
            onBytes: (n) => {
              doneBytes += n;
              task.progress(totalBytes ? doneBytes / totalBytes : 0, `${p.name} · ${Math.round(doneBytes / 1048576)} / ${Math.round(totalBytes / 1048576)} MB`);
            },
          });
          await this.writeConverted(dest, p, opts.source, launch);
          if (p.image) {
            const img = await fsp.readFile(p.image).catch(() => null);
            if (img && img.length) await instances.setImage(destId, img).catch(() => {});
          }
          if (opts.source === 'curseforge' && this.appConfig.get().writePrismMetadata !== false) await this.writeCurseMetadata(game, p).catch(() => {});
          if (opts.groups !== false && p.group) await groups.setInstanceGroup(ctx, destId, p.group).catch(() => {});
          imported.push({ from: p.id, id: destId });
        } catch (e) {
          await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
          if (task.cancelled()) {
            this.emit('instances:changed', {});
            throw e;
          }
          failed.push({ id: p.name, error: String(e.message || e) });
        }
      }
      let linked = 0;
      if (opts.shared !== false) {
        for (const [from, name] of shared) {
          linked += await this.linkInto(from, path.join(ctx.dataDir, name), (n) => task.progress(1, tr('Reusando archivos del juego ya descargados… {n}', { n }))).catch(() => 0);
        }
      }
      task.progress(1, '');
      this.emit('instances:changed', {});
      return { imported, failed, accounts: 0, skins: 0, shared: linked };
    });
  }

  // instance.cfg + mmc-pack.json for a profile from another launcher.
  // launch: what that launcher used for every profile (only the values the
  // person changed); a profile's own setting wins over it.
  async writeConverted(dest, p, source, launch = {}) {
    const cfg = await IniFile.load(path.join(dest, 'instance.cfg'));
    cfg.set('ConfigVersion', '1.3');
    cfg.set('InstanceType', 'OneSix');
    cfg.set('name', p.name);
    cfg.set('iconKey', 'default');
    if (p.lastPlayed) cfg.set('lastLaunchTime', String(Math.round(p.lastPlayed)));
    if (p.played) cfg.set('totalTimePlayed', String(Math.round(p.played)));
    const g = launch || {};
    const memory = p.memory || g.memory || 0;
    if (memory) {
      cfg.set('OverrideMemory', true);
      cfg.set('MaxMemAlloc', String(memory));
    }
    const args = String(p.jvmArgs || '').trim() || String(g.jvmArgs || '').trim();
    if (args) {
      cfg.set('OverrideJavaArgs', true);
      cfg.set('JvmArgs', args);
    }
    if (p.javaPath) {
      cfg.set('OverrideJavaLocation', true);
      cfg.set('AutomaticJava', false);
      cfg.set('JavaPath', p.javaPath);
    }
    const env = { ...(g.env || {}), ...(p.env || {}) };
    if (Object.keys(env).length) {
      cfg.set('OverrideEnv', true);
      cfg.set('Env', cleanEnv(JSON.stringify(env)));
    }
    const res = p.resolution || g.resolution || null;
    const full = p.fullscreen === true || (p.fullscreen !== false && g.fullscreen === true);
    if (res || full) {
      cfg.set('OverrideWindow', true);
      if (res) {
        cfg.set('MinecraftWinWidth', res[0]);
        cfg.set('MinecraftWinHeight', res[1]);
      }
      if (full) cfg.set('LaunchMaximized', true);
    }
    const ph = p.hooks || {};
    const gh = g.hooks || {};
    const hooks = { pre: ph.pre || gh.pre || '', wrapper: ph.wrapper || gh.wrapper || '', post: ph.post || gh.post || '' };
    if (hooks.pre || hooks.wrapper || hooks.post) {
      cfg.set('OverrideCommands', true);
      cfg.set('PreLaunchCommand', hooks.pre);
      cfg.set('WrapperCommand', hooks.wrapper);
      cfg.set('PostExitCommand', hooks.post);
    }
    if (p.modpack) {
      cfg.set('ManagedPack', true);
      cfg.set('ManagedPackType', source === 'curseforge' ? 'flame' : 'modrinth');
      cfg.set('ManagedPackID', String(p.modpack.projectId));
      cfg.set('ManagedPackVersionID', String(p.modpack.fileId || p.modpack.versionId || ''));
      cfg.set('ManagedPackName', p.modpack.name || p.name);
      if (p.modpack.version) cfg.set('ManagedPackVersionName', p.modpack.version);
    }
    await cfg.save(path.join(dest, 'instance.cfg'));
    const components = [{ uid: 'net.minecraft', version: p.mcVersion, important: true }];
    if (p.loader && LOADER_INFO[p.loader.id]) components.push({ uid: LOADER_INFO[p.loader.id].uid, version: p.loader.version });
    await writeJson(path.join(dest, 'mmc-pack.json'), { components, formatVersion: 1 }, 4);
  }

  // CurseForge knows which project each file comes from: keep that, so the
  // mods show their name, author and image and can be updated
  async writeCurseMetadata(game, p) {
    for (const a of p.addons || []) {
      if (!isPlainFileName(a.fileName)) continue;
      for (const folder of ['mods', 'resourcepacks']) {
        let file = path.join(game, folder, a.fileName);
        let name = a.fileName;
        if (!(await exists(file)) && (await exists(`${file}.disabled`))) {
          file = `${file}.disabled`;
          name = `${a.fileName}.disabled`;
        }
        if (!(await exists(file))) continue;
        const hash = a.sha1 || (await hashFile(file, 'sha1').catch(() => ''));
        await writeMetadata(path.join(game, folder, '.index'), {
          slug: a.slug || a.name,
          name: a.name,
          filename: name.replace(/\.disabled$/, ''),
          side: 'both',
          loaders: [],
          mcVersions: a.gameVersions.filter((v) => /^\d/.test(v)),
          releaseType: a.releaseType,
          versionNumber: a.versionNumber,
          hash,
          hashFormat: 'sha1',
          provider: 'curseforge',
          projectId: a.projectId,
          fileId: a.fileId,
          dependencies: [],
        });
        break;
      }
    }
  }

  // Hard links (or copies) files the other launcher already downloaded
  async linkInto(from, to, onProgress) {
    if (!(await exists(from))) return 0;
    let n = 0;
    const { files } = await walkFiles(from);
    for (const f of files) {
      if (f.link) continue;
      const target = path.join(to, path.relative(from, f.full));
      if (await exists(target)) continue;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      try {
        await fsp.link(f.full, target);
      } catch {
        await fsp.copyFile(f.full, target).catch(() => {});
      }
      n++;
      if (onProgress && n % 500 === 0) onProgress(n);
    }
    return n;
  }

  // Make the copy independent from the old installation. A Java the profile
  // picked from the old installation's own folder is the same one in Havi
  // Hub's when the game files were brought (linked); otherwise it stays where
  // it is.
  async fixInstance(dest, src, srcDirs, ownDirs, linked) {
    const cfgPath = path.join(dest, 'instance.cfg');
    const cfg = await IniFile.load(cfgPath);
    let changed = false;
    const java = cfg.get('JavaPath');
    const moved = this.movePath(java, src, this.ctxProvider(), linked);
    if (java && moved !== java) {
      cfg.set('JavaPath', moved);
      changed = true;
    }
    const key = cfg.get('iconKey');
    if (key && key !== 'default') {
      for (const ext of ICON_EXTS) {
        const from = path.join(srcDirs.iconsDir, `${key}.${ext}`);
        if (await exists(from)) {
          const to = path.join(ownDirs.iconsDir, `${key}.${ext}`);
          if (!(await exists(to))) {
            await fsp.mkdir(ownDirs.iconsDir, { recursive: true });
            await fsp.copyFile(from, to);
          }
          break;
        }
      }
    }
    if (changed) await cfg.save(cfgPath);
  }

  async linkShared(fromRoot, toRoot, onProgress) {
    let n = 0;
    for (const name of ['assets', 'libraries', 'meta', 'java']) {
      const from = path.join(fromRoot, name);
      if (!(await exists(from))) continue;
      const { files } = await walkFiles(from);
      for (const f of files) {
        if (f.link) continue;
        const target = path.join(toRoot, name, path.relative(from, f.full));
        if (await exists(target)) continue;
        await fsp.mkdir(path.dirname(target), { recursive: true });
        try {
          await fsp.link(f.full, target);
        } catch {
          await fsp.copyFile(f.full, target).catch(() => {});
        }
        n++;
        if (onProgress && n % 500 === 0) onProgress(n);
      }
    }
    return n;
  }

  async copySkins(fromDir, toDir) {
    if (!(await exists(fromDir))) return 0;
    await fsp.mkdir(toDir, { recursive: true });
    let n = 0;
    for (const ent of await listDir(fromDir)) {
      if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.png')) continue;
      const to = path.join(toDir, ent.name);
      if (await exists(to)) continue;
      await fsp.copyFile(path.join(fromDir, ent.name), to);
      n++;
    }
    const srcIndex = await readJson(path.join(fromDir, 'index.json'), null);
    if (srcIndex && Array.isArray(srcIndex.skins)) {
      const ownFile = path.join(toDir, 'index.json');
      const own = (await readJson(ownFile, null)) || { skins: [] };
      if (!Array.isArray(own.skins)) own.skins = [];
      const names = new Set(own.skins.map((s) => s.name));
      for (const s of srcIndex.skins) if (s && s.name && !names.has(s.name)) own.skins.push(s);
      await writeJson(ownFile, own, 4);
    }
    return n;
  }
}

// Copies a folder tree; top-level names in `skip` are left out
async function copyTree(from, to, { skip = new Set(), onBytes } = {}) {
  const { files } = await walkFiles(from);
  for (const f of files) {
    throwIfCancelled();
    const rel = path.relative(from, f.full);
    const top = rel.split(path.sep)[0];
    if (skip.has(top)) continue;
    const target = path.join(to, rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (f.link) {
      const link = await fsp.readlink(f.full).catch(() => null);
      if (link) await fsp.symlink(link, target).catch(() => {});
    } else await fsp.copyFile(f.full, target);
    if (onBytes) onBytes(f.size);
  }
  for (const ent of await listDir(from)) if (ent.isDirectory() && !skip.has(ent.name)) await fsp.mkdir(path.join(to, ent.name), { recursive: true });
}

module.exports = { Importer, walkFiles, copyTree, LOADER_INFO };
