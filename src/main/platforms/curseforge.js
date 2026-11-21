// CurseForge API v1 client (requires the user's own API key), normalized to
// Havi Hub's common shapes.
const http = require('../util/http');
const { envFromCurseVersions } = require('./env');
const { UserError } = require('../../shared/usertext');

const BASE = 'https://api.curseforge.com/v1';
const GAME_ID = 432;
const CLASS_IDS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945, world: 17 };
const CLASS_TYPES = Object.fromEntries(Object.entries(CLASS_IDS).map(([k, v]) => [v, k]));
const LOADER_TYPES = { forge: 1, cauldron: 2, liteloader: 3, fabric: 4, quilt: 5, neoforge: 6 };
const RELEASE_TYPES = { 1: 'release', 2: 'beta', 3: 'alpha' };
const LOADER_NAMES = new Set(['forge', 'fabric', 'quilt', 'neoforge', 'liteloader', 'cauldron']);

let keyProvider = () => '';
function setKeyProvider(fn) {
  keyProvider = fn;
}

function noKey() {
  const e = new UserError('Para usar CurseForge necesitas una API key de CurseForge (Ajustes → Addons).');
  e.code = 'CF_NO_KEY';
  return e;
}

function headers() {
  const key = keyProvider();
  if (!key) throw noKey();
  return { 'x-api-key': key, Accept: 'application/json' };
}

async function get(path) {
  try {
    return await http.getJson(`${BASE}${path}`, { headers: headers() });
  } catch (e) {
    if (e.status === 403 || e.status === 401) {
      const err = new UserError('CurseForge rechazó la API key. Revísala en Ajustes → Addons.');
      err.code = 'CF_BAD_KEY';
      throw err;
    }
    throw e;
  }
}

async function post(path, body) {
  try {
    return await http.postJson(`${BASE}${path}`, body, { headers: headers() });
  } catch (e) {
    if (e.status === 403 || e.status === 401) {
      const err = new UserError('CurseForge rechazó la API key. Revísala en Ajustes → Addons.');
      err.code = 'CF_BAD_KEY';
      throw err;
    }
    throw e;
  }
}

function normalizeMod(m) {
  const type = CLASS_TYPES[m.classId] || 'mod';
  const versions = new Set();
  const loaders = new Set();
  for (const idx of m.latestFilesIndexes || []) {
    if (idx.gameVersion) versions.add(idx.gameVersion);
    const l = Object.entries(LOADER_TYPES).find(([, v]) => v === idx.modLoader);
    if (l) loaders.add(l[0]);
  }
  // the newest files tell where the mod runs ("Client" / "Server")
  const latest = [...(m.latestFiles || [])].sort((a, b) => Date.parse(b.fileDate || 0) - Date.parse(a.fileDate || 0));
  let env = '';
  for (const f of latest) {
    env = envFromCurseVersions(f.gameVersions);
    if (env) break;
  }
  return {
    source: 'curseforge',
    id: String(m.id),
    slug: m.slug,
    title: m.name,
    author: (m.authors && m.authors[0] && m.authors[0].name) || '',
    description: m.summary || '',
    icon: (m.logo && (m.logo.thumbnailUrl || m.logo.url)) || null,
    downloads: m.downloadCount || 0,
    follows: m.thumbsUpCount || 0,
    updated: m.dateReleased || m.dateModified || null,
    created: m.dateCreated || null,
    categories: (m.categories || []).map((c) => c.name),
    gameVersions: [...versions],
    loaders: [...loaders],
    type,
    url: (m.links && m.links.websiteUrl) || `https://www.curseforge.com/minecraft/${type === 'mod' ? 'mc-mods' : type + 's'}/${m.slug}`,
    featuredImage: (m.screenshots && m.screenshots[0] && m.screenshots[0].url) || null,
    allowDistribution: m.allowModDistribution !== false,
    classId: m.classId,
    env: type === 'mod' ? env : '',
    _latestFilesIndexes: m.latestFilesIndexes || [],
  };
}

function normalizeFile(f) {
  const gameVersions = [];
  const loaders = [];
  for (const g of f.gameVersions || []) {
    const lower = String(g).toLowerCase();
    if (LOADER_NAMES.has(lower)) loaders.push(lower);
    else if (/^\d/.test(g)) gameVersions.push(g);
  }
  const sha1 = (f.hashes || []).find((h) => h.algo === 1);
  const md5 = (f.hashes || []).find((h) => h.algo === 2);
  return {
    source: 'curseforge',
    projectId: String(f.modId),
    id: String(f.id),
    name: f.displayName || f.fileName,
    versionNumber: f.displayName || f.fileName,
    type: RELEASE_TYPES[f.releaseType] || 'release',
    gameVersions,
    loaders,
    date: f.fileDate,
    downloads: f.downloadCount || 0,
    changelog: '',
    files: [
      {
        filename: f.fileName,
        url: f.downloadUrl || null,
        size: f.fileLength,
        primary: true,
        hashes: { ...(sha1 ? { sha1: sha1.value } : {}), ...(md5 ? { md5: md5.value } : {}) },
        fingerprint: f.fileFingerprint,
      },
    ],
    dependencies: (f.dependencies || []).map((d) => ({
      projectId: String(d.modId),
      versionId: null,
      type: { 1: 'embedded', 2: 'optional', 3: 'required', 4: 'tool', 5: 'incompatible', 6: 'include' }[d.relationType] || 'unknown',
    })),
    blocked: !f.downloadUrl,
    env: envFromCurseVersions(f.gameVersions),
  };
}

const client = {
  hasKey: () => Boolean(keyProvider()),

  async search({ query = '', type = 'mod', gameVersion, loaders, categoryIds = [], sort = 'relevance', offset = 0, limit = 20 } = {}) {
    const sortField = { relevance: 2, downloads: 6, follows: 2, newest: 11, updated: 3, featured: 1, name: 4 }[sort] || 2;
    const params = new URLSearchParams({ gameId: String(GAME_ID), classId: String(CLASS_IDS[type] || 6), index: String(offset), pageSize: String(Math.min(limit, 50)), sortField: String(sortField), sortOrder: sortField === 4 ? 'asc' : 'desc' });
    if (query) params.set('searchFilter', query);
    if (gameVersion) params.set('gameVersion', gameVersion);
    const lt = (loaders || []).map((l) => LOADER_TYPES[l]).filter(Boolean);
    if (lt.length && (type === 'mod' || type === 'modpack')) params.set('modLoaderTypes', `[${lt.join(',')}]`);
    if (categoryIds.length) params.set('categoryIds', `[${categoryIds.join(',')}]`);
    let res;
    try {
      res = await get(`/mods/search?${params}`);
    } catch (e) {
      if (e.status === 400 && sortField === 11) {
        params.set('sortField', '3');
        res = await get(`/mods/search?${params}`);
      } else throw e;
    }
    return { total: (res.pagination && res.pagination.totalCount) || 0, hits: (res.data || []).map(normalizeMod) };
  },

  // the project a page address names (…/minecraft/texture-packs/<slug>): its id, or null
  async idBySlug(slug, type) {
    const params = new URLSearchParams({ gameId: String(GAME_ID), slug: String(slug), pageSize: '10' });
    if (CLASS_IDS[type]) params.set('classId', String(CLASS_IDS[type]));
    const res = await get(`/mods/search?${params}`);
    const hit = (res.data || []).find((m) => String(m.slug).toLowerCase() === String(slug).toLowerCase());
    return hit ? String(hit.id) : null;
  },

  async project(id) {
    const [{ data: m }, desc] = await Promise.all([get(`/mods/${id}`), get(`/mods/${id}/description`).catch(() => ({ data: '' }))]);
    const base = normalizeMod(m);
    return {
      ...base,
      body: desc.data || '',
      bodyFormat: 'html',
      gallery: (m.screenshots || []).map((s) => ({ url: s.url, thumb: s.thumbnailUrl || s.url, title: s.title || '', description: s.description || '' })),
      links: {
        source: (m.links && m.links.sourceUrl) || null,
        issues: (m.links && m.links.issuesUrl) || null,
        wiki: (m.links && m.links.wikiUrl) || null,
        discord: null,
        donations: [],
      },
      license: '',
    };
  },

  async mods(ids) {
    if (!ids.length) return [];
    const res = await post('/mods', { modIds: ids.map(Number), filterPcOnly: true });
    return (res.data || []).map(normalizeMod);
  },

  async files(id, { gameVersion, loader, pageSize = 50, index = 0 } = {}) {
    const params = new URLSearchParams({ pageSize: String(pageSize), index: String(index) });
    if (gameVersion) params.set('gameVersion', gameVersion);
    if (loader && LOADER_TYPES[loader]) params.set('modLoaderType', String(LOADER_TYPES[loader]));
    const res = await get(`/mods/${id}/files?${params}`);
    return (res.data || []).map(normalizeFile);
  },

  async file(modId, fileId) {
    const res = await get(`/mods/${modId}/files/${fileId}`);
    return normalizeFile(res.data);
  },

  // the changelog of one file (HTML)
  async changelog(modId, fileId) {
    const res = await get(`/mods/${modId}/files/${fileId}/changelog`);
    return (res && res.data) || '';
  },

  async filesByIds(fileIds) {
    if (!fileIds.length) return [];
    const res = await post('/mods/files', { fileIds: fileIds.map(Number) });
    return (res.data || []).map(normalizeFile);
  },

  async fingerprints(fps) {
    if (!fps.length) return [];
    const res = await post(`/fingerprints/${GAME_ID}`, { fingerprints: fps });
    const matches = (res.data && res.data.exactMatches) || [];
    return matches.map((m) => ({ projectId: String(m.id), file: normalizeFile(m.file), latest: (m.latestFiles || []).map(normalizeFile) }));
  },

  async categories(type = 'mod') {
    const res = await get(`/categories?gameId=${GAME_ID}&classId=${CLASS_IDS[type] || 6}`);
    return (res.data || []).filter((c) => !c.isClass).map((c) => ({ id: String(c.id), name: c.name, slug: c.slug, icon: c.iconUrl }));
  },

  async featured() {
    const res = await post('/mods/featured', { gameId: GAME_ID, excludedModIds: [] });
    const d = res.data || {};
    return { featured: (d.featured || []).map(normalizeMod), popular: (d.popular || []).map(normalizeMod), recentlyUpdated: (d.recentlyUpdated || []).map(normalizeMod) };
  },
};

module.exports = { curseforge: client, setKeyProvider, normalizeMod, normalizeFile, CLASS_IDS, CLASS_TYPES, LOADER_TYPES };
