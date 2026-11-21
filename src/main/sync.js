// Profiles kept in sync between launchers: Havi Hub (and Prism Launcher when
// its profiles are shared), CurseForge and the Modrinth App. The profiles of a
// group keep their own launcher settings, but their game folders (mods,
// worlds, configs, screenshots…) become links (Windows junctions) to one
// shared folder inside Havi Hub's data folder.
//
// Nothing is ever deleted: when two profiles are joined, the main one's mods
// and settings win and anything that does not fit goes to a backup folder
// inside the shared one. Leaving the sync gives each profile a full copy.
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { Instances, gameDirOf } = require('./prism/instances');
const groups = require('./prism/groups');
const { exists, uniqueDirName, safeName } = require('./util/fsx');
const { fileUrl } = require('./urls');
const cfImport = require('./importers/curseforge');
const mrImport = require('./importers/modrinth');
const { UserError, tr } = require('../shared/usertext');

const LAUNCHERS = { havi: 'Havi Hub', curseforge: 'CurseForge', modrinth: 'Modrinth App' };
// files a launcher keeps in the game folder itself: they stay at the root of
// the shared folder (one per launcher)
const META_FILES = new Set(['minecraftinstance.json', 'profile.json']);
// the pack itself: the main profile's copy wins
const PACK = new Set(['mods', 'config', 'defaultconfigs', 'kubejs', 'scripts', 'global_packs', 'options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat', 'servers.dat_old']);
// the player's things: everything is kept (same names are renamed / backed up)
const UNION = new Set(['saves', 'screenshots', 'resourcepacks', 'shaderpacks', 'schematics', 'journeymap', 'xaero', 'XaeroWaypoints', 'XaeroWorldMap', 'replay_recordings', 'backups']);
// leftovers that are not worth merging
const DROP = new Set(['logs', 'crash-reports', '.fabric', '.cache', 'natives', 'debug']);

const norm = (p) => {
  let s = path.resolve(String(p || '').replace(/^\\\\\?\\/, ''));
  if (process.platform === 'win32') s = s.toLowerCase();
  return s.replace(/[\\/]+$/, '');
};
const samePath = (a, b) => Boolean(a && b) && norm(a) === norm(b);
const nameKey = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9áéíóúñü]+/g, ' ')
    .trim();

async function lstat(p) {
  try {
    return await fsp.lstat(p);
  } catch {
    return null;
  }
}

async function linkTarget(p) {
  const st = await lstat(p);
  if (!st || !st.isSymbolicLink()) return null;
  try {
    return path.resolve(path.dirname(p), await fsp.readlink(p));
  } catch {
    return null;
  }
}

// removes a link (Windows junction or symlink), never what it points to
async function removeLink(p) {
  try {
    await fsp.unlink(p);
  } catch (e) {
    if (process.platform !== 'win32') throw e;
    await fsp.rmdir(p);
  }
}

async function makeLink(target, at) {
  await fsp.mkdir(path.dirname(at), { recursive: true });
  await fsp.symlink(target, at, process.platform === 'win32' ? 'junction' : 'dir');
}

// rename, or copy + remove when the folders are on different drives
async function move(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    await fsp.rm(from, { recursive: true, force: true });
  }
}

async function freeName(p) {
  if (!(await lstat(p))) return p;
  const ext = path.extname(p);
  const base = ext && ext.length < 8 ? p.slice(0, -ext.length) : p;
  for (let i = 2; ; i++) {
    const c = ext && ext.length < 8 ? `${base} (${i})${ext}` : `${p} (${i})`;
    if (!(await lstat(c))) return c;
  }
}

// removes the folders left empty after a merge (never anything with files)
async function pruneEmpty(dir) {
  const st = await lstat(dir);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) return false;
  let empty = true;
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !e.isSymbolicLink()) {
      if (!(await pruneEmpty(p))) empty = false;
    } else empty = false;
  }
  if (empty) await fsp.rmdir(dir).catch(() => (empty = false));
  return empty;
}

// byte for byte the same (big files are not compared: they count as different)
async function sameFile(a, b) {
  const [x, y] = await Promise.all([lstat(a), lstat(b)]);
  if (!x || !y || !x.isFile() || !y.isFile() || x.size !== y.size || x.size > 256 * 1024 * 1024) return false;
  const [da, db] = await Promise.all([fsp.readFile(a), fsp.readFile(b)]);
  return da.equals(db);
}

// Windows: is CurseForge / the Modrinth App open?
function runningLaunchers() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err) return resolve([]);
      const names = new Set(String(out).split(/\r?\n/).map((l) => (l.split('","')[0] || '').replace(/^"/, '').toLowerCase()));
      const found = [];
      if (names.has('curseforge.exe')) found.push('curseforge');
      if (names.has('modrinth app.exe') || names.has('modrinth-app.exe')) found.push('modrinth');
      resolve(found);
    });
  });
}

class SyncManager {
  constructor({ appConfig, tasks, ctxProvider, importer, emit, isRunning, allowRoot }) {
    this.appConfig = appConfig;
    this.tasks = tasks;
    this.ctxProvider = ctxProvider;
    this.importer = importer;
    this.emit = emit || (() => {});
    this.isRunning = isRunning || (() => false);
    this.allowRoot = allowRoot || (() => {});
    this.running = runningLaunchers;
  }

  groups() {
    return (this.appConfig.get().sync || {}).groups || [];
  }

  async saveGroups(list) {
    await this.appConfig.replaceKey('sync', { ...(this.appConfig.get().sync || {}), groups: list });
  }

  storeRoot() {
    const ctx = this.ctxProvider();
    if (!ctx) throw new UserError('La carpeta de datos de Havi Hub no está disponible.');
    return path.join(ctx.dataDir, 'synced');
  }

  // ------------------------------------------------ profiles of every launcher
  async profiles() {
    const out = [];
    const ctx = this.ctxProvider();
    const sharing = this.appConfig.get().sharedInstances || {};
    if (ctx) {
      const { instances } = await new Instances(ctx, this.appConfig).list().catch(() => ({ instances: [] }));
      for (const i of instances) {
        if (i.broken) continue;
        out.push({ launcher: 'havi', label: sharing.enabled ? 'Havi Hub + Prism Launcher' : LAUNCHERS.havi, id: i.id, name: i.name, dir: i.gameDir, mcVersion: i.mcVersion, loader: i.loader ? { id: i.loader.id, version: i.loader.version } : null, lastPlayed: i.lastLaunch || 0, icon: i.icon || null, iconRecipe: i.iconRecipe || '', instanceId: i.id });
      }
    }
    const seen = new Set();
    for (const c of cfImport.candidates()) {
      const root = await cfImport.resolveRoot(c);
      if (!root || seen.has(norm(root)) || !(await exists(root))) continue;
      seen.add(norm(root));
      for (const p of await cfImport.listProfiles(root).catch(() => [])) {
        out.push({ launcher: 'curseforge', label: LAUNCHERS.curseforge, id: p.id, name: p.name, dir: p.dir, mcVersion: p.mcVersion, loader: p.loader, lastPlayed: p.lastPlayed, icon: p.image ? fileUrl(p.image) : null, raw: p });
        if (p.image) this.allowRoot([path.dirname(p.image)]);
      }
    }
    for (const c of mrImport.candidates()) {
      const root = await mrImport.resolveRoot(c);
      if (!root || seen.has(norm(root)) || !(await mrImport.isApp(root))) continue;
      seen.add(norm(root));
      try {
        const { profiles } = await mrImport.readApp(root);
        for (const p of profiles) {
          if (p.incomplete) continue;
          out.push({ launcher: 'modrinth', label: LAUNCHERS.modrinth, id: p.id, name: p.name, dir: p.dir, mcVersion: p.mcVersion, loader: p.loader, lastPlayed: p.lastPlayed, icon: p.image ? fileUrl(p.image) : null, raw: p });
          if (p.image) this.allowRoot([path.dirname(p.image)]);
        }
      } catch {
        /* unreadable Modrinth App data */
      }
    }
    // which group each profile is in
    const list = this.groups();
    for (const p of out) {
      const g = list.find((x) => x.members.some((m) => samePath(m.dir, p.dir)));
      p.group = g ? g.id : null;
      p.linked = Boolean(g) && Boolean(await linkTarget(p.dir));
    }
    return out;
  }

  // Everything the dialog needs: profiles, groups and suggested matches
  async scan() {
    const profiles = await this.profiles();
    const strip = (p) => ({ launcher: p.launcher, label: p.label, id: p.id, name: p.name, dir: p.dir, mcVersion: p.mcVersion, loader: p.loader, lastPlayed: p.lastPlayed, icon: p.icon, iconRecipe: p.iconRecipe || '', instanceId: p.instanceId || null, group: p.group, linked: p.linked });
    const loose = profiles.filter((p) => !p.group);
    const byKey = new Map();
    for (const p of loose) {
      const key = `${nameKey(p.name)}|${p.mcVersion}|${p.loader ? p.loader.id : 'vanilla'}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p);
    }
    const suggestions = [];
    for (const [key, list] of byKey) {
      const launchers = new Set(list.map((p) => p.launcher));
      if (launchers.size < 2) continue;
      // one per launcher: the most recently played
      const pick = [...launchers].map((l) => list.filter((p) => p.launcher === l).sort((a, b) => b.lastPlayed - a.lastPlayed)[0]);
      suggestions.push({ key, name: pick[0].name, mcVersion: pick[0].mcVersion, loader: pick[0].loader, profiles: pick.map(strip) });
    }
    const groupsOut = [];
    for (const g of this.groups()) {
      const members = [];
      for (const m of g.members) {
        const target = await linkTarget(m.dir);
        members.push({ ...m, ok: Boolean(target) && samePath(target, g.store), missing: !(await lstat(m.dir)) });
      }
      groupsOut.push({ ...g, members, storeMissing: !(await exists(g.store)) });
    }
    return {
      profiles: profiles.map(strip),
      suggestions,
      groups: groupsOut,
      running: await this.running(),
      prismSharing: Boolean((this.appConfig.get().sharedInstances || {}).enabled),
    };
  }

  async findProfile(ref) {
    const all = await this.profiles();
    const p = all.find((x) => samePath(x.dir, ref.dir));
    if (!p) throw new UserError('No se encontró el perfil "{name}".', { name: ref.name || ref.dir });
    return p;
  }

  async ensureClosed(launchers) {
    const open = (await this.running()).filter((l) => launchers.includes(l));
    if (open.length) {
      const names = open.map((l) => LAUNCHERS[l]);
      const e =
        names.length > 1
          ? new UserError('Cierra {a} y {b} antes de sincronizar: sus perfiles no se pueden mover mientras están abiertos.', { a: names.slice(0, -1).join(', '), b: names[names.length - 1] })
          : new UserError('Cierra {a} antes de sincronizar: sus perfiles no se pueden mover mientras está abierto.', { a: names[0] });
      e.code = 'LAUNCHER_OPEN';
      throw e;
    }
  }

  // ------------------------------------------------ join profiles
  // main: the profile whose mods and settings win; others: the rest
  async link({ main, others = [] }) {
    const m = await this.findProfile(main);
    const rest = [];
    for (const r of others) rest.push(await this.findProfile(r));
    const all = [m, ...rest];
    const launchers = all.map((p) => p.launcher);
    if (new Set(launchers).size !== launchers.length) throw new UserError('Elige un solo perfil de cada launcher.');
    for (const p of rest) {
      if (p.mcVersion !== m.mcVersion || (p.loader ? p.loader.id : '') !== (m.loader ? m.loader.id : '')) {
        throw new UserError('"{name}" ({label}) usa otra versión o cargador que "{other}": no se pueden sincronizar.', { name: p.name, label: p.label, other: m.name });
      }
    }
    for (const p of all) {
      if (p.group) throw new UserError('"{name}" ({label}) ya está sincronizado.', { name: p.name, label: p.label });
      if (p.launcher === 'havi' && this.isRunning(p.instanceId)) throw new UserError('"{name}" está abierto en el juego.', { name: p.name });
    }
    await this.ensureClosed(launchers);
    return this.tasks.run(tr('Sincronizando {name}', { name: m.name }), { kind: 'sync', cancelable: false }, async (task) => {
      const root = this.storeRoot();
      await fsp.mkdir(root, { recursive: true });
      const store = path.join(root, await uniqueDirName(root, safeName(m.name, 'perfil')));
      const backup = path.join(store, '.havihub', `respaldo-${new Date().toISOString().slice(0, 10)}`);
      task.progress(0.05, m.name);
      // the main profile's folder becomes the shared one
      if (await lstat(m.dir)) await move(m.dir, store);
      else await fsp.mkdir(store, { recursive: true });
      try {
        await makeLink(store, m.dir);
      } catch (e) {
        await move(store, m.dir).catch(() => {});
        throw e;
      }
      const members = [{ launcher: m.launcher, label: m.label, dir: m.dir, name: m.name, instanceId: m.instanceId || null }];
      const problems = [];
      let i = 0;
      for (const p of rest) {
        i++;
        task.progress(0.1 + (0.85 * i) / rest.length, p.name);
        const tmp = (await lstat(p.dir)) ? await freeName(`${p.dir}.havihub-merge`) : null;
        if (tmp) await fsp.rename(p.dir, tmp);
        try {
          await makeLink(store, p.dir);
        } catch (e) {
          if (tmp) await fsp.rename(tmp, p.dir).catch(() => {});
          problems.push({ name: p.name, error: String(e.message || e) });
          continue;
        }
        members.push({ launcher: p.launcher, label: p.label, dir: p.dir, name: p.name, instanceId: p.instanceId || null });
        if (tmp) {
          const left = await this.mergeInto(store, tmp, path.join(backup, p.launcher));
          const gone = await pruneEmpty(tmp);
          if (left.length || !gone) problems.push({ name: p.name, error: `Quedaron archivos en ${tmp}`, files: left.slice(0, 20) });
        }
      }
      const group = { id: `g${Date.now().toString(36)}`, name: m.name, store, mcVersion: m.mcVersion, loader: m.loader ? m.loader.id : '', created: Date.now(), members };
      await this.saveGroups([...this.groups(), group]);
      task.progress(1, '');
      this.emit('instances:changed', {});
      return { group, problems };
    });
  }

  // Moves what `from` has into `store`; returns the files that could not move.
  // Exact copies of what the shared folder already has are dropped; anything
  // else that cannot go in goes to `backup`.
  async mergeInto(store, from, backup) {
    const left = [];
    const keep = async (src, rel) => {
      try {
        await move(src, await freeName(path.join(backup, rel)));
      } catch {
        left.push(rel);
      }
    };
    // the shared folder's copy wins: duplicates go away, differences to the backup
    const dedupe = async (src, dst, rel) => {
      const st = await lstat(src);
      if (st && st.isDirectory() && !st.isSymbolicLink()) {
        for (const e of await fsp.readdir(src).catch(() => [])) await dedupe(path.join(src, e), path.join(dst, e), path.join(rel, e));
        return;
      }
      if (await sameFile(src, dst)) await fsp.unlink(src).catch(() => left.push(rel));
      else await keep(src, rel);
    };
    const union = async (srcDir, dstDir, rel) => {
      await fsp.mkdir(dstDir, { recursive: true });
      for (const e of await fsp.readdir(srcDir, { withFileTypes: true }).catch(() => [])) {
        const src = path.join(srcDir, e.name);
        const dst = path.join(dstDir, e.name);
        const r = path.join(rel, e.name);
        if (!(await lstat(dst))) {
          try {
            await move(src, dst);
          } catch {
            left.push(r);
          }
        } else if (e.isDirectory()) {
          // a world (or pack) with the same name: both are kept
          try {
            await move(src, await freeName(`${dst} (${path.basename(backup)})`));
          } catch {
            left.push(r);
          }
        } else await dedupe(src, dst, r);
      }
    };
    for (const e of await fsp.readdir(from, { withFileTypes: true })) {
      const src = path.join(from, e.name);
      const dst = path.join(store, e.name);
      if (META_FILES.has(e.name)) {
        if (!(await lstat(dst))) {
          try {
            await move(src, dst);
          } catch {
            left.push(e.name);
          }
        } else await keep(src, e.name);
      } else if (UNION.has(e.name) && e.isDirectory()) await union(src, dst, e.name);
      else if (DROP.has(e.name)) await keep(src, e.name);
      else if (PACK.has(e.name)) await dedupe(src, dst, e.name);
      else if (!(await lstat(dst))) {
        try {
          await move(src, dst);
        } catch {
          left.push(e.name);
        }
      } else await dedupe(src, dst, e.name);
    }
    return left;
  }

  // ------------------------------------------------ a CurseForge/Modrinth profile in Havi Hub
  async bringToHavi(ref) {
    const p = await this.findProfile(ref);
    if (p.launcher === 'havi') throw new UserError('Ese perfil ya está en Havi Hub.');
    const ctx = this.ctxProvider();
    const dirs = await ctx.dirs();
    const instances = new Instances(ctx, this.appConfig);
    await fsp.mkdir(dirs.primaryInstanceDir, { recursive: true });
    const id = await uniqueDirName(dirs.primaryInstanceDir, safeName(p.name, 'perfil'));
    const dest = path.join(dirs.primaryInstanceDir, id);
    await fsp.mkdir(dest, { recursive: true });
    await this.importer.writeConverted(dest, p.raw || p, p.launcher);
    if (p.raw && p.raw.image) {
      const img = await fsp.readFile(p.raw.image).catch(() => null);
      if (img && img.length) await instances.setImage(id, img).catch(() => {});
    }
    if (p.raw && p.raw.group) await groups.setInstanceGroup(ctx, id, p.raw.group).catch(() => {});
    const havi = { launcher: 'havi', dir: path.join(dest, 'minecraft') };
    const g = this.groups().find((x) => x.members.some((m) => samePath(m.dir, p.dir)));
    if (g) {
      await makeLink(g.store, havi.dir);
      g.members.push({ launcher: 'havi', label: LAUNCHERS.havi, dir: havi.dir, name: p.name, instanceId: id });
      await this.saveGroups(this.groups().map((x) => (x.id === g.id ? g : x)));
      this.emit('instances:changed', {});
      return { id, group: g };
    }
    try {
      const r = await this.link({ main: { dir: p.dir, name: p.name }, others: [havi] });
      return { id, group: r.group, problems: r.problems };
    } catch (e) {
      await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
  }

  // ------------------------------------------------ leaving the sync
  // The member gets a full copy of the shared folder again; with one member
  // left, the shared folder simply moves back into it.
  async detach(groupId, dir) {
    const g = this.groups().find((x) => x.id === groupId);
    if (!g) throw new UserError('Ese grupo ya no existe.');
    const member = g.members.find((m) => samePath(m.dir, dir));
    if (!member) throw new UserError('Ese perfil ya no está sincronizado.');
    if (member.launcher === 'havi' && member.instanceId && this.isRunning(member.instanceId)) throw new UserError('"{name}" está abierto en el juego.', { name: member.name });
    await this.ensureClosed(g.members.map((m) => m.launcher));
    return this.tasks.run(tr('Dejando de sincronizar {name}', { name: member.name }), { kind: 'sync', cancelable: false }, async (task) => {
      const rest = g.members.filter((m) => m !== member);
      const alive = [];
      for (const m of rest) if (samePath(await linkTarget(m.dir), g.store)) alive.push(m);
      task.progress(0.1, member.name);
      if (samePath(await linkTarget(member.dir), g.store)) await removeLink(member.dir);
      if (!alive.length) {
        // the last one: the shared folder goes back to it
        if (!(await lstat(member.dir))) await move(g.store, member.dir);
        await this.saveGroups(this.groups().filter((x) => x.id !== g.id));
      } else {
        if (!(await lstat(member.dir))) await fsp.cp(g.store, member.dir, { recursive: true, verbatimSymlinks: true, filter: (src) => !samePath(src, path.join(g.store, '.havihub')) });
        if (alive.length === 1) {
          const last = alive[0];
          await removeLink(last.dir);
          await move(g.store, last.dir);
          await this.saveGroups(this.groups().filter((x) => x.id !== g.id));
        } else await this.saveGroups(this.groups().map((x) => (x.id === g.id ? { ...g, members: alive } : x)));
      }
      task.progress(1, '');
      this.emit('instances:changed', {});
      return { ok: true };
    });
  }

  // Before Havi Hub deletes one of its synced instances: remove its link
  async forgetInstance(instanceId, gameDir) {
    const list = this.groups();
    let changed = false;
    for (const g of list) {
      const before = g.members.length;
      g.members = g.members.filter((m) => !(m.launcher === 'havi' && (m.instanceId === instanceId || samePath(m.dir, gameDir))));
      if (g.members.length !== before) changed = true;
    }
    if (gameDir && (await linkTarget(gameDir))) await removeLink(gameDir).catch(() => {});
    if (changed) await this.saveGroups(list.filter((g) => g.members.length));
  }

  // Members whose profile no longer exists (deleted in its launcher) leave the group
  async check() {
    const list = this.groups();
    let changed = false;
    for (const g of list) {
      const keep = [];
      for (const m of g.members) {
        if (await lstat(m.dir)) keep.push(m);
        else changed = true;
      }
      g.members = keep;
    }
    if (changed) await this.saveGroups(list);
    return list;
  }
}

module.exports = { SyncManager, mergeHelpers: { META_FILES, PACK, UNION, DROP }, samePath, nameKey, linkTarget, runningLaunchers, LAUNCHERS };
