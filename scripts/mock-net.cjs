// Offline mock of the web APIs Havi Hub talks to (Modrinth, CurseForge, Prism
// meta, Mojang, mclo.gs). Used only for development screenshots and tests:
//   HAVIHUB_MOCK_NET=/abs/path/scripts/mock-net.cjs
// Project names are real public mod names used as sample data; descriptions,
// icons and images are generated here.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { encodePng } = require('./png.cjs');

const META_DIR = path.join(__dirname, '..', 'fixtures', 'net', 'meta');
const NOW = Date.parse('2026-11-01T12:00:00Z');
const DAY = 86400000;

// ------------------------------------------------------------ helpers
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) % 1000000) / 1000000;
}
function hashSeed(str) {
  return [...str].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
}
const iconCache = new Map();
function iconPng(seedStr, size = 96) {
  const key = `${seedStr}|${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const r = rng(hashSeed(seedStr));
  const c1 = [r() * 255, r() * 255, r() * 255];
  const c2 = [r() * 255, r() * 255, r() * 255];
  const shape = Math.floor(r() * 4);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      let col = [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
      const dx = x - size / 2;
      const dy = y - size / 2;
      const inside = shape === 0 ? Math.hypot(dx, dy) < size * 0.28 : shape === 1 ? Math.abs(dx) + Math.abs(dy) < size * 0.32 : shape === 2 ? Math.abs(dx) < size * 0.25 && Math.abs(dy) < size * 0.25 : (x >> 3) % 2 === (y >> 3) % 2 && Math.hypot(dx, dy) < size * 0.4;
      if (inside) col = [255 - col[0] * 0.3, 255 - col[1] * 0.3, 255 - col[2] * 0.3];
      const i = (y * size + x) * 4;
      data[i] = col[0];
      data[i + 1] = col[1];
      data[i + 2] = col[2];
      data[i + 3] = 255;
    }
  const png = encodePng(size, size, data);
  iconCache.set(key, png);
  return png;
}
function bannerPng(seedStr, w = 640, h = 360) {
  const key = `banner|${seedStr}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const r = rng(hashSeed(seedStr));
  const c1 = [40 + r() * 120, 40 + r() * 120, 60 + r() * 150];
  const c2 = [r() * 60, r() * 60, r() * 80];
  const hills = Array.from({ length: 3 }, (_, i) => ({ a: 20 + r() * 40, f: 0.004 + r() * 0.01, base: h * (0.55 + i * 0.12), c: [30 + i * 25 + r() * 40, 90 + i * 30 + r() * 40, 40 + r() * 30] }));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = y / h;
      let col = [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
      for (const hl of hills) if (y > hl.base + Math.sin(x * hl.f) * hl.a) col = [...hl.c];
      const i = (y * w + x) * 4;
      data[i] = col[0];
      data[i + 1] = col[1];
      data[i + 2] = col[2];
      data[i + 3] = 255;
    }
  const png = encodePng(w, h, data);
  iconCache.set(key, png);
  return png;
}
const dataUrl = (png) => `data:image/png;base64,${png.toString('base64')}`;

// deterministic "jar" content for a file name
const jarCache = new Map();
function jarBytes(filename, modId, name) {
  if (jarCache.has(filename)) return jarCache.get(filename);
  const yazlFree = makeStoredZip({
    'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: modId, version: filename.replace(/\.jar$/, ''), name, authors: ['Mock'], environment: '*', icon: 'icon.png' }),
    'icon.png': iconPng(modId, 64),
  });
  jarCache.set(filename, yazlFree);
  return yazlFree;
}

const temurinCache = new Map();
function temurinZip(major) {
  if (!temurinCache.has(major)) {
    const home = `jdk-${major}.0.1+8-jre`;
    temurinCache.set(major, makeStoredZip({ [`${home}/bin/java`]: '#!/bin/sh\nexit 0\n', [`${home}/bin/javaw.exe`]: 'MZ', [`${home}/release`]: `JAVA_VERSION="${major}.0.1"\n` }));
  }
  return temurinCache.get(major);
}

// minimal STORED zip writer (sync) so we can hash downloads deterministically
function makeStoredZip(files) {
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(0, 10);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(0, 12);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(0, 30);
    ch.writeUInt32LE(0, 34);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const sha = (b, a) => crypto.createHash(a).update(b).digest('hex');

// ------------------------------------------------------------ catalog
const MR = [
  // [id, slug, title, author, type, downloads, follows, updatedDaysAgo, categories, loaders, desc, clientSide, serverSide]
  ['AANobbMI', 'sodium', 'Sodium', 'jellysquid3', 'mod', 98e6, 31000, 6, ['optimization'], ['fabric', 'quilt', 'neoforge'], 'Motor de renderizado moderno que mejora muchísimo los FPS.', 'required', 'unsupported'],
  ['YL57xq9U', 'iris', 'Iris Shaders', 'coderbot', 'mod', 70e6, 20000, 4, ['decoration', 'optimization'], ['fabric', 'quilt', 'neoforge'], 'Carga shaders compatibles con OptiFine y funciona junto a Sodium.', 'required', 'unsupported'],
  ['P7dR8mSH', 'fabric-api', 'Fabric API', 'modmuss50', 'mod', 120e6, 25000, 2, ['library'], ['fabric'], 'Biblioteca base que usan casi todos los mods de Fabric.', 'optional', 'optional'],
  ['gvQqBUqZ', 'lithium', 'Lithium', 'jellysquid3', 'mod', 50e6, 15000, 12, ['optimization'], ['fabric', 'quilt', 'neoforge'], 'Optimiza la lógica del juego, la IA y la física sin cambiar el comportamiento.', 'optional', 'optional'],
  ['mOgUt4GM', 'modmenu', 'Mod Menu', 'Prospector', 'mod', 60e6, 14000, 20, ['utility'], ['fabric', 'quilt'], 'Agrega un menú para ver y configurar los mods instalados.', 'required', 'unsupported'],
  ['PtjYWJkn', 'sodium-extra', 'Sodium Extra', 'FlashyReese', 'mod', 30e6, 9000, 1, ['optimization'], ['fabric', 'quilt'], 'Opciones extra de video para Sodium.', 'required', 'unsupported'],
  ['9s6osm5g', 'cloth-config', 'Cloth Config API', 'shedaniel', 'mod', 70e6, 9500, 15, ['library'], ['fabric', 'forge', 'neoforge'], 'API para crear pantallas de configuración.', 'required', 'optional'],
  ['NNAgCjsB', 'entityculling', 'Entity Culling', 'tr7zw', 'mod', 40e6, 7000, 9, ['optimization'], ['fabric', 'forge', 'neoforge'], 'Evita renderizar entidades que no se ven.', 'required', 'unsupported'],
  ['EsAfCjCV', 'appleskin', 'AppleSkin', 'squeek502', 'mod', 45e6, 8000, 30, ['food', 'utility'], ['fabric', 'forge', 'neoforge'], 'Muestra información de hambre y saturación.', 'required', 'optional'],
  ['1bokaNcj', 'xaeros-minimap', "Xaero's Minimap", 'thexaero', 'mod', 35e6, 7000, 3, ['utility', 'adventure'], ['fabric', 'forge', 'neoforge'], 'Minimapa con waypoints y radar.', 'required', 'unsupported'],
  ['1KVo5zza', 'fabulously-optimized', 'Fabulously Optimized', 'robotkoer', 'modpack', 12e6, 9000, 5, ['optimization'], ['fabric'], 'Modpack de rendimiento con gráficos mejorados y la experiencia vanilla intacta.', 'required', 'unsupported'],
  ['MdwFAVRL', 'cobblemon-modpack', 'Cobblemon Official Modpack', 'Cobblemon', 'modpack', 6e6, 7000, 10, ['adventure'], ['fabric'], 'Modpack oficial para jugar Cobblemon con amigos.', 'required', 'optional'],
  ['zXNVpTnF', 'simply-optimized', 'Simply Optimized', 'Fabulously Optimized', 'modpack', 3e6, 2500, 25, ['optimization'], ['fabric'], 'Lo mínimo para que el juego vaya rápido.', 'required', 'unsupported'],
  ['KmiWHzQ4', 'additive', 'Additive', 'ThatWiggleOne', 'modpack', 2.5e6, 2000, 8, ['adventure'], ['fabric'], 'Agrega contenido al estilo vanilla: biomas, criaturas y estructuras.', 'required', 'optional'],
  ['HYKaKraK', 'better-adventures', 'Better Adventures+', 'Hecco', 'modpack', 1.5e6, 2200, 3, ['adventure'], ['fabric'], 'Aventura y exploración con dungeons, jefes y nuevas dimensiones.', 'required', 'optional'],
  ['BYfVnHa7', 'complementary-reimagined', 'Complementary Shaders - Reimagined', 'EminGT', 'shader', 15e6, 8000, 14, ['atmosphere', 'shadows'], ['iris', 'optifine'], 'Shaders con estilo fiel a vanilla y mucho detalle.', 'required', 'unsupported'],
  ['HVnmMxH1', 'bsl-shaders', 'BSL Shaders', 'CaptTatsu', 'shader', 12e6, 6000, 60, ['atmosphere'], ['iris', 'optifine'], 'Shaders clásicos con iluminación brillante.', 'required', 'unsupported'],
  ['lIAp4Tvf', 'fresh-animations', 'Fresh Animations', 'FreshLX', 'resourcepack', 9e6, 6000, 7, ['entities'], ['minecraft'], 'Animaciones nuevas para las criaturas.', 'required', 'unsupported'],
  ['R6NEzAwj', 'faithful-32x', 'Faithful 32x', 'Faithful Resource Pack', 'resourcepack', 8e6, 4500, 11, ['simplistic'], ['minecraft'], 'Texturas al doble de resolución, fieles al estilo original.', 'required', 'unsupported'],
  ['bHMxuc9t', 'terralith-dp', 'Terralith', 'Stardust Labs', 'datapack', 6e6, 5000, 18, ['worldgen'], ['datapack'], 'Más de 90 biomas nuevos usando solo bloques vanilla.', 'optional', 'required'],
];

const CF = [
  // [id, slug, name, author, classId, downloads, likes, updatedDaysAgo, categories, desc]
  [394468, 'sodium', 'Sodium', 'JellySquid', 6, 140e6, 3000, 1, ['Performance'], 'Motor de renderizado que mejora el rendimiento del juego.'],
  [238222, 'jei', 'Just Enough Items (JEI)', 'mezz', 6, 400e6, 9000, 2, ['API and Library', 'Utility & QoL'], 'Visor de objetos y recetas.'],
  [256717, 'clumps', 'Clumps', 'Jaredlll08', 6, 200e6, 2000, 4, ['Performance'], 'Agrupa los orbes de experiencia para reducir el lag.'],
  [306612, 'fabric-api', 'Fabric API', 'modmuss50', 6, 150e6, 4000, 9, ['API and Library'], 'Biblioteca base que usan casi todos los mods de Fabric.'],
  [925200, 'all-the-mods-10', 'All the Mods 10', 'ATMTeam', 4471, 9e6, 4000, 2, ['Kitchen Sink'], 'Modpack con cientos de mods para jugar sin límites.'],
  [285109, 'rlcraft', 'RLCraft', 'Shivaxi', 4471, 25e6, 9000, 120, ['Adventure and RPG', 'Hardcore'], 'Modpack de supervivencia extremadamente difícil.'],
  [876781, 'better-mc-fabric', 'Better MC [FABRIC] - BMC4', 'LunaPixelStudios', 4471, 11e6, 5000, 6, ['Adventure and RPG'], 'Mejora vanilla con cientos de mods de aventura.'],
  [452013, 'prominence-2', 'Prominence II: Hasturian Era', 'ElocinDev', 4471, 4e6, 3000, 15, ['Adventure and RPG', 'Magic'], 'RPG con jefes, magia y progresión profunda.'],
  [711228, 'the-horror-pack', 'From The Fog', 'Lunareclipse', 6, 8e6, 2500, 20, ['Mobs', 'Adventure and RPG'], 'Agrega una presencia que te observa desde la niebla.'],
  [418039, 'complementary', 'Complementary Shaders', 'EminGT', 6552, 10e6, 3000, 30, ['Realistic'], 'Shaders con estilo fiel a vanilla.'],
  [530100, 'skyblock-classic', 'SkyBlock Clásico', 'Noobcrew', 17, 6e6, 1800, 40, ['Survival', 'Game Map'], 'Una isla flotante, un árbol y un cofre: sobrevive y agranda tu isla.'],
  [530101, 'parkour-paradise', 'Parkour Paradise', 'Hielke', 17, 3e6, 900, 12, ['Parkour'], 'Cien niveles de parkour con dificultad creciente.'],
];

function mrHit(p) {
  const [id, slug, title, author, type, downloads, follows, ago, categories, loaders, desc, cs, ss] = p;
  return {
    project_id: id,
    project_type: type,
    slug,
    author,
    title,
    description: desc,
    categories: [...categories, ...loaders],
    display_categories: categories,
    versions: ['1.21.1', '1.21.8', '26.1', '26.2', '26.3'],
    downloads,
    follows,
    icon_url: dataUrl(iconPng(slug)),
    date_created: new Date(NOW - (ago + 400) * DAY).toISOString(),
    date_modified: new Date(NOW - ago * DAY).toISOString(),
    latest_version: `v${id}`,
    license: 'MIT',
    client_side: cs,
    server_side: ss,
    gallery: [dataUrl(bannerPng(slug))],
    featured_gallery: dataUrl(bannerPng(slug)),
    color: null,
  };
}

function mrVersions(p, filters = {}) {
  const [id, slug, title, , type, , , ago, , loaders] = p;
  const out = [];
  const gvs = ['26.3', '26.2', '26.1', '1.21.8', '1.21.1'];
  for (let i = 0; i < 3; i++) {
    const vn = `${i === 0 ? '1.4.0' : i === 1 ? '1.3.2' : '1.3.0'}+${slug}`;
    const ext = type === 'modpack' ? 'mrpack' : type === 'mod' ? 'jar' : 'zip';
    const filename = `${slug}-${vn}.${ext}`;
    const bytes = fileBytes(filename, p);
    for (const gv of gvs) {
      out.push({
        id: `${id}-${i}-${gv}`.replace(/\./g, '_'),
        project_id: id,
        name: `${title} ${vn}`,
        version_number: vn,
        changelog: `- Cambios de la versión ${vn}`,
        dependencies: type === 'mod' && slug !== 'fabric-api' && loaders.includes('fabric') && slug !== 'cloth-config' ? [{ project_id: 'P7dR8mSH', version_id: null, file_name: null, dependency_type: 'required' }] : [],
        game_versions: [gv],
        version_type: i === 0 && slug === 'iris' ? 'beta' : 'release',
        loaders,
        featured: i === 0,
        date_published: new Date(NOW - (ago + i * 20) * DAY).toISOString(),
        downloads: 1000 * (3 - i),
        files: [{ hashes: { sha1: sha(bytes, 'sha1'), sha512: sha(bytes, 'sha512') }, url: `https://cdn.modrinth.com/data/${id}/versions/${i}/${encodeURIComponent(filename)}`, filename, primary: true, size: bytes.length }],
      });
    }
  }
  return out.filter((v) => (!filters.loaders || v.loaders.some((l) => filters.loaders.includes(l))) && (!filters.game_versions || v.game_versions.some((g) => filters.game_versions.includes(g))));
}

function fileBytes(filename, p) {
  if (filename.endsWith('.mrpack')) return mrpackBytes(p);
  return jarBytes(filename, p ? p[1] : filename, p ? p[2] : filename);
}

function mrpackBytes(p) {
  const deps = [MR.find((x) => x[1] === 'sodium'), MR.find((x) => x[1] === 'fabric-api'), MR.find((x) => x[1] === 'lithium')];
  const files = deps.map((d) => {
    const v = mrVersions(d, { game_versions: ['26.2'] })[0];
    const f = v.files[0];
    return { path: `mods/${f.filename}`, hashes: f.hashes, env: { client: 'required', server: 'required' }, downloads: [f.url], fileSize: f.size };
  });
  const index = { formatVersion: 1, game: 'minecraft', versionId: '1.4.0', name: p[2], summary: p[10], files, dependencies: { minecraft: '26.2', 'fabric-loader': '0.20.1' } };
  return makeStoredZip({ 'modrinth.index.json': JSON.stringify(index), 'overrides/config/sample.json5': '{ enabled: true }', 'overrides/options.txt': 'renderDistance:12\n' });
}

function cfMod(p) {
  const [id, slug, name, author, classId, downloads, likes, ago, cats, desc] = p;
  const latest = cfFiles(p).slice(0, 2);
  return {
    id,
    gameId: 432,
    name,
    slug,
    links: { websiteUrl: `https://www.curseforge.com/minecraft/${classId === 4471 ? 'modpacks' : classId === 6552 ? 'shaders' : classId === 17 ? 'worlds' : 'mc-mods'}/${slug}`, wikiUrl: null, issuesUrl: null, sourceUrl: null },
    summary: desc,
    status: 4,
    downloadCount: downloads,
    isFeatured: false,
    classId,
    categories: cats.map((c, i) => ({ id: 400 + i, name: c, slug: c.toLowerCase(), classId })),
    authors: [{ id: 1, name: author, url: '' }],
    logo: { thumbnailUrl: dataUrl(iconPng(`cf-${slug}`)), url: dataUrl(iconPng(`cf-${slug}`)) },
    screenshots: [{ title: 'Captura', description: '', thumbnailUrl: dataUrl(bannerPng(`cf-${slug}`)), url: dataUrl(bannerPng(`cf-${slug}`)) }],
    mainFileId: latest[0].id,
    latestFiles: latest,
    latestFilesIndexes: cfFiles(p).map((f) => ({ gameVersion: f.gameVersions.find((g) => /^\d/.test(g)), fileId: f.id, filename: f.fileName, releaseType: f.releaseType, modLoader: f.gameVersions.includes('Fabric') ? 4 : f.gameVersions.includes('NeoForge') ? 6 : 1 })),
    dateCreated: new Date(NOW - (ago + 600) * DAY).toISOString(),
    dateModified: new Date(NOW - ago * DAY).toISOString(),
    dateReleased: new Date(NOW - ago * DAY).toISOString(),
    allowModDistribution: slug !== 'the-horror-pack',
    thumbsUpCount: likes,
  };
}

function cfFiles(p) {
  const [id, slug, name, , classId, , , ago] = p;
  const out = [];
  let n = 0;
  for (const gv of ['26.2', '1.21.1']) {
    for (const loader of classId === 6 ? ['Fabric', 'NeoForge'] : classId === 4471 ? ['Forge'] : []) {
      for (let i = 0; i < 2; i++) {
        const fileId = id * 10 + n++ + (slug === 'clumps' ? 5551230 - id * 10 : 0);
        const ext = classId === 4471 ? 'zip' : classId === 6552 ? 'zip' : 'jar';
        const fileName = `${slug}-${loader.toLowerCase()}-${gv}-${i === 0 ? '2.0' : '1.9'}.${ext}`;
        const bytes = classId === 4471 ? cfPackBytes(p) : jarBytes(fileName, slug, name);
        out.push({
          id: fileId,
          gameId: 432,
          modId: id,
          isAvailable: true,
          displayName: fileName.replace(/\.(jar|zip)$/, ''),
          fileName,
          releaseType: 1,
          fileStatus: 4,
          hashes: [{ value: sha(bytes, 'sha1'), algo: 1 }],
          fileDate: new Date(NOW - (ago + i * 15) * DAY).toISOString(),
          fileLength: bytes.length,
          downloadCount: 5000,
          downloadUrl: slug === 'the-horror-pack' ? null : `https://edge.forgecdn.net/files/${Math.floor(fileId / 1000)}/${fileId % 1000}/${fileName}`,
          gameVersions: [gv, loader, ...(hashSeed(slug) % 3 === 0 ? ['Client'] : hashSeed(slug) % 3 === 1 ? ['Client', 'Server'] : ['Server'])],
          dependencies: [],
          fileFingerprint: 0,
        });
      }
    }
    if (classId !== 6 && classId !== 4471) {
      const fileId = id * 10 + n++;
      const fileName = `${slug}-${gv}.zip`;
      const bytes = classId === 17 ? cfWorldBytes(p) : jarBytes(fileName, slug, name);
      out.push({ id: fileId, gameId: 432, modId: id, isAvailable: true, displayName: fileName, fileName, releaseType: 1, fileStatus: 4, hashes: [{ value: sha(bytes, 'sha1'), algo: 1 }], fileDate: new Date(NOW - ago * DAY).toISOString(), fileLength: bytes.length, downloadCount: 1, downloadUrl: `https://edge.forgecdn.net/files/${Math.floor(fileId / 1000)}/${fileId % 1000}/${fileName}`, gameVersions: [gv], dependencies: [] });
    }
  }
  return out.sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate));
}

// A world download: "<Name>/level.dat" (+ a region file) inside a zip
const worldCache = new Map();
function cfWorldBytes(p) {
  if (worldCache.has(p[1])) return worldCache.get(p[1]);
  const nbt = require('../src/main/util/nbt');
  const { tag } = nbt;
  const level = nbt.serialize({ name: '', value: { Data: tag.compound({ LevelName: tag.string(p[2]), GameType: tag.int(0), hardcore: tag.byte(0), LastPlayed: tag.long(NOW - 30 * DAY), allowCommands: tag.byte(0), Version: tag.compound({ Name: tag.string('26.2'), Id: tag.int(4600) }) }) } }, { gzip: true });
  const bytes = makeStoredZip({ [`${p[2]}/level.dat`]: level, [`${p[2]}/region/r.0.0.mca`]: Buffer.alloc(64) });
  worldCache.set(p[1], bytes);
  return bytes;
}

function cfPackBytes(p) {
  const jei = CF.find((x) => x[1] === 'jei');
  const jf = cfFiles(jei).find((f) => f.gameVersions.includes('1.21.1') && f.gameVersions.includes('NeoForge'));
  const blocked = CF.find((x) => x[1] === 'the-horror-pack');
  const bf = cfFiles(blocked)[0];
  const manifest = { minecraft: { version: '1.21.1', modLoaders: [{ id: 'neoforge-21.1.200', primary: true }] }, manifestType: 'minecraftModpack', manifestVersion: 1, name: p[2], version: '1.0', author: p[3], files: [{ projectID: jei[0], fileID: jf.id, required: true }, { projectID: blocked[0], fileID: bf.id, required: true }], overrides: 'overrides' };
  return makeStoredZip({ 'manifest.json': JSON.stringify(manifest), 'overrides/config/pack.toml': 'x = 1\n' });
}

// ------------------------------------------------------------ router
function png1x1() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
function bin(buf, type = 'application/octet-stream') {
  return new Response(buf, { status: 200, headers: { 'content-type': type, 'content-length': String(buf.length) } });
}

function mrFacets(u) {
  const facets = JSON.parse(u.searchParams.get('facets') || '[]');
  const flat = facets.map((g) => g.map((f) => f.split(':')));
  return flat;
}

// ------------------------------------------------------------ server directory (Modrinth v3)
// [id, slug, name, author, summary, categories, region, languages, kind, versions | modpack, plays, online, max, address]
const MR_SERVERS = [
  ['srvA0001', 'bloque-norte', 'Bloque Norte SMP', 'norteño', 'SMP de supervivencia con economía, tiendas de jugadores y eventos cada fin de semana.', ['smp', 'economy', 'survival-mode', 'vanilla-like'], 'south_america', ['es'], 'vanilla', ['1.21.1', '1.21.4', '1.21.8', '1.21.10'], 4120, 812, 2000, 'play.bloquenorte.example'],
  ['srvA0002', 'pvp-arena-club', 'PvP Arena Club', 'arena', 'Servidor para practicar PvP moderno: duelos 1v1, rankings y torneos.', ['pvp', 'competitive', 'kitpvp'], 'us_east', ['en'], 'vanilla', ['1.21.8', '1.21.10', '1.21.11'], 6396, 2161, 5000, 'pvp.arenaclub.example'],
  ['srvA0003', 'cobble-valley', 'Cobble Valley', 'valle', 'Atrapa, entrena y combate en un mundo lleno de criaturas. Se juega con su propio modpack.', ['pokemon', 'smp', 'custom-content', 'bosses'], 'us_east', ['en', 'es'], 'modpack', { projectId: 'MdwFAVRL', versionId: '', name: 'Cobblemon Official Modpack' }, 6304, 374, 500, 'cobblevalley.example:25570'],
  ['srvA0004', 'reino-tecnico', 'Reino Técnico', 'redstone', 'Granjas, redstone y proyectos técnicos en equipo. Sin trampas, sin pay-to-win.', ['technical', 'smp', 'creator-community'], 'europe', ['es', 'en'], 'vanilla', ['1.21.4', '1.21.8'], 953, 24, 100, 'tecnico.example'],
  ['srvA0005', 'isla-nublada', 'Isla Nublada', 'nubes', 'Skyblock con misiones, jefes y una isla propia para cada jugador.', ['skyblock', 'questing', 'bosses', 'economy'], 'europe', ['es'], 'vanilla', ['1.20.1', '1.21.1'], 3117, 96, 300, 'isla.nublada.example'],
  ['srvA0006', 'aldea-lenta', 'Aldea Lenta', 'aldea', 'Servidor tranquilo para construir pueblos con amigos (ahora mismo en mantenimiento).', ['towns', 'social', 'whitelisted'], 'south_america', ['es'], 'vanilla', ['1.21.10'], 120, null, null, 'aldea.lenta.example'],
  // also among the well-known servers (as mc.hypixel.net): the list shows it once
  ['srvA0007', 'hypixel', 'Hypixel Network', 'hypixel', 'Minijuegos: BedWars, SkyBlock, SkyWars, duelos y más.', ['minigames', 'pvp', 'skyblock'], 'us_east', ['en'], 'vanilla', ['1.8.9', '1.21.8', '1.21.10'], 98000, 41000, 200000, 'hypixel.net'],
];

function mrServerHit(x) {
  const [id, slug, name, author, summary, cats, region, langs, kind, vs, plays, online, max, address] = x;
  const content = kind === 'modpack' ? { kind, project_id: vs.projectId, version_id: vs.versionId, project_name: vs.name, project_icon: dataUrl(iconPng(vs.projectId)) } : { kind, supported_game_versions: vs, recommended_game_version: vs[vs.length - 1] };
  return {
    project_id: id,
    project_types: ['minecraft_java_server'],
    slug,
    name,
    author,
    summary,
    categories: cats,
    display_categories: cats,
    follows: Math.round(plays / 9),
    icon_url: dataUrl(iconPng(`srv-${slug}`)),
    date_created: new Date(NOW - plays * 3600000).toISOString(),
    date_modified: new Date(NOW - (plays % 17) * DAY).toISOString(),
    game_versions: kind === 'modpack' ? ['1.21.1'] : vs,
    minecraft_server: { region, languages: langs, max_players: max, active_version: null },
    minecraft_java_server: { address, content, verified_plays_2w: plays, ping: online === null ? null : { address, when: new Date(NOW).toISOString(), data: { players_online: online, players_max: max, description: '', version_name: 'Paper', version_protocol: 767, latency: { secs: 0, nanos: 30000000 } } } },
  };
}

function handleServerSearch(u) {
  const f = u.searchParams.get('new_filters') || '';
  const query = (u.searchParams.get('query') || '').toLowerCase();
  const conds = f.split(' AND ').map((c) => c.trim());
  let list = MR_SERVERS.filter((x) => {
    for (const c of conds) {
      let m;
      if (c === 'project_types = minecraft_java_server') continue;
      if (c === 'minecraft_java_server.ping.data EXISTS') {
        if (x[11] === null) return false;
      } else if ((m = /^minecraft_java_server\.content\.kind = (\w+)$/.exec(c))) {
        if (x[8] !== m[1]) return false;
      } else if ((m = /^game_versions = "?([^"]+)"?$/.exec(c))) {
        if (!(x[8] === 'modpack' ? ['1.21.1'] : x[9]).includes(m[1])) return false;
      } else if ((m = /^minecraft_server\.region = (\w+)$/.exec(c))) {
        if (x[6] !== m[1]) return false;
      } else if ((m = /^minecraft_server\.languages = (\w+)$/.exec(c))) {
        if (!x[7].includes(m[1])) return false;
      } else if ((m = /^categories = "?([^"]+)"?$/.exec(c))) {
        if (!x[5].includes(m[1])) return false;
      }
    }
    return !query || x[2].toLowerCase().includes(query) || x[4].toLowerCase().includes(query);
  });
  const index = u.searchParams.get('index') || 'relevance';
  if (index.endsWith('verified_plays_2w')) list = [...list].sort((a, b) => b[10] - a[10]);
  if (index.endsWith('players_online')) list = [...list].sort((a, b) => (b[11] || 0) - (a[11] || 0));
  const offset = Number(u.searchParams.get('offset') || 0);
  const limit = Number(u.searchParams.get('limit') || 10);
  return json({ hits: list.slice(offset, offset + limit).map(mrServerHit), page: 1, hits_per_page: limit, total_hits: list.length });
}

// what pinging a server from this computer answers in tests
async function mockPing(address) {
  await new Promise((r) => setTimeout(r, 120));
  const x = MR_SERVERS.find((s) => s[13] === address);
  if (x && x[11] === null) throw new Error('Sin respuesta');
  const h = hashSeed(String(address));
  return { latency: 35 + (h % 230), online: x ? x[11] + (h % 7) : 3, max: x ? x[12] : 20, version: 'Paper 1.21.10', protocol: 773, motd: x ? x[2] : 'A Minecraft Server', favicon: null };
}

async function handleModrinth(u, method, body) {
  if (u.pathname === '/v3/search') return handleServerSearch(u);
  const p = u.pathname.replace(/^\/v2/, '');
  if (p === '/search') {
    const facets = mrFacets(u);
    const query = (u.searchParams.get('query') || '').toLowerCase();
    let list = MR.filter((x) => {
      for (const group of facets) {
        const ok = group.some(([k, v]) => {
          if (k === 'project_type') return x[4] === v;
          if (k === 'categories') return x[8].includes(v) || x[9].includes(v);
          if (k === 'versions') return true;
          return true;
        });
        if (!ok) return false;
      }
      return !query || x[2].toLowerCase().includes(query) || x[10].toLowerCase().includes(query);
    });
    const index = u.searchParams.get('index');
    if (index === 'downloads') list.sort((a, b) => b[5] - a[5]);
    if (index === 'follows') list.sort((a, b) => b[6] - a[6]);
    if (index === 'updated') list.sort((a, b) => a[7] - b[7]);
    if (index === 'newest') list.sort((a, b) => a[7] - b[7]).reverse();
    const offset = Number(u.searchParams.get('offset') || 0);
    const limit = Number(u.searchParams.get('limit') || 10);
    return json({ hits: list.slice(offset, offset + limit).map(mrHit), offset, limit, total_hits: list.length });
  }
  let m;
  if ((m = /^\/project\/([^/]+)\/members$/.exec(p))) {
    const proj = MR.find((x) => x[0] === m[1] || x[1] === m[1]);
    return json(proj ? [{ role: 'Owner', user: { username: proj[3] } }] : []);
  }
  if ((m = /^\/project\/([^/]+)\/version$/.exec(p))) {
    const proj = MR.find((x) => x[0] === m[1] || x[1] === m[1]);
    if (!proj) return json({ error: 'not found' }, 404);
    const loaders = u.searchParams.get('loaders') ? JSON.parse(u.searchParams.get('loaders')) : undefined;
    const gvs = u.searchParams.get('game_versions') ? JSON.parse(u.searchParams.get('game_versions')) : undefined;
    return json(mrVersions(proj, { loaders, game_versions: gvs }));
  }
  if ((m = /^\/project\/([^/]+)$/.exec(p))) {
    const proj = MR.find((x) => x[0] === m[1] || x[1] === m[1]);
    if (!proj) return json({ error: 'not found' }, 404);
    const h = mrHit(proj);
    return json({
      ...h,
      id: proj[0],
      body: `## ${proj[2]}\n\n${proj[10]}\n\n### Características\n\n- Compatible con **${proj[9].join(', ')}**\n- Funciona en modo multijugador\n- Configurable desde el menú del juego\n\n> Datos de ejemplo generados para pruebas.\n\n[Sitio del proyecto](https://modrinth.com/project/${proj[1]})`,
      published: h.date_created,
      updated: h.date_modified,
      followers: h.follows,
      game_versions: h.versions,
      loaders: proj[9],
      gallery: [0, 1, 2].map((i) => ({ url: dataUrl(bannerPng(`${proj[1]}-${i}`)), featured: i === 0, title: `Imagen ${i + 1}`, description: '', ordering: i })),
      license: { id: 'MIT', name: 'MIT License' },
      source_url: `https://github.com/example/${proj[1]}`,
      issues_url: `https://github.com/example/${proj[1]}/issues`,
      discord_url: null,
      donation_urls: [],
      versions: mrVersions(proj).map((v) => v.id),
    });
  }
  if (p === '/projects') {
    const ids = JSON.parse(u.searchParams.get('ids') || '[]');
    return json(MR.filter((x) => ids.includes(x[0]) || ids.includes(x[1])).map((x) => ({ ...mrHit(x), id: x[0], game_versions: mrHit(x).versions, followers: x[6], updated: mrHit(x).date_modified, published: mrHit(x).date_created, loaders: x[9] })));
  }
  if ((m = /^\/version\/([^/]+)$/.exec(p))) {
    for (const proj of MR) {
      const v = mrVersions(proj).find((x) => x.id === m[1]);
      if (v) return json(v);
    }
    return json({ error: 'not found' }, 404);
  }
  if (p === '/version_files' && method === 'POST') {
    const { hashes, algorithm } = JSON.parse(body);
    const out = {};
    for (const proj of MR) for (const v of mrVersions(proj)) for (const f of v.files) if (hashes.includes(f.hashes[algorithm])) out[f.hashes[algorithm]] = v;
    return json(out);
  }
  if (p === '/version_files/update' && method === 'POST') {
    const { hashes, algorithm, game_versions } = JSON.parse(body);
    const out = {};
    for (const h of hashes) {
      // fixture mods: anything named like sodium-extra / entityculling -> report newer version
      const proj = MR.find((x) => h.includes(x[0]) || mrVersions(x).some((v) => v.files.some((f) => f.hashes[algorithm] === h)));
      if (proj) {
        const latest = mrVersions(proj, { game_versions })[0];
        if (latest) out[h] = latest;
      }
    }
    return json(out);
  }
  if (p === '/tag/category') {
    const cats = [
      ['adventure', 'mod'], ['decoration', 'mod'], ['economy', 'mod'], ['equipment', 'mod'], ['food', 'mod'], ['game-mechanics', 'mod'], ['library', 'mod'], ['magic', 'mod'], ['management', 'mod'], ['minigame', 'mod'], ['mobs', 'mod'], ['optimization', 'mod'], ['social', 'mod'], ['storage', 'mod'], ['technology', 'mod'], ['transportation', 'mod'], ['utility', 'mod'], ['worldgen', 'mod'],
      ['adventure', 'modpack'], ['challenging', 'modpack'], ['combat', 'modpack'], ['kitchen-sink', 'modpack'], ['lightweight', 'modpack'], ['magic', 'modpack'], ['multiplayer', 'modpack'], ['optimization', 'modpack'], ['quests', 'modpack'], ['technology', 'modpack'],
      ['atmosphere', 'shader'], ['cartoon', 'shader'], ['fantasy', 'shader'], ['realistic', 'shader'], ['semi-realistic', 'shader'], ['vanilla-like', 'shader'],
      ['combat', 'resourcepack'], ['decoration', 'resourcepack'], ['entities', 'resourcepack'], ['gui', 'resourcepack'], ['realistic', 'resourcepack'], ['simplistic', 'resourcepack'], ['themed', 'resourcepack'],
    ];
    return json(cats.map(([name, project_type]) => ({ icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>', name, project_type, header: 'categories' })));
  }
  if (p === '/tag/game_version') {
    return json(['26.3', '26.2', '26.1', '1.21.8', '1.21.1', '1.20.1'].map((v) => ({ version: v, version_type: 'release', major: true, date: '' })));
  }
  return json({ error: 'not found' }, 404);
}

async function handleCurse(u, method, body) {
  const p = u.pathname.replace(/^\/v1/, '');
  let m;
  if (p === '/mods/search') {
    const classId = Number(u.searchParams.get('classId') || 6);
    const q = (u.searchParams.get('searchFilter') || '').toLowerCase();
    const bySlug = u.searchParams.get('slug');
    let list = CF.filter((x) => x[4] === classId && (!q || x[2].toLowerCase().includes(q)) && (!bySlug || x[1] === bySlug));
    const sort = Number(u.searchParams.get('sortField'));
    if (sort === 6) list.sort((a, b) => b[5] - a[5]);
    if (sort === 3) list.sort((a, b) => a[7] - b[7]);
    const index = Number(u.searchParams.get('index') || 0);
    const size = Number(u.searchParams.get('pageSize') || 20);
    return json({ data: list.slice(index, index + size).map(cfMod), pagination: { index, pageSize: size, resultCount: list.length, totalCount: list.length } });
  }
  if ((m = /^\/mods\/(\d+)\/description$/.exec(p))) {
    const x = CF.find((c) => c[0] === Number(m[1]));
    return json({ data: `<h2>${x ? x[2] : ''}</h2><p>${x ? x[9] : ''}</p><ul><li>Datos de ejemplo</li><li>Generados para pruebas</li></ul><p><a href="https://www.curseforge.com">Ver en CurseForge</a></p><script>alert(1)</script>` });
  }
  if ((m = /^\/mods\/(\d+)\/files\/(\d+)$/.exec(p))) {
    const x = CF.find((c) => c[0] === Number(m[1]));
    const f = x && cfFiles(x).find((ff) => ff.id === Number(m[2]));
    return f ? json({ data: f }) : json({}, 404);
  }
  if ((m = /^\/mods\/(\d+)\/files$/.exec(p))) {
    const x = CF.find((c) => c[0] === Number(m[1]));
    if (!x) return json({ data: [] });
    const gv = u.searchParams.get('gameVersion');
    const lt = u.searchParams.get('modLoaderType');
    const ln = { 1: 'Forge', 4: 'Fabric', 5: 'Quilt', 6: 'NeoForge' }[lt];
    return json({ data: cfFiles(x).filter((f) => (!gv || f.gameVersions.includes(gv)) && (!ln || f.gameVersions.includes(ln))), pagination: {} });
  }
  if ((m = /^\/mods\/(\d+)$/.exec(p))) {
    const x = CF.find((c) => c[0] === Number(m[1]));
    return x ? json({ data: cfMod(x) }) : json({}, 404);
  }
  if (p === '/mods' && method === 'POST') {
    const { modIds } = JSON.parse(body);
    return json({ data: CF.filter((x) => modIds.includes(x[0])).map(cfMod) });
  }
  if (p === '/mods/files' && method === 'POST') {
    const { fileIds } = JSON.parse(body);
    const all = CF.flatMap((x) => cfFiles(x));
    return json({ data: all.filter((f) => fileIds.includes(f.id)) });
  }
  if (p.startsWith('/fingerprints')) return json({ data: { exactMatches: [] } });
  if (p === '/categories') {
    const names = ['Performance', 'API and Library', 'Utility & QoL', 'Adventure and RPG', 'Magic', 'Technology', 'Storage', 'World Gen', 'Mobs', 'Food', 'Armor, Tools, and Weapons', 'Cosmetic', 'Map and Information', 'Miscellaneous'];
    return json({ data: names.map((n, i) => ({ id: 400 + i, name: n, slug: n.toLowerCase(), iconUrl: '', classId: Number(u.searchParams.get('classId')), isClass: false })) });
  }
  return json({ error: 'not found' }, 404);
}

async function mockFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init.method || 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : '';
  const u = new URL(url);
  // HAVIHUB_MOCK_LOG=file: every address asked for is written down, so a test can
  // tell what the app connected to on its own
  if (process.env.HAVIHUB_MOCK_LOG) fs.appendFileSync(process.env.HAVIHUB_MOCK_LOG, `${u.host}${u.pathname}\n`);
  await new Promise((r) => setTimeout(r, 40));
  if (u.host === 'api.modrinth.com') return handleModrinth(u, method, body);
  if (u.host === 'api.curseforge.com') {
    const key = init.headers && (init.headers['x-api-key'] || (init.headers.get && init.headers.get('x-api-key')));
    if (!key) return json({ error: 'forbidden' }, 403);
    return handleCurse(u, method, body);
  }
  if (u.host === 'meta.prismlauncher.org') {
    const uid = u.pathname.split('/')[2];
    const f = path.join(META_DIR, `${uid}.json`);
    if (fs.existsSync(f)) return bin(fs.readFileSync(f), 'application/json');
    return json({}, 404);
  }
  if (u.host === 'cdn.modrinth.com') {
    const filename = decodeURIComponent(u.pathname.split('/').pop());
    // HAVIHUB_MOCK_SLOW_FILES=ms: the files inside modpacks take that long (the
    // .mrpack itself doesn't), so a test can close the app half way
    const slow = Number(process.env.HAVIHUB_MOCK_SLOW_FILES || 0);
    if (slow && !filename.endsWith('.mrpack') && !u.pathname.startsWith('/news/')) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, slow);
        if (init.signal) {
          init.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              const e = new Error('aborted');
              e.name = 'AbortError';
              reject(e);
            },
            { once: true },
          );
        }
      });
    }
    const proj = MR.find((x) => u.pathname.includes(x[0]));
    return bin(fileBytes(filename, proj));
  }
  if (u.host === 'edge.forgecdn.net') {
    const filename = decodeURIComponent(u.pathname.split('/').pop());
    const proj = CF.find((x) => filename.startsWith(x[1]));
    if (proj && proj[4] === 4471) return bin(cfPackBytes(proj));
    if (proj && proj[4] === 17) return bin(cfWorldBytes(proj));
    return bin(jarBytes(filename, proj ? proj[1] : filename, proj ? proj[2] : filename));
  }
  // Havikun's channels (main/social.js). HAVIHUB_MOCK_TWITCH=live|offline|nodata
  if (u.host === 'www.youtube.com' && u.pathname === '/feeds/videos.xml') {
    const entry = (id, title, days, views, short) =>
      `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><yt:channelId>${u.searchParams.get('channel_id')}</yt:channelId><title>${title}</title><link rel="alternate" href="https://www.youtube.com/${short ? 'shorts/' : 'watch?v='}${id}"/><published>${new Date(NOW - days * DAY).toISOString()}</published><media:group><media:title>${title}</media:title><media:thumbnail url="https://i2.ytimg.com/vi/${id}/hqdefault.jpg" width="480" height="360"/><media:community><media:statistics views="${views}"/></media:community></media:group></entry>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><title>Havikun</title>${entry('aaaaaaaaa01', 'Sobreviv&#237; 100 d&#237;as en Minecraft Hardcore', 2, 15234)}${entry('aaaaaaaaa02', 'El totem de Gojo &amp; otros texture packs', 9, 4810)}${entry('aaaaaaaaa03', 'Clip: el creeper m&#225;s inoportuno', 12, 98123, true)}${entry('aaaaaaaaa04', 'Probando Havi Hub', 20, 2301)}</feed>`;
    return new Response(xml, { status: 200, headers: { 'content-type': 'text/xml' } });
  }
  if (u.host === 'static-cdn.jtvnw.net' && u.pathname.startsWith('/previews-ttv/')) {
    if ((process.env.HAVIHUB_MOCK_TWITCH || 'live') === 'offline') return new Response('', { status: 302, headers: { location: 'https://static-cdn.jtvnw.net/ttv-static/404_preview-440x248.jpg' } });
    return new Response(png1x1(), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  }
  if (u.host === 'gql.twitch.tv') {
    const mode = process.env.HAVIHUB_MOCK_TWITCH || 'live';
    if (mode === 'nodata') return json({ error: 'Bad Request' }, 400);
    const node = (id, title, days, secs) => ({ node: { id: String(id), title, publishedAt: new Date(NOW - days * DAY).toISOString(), lengthSeconds: secs, viewCount: 120 + id, previewThumbnailURL: `https://static-cdn.jtvnw.net/cf_vods/x/${id}/thumb/thumb0-320x180.jpg`, game: { name: 'Minecraft' } } });
    return json({ data: { user: { stream: mode === 'live' ? { title: 'Hardcore con subs', viewersCount: 37, createdAt: new Date(NOW - 3600e3).toISOString(), game: { name: 'Minecraft' } } : null, videos: { edges: [node(2001, 'Hardcore día 40', 1, 10230), node(2002, 'Probando mods raros', 4, 7400), node(2003, 'Speedrun con chat', 8, 5025)] } } } });
  }
  if (u.host === 'linktr.ee') {
    const data = { props: { pageProps: { links: [{ title: 'Sin Drama by Havikun', url: 'https://push.fm/fl/Hc8Wz28g', type: 'CLASSIC' }, { title: 'Server Discord', url: 'https://discord.gg/PFtMpSjsU3', type: 'CLASSIC' }, { title: 'Sodium (Modrinth)', url: 'https://modrinth.com/mod/sodium', type: 'CLASSIC' }, { title: 'Fabric API (CurseForge)', url: 'https://www.curseforge.com/minecraft/mc-mods/fabric-api', type: 'CLASSIC' }, { title: 'Título', url: '', type: 'HEADER' }, { title: 'Satoru Gojo Totem (Modrinth)', url: 'https://modrinth.com/resourcepack/satoru-gojo-totem', type: 'CLASSIC' }] } } };
    return new Response(`<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (u.host === 'api.mclo.gs') return json({ success: true, id: 'Ab12Cd3', url: 'https://mclo.gs/Ab12Cd3', raw: 'https://api.mclo.gs/1/raw/Ab12Cd3' });
  if (u.host === 'api.mojang.com') return json({ id: 'f'.repeat(32), name: decodeURIComponent(u.pathname.split('/').pop()) });
  if (u.host === 'sessionserver.mojang.com') {
    const tex = { textures: { SKIN: { url: 'https://textures.minecraft.net/texture/mockskin', metadata: { model: 'slim' } } } };
    return json({ id: 'f'.repeat(32), name: 'Jugador', properties: [{ name: 'textures', value: Buffer.from(JSON.stringify(tex)).toString('base64') }] });
  }
  if (u.host === 'textures.minecraft.net') {
    const { paintSkin } = require('../src/shared/skinpaint.js');
    const c = paintSkin({ skin: '#9a6a4a', hair: '#e8d36a', shirt: '#8e44ad', pants: '#2c3e50', slim: true });
    return bin(encodePng(64, 64, c.data), 'image/png');
  }
  if (u.host === 'api.minecraftservices.com') {
    return json({ id: '0123456789abcdef0123456789abcdef', name: 'havikun', skins: [{ id: 'new', state: 'ACTIVE', url: 'https://textures.minecraft.net/texture/uploaded', variant: 'CLASSIC' }], capes: [{ id: 'cape-1', state: 'ACTIVE', url: 'https://textures.minecraft.net/texture/cape1', alias: 'Moonlight Trail' }, { id: 'cape-2', state: 'INACTIVE', url: 'https://textures.minecraft.net/texture/cape2', alias: 'Purple Heart' }] });
  }
  // Mojang's list of versions and the game's client .jar, which Havi Hub fetches
  // for its pictures when no game is installed (main/mcassets.js): stand-ins of
  // the same shape (scripts/mc-standins.cjs). HAVIHUB_MOCK_MC_DOWN=<file>: Mojang
  // is out of reach while that file exists; HAVIHUB_MOCK_SLOW_MC=ms: the .jar
  // takes that long to arrive, in pieces.
  if (u.host === 'piston-meta.mojang.com' || u.host === 'piston-data.mojang.com') {
    const down = process.env.HAVIHUB_MOCK_MC_DOWN;
    if (down && fs.existsSync(down)) throw new TypeError('fetch failed');
    const { STANDIN_VERSION, clientJar } = require('./mc-standins.cjs');
    const jar = await clientJar();
    if (u.pathname === '/mc/game/version_manifest_v2.json') {
      return json({ latest: { release: STANDIN_VERSION, snapshot: STANDIN_VERSION }, versions: [{ id: STANDIN_VERSION, type: 'release', url: `https://piston-meta.mojang.com/v1/packages/0/${STANDIN_VERSION}.json` }] });
    }
    if (u.pathname.startsWith('/v1/packages/')) {
      return json({ id: STANDIN_VERSION, downloads: { client: { url: 'https://piston-data.mojang.com/v1/objects/0/client.jar', size: jar.length, sha1: crypto.createHash('sha1').update(jar).digest('hex') } } });
    }
    if (u.pathname.endsWith('/client.jar')) {
      const ms = Number(process.env.HAVIHUB_MOCK_SLOW_MC || 0);
      if (!ms) return bin(jar, 'application/java-archive');
      const parts = 24;
      const size = Math.ceil(jar.length / parts);
      let i = 0;
      const stream = new ReadableStream({
        async pull(controller) {
          if (i >= parts) return controller.close();
          await new Promise((r) => setTimeout(r, ms / parts));
          controller.enqueue(new Uint8Array(jar.subarray(i * size, (i + 1) * size)));
          i++;
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/java-archive', 'content-length': String(jar.length) } });
    }
    return json({}, 404);
  }
  // Adoptium (Java for a profile): the newest Temurin is a small zip with a
  // stand-in java program, listed with its SHA-256 as the real API does
  if (u.host === 'api.adoptium.net' && u.pathname.startsWith('/v3/assets/latest/')) {
    const major = u.pathname.split('/')[4];
    const os = u.searchParams.get('os');
    const zip = temurinZip(major);
    const name = `OpenJDK${major}U-jre_${u.searchParams.get('architecture')}_${os}_hotspot.zip`;
    return json([{ version: { semver: `${major}.0.1+8` }, binary: { package: { name, link: `https://github.com/adoptium/temurin${major}-binaries/releases/download/mock/${name}`, checksum: crypto.createHash('sha256').update(zip).digest('hex'), size: zip.length } } }]);
  }
  if (u.host === 'github.com' && /^\/adoptium\/temurin(\d+)-binaries\//.test(u.pathname)) {
    return bin(temurinZip(/temurin(\d+)-binaries/.exec(u.pathname)[1]), 'application/zip');
  }
  // Prism Launcher releases (engine download): HAVIHUB_MOCK_ENGINE_ASSET is a real
  // archive on disk served as the newest release (HAVIHUB_MOCK_ENGINE_VERSION)
  if (u.host === 'api.github.com' && /\/repos\/PrismLauncher\/PrismLauncher\/releases\/latest$/.test(u.pathname)) {
    const file = process.env.HAVIHUB_MOCK_ENGINE_ASSET;
    if (!file) return json({ message: 'Not Found' }, 404);
    const v = process.env.HAVIHUB_MOCK_ENGINE_VERSION || '11.1.1';
    const name = path.basename(file);
    return json({ tag_name: v, published_at: new Date(NOW).toISOString(), assets: [{ name, size: fs.statSync(file).size, browser_download_url: `https://github.com/PrismLauncher/PrismLauncher/releases/download/${v}/${name}` }] });
  }
  if (u.host === 'github.com' && u.pathname.includes('/releases/download/')) {
    const file = process.env.HAVIHUB_MOCK_ENGINE_ASSET;
    if (!file || path.basename(file) !== decodeURIComponent(u.pathname.split('/').pop())) return json({}, 404);
    return new Response(fs.readFileSync(file), { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(fs.statSync(file).size) } });
  }
  return json({ error: `mock: unknown host ${u.host}` }, 502);
}

module.exports = { fetch: mockFetch, ping: mockPing, MR, CF, MR_SERVERS, mrVersions, cfFiles, jarBytes, zlib };
