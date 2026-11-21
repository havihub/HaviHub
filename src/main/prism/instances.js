// Instances: listing, details, creation, cloning, deletion, renaming, images
// and per-instance settings. Works directly on Prism Launcher's folders.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { IniFile, asBool, asInt } = require('../util/ini');
const { readJson, writeJson, exists, listDir, statSafe, safeName, uniqueDirName, copyDir } = require('../util/fsx');
const { cleanText } = require('../../shared/limits.js');
const { fileUrl } = require('../urls');
const groups = require('./groups');
const { keyForOptions } = require('../../shared/mckeys-legacy');
const { UserError } = require('../../shared/usertext');

const ICON_EXTS = ['png', 'svg', 'jpg', 'jpeg', 'webp', 'gif', 'ico'];
// instance.cfg key with the recipe of a generated icon ("background/symbol")
const ICON_RECIPE_KEY = 'HaviHubIcon';

const LOADERS = {
  'net.fabricmc.fabric-loader': { id: 'fabric', name: 'Fabric' },
  'org.quiltmc.quilt-loader': { id: 'quilt', name: 'Quilt' },
  'net.minecraftforge': { id: 'forge', name: 'Forge' },
  'net.neoforged': { id: 'neoforge', name: 'NeoForge' },
  'com.mumfrey.liteloader': { id: 'liteloader', name: 'LiteLoader' },
  'net.legacyfabric.fabric-loader': { id: 'legacy-fabric', name: 'Legacy Fabric' },
  'net.ornithemc.ornithe-loader': { id: 'ornithe', name: 'Ornithe' },
};
const LOADER_UIDS = Object.fromEntries(Object.entries(LOADERS).map(([uid, l]) => [l.id, uid]));

// file extension from the first bytes (icons downloaded from the web are not always PNG)
function imageExt(buf) {
  if (buf.length > 4 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 4 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return 'png';
}

function gameDirOf(instanceRoot) {
  const mc = path.join(instanceRoot, 'minecraft');
  const dot = path.join(instanceRoot, '.minecraft');
  if (fs.existsSync(dot) && !fs.existsSync(mc)) return dot;
  return mc;
}

async function readPack(instanceRoot) {
  const pack = await readJson(path.join(instanceRoot, 'mmc-pack.json'), null);
  const components = (pack && Array.isArray(pack.components) ? pack.components : []).filter((c) => !c.disabled);
  const mc = components.find((c) => c.uid === 'net.minecraft');
  let loader = null;
  for (const c of components) {
    if (LOADERS[c.uid]) {
      loader = { ...LOADERS[c.uid], uid: c.uid, version: c.version || c.cachedVersion || '' };
      break;
    }
  }
  return {
    mcVersion: mc ? mc.version || mc.cachedVersion || '' : '',
    loader,
    components,
  };
}

async function resolveIcon(iconsDir, key) {
  if (!key || key === 'default') return null;
  // key can be "name" or "subdir/name"; also allow full file names
  const base = path.join(iconsDir, key);
  for (const ext of ICON_EXTS) {
    const p = `${base}.${ext}`;
    const st = await statSafe(p);
    if (st) return fileUrl(p, st.mtimeMs);
  }
  const st = await statSafe(base);
  if (st && st.isFile()) return fileUrl(base, st.mtimeMs);
  return null;
}

// options.txt as an ordered map (key -> value)
async function readOptions(file) {
  const lines = new Map();
  if (await exists(file)) {
    for (const line of (await fsp.readFile(file, 'utf8')).split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) lines.set(line.slice(0, i), line.slice(i + 1));
    }
  }
  return lines;
}

// Minecraft upgrades an options.txt from the version it says it was saved
// in (its "version:" line). With none, it assumes the oldest one and runs
// every upgrade, among them the one for the numeric keys used before 1.13:
// it reads "key.keyboard.g" as a number, fails, and throws the whole file
// away ("Failed to load options"), so the profile starts with none of Havi
// Hub's options or keys, and with the game's welcome screen. Havi Hub
// writes options in the current format, so a file without that line says
// it is already current: a version no Minecraft has reached, so nothing is
// upgraded. The game writes its own version the next time it saves the file.
const OPTIONS_VERSION = '999999';

async function writeOptions(file, lines) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const out = lines.has('version') ? lines : new Map([['version', OPTIONS_VERSION], ...lines]);
  await fsp.writeFile(file, [...out].map(([k, v]) => `${k}:${v}`).join('\n') + '\n');
}

// key bindings the user changed ('' = keep Minecraft's) in this version's format
function setKeyLines(lines, keys, mcVersion) {
  let n = 0;
  for (const [id, key] of Object.entries(keys || {})) {
    if (!key || !/^key\./.test(id)) continue;
    const v = keyForOptions(key, mcVersion);
    if (v === null) continue;
    lines.set(`key_${id}`, v);
    n++;
  }
  return n;
}

class Instances {
  constructor(ctx, appConfig) {
    this.ctx = ctx;
    this.appConfig = appConfig;
  }

  async locate(id) {
    const { instanceDirs } = await this.ctx.dirs();
    for (const d of instanceDirs) {
      const root = path.join(d, id);
      if (await exists(path.join(root, 'instance.cfg'))) return root;
    }
    const err = new UserError('No se encontró la instancia "{id}"', { id });
    err.code = 'NOT_FOUND';
    throw err;
  }

  async summary(id, root, groupMap, iconsDir) {
    const cfg = await IniFile.load(path.join(root, 'instance.cfg'));
    const type = cfg.get('InstanceType', '');
    if (type && type !== 'OneSix') return null;
    const pack = await readPack(root);
    const st = await statSafe(root);
    const iconKey = cfg.get('iconKey', 'default') || 'default';
    const managed = asBool(cfg.get('ManagedPack'));
    return {
      id,
      root,
      gameDir: gameDirOf(root),
      // names typed in other launchers can be any length: show the first 128 characters
      name: cleanText(cfg.get('name', id) || id, 128) || id,
      iconKey,
      icon: await resolveIcon(iconsDir, iconKey),
      // generated icon (background/symbol) the image was made from, if any
      iconRecipe: cfg.get(ICON_RECIPE_KEY, '') || '',
      // the server (Modrinth project) this instance plays on, if it was set up for one
      linkedServer: cfg.get('HaviHubServer', '') || '',
      group: groupMap.get(id) || '',
      mcVersion: pack.mcVersion,
      loader: pack.loader,
      lastLaunch: asInt(cfg.get('lastLaunchTime'), 0),
      totalPlayed: asInt(cfg.get('totalTimePlayed'), 0),
      lastPlayed: asInt(cfg.get('lastTimePlayed'), 0),
      created: st ? st.birthtimeMs || st.ctimeMs : 0,
      notes: cfg.get('notes', ''),
      uuid: cfg.get('uuid', ''),
      managed: managed
        ? {
            type: cfg.get('ManagedPackType', ''),
            id: cfg.get('ManagedPackID', ''),
            name: cfg.get('ManagedPackName', ''),
            versionId: cfg.get('ManagedPackVersionID', ''),
            versionName: cfg.get('ManagedPackVersionName', ''),
          }
        : null,
    };
  }

  async list() {
    const { instanceDirs, iconsDir } = await this.ctx.dirs();
    const g = await groups.loadGroupsSafe(this.ctx);
    const seen = new Set();
    const out = [];
    for (const dir of instanceDirs) {
      for (const ent of await listDir(dir)) {
        if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
        if (seen.has(ent.name)) continue;
        const root = path.join(dir, ent.name);
        if (!(await exists(path.join(root, 'instance.cfg')))) continue;
        seen.add(ent.name);
        try {
          const s = await this.summary(ent.name, root, g.map, iconsDir);
          if (s) out.push(s);
        } catch (e) {
          out.push({ id: ent.name, root, name: ent.name, broken: String(e.message || e), group: g.map.get(ent.name) || '' });
        }
      }
    }
    // groups present in Prism + empty groups created in Havi Hub
    const cfg = this.appConfig.get();
    const groupNames = new Set(g.order);
    for (const name of g.map.values()) groupNames.add(name);
    for (const name of cfg.extraGroups || []) groupNames.add(name);
    const names = [...groupNames].filter(Boolean);
    return { instances: out, groups: names, groupImages: await this.groupImages(names) };
  }

  // ---- group pictures (Havi Hub's own: Prism's groups file has no place for them) ----
  groupPicturesDir() {
    return path.join(this.ctx.dataDir, 'group-pictures');
  }

  async groupImages(names) {
    const saved = this.appConfig.get().groupImages || {};
    const out = {};
    for (const name of names) {
      const g = saved[name];
      if (!g || !g.file) continue;
      const file = path.join(this.groupPicturesDir(), path.basename(g.file));
      const st = await statSafe(file);
      if (st) out[name] = { url: fileUrl(file, st.mtimeMs), recipe: g.recipe || undefined };
    }
    return out;
  }

  async setGroupImage(name, imageBuffer, { recipe } = {}) {
    const dir = this.groupPicturesDir();
    await fsp.mkdir(dir, { recursive: true });
    const buf = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
    const saved = { ...(this.appConfig.get().groupImages || {}) };
    const before = saved[name] && saved[name].file;
    const file = `${crypto.createHash('sha1').update(name).digest('hex').slice(0, 16)}-${Date.now().toString(36)}.${imageExt(buf)}`;
    await fsp.writeFile(path.join(dir, file), buf);
    const r = typeof recipe === 'string' && /^[a-z-]+\/[a-z0-9-]+$/.test(recipe) ? recipe : undefined;
    saved[name] = r ? { file, recipe: r } : { file };
    await this.appConfig.replaceKey('groupImages', saved);
    if (before) await fsp.rm(path.join(dir, path.basename(before)), { force: true }).catch(() => {});
  }

  async resetGroupImage(name) {
    const saved = { ...(this.appConfig.get().groupImages || {}) };
    const g = saved[name];
    if (!g) return;
    delete saved[name];
    await this.appConfig.replaceKey('groupImages', saved);
    if (g.file) await fsp.rm(path.join(this.groupPicturesDir(), path.basename(g.file)), { force: true }).catch(() => {});
  }

  async renameGroupImage(from, to) {
    const saved = { ...(this.appConfig.get().groupImages || {}) };
    if (!saved[from] || from === to) return;
    saved[to] = saved[from];
    delete saved[from];
    await this.appConfig.replaceKey('groupImages', saved);
  }

  async get(id) {
    const root = await this.locate(id);
    const { iconsDir } = await this.ctx.dirs();
    const g = await groups.loadGroupsSafe(this.ctx);
    return this.summary(id, root, g.map, iconsDir);
  }

  // ---- settings (instance.cfg) ----
  async getSettings(id) {
    const root = await this.locate(id);
    const cfg = await IniFile.load(path.join(root, 'instance.cfg'));
    return cfg.toObject();
  }

  async setSettings(id, patch) {
    const root = await this.locate(id);
    const cfg = await IniFile.load(path.join(root, 'instance.cfg'));
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) cfg.remove(k);
      else cfg.set(k, v);
    }
    await cfg.save();
    return cfg.toObject();
  }

  async rename(id, name) {
    const clean = cleanText(name, 64);
    if (!clean) throw new UserError('El nombre no puede estar vacío');
    await this.setSettings(id, { name: clean });
  }

  async setGroup(id, group) {
    await groups.setInstanceGroup(this.ctx, id, group || '');
    if (group) {
      const extra = (this.appConfig.get().extraGroups || []).filter((g) => g !== group);
      await this.appConfig.replaceKey('extraGroups', extra);
    }
  }

  // ---- components (mmc-pack.json) ----
  async setVersion(id, { mcVersion, loader, loaderVersion }) {
    const root = await this.locate(id);
    const file = path.join(root, 'mmc-pack.json');
    const pack = (await readJson(file, null)) || { formatVersion: 1, components: [] };
    let comps = Array.isArray(pack.components) ? pack.components : [];
    const mcChanged = mcVersion && !comps.some((c) => c.uid === 'net.minecraft' && c.version === mcVersion);
    if (mcVersion) {
      const mc = comps.find((c) => c.uid === 'net.minecraft');
      if (mc) {
        mc.version = mcVersion;
        delete mc.cachedVersion;
        delete mc.cachedRequires;
      } else comps.unshift({ uid: 'net.minecraft', version: mcVersion, important: true });
    }
    if (loader !== undefined) {
      // remove existing loaders and dependency-only components that depend on the MC version
      comps = comps.filter((c) => !LOADERS[c.uid]);
      if (loader && loader !== 'vanilla') {
        const uid = LOADER_UIDS[loader];
        if (!uid) throw new Error(`Loader desconocido: ${loader}`);
        comps.push({ uid, version: loaderVersion });
      }
    }
    if (mcChanged || loader !== undefined) {
      // let Prism re-resolve dependency-only components (LWJGL, intermediary...)
      comps = comps.filter((c) => !c.dependencyOnly);
    }
    pack.components = comps;
    pack.formatVersion = 1;
    await writeJson(file, pack, 4);
  }

  // ---- creation ----
  async create({ name, group, mcVersion, loader, loaderVersion, imagePng, iconRecipe, iconKey, extraSettings } = {}) {
    if (!mcVersion) throw new UserError('Falta la versión de Minecraft');
    const { primaryInstanceDir } = await this.ctx.dirs();
    await fsp.mkdir(primaryInstanceDir, { recursive: true });
    const displayName = String(name || '').trim() || `Minecraft ${mcVersion}`;
    const id = await uniqueDirName(primaryInstanceDir, safeName(displayName));
    const root = path.join(primaryInstanceDir, id);
    await fsp.mkdir(root, { recursive: true });

    // copy Prism's instance template if the user configured one
    const { templateDir } = await this.ctx.dirs();
    if (await exists(templateDir)) {
      await copyDir(templateDir, root).catch(() => {});
    }

    const cfg = await IniFile.load(path.join(root, 'instance.cfg'));
    cfg.set('ConfigVersion', '1.3');
    cfg.set('InstanceType', 'OneSix');
    cfg.set('name', displayName);
    cfg.set('iconKey', iconKey || 'default');
    for (const [k, v] of Object.entries(extraSettings || {})) cfg.set(k, v);
    await cfg.save();

    const components = [{ uid: 'net.minecraft', version: mcVersion, important: true }];
    if (loader && loader !== 'vanilla') {
      const uid = LOADER_UIDS[loader];
      if (!uid) throw new Error(`Loader desconocido: ${loader}`);
      components.push({ uid, version: loaderVersion });
    }
    await writeJson(path.join(root, 'mmc-pack.json'), { components, formatVersion: 1 }, 4);

    const gameDir = path.join(root, 'minecraft');
    await fsp.mkdir(gameDir, { recursive: true });
    await this.writeDefaultOptions(gameDir, { mcVersion });

    if (imagePng) await this.setImage(id, imagePng, { recipe: iconRecipe });
    if (group) await this.setGroup(id, group);
    return id;
  }

  // options.txt defaults (CurseForge-style "in-game default settings")
  async writeDefaultOptions(gameDir, { force = false, mcVersion } = {}) {
    const d = this.appConfig.get().inGameDefaults;
    if (!d || !d.enabled) return;
    const file = path.join(gameDir, 'options.txt');
    if (!force && (await exists(file))) return;
    const mc = mcVersion || (await readPack(path.dirname(gameDir)).catch(() => ({}))).mcVersion || '';
    const lines = await readOptions(file);
    const num = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
    lines.set('fullscreen', String(Boolean(d.fullscreen)));
    lines.set('bobView', String(Boolean(d.bobView)));
    lines.set('guiScale', String(d.guiScale | 0));
    lines.set('gamma', num(Number(d.gamma)));
    lines.set('renderDistance', String(d.renderDistance | 0));
    lines.set('fov', num(Math.max(-1, Math.min(1, (Number(d.fov) - 70) / 40))));
    lines.set('autoJump', String(Boolean(d.autoJump)));
    lines.set('invertYMouse', String(Boolean(d.invertYMouse)));
    lines.set('mouseSensitivity', num(Number(d.mouseSensitivity) / 100));
    const sound = d.sound || {};
    for (const [k, v] of Object.entries(sound)) lines.set(`soundCategory_${k}`, num(Number(v) / 100));
    setKeyLines(lines, d.keys, mc);
    if (d.lang) lines.set('lang', d.lang);
    await writeOptions(file, lines);
  }

  // Writes only the customized key bindings into every profile's options.txt
  async applyKeys(isRunning = () => false) {
    const keys = (this.appConfig.get().inGameDefaults || {}).keys || {};
    let count = 0;
    const skipped = [];
    for (const inst of (await this.list()).instances) {
      if (inst.broken) continue;
      if (isRunning(inst.id)) {
        skipped.push(inst.name);
        continue;
      }
      if (await this.writeKeys(inst, keys)) count++;
    }
    return { count, skipped };
  }

  // The customized key bindings into one profile's options.txt (the rest of
  // its options stay). False when there was nothing to change.
  async applyKeysTo(id) {
    const keys = (this.appConfig.get().inGameDefaults || {}).keys || {};
    return this.writeKeys(await this.get(id), keys);
  }

  async writeKeys(inst, keys) {
    const gameDir = gameDirOf(inst.root);
    const file = path.join(gameDir, 'options.txt');
    const lines = await readOptions(file);
    if (!setKeyLines(lines, keys, inst.mcVersion)) return false;
    await fsp.mkdir(gameDir, { recursive: true });
    await writeOptions(file, lines);
    return true;
  }

  // Whether the person has key bindings of their own (Ajustes → Minecraft → Teclas)
  hasCustomKeys() {
    const d = this.appConfig.get().inGameDefaults || {};
    return Boolean(d.enabled) && Object.entries(d.keys || {}).some(([id, key]) => key && /^key\./.test(id));
  }

  // ---- image ----
  // recipe: the generated icon the image comes from ("background/symbol"), or
  // nothing for a picture of the user's
  async setImage(id, imageBuffer, { recipe } = {}) {
    const { iconsDir } = await this.ctx.dirs();
    await fsp.mkdir(iconsDir, { recursive: true });
    const key = `havihub-${safeName(id, 'instance').replace(/\s+/g, '_')}`;
    // remove older variants with other extensions
    for (const ext of ICON_EXTS) await fsp.rm(path.join(iconsDir, `${key}.${ext}`), { force: true });
    const buf = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
    await fsp.writeFile(path.join(iconsDir, `${key}.${imageExt(buf)}`), buf);
    const r = typeof recipe === 'string' && /^[a-z-]+\/[a-z0-9-]+$/.test(recipe) ? recipe : undefined;
    await this.setSettings(id, { iconKey: key, [ICON_RECIPE_KEY]: r });
    return key;
  }

  async resetImage(id) {
    await this.setSettings(id, { iconKey: 'default', [ICON_RECIPE_KEY]: undefined });
  }

  // ---- clone ----
  async clone(id, { name, copyWorlds = true, copyScreenshots = false, keepPlaytime = false, group } = {}) {
    const src = await this.locate(id);
    const parent = path.dirname(src);
    const srcCfg = await IniFile.load(path.join(src, 'instance.cfg'));
    const displayName = String(name || '').trim() || `${srcCfg.get('name', id)} (copia)`;
    const newId = await uniqueDirName(parent, safeName(displayName));
    const dest = path.join(parent, newId);
    const gameRel = path.relative(src, gameDirOf(src));
    const skip = new Set([
      path.join(src, gameRel, 'logs'),
      path.join(src, gameRel, 'crash-reports'),
      path.join(src, 'natives'),
      ...(copyWorlds ? [] : [path.join(src, gameRel, 'saves')]),
      ...(copyScreenshots ? [] : [path.join(src, gameRel, 'screenshots')]),
    ]);
    await copyDir(src, dest, (p) => !skip.has(p));
    const cfg = await IniFile.load(path.join(dest, 'instance.cfg'));
    cfg.set('name', displayName);
    cfg.remove('uuid');
    cfg.remove('shortcuts');
    if (!keepPlaytime) {
      cfg.set('totalTimePlayed', 0);
      cfg.set('lastTimePlayed', 0);
      cfg.set('lastLaunchTime', 0);
    }
    await cfg.save();
    // keep the same image: copy the icon file under a new key if it was ours
    const iconKey = srcCfg.get('iconKey', 'default');
    if (iconKey && iconKey.startsWith('havihub-')) {
      const { iconsDir } = await this.ctx.dirs();
      for (const ext of ICON_EXTS) {
        const file = path.join(iconsDir, `${iconKey}.${ext}`);
        if (await exists(file)) {
          await this.setImage(newId, await fsp.readFile(file), { recipe: srcCfg.get(ICON_RECIPE_KEY, '') || undefined });
          break;
        }
      }
    }
    const g = group !== undefined ? group : (await groups.loadGroupsSafe(this.ctx)).map.get(id);
    if (g) await this.setGroup(newId, g);
    return newId;
  }

  // ---- deletion ----
  async remove(id, trashFn) {
    const root = await this.locate(id);
    // a linked game folder (synced profile) is only unlinked, never emptied
    const game = gameDirOf(root);
    const st = await fsp.lstat(game).catch(() => null);
    if (st && st.isSymbolicLink()) await fsp.unlink(game).catch(() => fsp.rmdir(game).catch(() => {}));
    if (trashFn) {
      try {
        await trashFn(root);
      } catch {
        await fsp.rm(root, { recursive: true, force: true });
      }
    } else {
      await fsp.rm(root, { recursive: true, force: true });
    }
    await groups.removeInstance(this.ctx, id);
  }

  async ensureUuid(id) {
    const root = await this.locate(id);
    const cfg = await IniFile.load(path.join(root, 'instance.cfg'));
    let uuid = cfg.get('uuid', '');
    if (!uuid) {
      uuid = crypto.randomUUID();
      cfg.set('uuid', uuid);
      await cfg.save();
    }
    return uuid;
  }

  async counts(id) {
    const root = await this.locate(id);
    const game = gameDirOf(root);
    const count = async (dir, filter) => (await listDir(path.join(game, dir))).filter(filter).length;
    const isRes = (e) => !e.name.startsWith('.') && !e.name.endsWith('.pw.toml') && (e.isDirectory() || /\.(jar|zip|litemod|disabled)$/i.test(e.name));
    const settings = await IniFile.load(path.join(root, 'instance.cfg'));
    const dpRel = settings.get('GlobalDataPacksPath', '') || 'datapacks';
    const worlds = (await listDir(path.join(game, 'saves'))).filter((e) => e.isDirectory()).length;
    return {
      mods: await count('mods', (e) => e.isFile() && /\.(jar|litemod|zip)(\.disabled)?$/i.test(e.name)),
      resourcepacks: await count('resourcepacks', isRes),
      shaderpacks: await count('shaderpacks', (e) => e.isDirectory() || /\.zip(\.disabled)?$/i.test(e.name)),
      datapacks: (await listDir(path.join(game, dpRel))).filter(isRes).length,
      worlds,
      screenshots: await count('screenshots', (e) => e.isFile() && /\.(png|jpe?g)$/i.test(e.name)),
    };
  }
}

module.exports = { Instances, gameDirOf, readPack, LOADERS, LOADER_UIDS, resolveIcon, imageExt };
