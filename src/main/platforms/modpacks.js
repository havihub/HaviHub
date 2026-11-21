// Modpacks: install from Modrinth (.mrpack) or CurseForge (.zip), import local
// archives (mrpack, CurseForge zip, Prism instance zip) and export instances.
const os = require('node:os');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { modrinth } = require('./modrinth');
const { curseforge, CLASS_TYPES } = require('./curseforge');
const { alternativeUrl, blockedEntry } = require('./blocked');
const http = require('../util/http');
const zip = require('../util/zip');
const { hashFileMulti, curseFingerprint } = require('../util/hash');
const { IniFile } = require('../util/ini');
const { safeName, uniqueDirName, exists, writeJson, readJson } = require('../util/fsx');
const { gameDirOf, LOADER_UIDS } = require('../prism/instances');
const { writeMetadata, readMetadata } = require('../prism/content');
const { safeRelPath, resolveInside, resolveRelInside } = require('../util/safepath');
const { riskyLaunchSettings, dropLaunchSettings, personalSettings, dropPersonalSettings } = require('../prism/launchsettings');
const { UserError, tr } = require('../../shared/usertext');

const MR_DEP_TO_LOADER = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' };

// One file of a .mrpack. Its addresses come from the pack itself, so only
// HTTPS ones are used, as Modrinth's format asks: a file: address would copy
// any file of this computer into the profile (and on Windows, file://server/…
// would connect to that server with the person's credentials). The addresses
// are mirrors, tried in order, and the strongest hash the pack gives decides.
async function downloadPackFile(f, dest) {
  const urls = (Array.isArray(f.downloads) ? f.downloads : []).filter((u) => typeof u === 'string' && /^https:\/\//i.test(u));
  if (!urls.length) throw new UserError('El modpack no indica una dirección HTTPS para este archivo');
  const hashes = f.hashes || {};
  const check = hashes.sha512 ? { hash: hashes.sha512, hashAlgo: 'sha512' } : hashes.sha1 ? { hash: hashes.sha1, hashAlgo: 'sha1' } : {};
  let lastError;
  for (const url of urls) {
    try {
      return await http.download(url, dest, check);
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      lastError = e;
    }
  }
  throw lastError;
}

class Modpacks {
  constructor({ ctxProvider, instances, tasks, appConfig, emit }) {
    this.ctxProvider = ctxProvider;
    this.instances = instances;
    this.tasks = tasks;
    this.appConfig = appConfig;
    this.emit = emit;
  }

  async tempFile(name) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'havihub-'));
    return path.join(dir, name);
  }

  async iconPng(url) {
    if (!url) return null;
    try {
      return await http.getBuffer(url);
    } catch {
      return null;
    }
  }

  // ---------- install from platforms ----------
  async install({ source, projectId, versionId, name, group, icon }) {
    return this.tasks.run(name ? tr('Instalando modpack {name}', { name }) : tr('Instalando modpack'), { kind: 'modpack' }, async (task) => {
      if (source === 'curseforge') {
        const file = versionId ? await curseforge.file(projectId, versionId) : (await curseforge.files(projectId, { pageSize: 20 })).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
        if (!file) throw new UserError('No se encontró una versión del modpack');
        const f = file.files[0];
        if (!f.url) throw new UserError('El autor de este modpack no permite descargarlo desde otras apps. Descárgalo desde CurseForge e impórtalo.');
        const tmp = await this.tempFile(f.filename);
        task.progress(0, tr('Descargando modpack…'));
        await http.download(f.url, tmp, { onProgress: (r, t) => task.progress(t ? (r / t) * 0.2 : 0, tr('Descargando modpack…')) });
        return this.installCurseZip(tmp, { task, name, group, icon, managed: { id: projectId, versionId: file.id, versionName: file.name } });
      }
      const versions = versionId ? [await modrinth.version(versionId)] : await modrinth.versions(projectId, {});
      const v = versions.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
      if (!v) throw new UserError('No se encontró una versión del modpack');
      const f = v.files.find((x) => x.primary) || v.files[0];
      const tmp = await this.tempFile(f.filename);
      task.progress(0, tr('Descargando modpack…'));
      await http.download(f.url, tmp, { hash: f.hashes.sha1, hashAlgo: 'sha1', onProgress: (r, t) => task.progress(t ? (r / t) * 0.2 : 0, tr('Descargando modpack…')) });
      return this.installMrpack(tmp, { task, name, group, icon, managed: { id: projectId, versionId: v.id, versionName: v.versionNumber } });
    });
  }

  async createShell({ name, mcVersion, loader, loaderVersion, group, iconPng, managed, managedType }) {
    const extra = {};
    if (managed) {
      extra.ManagedPack = true;
      extra.ManagedPackType = managedType;
      extra.ManagedPackID = managed.id || '';
      extra.ManagedPackName = name;
      extra.ManagedPackVersionID = managed.versionId || '';
      extra.ManagedPackVersionName = managed.versionName || '';
    }
    const id = await this.instances.create({ name, group, mcVersion, loader, loaderVersion, imagePng: iconPng, extraSettings: extra });
    return id;
  }

  async installMrpack(file, { task, name, group, icon, managed } = {}) {
    const idxBuf = await zip.readEntry(file, 'modrinth.index.json');
    if (!idxBuf) throw new UserError('El archivo no es un modpack de Modrinth válido');
    const index = JSON.parse(idxBuf.toString('utf8'));
    const deps = index.dependencies || {};
    let loader = null;
    let loaderVersion = null;
    for (const [k, l] of Object.entries(MR_DEP_TO_LOADER)) {
      if (deps[k]) {
        loader = l;
        loaderVersion = deps[k];
        break;
      }
    }
    const packName = name || index.name || path.basename(file, '.mrpack');
    const id = await this.createShell({
      name: packName,
      mcVersion: deps.minecraft,
      loader,
      loaderVersion,
      group,
      iconPng: await this.iconPng(icon),
      managed: managed || { id: '', versionId: '', versionName: index.versionId || '' },
      managedType: 'modrinth',
    });
    const root = await this.instances.locate(id);
    // stopped half way: don't leave a broken profile behind
    if (task && task.onCancel) {
      task.onCancel(async () => {
        await fsp.rm(root, { recursive: true, force: true });
        this.emit('instances:changed', {});
      });
    }
    const game = gameDirOf(root);
    try {
      const files = (index.files || []).filter((f) => !(f.env && f.env.client === 'unsupported'));
      let done = 0;
      const failed = [];
      await http.pool(files, 6, async (f) => {
        const rel = safeRelPath(f.path);
        if (!rel) return;
        try {
          const dest = await resolveRelInside(game, rel);
          await downloadPackFile(f, dest);
        } catch (e) {
          failed.push({ title: rel, reason: e.message });
        }
        done++;
        if (task) task.progress(0.2 + 0.7 * (done / files.length), tr('Descargando archivos ({done}/{total})', { done, total: files.length }));
      });
      if (task) task.progress(0.92, tr('Copiando configuración…'));
      await zip.extractPrefix(file, 'overrides/', game);
      await zip.extractPrefix(file, 'client-overrides/', game);
      await this.instances.writeDefaultOptions(game);
      const keys = await this.packKeys(id, file, ['overrides/', 'client-overrides/'], packName);
      this.emit('instances:changed', {});
      return { id, failed, blocked: [], keys };
    } catch (e) {
      e.instanceId = id;
      throw e;
    }
  }

  async installCurseZip(file, { task, name, group, icon, managed } = {}) {
    const mBuf = await zip.readEntry(file, 'manifest.json');
    if (!mBuf) throw new UserError('El archivo no es un modpack de CurseForge válido');
    const manifest = JSON.parse(mBuf.toString('utf8'));
    const mc = manifest.minecraft || {};
    let loader = null;
    let loaderVersion = null;
    const primary = (mc.modLoaders || []).find((l) => l.primary) || (mc.modLoaders || [])[0];
    if (primary) {
      const m = /^(neoforge|forge|fabric|quilt)-(.+)$/.exec(primary.id);
      if (m) {
        loader = m[1];
        loaderVersion = m[2];
        // Forge ids are "forge-47.2.0" while some packs use "forge-1.20.1-47.2.0"
        if (loader === 'forge' && loaderVersion.startsWith(`${mc.version}-`)) loaderVersion = loaderVersion.slice(mc.version.length + 1);
      }
    }
    const packName = name || manifest.name || path.basename(file, '.zip');
    const id = await this.createShell({
      name: packName,
      mcVersion: mc.version,
      loader,
      loaderVersion,
      group,
      iconPng: await this.iconPng(icon),
      managed: managed || { id: '', versionId: '', versionName: manifest.version || '' },
      managedType: 'flame',
    });
    const root = await this.instances.locate(id);
    // stopped half way: don't leave a broken profile behind
    if (task && task.onCancel) {
      task.onCancel(async () => {
        await fsp.rm(root, { recursive: true, force: true });
        this.emit('instances:changed', {});
      });
    }
    const game = gameDirOf(root);
    const blocked = [];
    const failed = [];
    const entries = (manifest.files || []).filter((f) => f.required !== false);
    if (entries.length) {
      if (!curseforge.hasKey()) {
        failed.push({ title: tr('{n} archivos', { n: entries.length }), reason: tr('Falta la API key de CurseForge para descargar los mods del modpack') });
      } else {
        if (task) task.progress(0.22, tr('Resolviendo archivos…'));
        const files = [];
        for (let i = 0; i < entries.length; i += 500) files.push(...(await curseforge.filesByIds(entries.slice(i, i + 500).map((e) => e.fileID))));
        const mods = [];
        const modIds = [...new Set(files.map((f) => f.projectId))];
        for (let i = 0; i < modIds.length; i += 500) mods.push(...(await curseforge.mods(modIds.slice(i, i + 500))));
        const modById = new Map(mods.map((m) => [String(m.id), m]));
        let done = 0;
        await http.pool(files, 6, async (fv) => {
          const f = fv.files[0];
          const mod = modById.get(fv.projectId);
          const type = mod ? CLASS_TYPES[mod.classId] || 'mod' : 'mod';
          const folder = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks', world: 'saves' }[type] || 'mods';
          // its author doesn't let other apps download it: another allowed source, or it's fetched later from CurseForge's own page (blocked.js)
          const url = f.url || (await alternativeUrl(fv, f));
          if (!url) {
            blocked.push(blockedEntry({ version: fv, file: f, mod, folder: path.join(game, folder), title: mod ? mod.title : f.filename, resume: { kind: 'pack', game, folder, version: fv, mod: mod ? { slug: mod.slug, title: mod.title } : null } }));
          } else {
            try {
              await this.placeFile({ game, folder, version: fv, mod, url });
            } catch (e) {
              failed.push({ title: f.filename, reason: e.message });
            }
          }
          done++;
          if (task) task.progress(0.25 + 0.65 * (done / files.length), tr('Descargando mods ({done}/{total})', { done, total: files.length }));
        });
      }
    }
    if (task) task.progress(0.92, tr('Copiando configuración…'));
    const overrides = (manifest.overrides || 'overrides').replace(/\/?$/, '/');
    await zip.extractPrefix(file, overrides, game);
    await this.instances.writeDefaultOptions(game);
    const keys = await this.packKeys(id, file, [overrides], packName);
    this.emit('instances:changed', {});
    return { id, blocked, failed, keys };
  }

  // ---------- import local archives ----------
  // Key bindings of a freshly installed modpack. Havi Hub writes the
  // person's own (Ajustes → Minecraft → Teclas) when it creates the profile,
  // but a pack that brings its own options.txt replaces that file. If that
  // file has key bindings (chosen by the pack's author so its mods don't
  // clash), the person chooses whose to use: 'ask' here, then the
  // 'modpack:keys' event; the page answers with instances.applyKeysTo.
  // Otherwise the person's are applied on top of the pack's other options.
  async packKeys(id, file, prefixes, name) {
    if (!this.instances.hasCustomKeys()) return null;
    const names = await zip.listEntries(file);
    if (!prefixes.some((p) => names.includes(`${p}options.txt`))) return null;
    const inst = await this.instances.get(id);
    const text = await fsp.readFile(path.join(gameDirOf(inst.root), 'options.txt'), 'utf8').catch(() => '');
    if (!/^key_/m.test(text)) {
      await this.instances.applyKeysTo(id);
      return 'applied';
    }
    this.emit('modpack:keys', { id, name: name || inst.name });
    return 'ask';
  }

  // The settings of a Prism instance in this archive that would run something
  // on this computer (prism/launchsettings.js); [] for anything else.
  async archiveLaunchSettings(file) {
    const names = await zip.listEntries(file);
    if (names.includes('modrinth.index.json') || names.includes('manifest.json')) return [];
    const cfgEntry = names.filter((n) => /(^|\/)instance\.cfg$/.test(n)).sort((a, b) => a.length - b.length)[0];
    const buf = cfgEntry ? await zip.readEntry(file, cfgEntry) : null;
    if (!buf) return [];
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return riskyLaunchSettings(new IniFile(text));
  }

  // launchSettings: 'keep' to keep what archiveLaunchSettings found (the
  // person chose so); otherwise it is taken out.
  async importArchive(file, { group, launchSettings } = {}) {
    const names = await zip.listEntries(file);
    if (names.includes('modrinth.index.json')) {
      return this.tasks.run(tr('Importando {file}', { file: path.basename(file) }), { kind: 'modpack' }, (task) => this.installMrpack(file, { task, group }));
    }
    if (names.includes('manifest.json')) {
      return this.tasks.run(tr('Importando {file}', { file: path.basename(file) }), { kind: 'modpack' }, (task) => this.installCurseZip(file, { task, group }));
    }
    const cfgEntry = names.filter((n) => /(^|\/)instance\.cfg$/.test(n)).sort((a, b) => a.length - b.length)[0];
    if (cfgEntry) {
      return this.tasks.run(tr('Importando {file}', { file: path.basename(file) }), { kind: 'import' }, async (task) => {
        const prefix = cfgEntry.slice(0, cfgEntry.length - 'instance.cfg'.length);
        const ctx = this.ctxProvider();
        const { primaryInstanceDir } = await ctx.dirs();
        const base = prefix ? prefix.replace(/\/$/, '').split('/').pop() : path.basename(file).replace(/\.zip$/i, '');
        const id = await uniqueDirName(primaryInstanceDir, safeName(base));
        task.progress(0.1, tr('Extrayendo…'));
        await zip.extractPrefix(file, prefix, path.join(primaryInstanceDir, id));
        const cfg = await IniFile.load(path.join(primaryInstanceDir, id, 'instance.cfg'));
        cfg.remove('uuid');
        // what would run something on this computer stays only if the person said so
        if (launchSettings !== 'keep') dropLaunchSettings(cfg);
        await cfg.save();
        if (group) await this.instances.setGroup(id, group);
        this.emit('instances:changed', {});
        return { id, blocked: [], failed: [] };
      });
    }
    throw new UserError('No reconozco este archivo. Usa un .mrpack, un modpack de CurseForge (.zip) o una instancia exportada de Prism (.zip).');
  }

  // ---------- export ----------
  // What exportZip leaves out unless asked (personalSettings in launchsettings.js)
  async exportSettings(id) {
    const root = await this.instances.locate(id);
    const cfg = await IniFile.load(path.join(root, 'instance.cfg')).catch(() => null);
    return cfg ? personalSettings(cfg) : [];
  }

  // personalSettings: 'keep' to share this computer's commands, Java and
  // variables as they are; otherwise the exported instance.cfg goes without them
  async exportZip(id, dest, { includeWorlds = true, includeScreenshots = false, personalSettings: personal = 'drop' } = {}) {
    const root = await this.instances.locate(id);
    const gameRel = path.relative(root, gameDirOf(root)).split(path.sep).join('/');
    const skip = [`${gameRel}/logs`, `${gameRel}/crash-reports`, 'natives', `${gameRel}/.cache`, `${gameRel}/backups`];
    if (!includeWorlds) skip.push(`${gameRel}/saves`);
    if (!includeScreenshots) skip.push(`${gameRel}/screenshots`);
    return this.tasks.run(tr('Exportando {name}', { name: id }), { kind: 'export', instanceId: id }, async () => {
      const items = await zip.collectFiles(root, '', (rel) => skip.some((s) => rel === s || rel.startsWith(`${s}/`)) || rel === 'logs.zip' || rel.endsWith('.part'));
      if (personal !== 'keep') {
        const at = items.findIndex((it) => it.name === 'instance.cfg' && it.abs);
        if (at >= 0) {
          const cfg = await IniFile.load(items[at].abs);
          if (dropPersonalSettings(cfg)) items[at] = { name: 'instance.cfg', buffer: Buffer.from(cfg.toString(), 'utf8') };
        }
      }
      await zip.writeZip(dest, items);
      return dest;
    });
  }

  // CurseForge's own export format ("Export profile" / "Import profile .zip"
  // in the CurseForge app): manifest.json lists the CurseForge files, the
  // rest of the profile goes in overrides/.
  // One file of a CurseForge pack: downloaded into its folder, with the
  // metadata that lets Havi Hub recognize and update it later.
  async placeFile({ game, folder, version: fv, mod, url }) {
    const f = fv.files[0];
    const from = url || f.url || (await alternativeUrl(fv, f));
    if (!from) throw new UserError('No hay de dónde descargar {file}', { file: f.filename });
    await http.download(from, await resolveInside(path.join(game, folder), f.filename), { hash: f.hashes.sha1, hashAlgo: 'sha1' });
    if (folder !== 'saves' && this.appConfig.get().writePrismMetadata) {
      const indexDir = folder === 'shaderpacks' ? path.join(game, folder) : path.join(game, folder, '.index');
      await writeMetadata(indexDir, {
        slug: mod ? mod.slug : f.filename,
        name: mod ? mod.title : f.filename,
        filename: f.filename,
        side: 'both',
        loaders: fv.loaders,
        mcVersions: fv.gameVersions,
        releaseType: fv.type.charAt(0).toUpperCase() + fv.type.slice(1),
        versionNumber: fv.name,
        hash: f.hashes.sha1 || '',
        hashFormat: 'sha1',
        provider: 'curseforge',
        projectId: fv.projectId,
        fileId: fv.id,
        dependencies: [],
      }).catch(() => {});
    }
  }

  async exportCurseZip(id, dest, { name, version = '1.0.0', author = '', includeWorlds = false } = {}) {
    const inst = await this.instances.get(id);
    const game = gameDirOf(inst.root);
    return this.tasks.run(tr('Exportando {name} (CurseForge)', { name: inst.name }), { kind: 'export', instanceId: id }, async (task) => {
      const files = [];
      const listed = [];
      const handled = new Set();
      const unknown = [];
      for (const folder of ['mods', 'resourcepacks', 'shaderpacks']) {
        const dir = path.join(game, folder);
        const meta = await readMetadata(folder === 'shaderpacks' ? dir : path.join(dir, '.index'));
        const byName = new Map([...meta.values()].map((m) => [m.filename.toLowerCase(), m]));
        let ents = [];
        try {
          ents = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of ents) {
          if (!e.isFile() || e.name.endsWith('.pw.toml')) continue;
          const disabled = e.name.toLowerCase().endsWith('.disabled');
          const base = disabled ? e.name.slice(0, -9) : e.name;
          const abs = path.join(dir, e.name);
          const m = byName.get(base.toLowerCase());
          if (m && m.provider === 'curseforge' && m.projectId && m.fileId) {
            files.push({ projectID: Number(m.projectId), fileID: Number(m.fileId), required: !disabled });
            listed.push({ name: m.name || base, projectId: m.projectId });
            handled.add(path.resolve(abs));
          } else if (!m || m.provider !== 'curseforge') unknown.push({ abs, base, disabled });
        }
      }
      // files added by hand or from Modrinth: the same file on CurseForge? (fingerprint)
      if (unknown.length && curseforge.hasKey()) {
        task.progress(0.2, tr('Buscando los archivos en CurseForge…'));
        try {
          const fps = new Map();
          for (const u of unknown) fps.set(await curseFingerprint(u.abs), u);
          for (const m of await curseforge.fingerprints([...fps.keys()])) {
            const u = fps.get(m.file.files[0].fingerprint);
            if (!u) continue;
            files.push({ projectID: Number(m.projectId), fileID: Number(m.file.id), required: !u.disabled });
            listed.push({ name: m.file.name || u.base, projectId: m.projectId });
            handled.add(path.resolve(u.abs));
          }
        } catch (e) {
          if (e.code === 'CANCELLED') throw e;
        }
      }
      task.progress(0.45, tr('Empaquetando…'));
      const skip = ['logs', 'crash-reports', 'screenshots', 'backups', '.cache', 'options.txt.bak', '.havihub'];
      if (!includeWorlds) skip.push('saves');
      const all = await zip.collectFiles(game, 'overrides/', (rel) => skip.some((s) => rel === s || rel.startsWith(`${s}/`)) || rel.includes('/.index/') || rel.endsWith('.pw.toml'));
      const overrides = all.filter((it) => it.dir || !handled.has(path.resolve(it.abs)));
      const loaderId = inst.loader ? `${inst.loader.id}-${inst.loader.version}` : null;
      const manifest = {
        minecraft: { version: inst.mcVersion, modLoaders: loaderId ? [{ id: loaderId, primary: true }] : [] },
        manifestType: 'minecraftModpack',
        manifestVersion: 1,
        name: name || inst.name,
        version,
        author,
        files,
        overrides: 'overrides',
      };
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      const modlist = `<ul>\n${listed.map((l) => `<li><a href="https://www.curseforge.com/projects/${esc(l.projectId)}">${esc(l.name)}</a></li>`).join('\n')}\n</ul>\n`;
      await zip.writeZip(dest, [
        { name: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest, null, 2)) },
        { name: 'modlist.html', buffer: Buffer.from(modlist) },
        ...overrides,
      ]);
      return dest;
    });
  }

  async exportMrpack(id, dest, { name, version = '1.0.0', summary = '' } = {}) {
    const inst = await this.instances.get(id);
    const root = inst.root;
    const game = gameDirOf(root);
    return this.tasks.run(tr('Exportando {name} (.mrpack)', { name: inst.name }), { kind: 'export', instanceId: id }, async (task) => {
      const files = [];
      const overrideItems = [];
      const handled = new Set();
      for (const folder of ['mods', 'resourcepacks', 'shaderpacks']) {
        const dir = path.join(game, folder);
        const meta = await readMetadata(folder === 'shaderpacks' ? dir : path.join(dir, '.index'));
        for (const m of meta.values()) {
          const abs = await resolveInside(dir, m.filename).catch(() => null);
          if (!abs || !(await exists(abs))) continue;
          if (m.provider === 'modrinth' && m.download.url && /^https:\/\/cdn\.modrinth\.com\//.test(m.download.url)) {
            const st = await fsp.stat(abs);
            const hashes = await hashFileMulti(abs, ['sha1', 'sha512']);
            files.push({
              path: `${folder}/${m.filename}`,
              hashes,
              env: { client: 'required', server: m.side === 'client' ? 'unsupported' : 'required' },
              downloads: [m.download.url],
              fileSize: st.size,
            });
            handled.add(path.resolve(abs));
          }
        }
      }
      task.progress(0.4, tr('Empaquetando…'));
      const skip = ['logs', 'crash-reports', 'saves', 'screenshots', 'backups', '.cache', 'options.txt.bak'];
      const all = await zip.collectFiles(game, 'overrides/', (rel) => skip.some((s) => rel === s || rel.startsWith(`${s}/`)) || rel.includes('/.index/') || rel.endsWith('.pw.toml') || rel.endsWith('.disabled'));
      for (const it of all) if (!handled.has(path.resolve(it.abs))) overrideItems.push(it);
      const deps = { minecraft: inst.mcVersion };
      if (inst.loader) {
        const key = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' }[inst.loader.id];
        if (key) deps[key] = inst.loader.version;
      }
      const index = { formatVersion: 1, game: 'minecraft', versionId: version, name: name || inst.name, summary, files, dependencies: deps };
      await zip.writeZip(dest, [{ name: 'modrinth.index.json', buffer: Buffer.from(JSON.stringify(index, null, 2)) }, ...overrideItems]);
      return dest;
    });
  }
}

module.exports = { Modpacks, safeRelPath, LOADER_UIDS, readJson, writeJson };
