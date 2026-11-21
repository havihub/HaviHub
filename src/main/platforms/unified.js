// Unified content service over Modrinth + CurseForge:
//  - search with source "modrinth" | "curseforge" | "both" (duplicates merged,
//    keeping the most recently updated project)
//  - project pages, versions, installation with dependencies, update checks
const { parseProjectLink } = require('../../shared/projectLink');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { modrinth } = require('./modrinth');
const { curseforge, LOADER_TYPES } = require('./curseforge');
const http = require('../util/http');
const { hashFile, hashFileMulti, curseFingerprint } = require('../util/hash');
const { writeMetadata, readMetadata } = require('../prism/content');
const { isPlainFileName, resolveInside } = require('../util/safepath');
const { Worlds } = require('../prism/worlds');

const KIND_BY_TYPE = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' };
const { modLoadersFor, versionCompatible, typeAllowed, TYPE_OF_KIND } = require('../../shared/compat.js');
const { alternativeUrl, blockedEntry } = require('./blocked');
const { UserError, tr } = require('../../shared/usertext');
const RANK = { release: 0, beta: 1, alpha: 2 };

// ---------- helpers ----------
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\((fabric|forge|neoforge|quilt)[^)]*\)|\[(fabric|forge|neoforge|quilt)[^\]]*\]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function words(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .split(/[^a-z0-9áéíóúñ]+/)
      .filter((w) => w.length > 3),
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function isSameProject(a, b) {
  if (norm(a.title) !== norm(b.title)) return false;
  if (a.slug && b.slug && norm(a.slug) === norm(b.slug)) return true;
  if (a.author && b.author && norm(a.author) === norm(b.author)) return true;
  return jaccard(words(a.description), words(b.description)) >= 0.25;
}

function time(d) {
  const t = d ? Date.parse(d) : 0;
  return Number.isFinite(t) ? t : 0;
}

// Merge results from both platforms. When the same project exists on both,
// keep the one updated most recently and remember the other in `alsoOn`.
function mergeResults(mr, cf, sort) {
  const merged = [];
  const used = new Set();
  const cfByTitle = new Map();
  cf.forEach((p, i) => {
    const k = norm(p.title);
    if (!cfByTitle.has(k)) cfByTitle.set(k, []);
    cfByTitle.get(k).push(i);
  });
  const pairs = [];
  mr.forEach((m) => {
    const cands = cfByTitle.get(norm(m.title)) || [];
    const ci = cands.find((i) => !used.has(i) && isSameProject(m, cf[i]));
    if (ci !== undefined) {
      used.add(ci);
      const c = cf[ci];
      const winner = time(c.updated) > time(m.updated) ? c : m;
      const other = winner === c ? m : c;
      pairs.push({
        ...winner,
        env: m.env || c.env || '',
        downloads: Math.max(winner.downloads || 0, other.downloads || 0),
        alsoOn: { source: other.source, id: other.id, slug: other.slug, url: other.url, updated: other.updated },
        _rank: Math.min(mr.indexOf(m), ci),
      });
    } else pairs.push({ ...m, _rank: mr.indexOf(m) });
  });
  cf.forEach((c, i) => {
    if (!used.has(i)) pairs.push({ ...c, _rank: i });
  });
  if (sort === 'downloads') pairs.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  else if (sort === 'updated') pairs.sort((a, b) => time(b.updated) - time(a.updated));
  else if (sort === 'newest') pairs.sort((a, b) => time(b.created) - time(a.created));
  else if (sort === 'follows') pairs.sort((a, b) => (b.follows || 0) - (a.follows || 0));
  else pairs.sort((a, b) => a._rank - b._rank || (b.downloads || 0) - (a.downloads || 0));
  for (const p of pairs) {
    delete p._rank;
    merged.push(p);
  }
  return merged;
}

// Map Modrinth category names to CurseForge category names (best effort)
const CATEGORY_HINTS = {
  adventure: ['adventure'],
  cursed: ['miscellaneous'],
  decoration: ['cosmetic', 'decoration'],
  economy: ['economy'],
  equipment: ['armor', 'weapons', 'tools'],
  food: ['food'],
  'game-mechanics': ['miscellaneous', 'mechanics'],
  library: ['library', 'api'],
  magic: ['magic'],
  management: ['map', 'information'],
  minigame: ['minigame', 'adventure'],
  mobs: ['mobs'],
  optimization: ['performance'],
  social: ['server utility', 'social'],
  storage: ['storage'],
  technology: ['technology'],
  transportation: ['transportation', 'player transport'],
  utility: ['utility', 'qol'],
  worldgen: ['world gen', 'biomes', 'structures', 'dimensions'],
};

function loadersFor(instance) {
  const l = instance && instance.loader ? instance.loader.id : null;
  if (!l) return [];
  if (l === 'quilt') return ['quilt', 'fabric'];
  if (l === 'neoforge' && instance.mcVersion === '1.20.1') return ['neoforge', 'forge'];
  return [l];
}

// A service that is down or very slow must not hold up the other one: after
// `ms` its part is given up (it keeps loading in the background) and the
// caller shows what the other service returned, with a discreet notice.
const SEARCH_DEADLINE = 12000;
const UPDATE_DEADLINE = 25000;
function withDeadline(p, ms) {
  let timer;
  return Promise.race([
    p,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new UserError('El servicio tarda demasiado en responder', null, { code: 'SLOW' })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
const serviceError = (e) => ({ code: (e && e.code) || 'ERROR', message: (e && e.message) || String(e) });

class Platforms {
  constructor({ instances, content, tasks, appConfig, emit }) {
    this.instances = instances;
    this.content = content;
    this.tasks = tasks;
    this.appConfig = appConfig;
    this.emit = emit;
    this.cfCategoryCache = new Map();
    this.updateCache = new Map();
  }

  prefRank() {
    return RANK[this.appConfig.get().preferredRelease] ?? 0;
  }

  // ---------- search ----------
  async cfCategoryIds(type, mrCategories) {
    if (!mrCategories || !mrCategories.length) return [];
    let cats = this.cfCategoryCache.get(type);
    if (!cats) {
      cats = await curseforge.categories(type);
      this.cfCategoryCache.set(type, cats);
    }
    const ids = [];
    for (const c of mrCategories) {
      const hints = CATEGORY_HINTS[c] || [c];
      const match = cats.find((x) => hints.some((h) => x.name.toLowerCase().includes(h)));
      if (!match) return null; // no equivalent: skip CurseForge for this filter
      ids.push(match.id);
    }
    return ids;
  }

  async search(opts) {
    const { source = 'both', type = 'mod', limit = 20 } = opts;
    const offset = opts.offset || { modrinth: 0, curseforge: 0 };
    const errors = {};
    const wantMr = source === 'modrinth' || source === 'both';
    const wantCf = (source === 'curseforge' || source === 'both') && type !== 'world';
    const per = source === 'both' ? Math.ceil(limit / 2) + 4 : limit;

    const mrP = wantMr && type !== 'world'
      ? withDeadline(modrinth.search({ ...opts, offset: offset.modrinth || 0, limit: per }), SEARCH_DEADLINE)
          .catch((e) => {
            errors.modrinth = { code: e.code || 'ERROR', message: e.message };
            return { total: 0, hits: [] };
          })
      : Promise.resolve({ total: 0, hits: [] });

    const cfP = (async () => {
      if (!wantCf && !(type === 'world' && source !== 'modrinth')) return { total: 0, hits: [] };
      if (!curseforge.hasKey()) {
        errors.curseforge = { code: 'CF_NO_KEY', message: 'Falta la API key de CurseForge' };
        return { total: 0, hits: [] };
      }
      try {
        let categoryIds = [];
        if (opts.categories && opts.categories.length) {
          categoryIds = opts.cfCategoryIds || (await this.cfCategoryIds(type, opts.categories));
          if (categoryIds === null) return { total: 0, hits: [] };
        }
        return await withDeadline(curseforge.search({ ...opts, categoryIds, offset: offset.curseforge || 0, limit: per }), SEARCH_DEADLINE);
      } catch (e) {
        errors.curseforge = { code: e.code || 'ERROR', message: e.message };
        return { total: 0, hits: [] };
      }
    })();

    const [mr, cf] = await Promise.all([mrP, cfP]);
    let hits;
    if (source === 'both') hits = mergeResults(mr.hits, cf.hits, opts.sort);
    else hits = source === 'curseforge' ? cf.hits : mr.hits;
    for (const h of hits) delete h._latestFilesIndexes;
    return {
      hits,
      total: (mr.total || 0) + (cf.total || 0),
      nextOffset: { modrinth: (offset.modrinth || 0) + mr.hits.length, curseforge: (offset.curseforge || 0) + cf.hits.length },
      hasMore: (offset.modrinth || 0) + mr.hits.length < mr.total || (offset.curseforge || 0) + cf.hits.length < cf.total,
      errors,
    };
  }

  // Sections for the Discover page
  async discover({ source = 'both', type = 'modpack' } = {}) {
    const [featured, popular, updated, newest] = await Promise.all([
      this.search({ source, type, sort: 'follows', limit: 10 }),
      this.search({ source, type, sort: 'downloads', limit: 16 }),
      this.search({ source, type, sort: 'updated', limit: 16 }),
      this.search({ source, type, sort: 'newest', limit: 16 }),
    ]);
    const errors = { ...featured.errors, ...popular.errors };
    return { featured: featured.hits.slice(0, 8), popular: popular.hits, updated: updated.hits, newest: newest.hits, errors };
  }

  async categories(source, type) {
    if (source === 'curseforge') return curseforge.categories(type);
    const all = await modrinth.categories();
    const t = type === 'shader' ? 'shader' : type === 'datapack' ? 'mod' : type;
    return all.filter((c) => c.type === t && c.header !== 'resolutions' && c.header !== 'performance impact' && c.header !== 'features').map((c) => ({ id: c.name, name: c.name, icon: c.icon, header: c.header }));
  }

  async project(source, id) {
    return source === 'curseforge' ? curseforge.project(id) : modrinth.project(id);
  }

  // A link to a project page → { source, id } to open it here, or null (not a
  // project link, the project is not found, or CurseForge has no key set)
  async resolveLink(link) {
    const p = parseProjectLink(link);
    if (!p) return null;
    try {
      if (p.source === 'modrinth') {
        const project = await modrinth.project(p.slug);
        return project && project.id ? { source: 'modrinth', id: String(project.id), type: p.type } : null;
      }
      const id = await curseforge.idBySlug(p.slug, p.type);
      return id ? { source: 'curseforge', id, type: p.type } : null;
    } catch {
      return null;
    }
  }

  async versions(source, id, { gameVersion, loaders } = {}) {
    if (source === 'curseforge') {
      const loader = loaders && loaders.length === 1 ? loaders[0] : undefined;
      const list = await curseforge.files(id, { gameVersion, loader, pageSize: 50 });
      return list.sort((a, b) => time(b.date) - time(a.date));
    }
    const list = await modrinth.versions(id, { loaders, gameVersions: gameVersion ? [gameVersion] : undefined });
    return list.sort((a, b) => time(b.date) - time(a.date));
  }

  pickBest(list) {
    if (!list.length) return null;
    const pref = this.prefRank();
    const sorted = [...list].sort((a, b) => time(b.date) - time(a.date));
    return sorted.find((v) => (RANK[v.type] ?? 0) <= pref) || sorted[0];
  }

  async bestVersion(source, projectId, instance, kind) {
    const mc = instance.mcVersion;
    const loaders = kind === 'mods' ? loadersFor(instance) : kind === 'datapacks' && source === 'modrinth' ? ['datapack'] : undefined;
    let list;
    if (source === 'curseforge') {
      list = [];
      for (const l of loaders || [undefined]) {
        list.push(...(await curseforge.files(projectId, { gameVersion: mc, loader: l })));
      }
      // resource packs and shaders work across versions; data packs and mods don't
      if (!list.length && (kind === 'shaderpacks' || kind === 'resourcepacks')) list = await curseforge.files(projectId, {});
    } else {
      list = await modrinth.versions(projectId, { loaders, gameVersions: mc ? [mc] : undefined });
      if (!list.length && (kind === 'shaderpacks' || kind === 'resourcepacks')) list = await modrinth.versions(projectId, {});
    }
    return this.pickBest(list);
  }

  // ---------- install ----------
  async install({ source, projectId, versionId, instanceId, type = 'mod', world, title }) {
    if (type === 'world') return this.installWorld({ source, projectId, versionId, instanceId, title });
    const kind = KIND_BY_TYPE[type];
    if (!kind) throw new Error(`No se puede instalar este tipo de contenido en una instancia: ${type}`);
    const instance = await this.instances.get(instanceId);
    // a vanilla profile can't run mods or shaders: installing them would do nothing
    if (!typeAllowed(instance, type)) {
      throw Object.assign(new Error(type === 'shader' ? 'Este perfil es vanilla: los shaders necesitan Iris u OptiFine, que funcionan con un cargador de mods.' : 'Este perfil es vanilla: para usar mods, cambia su versión a una con Fabric, Forge, NeoForge o Quilt.'), { code: 'VANILLA' });
    }
    return this.tasks.run(tr('Instalando {name}', { name: title || projectId }), { kind: 'install', instanceId }, async (task) => {
      const result = { installed: [], skipped: [], blocked: [], failed: [] };
      const seen = new Set();
      await this.installOne({ source, projectId, versionId, instance, kind, world, title, result, seen, task, isDep: false });
      this.emit('content:changed', { instanceId, kind });
      return result;
    });
  }

  // CurseForge "Worlds": the file is a zip with the world; it goes to saves/
  async installWorld({ source, projectId, versionId, instanceId, title }) {
    if (source !== 'curseforge') throw new UserError('Los mundos solo están en CurseForge.');
    const instance = await this.instances.get(instanceId);
    const worlds = new Worlds(this.instances);
    return this.tasks.run(tr('Instalando {name}', { name: title || projectId }), { kind: 'install', instanceId }, async (task) => {
      const result = { installed: [], skipped: [], blocked: [], failed: [] };
      let version;
      if (versionId) version = await curseforge.file(projectId, versionId);
      else {
        let list = instance.mcVersion ? await curseforge.files(projectId, { gameVersion: instance.mcVersion }) : [];
        if (!list.length) list = await curseforge.files(projectId, {});
        version = this.pickBest(list);
      }
      const file = version && (version.files.find((f) => f.primary) || version.files[0]);
      if (!file) {
        result.failed.push({ title: title || projectId, reason: tr('No hay un archivo para descargar') });
        return result;
      }
      let proj = null;
      try {
        proj = (await curseforge.mods([projectId]))[0];
      } catch {
        proj = null;
      }
      const projTitle = (proj && proj.title) || title || file.filename;
      // its author doesn't let other apps download it: another allowed source, or it's fetched from CurseForge's own page (blocked.js)
      const fileUrl = file.url || (await alternativeUrl(version, file));
      if (!fileUrl) {
        result.blocked.push(blockedEntry({ version, file, mod: proj, title: projTitle, folder: await worlds.savesDir(instance.id), resume: { kind: 'world', args: { source, projectId, versionId: version.id, instanceId, title: projTitle } } }));
        return result;
      }
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'havihub-world-'));
      try {
        const zipPath = path.join(tmp, /\.zip$/i.test(file.filename) ? file.filename : `${file.filename}.zip`);
        task.progress(0, tr('Descargando {file}', { file: file.filename }));
        await http.download(fileUrl, zipPath, {
          hash: file.hashes.sha1 || undefined,
          hashAlgo: 'sha1',
          onProgress: (r, t) => task.progress(t ? r / t : 0, `${file.filename} (${Math.round(r / 1024)} KB)`),
        });
        task.progress(1, tr('Descomprimiendo el mundo…'));
        const folder = await worlds.importZip(instance.id, zipPath);
        result.installed.push({ title: projTitle, fileName: folder, version: version.versionNumber, isDep: false });
      } catch (e) {
        result.failed.push({ title: projTitle, reason: e.message });
      } finally {
        await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      }
      this.emit('content:changed', { instanceId, kind: 'worlds' });
      return result;
    });
  }

  async installedIndex(instance, kind, world) {
    const { meta, folder, indexDir } = await this.content.metadataFor(instance.id, kind, { world });
    const byProject = new Map();
    for (const m of meta.values()) byProject.set(`${m.provider}:${m.projectId}`, m);
    let names = [];
    if (kind === 'mods') {
      try {
        const { items } = await this.content.list(instance.id, kind, { world });
        names = items.map((i) => ({ modId: norm(i.modId), name: norm(i.name), fileName: i.fileName, baseName: i.baseName }));
      } catch {
        names = [];
      }
    }
    return { byProject, names, folder, indexDir };
  }

  async installOne({ source, projectId, versionId, instance, kind, world, title, result, seen, task, isDep, replaceFile }) {
    const key = `${source}:${projectId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const idx = await this.installedIndex(instance, kind, world);
    const existing = idx.byProject.get(key);

    let version;
    if (versionId) version = source === 'curseforge' ? await curseforge.file(projectId, versionId) : await modrinth.version(versionId);
    else version = await this.bestVersion(source, projectId, instance, kind);
    if (!version) {
      result.failed.push({ title: title || projectId, reason: tr('No hay una versión compatible con {version}', { version: `${instance.mcVersion}${instance.loader ? ' / ' + instance.loader.name : ''}` }) });
      return;
    }
    if (existing && existing.fileId === String(version.id) && !replaceFile) {
      result.skipped.push({ title: title || existing.name, reason: tr('Ya está instalado') });
      return;
    }

    const file = version.files.find((f) => f.primary) || version.files[0];
    if (!file) {
      result.failed.push({ title: title || projectId, reason: tr('La versión no tiene archivos') });
      return;
    }
    if (!isPlainFileName(file.filename)) {
      result.failed.push({ title: title || projectId, reason: tr('El nombre del archivo no es válido') });
      return;
    }

    // project info (name/slug) for metadata
    let proj = null;
    try {
      proj = source === 'curseforge' ? (await curseforge.mods([projectId]))[0] : (await modrinth.projects([projectId]))[0];
    } catch {
      proj = null;
    }
    const projTitle = (proj && proj.title) || title || file.filename;

    // its author doesn't let other apps download it: another allowed source, or it's fetched from CurseForge's own page (blocked.js)
    const fileUrl = file.url || (source === 'curseforge' ? await alternativeUrl(version, file) : null);
    if (!fileUrl) {
      result.blocked.push(
        blockedEntry({ version, file, mod: proj, title: projTitle, folder: idx.folder, resume: { kind: 'content', args: { source, projectId, versionId: version.id, instanceId: instance.id, type: TYPE_OF_KIND[kind] || 'mod', world, title: projTitle } } }),
      );
      return;
    }

    // remove old version(s) of this project
    const oldFiles = [];
    if (existing) oldFiles.push(existing.filename);
    if (replaceFile) oldFiles.push(replaceFile);
    let wasDisabled = false;
    for (const f of new Set(oldFiles)) {
      if (!isPlainFileName(f)) continue; // never delete outside the folder
      for (const candidate of [f, `${f}.disabled`]) {
        try {
          const p = await resolveInside(idx.folder, candidate);
          await fsp.access(p);
          if (candidate.endsWith('.disabled')) wasDisabled = true;
          await fsp.rm(p, { recursive: true, force: true });
        } catch {
          /* not present */
        }
      }
    }
    if (existing) await fsp.rm(existing.metaFile, { force: true });

    const dest = await resolveInside(idx.folder, file.filename + (wasDisabled ? '.disabled' : ''));
    task.progress(0, tr('Descargando {file}', { file: file.filename }));
    const hashAlgo = file.hashes.sha512 ? 'sha512' : file.hashes.sha1 ? 'sha1' : null;
    await http.download(fileUrl, dest, {
      hash: hashAlgo ? file.hashes[hashAlgo] : undefined,
      hashAlgo: hashAlgo || 'sha1',
      onProgress: (r, t) => task.progress(t ? r / t : 0, `${file.filename} (${Math.round(r / 1024)} KB)`),
    });

    if (this.appConfig.get().writePrismMetadata) {
      let hash = hashAlgo ? file.hashes[hashAlgo] : await hashFile(dest, 'sha1');
      await writeMetadata(idx.indexDir, {
        slug: (proj && proj.slug) || file.filename.replace(/\.[^.]+$/, ''),
        name: projTitle,
        filename: file.filename,
        side: proj && (proj.env || (proj.clientSide && proj.serverSide)) ? sideOf(proj) : 'both',
        loaders: version.loaders.filter((l) => !['minecraft', 'datapack', 'iris', 'optifine', 'canvas', 'vanilla'].includes(l)),
        mcVersions: version.gameVersions,
        releaseType: capitalize(version.type),
        versionNumber: version.versionNumber,
        hash,
        hashFormat: hashAlgo || 'sha1',
        provider: source,
        url: file.url,
        projectId: String(projectId),
        fileId: String(version.id),
        dependencies: version.dependencies
          .filter((d) => d.projectId)
          .map((d) => ({ addonId: d.projectId, type: d.type.toUpperCase(), version: d.versionId || '' })),
      });
    }
    result.installed.push({ title: projTitle, fileName: file.filename, version: version.versionNumber, isDep });

    // required dependencies
    if (!this.appConfig.get().autoInstallDependencies) return;
    const deps = version.dependencies.filter((d) => d.type === 'required' && d.projectId);
    if (!deps.length) return;
    let depProjects = [];
    try {
      depProjects = source === 'curseforge' ? await curseforge.mods(deps.map((d) => d.projectId)) : await modrinth.projects(deps.map((d) => d.projectId));
    } catch {
      depProjects = [];
    }
    for (const d of deps) {
      const p = depProjects.find((x) => String(x.id) === String(d.projectId));
      const fresh = await this.installedIndex(instance, kind, world);
      if (fresh.byProject.has(`${source}:${d.projectId}`)) continue;
      if (p && fresh.names.some((n) => (n.modId && (n.modId === norm(p.slug) || n.modId === norm(p.title))) || n.name === norm(p.title))) continue;
      try {
        await this.installOne({ source, projectId: d.projectId, versionId: source === 'modrinth' ? d.versionId : undefined, instance, kind, world, title: p ? p.title : d.projectId, result, seen, task, isDep: true });
      } catch (e) {
        result.failed.push({ title: p ? p.title : d.projectId, reason: e.message });
      }
    }
  }

  // ---------- updates ----------
  async checkUpdates(instanceId, kind = 'mods', { world } = {}) {
    const instance = await this.instances.get(instanceId);
    const { items } = await this.content.list(instanceId, kind, { world });
    const pref = this.prefRank();
    const mc = instance.mcVersion ? [instance.mcVersion] : [];
    const loaders = kind === 'mods' ? loadersFor(instance) : undefined;
    const updates = {};
    const identified = {};
    const errors = {}; // service -> { code, message }: what it couldn't check

    const files = items.filter((i) => !i.isDir);
    // 1) Modrinth entries with metadata
    const mrByAlgo = { sha1: [], sha512: [] };
    const hashToItem = new Map();
    for (const it of files) {
      if (it.meta && it.meta.lockUpdate) continue;
      if (it.meta && it.meta.provider === 'modrinth' && it.meta.hash && mrByAlgo[it.meta.hashFormat]) {
        mrByAlgo[it.meta.hashFormat].push(it.meta.hash);
        hashToItem.set(it.meta.hash, it);
      }
    }
    // 2) unknown files: identify by sha1 on Modrinth
    const unknown = files.filter((i) => !i.meta);
    const sha1Map = new Map();
    for (const it of unknown) {
      try {
        const h = await hashFile(it.path, 'sha1');
        sha1Map.set(h, it);
      } catch {
        /* unreadable */
      }
    }
    if (sha1Map.size) {
      try {
        const found = await withDeadline(modrinth.versionsByHash([...sha1Map.keys()], 'sha1'), UPDATE_DEADLINE);
        for (const [h, v] of Object.entries(found)) {
          const it = sha1Map.get(h);
          identified[it.fileName] = { source: 'modrinth', projectId: v.projectId, versionId: v.id };
          mrByAlgo.sha1.push(h);
          hashToItem.set(h, it);
          sha1Map.delete(h);
        }
      } catch (e) {
        errors.modrinth = serviceError(e);
      }
    }
    for (const algo of ['sha1', 'sha512']) {
      const list = mrByAlgo[algo];
      if (!list.length || errors.modrinth) continue;
      try {
        const latest = await withDeadline(modrinth.latestByHash(list, algo, { loaders, gameVersions: mc }), UPDATE_DEADLINE);
        for (const [h, v] of Object.entries(latest)) {
          const it = hashToItem.get(h);
          if (!it) continue;
          const currentId = it.meta ? it.meta.fileId : identified[it.fileName] && identified[it.fileName].versionId;
          let target = v;
          if ((RANK[v.type] ?? 0) > pref) {
            const all = await modrinth.versions(v.projectId, { loaders, gameVersions: mc }).catch(() => []);
            target = this.pickBest(all.filter((x) => (RANK[x.type] ?? 0) <= pref)) || null;
          }
          if (target && String(target.id) !== String(currentId)) {
            const fileNow = target.files.find((f) => f.primary) || target.files[0];
            if (fileNow && fileNow.filename === it.baseName) continue;
            updates[it.fileName] = { source: 'modrinth', projectId: v.projectId, versionId: target.id, versionNumber: target.versionNumber, type: target.type, date: target.date };
          }
        }
      } catch (e) {
        errors.modrinth = serviceError(e);
      }
    }

    // 3) CurseForge entries
    if (curseforge.hasKey()) {
      const cfItems = files.filter((i) => i.meta && i.meta.provider === 'curseforge' && !i.meta.lockUpdate);
      // identify still-unknown files by fingerprint
      if (sha1Map.size) {
        try {
          const fps = new Map();
          for (const it of sha1Map.values()) fps.set(await curseFingerprint(it.path), it);
          const matches = await withDeadline(curseforge.fingerprints([...fps.keys()]), UPDATE_DEADLINE);
          for (const m of matches) {
            const it = fps.get(m.file.files[0].fingerprint);
            if (!it) continue;
            identified[it.fileName] = { source: 'curseforge', projectId: m.projectId, versionId: m.file.id };
            cfItems.push({ ...it, meta: { provider: 'curseforge', projectId: m.projectId, fileId: m.file.id } });
          }
        } catch (e) {
          errors.curseforge = serviceError(e);
        }
      }
      if (cfItems.length && !errors.curseforge) {
        try {
          const mods = await withDeadline(curseforge.mods(cfItems.map((i) => i.meta.projectId)), UPDATE_DEADLINE);
          const loaderType = loaders && loaders.length ? LOADER_TYPES[loaders[0]] : null;
          for (const it of cfItems) {
            const mod = mods.find((m) => String(m.id) === String(it.meta.projectId));
            if (!mod) continue;
            const candidates = (mod._latestFilesIndexes || []).filter(
              (x) => (!mc.length || x.gameVersion === mc[0]) && (kind !== 'mods' || !loaderType || x.modLoader === loaderType || x.modLoader == null) && x.releaseType - 1 <= pref,
            );
            const best = candidates.sort((a, b) => b.fileId - a.fileId)[0];
            if (best && String(best.fileId) !== String(it.meta.fileId) && best.fileId > Number(it.meta.fileId)) {
              updates[it.fileName] = { source: 'curseforge', projectId: String(mod.id), versionId: String(best.fileId), versionNumber: best.filename, type: ['', 'release', 'beta', 'alpha'][best.releaseType] || 'release' };
            }
          }
        } catch (e) {
          errors.curseforge = serviceError(e);
        }
      }
    }

    const res = { updates, identified, errors, checkedAt: Date.now() };
    // with a service down, check again next time instead of keeping a partial answer
    if (!Object.keys(errors).length) this.updateCache.set(`${instanceId}|${kind}|${world || ''}`, res);
    return res;
  }

  cachedUpdates(instanceId, kind = 'mods', world) {
    return this.updateCache.get(`${instanceId}|${kind}|${world || ''}`) || null;
  }

  async applyUpdate(instanceId, kind, fileName, upd, { world, reason = 'update' } = {}) {
    const instance = await this.instances.get(instanceId);
    const baseName = fileName.toLowerCase().endsWith('.disabled') ? fileName.slice(0, -9) : fileName;
    // remember what was installed, to show it as "previous" and go back to it
    try {
      const was = await this.identify(instanceId, kind, fileName, { world });
      if (was && was.versionId && String(was.versionId) !== String(upd.versionId)) {
        await this.rememberPrevious(instanceId, `${was.source}:${was.projectId}`, { versionId: was.versionId, versionNumber: was.versionNumber || '', fileName: baseName, at: Date.now(), reason });
      }
    } catch {
      /* only a convenience */
    }
    return this.tasks.run(tr('Actualizando {name}', { name: baseName }), { kind: 'update', instanceId }, async (task) => {
      const result = { installed: [], skipped: [], blocked: [], failed: [] };
      // keep disabled state: rename back after install if it was disabled
      const wasDisabled = fileName.toLowerCase().endsWith('.disabled');
      await this.installOne({ source: upd.source, projectId: upd.projectId, versionId: upd.versionId, instance, kind, world, result, seen: new Set(), task, isDep: false, replaceFile: baseName });
      if (wasDisabled) {
        for (const i of result.installed) {
          const folder = (await this.content.metadataFor(instanceId, kind, { world })).folder;
          const p = await resolveInside(folder, i.fileName).catch(() => null);
          if (p) await fsp.rename(p, `${p}.disabled`).catch(() => {});
        }
      }
      const cache = this.cachedUpdates(instanceId, kind, world);
      if (cache) delete cache.updates[fileName];
      this.emit('content:changed', { instanceId, kind });
      return result;
    });
  }

  // ---------- versions of installed content ----------
  // Which project and version an installed file is: its metadata, the last
  // update check, or a lookup of its hash on Modrinth and CurseForge.
  async identify(instanceId, kind, fileName, { world } = {}) {
    const { items } = await this.content.list(instanceId, kind, { world });
    const it = items.find((i) => i.fileName === fileName);
    if (!it) throw new UserError('Ese archivo ya no está en el perfil');
    if (it.meta && it.meta.provider && it.meta.projectId) return { source: it.meta.provider, projectId: String(it.meta.projectId), versionId: String(it.meta.fileId || ''), versionNumber: it.meta.versionNumber || it.version || '', item: it };
    const cached = this.cachedUpdates(instanceId, kind, world);
    if (cached && cached.identified && cached.identified[fileName]) return { ...cached.identified[fileName], projectId: String(cached.identified[fileName].projectId), versionId: String(cached.identified[fileName].versionId), item: it };
    if (it.isDir) return null;
    try {
      const h = await hashFile(it.path, 'sha1');
      const v = (await modrinth.versionsByHash([h], 'sha1'))[h];
      if (v) return { source: 'modrinth', projectId: String(v.projectId), versionId: String(v.id), versionNumber: v.versionNumber, item: it };
    } catch {
      /* offline */
    }
    if (curseforge.hasKey()) {
      try {
        const m = (await curseforge.fingerprints([await curseFingerprint(it.path)]))[0];
        if (m) return { source: 'curseforge', projectId: String(m.projectId), versionId: String(m.file.id), versionNumber: m.file.versionNumber, item: it };
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  // The project an installed file belongs to (for opening its page)
  async projectOf(instanceId, kind, fileName, opts = {}) {
    const id = await this.identify(instanceId, kind, fileName, opts);
    return id ? { source: id.source, projectId: id.projectId } : null;
  }

  // Versions of a project, newest first, each marked compatible or not with
  // the instance (see shared/compat.js). `all`: include incompatible ones.
  async projectVersions(source, projectId, instance, kind, { all = false } = {}) {
    const type = TYPE_OF_KIND[kind] || 'mod';
    let list = [];
    if (source === 'curseforge') {
      if (!all && (type === 'mod' || type === 'datapack')) {
        const loaders = type === 'mod' ? modLoadersFor(instance) : [undefined];
        for (const l of loaders.length ? loaders : [undefined]) list.push(...(await curseforge.files(projectId, { gameVersion: instance.mcVersion, loader: l, pageSize: 50 })));
      } else {
        for (let i = 0; i < 4; i++) {
          const page = await curseforge.files(projectId, { pageSize: 50, index: i * 50 });
          list.push(...page);
          if (page.length < 50) break;
        }
      }
    } else {
      list = await modrinth.versions(projectId, {});
    }
    const seen = new Set();
    list = list.filter((v) => !seen.has(v.id) && seen.add(v.id));
    return list
      .map((v) => ({ ...v, compatible: versionCompatible(v, instance, type) }))
      .filter((v) => all || v.compatible)
      .sort((a, b) => time(b.date) - time(a.date));
  }

  // For the "Switch version" dialog
  async versionsFor(instanceId, kind, fileName, { world, all = false } = {}) {
    const instance = await this.instances.get(instanceId);
    const id = await this.identify(instanceId, kind, fileName, { world });
    if (!id) throw Object.assign(new UserError('No encontré este archivo en CurseForge ni en Modrinth: se agregó a mano, así que no tiene otras versiones para elegir.'), { code: 'UNKNOWN_FILE' });
    let versions = await this.projectVersions(id.source, id.projectId, instance, kind, { all });
    // the installed version is always in the list, compatible or not
    if (id.versionId && !versions.some((v) => String(v.id) === id.versionId)) {
      try {
        const cur = id.source === 'curseforge' ? await curseforge.file(id.projectId, id.versionId) : await modrinth.version(id.versionId);
        versions = [...versions, { ...cur, compatible: versionCompatible(cur, instance, TYPE_OF_KIND[kind]) }].sort((a, b) => time(b.date) - time(a.date));
      } catch {
        /* not available any more */
      }
    }
    const previous = (await this.previousVersions(instanceId))[`${id.source}:${id.projectId}`] || null;
    return { source: id.source, projectId: id.projectId, current: id.versionId, currentNumber: id.versionNumber, previous, versions };
  }

  async changelog(source, projectId, versionId) {
    if (source === 'curseforge') return { format: 'html', text: await curseforge.changelog(projectId, versionId).catch(() => '') };
    const v = await modrinth.version(versionId);
    return { format: 'markdown', text: v.changelog || '' };
  }

  // The version each project had before its last update or switch, kept in
  // the instance folder (.havihub-versions.json) so it travels with it.
  async previousVersions(instanceId) {
    const root = await this.instances.locate(instanceId).catch(() => null);
    if (!root) return {};
    try {
      return JSON.parse(await fsp.readFile(path.join(root, '.havihub-versions.json'), 'utf8')) || {};
    } catch {
      return {};
    }
  }

  async rememberPrevious(instanceId, key, entry) {
    const root = await this.instances.locate(instanceId);
    const all = await this.previousVersions(instanceId);
    all[key] = entry;
    await fsp.writeFile(path.join(root, '.havihub-versions.json'), JSON.stringify(all, null, 2));
  }

  async switchVersion(instanceId, kind, fileName, target, { world } = {}) {
    return this.applyUpdate(instanceId, kind, fileName, target, { world, reason: 'switch' });
  }

  async updateAll(instanceId, kind = 'mods', { world } = {}) {
    const cache = this.cachedUpdates(instanceId, kind, world) || (await this.checkUpdates(instanceId, kind, { world }));
    const out = { installed: [], skipped: [], blocked: [], failed: [] };
    for (const [fileName, upd] of Object.entries(cache.updates)) {
      try {
        const r = await this.applyUpdate(instanceId, kind, fileName, upd, { world });
        for (const k of Object.keys(out)) out[k].push(...r[k]);
      } catch (e) {
        out.failed.push({ title: fileName, reason: e.message });
      }
    }
    return out;
  }

  // Look up platform info (author, env) for installed files that only have metadata
  async enrich(items) {
    const mrIds = [...new Set(items.filter((i) => i.meta && i.meta.provider === 'modrinth').map((i) => i.meta.projectId))];
    const cfIds = [...new Set(items.filter((i) => i.meta && i.meta.provider === 'curseforge').map((i) => i.meta.projectId))];
    const out = {};
    try {
      for (const p of await modrinth.projects(mrIds)) out[`modrinth:${p.id}`] = { title: p.title, icon: p.icon, author: p.author, clientSide: p.clientSide, serverSide: p.serverSide, env: p.env, url: p.url, categories: p.categories || [] };
    } catch {
      /* offline */
    }
    if (curseforge.hasKey()) {
      try {
        for (const p of await curseforge.mods(cfIds)) out[`curseforge:${p.id}`] = { title: p.title, icon: p.icon, author: p.author, env: p.env, url: p.url, categories: p.categories || [] };
      } catch {
        /* ignore */
      }
    }
    return out;
  }
}

function sideOf(p) {
  if (p.env) return p.env;
  const c = p.clientSide !== 'unsupported';
  const s = p.serverSide !== 'unsupported';
  if (c && !s) return 'client';
  if (s && !c) return 'server';
  return 'both';
}

function capitalize(s) {
  s = String(s || 'release');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = { withDeadline, Platforms, mergeResults, isSameProject, norm, loadersFor, KIND_BY_TYPE, readMetadata, hashFileMulti };
