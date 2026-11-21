// Generates a fake Prism Launcher data folder for development and tests.
// Every image is generated procedurally (no third-party artwork).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { encodePng } = require('./png.cjs');
const nbt = require('../src/main/util/nbt.js');
const yazl = require('yazl');
const { paintSkin, paintCape } = require('../src/shared/skinpaint.js');

const out = path.resolve(process.argv[2] || path.join(root, 'fixtures', 'PrismLauncher'));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------- images
function img(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  return encodePng(w, h, data);
}
const mix = (a, b, t) => a + (b - a) * t;
function rnd(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

// abstract cover art: radial gradient + rings
function cover(c1, c2, seed) {
  const r = rnd(seed);
  const cx = 160 + r() * 200;
  const cy = 160 + r() * 200;
  return img(512, 512, (x, y) => {
    const d = Math.hypot(x - cx, y - cy) / 512;
    const ring = Math.sin(d * 40) > 0.85 ? 0.25 : 0;
    const t = Math.min(1, d + ring);
    return [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
  });
}

// "screenshot": sky gradient, rain, ground band with blocky houses
function screenshot(seed, night) {
  const r = rnd(seed);
  const houses = Array.from({ length: 4 }, () => ({ x: Math.floor(r() * 760), w: 60 + Math.floor(r() * 120), h: 50 + Math.floor(r() * 90) }));
  const drops = Array.from({ length: 220 }, () => ({ x: Math.floor(r() * 854), y: Math.floor(r() * 480), l: 6 + Math.floor(r() * 10) }));
  return img(854, 480, (x, y) => {
    const ground = 330 + Math.sin(x / 70) * 8;
    let c;
    if (y < ground) {
      const t = y / ground;
      c = night ? [mix(8, 30, t), mix(12, 40, t), mix(40, 80, t)] : [mix(90, 170, t), mix(140, 200, t), mix(210, 235, t)];
    } else {
      const tex = ((Math.floor(x / 8) * 31 + Math.floor(y / 8) * 17) % 7) / 7;
      c = night ? [20 + tex * 15, 50 + tex * 20, 25 + tex * 10] : [60 + tex * 25, 130 + tex * 30, 50 + tex * 15];
    }
    for (const h of houses) {
      if (x >= h.x && x < h.x + h.w && y > ground - h.h && y < ground + 4) {
        const win = (x - h.x) % 30 > 10 && (x - h.x) % 30 < 22 && (y - (ground - h.h)) % 28 > 8 && (y - (ground - h.h)) % 28 < 18;
        c = win ? (night ? [250, 210, 120] : [170, 200, 230]) : [110 - ((x >> 3) % 2) * 10, 80, 55];
      }
    }
    for (const d of drops) if (x === d.x && y >= d.y && y < d.y + d.l) c = night ? [80, 110, 200] : [150, 170, 220];
    return c;
  });
}

function icon64(c1, c2, shape) {
  return img(64, 64, (x, y) => {
    const t = (x + y) / 128;
    const base = [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
    const dx = x - 32;
    const dy = y - 32;
    if (shape === 'circle' && Math.hypot(dx, dy) < 16) return [255, 255, 255];
    if (shape === 'diamond' && Math.abs(dx) + Math.abs(dy) < 18) return [255, 255, 255];
    if (shape === 'bars' && x % 16 < 8 && y > 14 && y < 50) return [255, 255, 255];
    return base;
  });
}

function canvasPng(c) {
  return encodePng(c.w, c.h, c.data);
}

// ---------------------------------------------------------------- helpers
function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
}

function makeZip(file, entries) {
  return new Promise((resolve) => {
    const z = new yazl.ZipFile();
    for (const [name, buf] of Object.entries(entries)) z.addBuffer(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), name);
    z.end();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    z.outputStream.pipe(fs.createWriteStream(file)).on('close', resolve);
  });
}

function levelDat(name, mode, lastPlayed, hardcore = false) {
  const { tag, T } = nbt;
  const data = {
    LevelName: tag.string(name),
    GameType: tag.int(mode),
    hardcore: tag.byte(hardcore ? 1 : 0),
    LastPlayed: tag.long(lastPlayed),
    allowCommands: tag.byte(0),
    Version: tag.compound({ Name: tag.string('26.2'), Id: tag.int(4600) }),
  };
  return nbt.serialize({ name: '', value: { Data: tag.compound(data) } }, { gzip: true });
}

function serversDat(list) {
  const { tag, T } = nbt;
  return nbt.serialize({
    name: '',
    value: {
      servers: tag.list(
        T.Compound,
        list.map((s) => ({ name: tag.string(s.name), ip: tag.string(s.ip), ...(s.icon ? { icon: tag.string(s.icon) } : {}) })),
      ),
    },
  });
}

function instanceCfg(fields) {
  const lines = ['[General]', 'ConfigVersion=1.3', 'InstanceType=OneSix'];
  for (const [k, v] of Object.entries(fields)) lines.push(`${k}=${v}`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- data dir
write(
  path.join(out, 'prismlauncher.cfg'),
  ['[General]', 'ConfigVersion=1.3', 'ApplicationTheme=dark', 'InstanceDir=instances', 'IconsDir=icons', 'MaxMemAlloc=8192', 'MinMemAlloc=512', 'JvmArgs="-XX:+UseG1GC -Dsun.rmi.dgc.server.gcInterval=2147483646"', 'ShowConsole=false', 'Language=es_ES', ''].join('\n'),
);

const now = Date.now();
const DAY = 86400000;

// mods for the 26.2 instance
const MODS = [
  { id: 'sodium-extra', name: 'Sodium Extra', ver: '0.9.4+mc26.2', authors: ['FlashyReese'], env: 'client', file: 'sodium-extra-fabric-0.9.4+mc26.2.jar', colors: [[250, 200, 40], [240, 120, 20]], shape: 'circle', meta: 'modrinth' },
  { id: 'badoptimizations', name: 'BadOptimizations', ver: '2.4.1', authors: ['thosea'], env: 'client', file: 'BadOptimizations-2.4.1-26.2-fabric.jar', noIcon: true },
  { id: 'cloth-config', name: 'Cloth Config API', ver: '26.2.155', authors: ['shedaniel'], env: '*', file: 'cloth-config-26.2.155.jar', colors: [[170, 220, 60], [60, 150, 60]], shape: 'diamond', meta: 'modrinth' },
  { id: 'clumps', name: 'Clumps', ver: '26.2.1', authors: ['Jaredlll08'], env: '*', file: 'Clumps-fabric-26.2-26.2.1.jar', colors: [[230, 220, 60], [190, 170, 20]], shape: 'circle', meta: 'curseforge' },
  { id: 'continuity', name: 'Continuity', ver: '3.0.1+26.2', authors: ['Pepper_Bell'], env: 'client', file: 'continuity-3.0.1+26.2.jar', colors: [[120, 200, 120], [200, 120, 200]], shape: 'bars' },
  { id: 'entityculling', name: 'Entity Culling', ver: '1.11.3', authors: ['tr7zw'], env: 'client', file: 'entityculling-fabric-1.11.3-mc26.2.jar', colors: [[60, 120, 220], [30, 40, 90]], shape: 'diamond', meta: 'modrinth' },
  { id: 'fabric-api', name: 'Fabric API', ver: '0.161.0+26.2', authors: ['FabricMC'], env: '*', file: 'fabric-api-0.161.0+26.2.jar', colors: [[220, 210, 180], [150, 130, 100]], shape: 'bars', meta: 'modrinth' },
  { id: 'enchdesc', name: 'Enchantment Descriptions', ver: '26.2.0.2', authors: ['Darkhax'], env: 'client', file: 'EnchantmentDescriptions-Fabric-26.2-26.2.0.2.jar', colors: [[150, 60, 220], [60, 20, 120]], shape: 'circle', disabled: true },
  { id: 'drippyloadingscreen', name: 'Drippy Loading Screen', ver: '3.1.5', authors: ['Keksuccino'], env: 'client', file: 'drippyloadingscreen_fabric_3.1.5_MC_26.2.jar', colors: [[40, 200, 220], [20, 80, 160]], shape: 'circle' },
  { id: 'capes', name: 'Capes', ver: '1.5.11+26.2', authors: ['CaelTheColher'], env: 'client', file: 'capes-1.5.11+26.2-fabric.jar', colors: [[230, 80, 80], [120, 20, 40]], shape: 'bars', meta: 'modrinth' },
];

async function makeMods(gameDir) {
  const modsDir = path.join(gameDir, 'mods');
  for (const m of MODS) {
    const fmj = { schemaVersion: 1, id: m.id, version: m.ver, name: m.name, description: `${m.name} (fixture)`, authors: m.authors, environment: m.env, ...(m.noIcon ? {} : { icon: `assets/${m.id}/icon.png` }) };
    const entries = { 'fabric.mod.json': JSON.stringify(fmj, null, 2), 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n' };
    if (!m.noIcon) entries[`assets/${m.id}/icon.png`] = icon64(m.colors[0], m.colors[1], m.shape);
    await makeZip(path.join(modsDir, m.file + (m.disabled ? '.disabled' : '')), entries);
    if (m.meta) {
      const toml =
        m.meta === 'modrinth'
          ? `filename = '${m.file}'\nname = '${m.name}'\nside = '${m.env === 'client' ? 'client' : 'both'}'\nx-prismlauncher-loaders = [ 'fabric' ]\nx-prismlauncher-mc-versions = [ '26.2' ]\nx-prismlauncher-release-type = 'Release'\nx-prismlauncher-version-number = '${m.ver}'\n\n[download]\nhash = '0000'\nhash-format = 'sha512'\nmode = 'url'\nurl = 'https://cdn.modrinth.com/data/xxxx/versions/yyyy/${m.file}'\n\n[update.modrinth]\nmod-id = 'mr${m.id.slice(0, 6)}'\nversion = 'ver${m.id.slice(0, 5)}'\n`
          : `filename = '${m.file}'\nname = '${m.name}'\nside = 'both'\nx-prismlauncher-loaders = [ 'fabric' ]\nx-prismlauncher-mc-versions = [ '26.2' ]\nx-prismlauncher-release-type = 'Release'\n\n[download]\nhash = 'abcd'\nhash-format = 'sha1'\nmode = 'metadata:curseforge'\nurl = ''\n\n[update.curseforge]\nfile-id = 5551234\nproject-id = 256717\n`;
      write(path.join(modsDir, '.index', `${m.id}.pw.toml`), toml);
    }
  }
}

async function makeResourcePacks(gameDir) {
  const rp = path.join(gameDir, 'resourcepacks');
  await makeZip(path.join(rp, 'Soft Shadows Pack.zip'), {
    'pack.mcmeta': JSON.stringify({ pack: { pack_format: 70, description: 'Sombras suaves y colores cálidos' } }),
    'pack.png': icon64([240, 180, 120], [120, 60, 40], 'diamond'),
  });
  fs.mkdirSync(path.join(rp, 'Dark UI'), { recursive: true });
  write(path.join(rp, 'Dark UI', 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 70, description: { text: 'Interfaz oscura' } } }));
  write(path.join(rp, 'Dark UI', 'pack.png'), icon64([40, 40, 50], [10, 10, 20], 'bars'));
}

function makeLogs(gameDir) {
  const t = (s) => `[21:51:${String(s).padStart(2, '0')}]`;
  const lines = [
    `${t(1)} [main/INFO]: Loading Minecraft 26.2 with Fabric Loader 0.20.1`,
    `${t(1)} [main/INFO]: Mappings not present!`,
    `${t(1)} [ForkJoinPool-1-worker-12/WARN]: Mod com_github_rtyley_animated-gif-lib-for-java uses the version animated-gif-lib-1.7 which isn't compatible with Loader's extended semantic version format`,
    `${t(2)} [main/INFO]: Loading ${MODS.length + 96} mods:`,
    ...MODS.map((m) => `\t- ${m.id} ${m.ver}`),
    `\t- fabric-api 0.161.0+26.2`,
    `\t   |-- fabric-api-base 2.0.4+ece063239e`,
    `\t   |-- fabric-biome-api-v1 18.0.6+c7bd5b8e9e`,
    `${t(5)} [Render thread/INFO]: Setting user: havikun`,
    `${t(6)} [Render thread/INFO]: Backend library: LWJGL version 3.4.3`,
    `${t(7)} [Render thread/WARN]: Missing sound for event: minecraft:item.goat_horn.play`,
    `${t(9)} [Render thread/ERROR]: Failed to load texture minecraft:textures/missing.png`,
    `${t(12)} [Render thread/INFO]: Loaded 1438 recipes`,
    `${t(13)} [Server thread/INFO]: Preparing spawn area: 83%`,
    `${t(15)} [Render thread/INFO]: [CHAT] Welcome back!`,
  ];
  write(path.join(gameDir, 'logs', 'latest.log'), lines.join('\n') + '\n');
  write(path.join(gameDir, 'logs', '2026-10-17-1.log.gz'), zlib.gzipSync(Buffer.from(lines.slice(0, 6).join('\n') + '\n[21:55:00] [main/INFO]: Stopping!\n')));
  write(path.join(gameDir, 'crash-reports', 'crash-2026-10-16_20.11.04-client.txt'), '---- Minecraft Crash Report ----\n// Fixture crash report\n\nTime: 2026-10-16 20:11:04\nDescription: Rendering overlay\n\njava.lang.NullPointerException: fixture\n');
}

function makeWorlds(gameDir) {
  const saves = path.join(gameDir, 'saves');
  for (const [folder, name, mode, ago, hc] of [
    ['Hardcore', 'Hardcore', 0, 13 * DAY, true],
    ['Hardcore - copia', 'Hardcore - copia', 0, 13.5 * DAY, true],
    ['Creativo', 'Mundo creativo', 1, 2 * DAY, false],
  ]) {
    write(path.join(saves, folder, 'level.dat'), levelDat(name, mode, now - ago, hc));
    write(path.join(saves, folder, 'icon.png'), img(64, 64, (x, y) => [mix(240, 120, y / 64), mix(160, 200, x / 64), 200]));
  }
  const srvIcon = img(64, 64, (x, y) => (Math.hypot(x - 32, y - 32) < 26 ? [250, 210, 60] : [40, 40, 40])).toString('base64');
  write(path.join(gameDir, 'servers.dat'), serversDat([{ name: 'Minecraft Server', ip: '203.0.113.151', icon: srvIcon }, { name: 'Servidor de pruebas', ip: 'play.example.net' }]));
}

function makeScreenshots(gameDir) {
  for (let i = 0; i < 7; i++) {
    const f = path.join(gameDir, 'screenshots', `2026-10-${String(10 + i).padStart(2, '0')}_21.0${i}.12.png`);
    write(f, screenshot(100 + i, i % 3 !== 2));
    const tt = new Date(now - (7 - i) * DAY);
    fs.utimesSync(f, tt, tt);
  }
}

async function makeInstance(dir, { name, mc, loader, iconKey, lastLaunch, played, withContent, notes }) {
  const comps = [{ uid: 'net.minecraft', version: mc, important: true }];
  if (loader) comps.push(loader);
  write(path.join(dir, 'mmc-pack.json'), JSON.stringify({ components: comps, formatVersion: 1 }, null, 4));
  write(path.join(dir, 'instance.cfg'), instanceCfg({ name, iconKey: iconKey || 'default', lastLaunchTime: lastLaunch || 0, totalTimePlayed: played || 0, ...(notes ? { notes } : {}) }));
  const gameDir = path.join(dir, 'minecraft');
  fs.mkdirSync(gameDir, { recursive: true });
  if (withContent) {
    await makeMods(gameDir);
    await makeResourcePacks(gameDir);
    makeLogs(gameDir);
    makeWorlds(gameDir);
    makeScreenshots(gameDir);
    fs.mkdirSync(path.join(gameDir, 'shaderpacks'), { recursive: true });
  }
}

const inst = path.join(out, 'instances');
await makeInstance(path.join(inst, '1.21.8 PVP'), { name: '[1.21.8] PVP', mc: '1.21.8', iconKey: 'havihub-pvp', lastLaunch: now - 3 * DAY, played: 5400 });
await makeInstance(path.join(inst, '26.2 Vanilla'), {
  name: '[26.2] Vanilla',
  mc: '26.2',
  loader: { uid: 'net.fabricmc.fabric-loader', version: '0.20.1' },
  iconKey: 'havihub-vanilla',
  lastLaunch: now - 14 * DAY,
  played: 13 * 3600 + 120,
  withContent: true,
  notes: 'Mundo principal\\ncon amigos',
});
await makeInstance(path.join(inst, 'Survival 1.20.1'), { name: 'Survival 1.20.1', mc: '1.20.1', loader: { uid: 'net.minecraftforge', version: '47.4.0' }, iconKey: 'default', lastLaunch: now - 40 * DAY, played: 3600 * 52 });
await makeInstance(path.join(inst, 'Cave Dread'), { name: 'Cave Dread', mc: '1.20.1', loader: { uid: 'net.neoforged', version: '47.1.106' }, iconKey: 'havihub-horror1', lastLaunch: now - 9 * DAY, played: 3600 * 4 });
// a few more screenshots, from today back to last month, for the gallery
{
  const gameDir = path.join(inst, 'Cave Dread', 'minecraft');
  for (const [i, ago] of [[0, 0.1], [1, 0.3], [2, 1.2], [3, 38]].map(([i, d]) => [i, d * DAY])) {
    // "today" (less than a day ago) stays after midnight, so the gallery's
    // "Hoy" filter finds them whatever time it is
    const midnight = new Date(now).setHours(0, 0, 0, 0);
    const tt = new Date(ago < DAY ? midnight + (now - midnight) * (1 - ago / DAY) : now - ago);
    const name = `${tt.getFullYear()}-${String(tt.getMonth() + 1).padStart(2, '0')}-${String(tt.getDate()).padStart(2, '0')}_2${i}.1${i}.0${i}.png`;
    const f = path.join(gameDir, 'screenshots', name);
    write(f, screenshot(300 + i, false));
    fs.utimesSync(f, tt, tt);
  }
}
await makeInstance(path.join(inst, 'The Fog'), { name: 'The Fog', mc: '26.1', loader: { uid: 'org.quiltmc.quilt-loader', version: '0.30.2' }, iconKey: 'havihub-horror2', lastLaunch: 0, played: 0 });

write(path.join(out, 'icons', 'havihub-pvp.png'), cover([230, 230, 235], [40, 40, 50], 7));
write(path.join(out, 'icons', 'havihub-vanilla.png'), cover([255, 205, 120], [190, 110, 40], 3));
write(path.join(out, 'icons', 'havihub-horror1.png'), cover([60, 10, 15], [5, 5, 5], 11));
write(path.join(out, 'icons', 'havihub-horror2.png'), cover([150, 160, 170], [30, 35, 40], 5));

write(
  path.join(inst, 'instgroups.json'),
  JSON.stringify({ formatVersion: '1', groups: { Vanilla: { hidden: false, instances: ['26.2 Vanilla', 'Survival 1.20.1'] }, Horror: { hidden: false, instances: ['Cave Dread', 'The Fog'] } } }, null, 4),
);

// ---------------------------------------------------------------- accounts & skins
const skinA = canvasPng(paintSkin({ skin: '#f1d6c6', hair: '#eeeeee', shirt: '#e8e8ec', pants: '#3a5f9a', eyes: '#7d7d7d' }));
const skinB = canvasPng(paintSkin({ skin: '#c98e62', hair: '#1d1d1d', shirt: '#d94f3d', pants: '#2c2c34', eyes: '#3b2414' }));
const skinC = canvasPng(paintSkin({ skin: '#e6b991', hair: '#c9772f', shirt: '#2f9e6b', pants: '#5a3d2a', eyes: '#2a6bd1', slim: true }));
const cape1 = canvasPng(paintCape({ main: '#2d6fa8', accent: '#bfe8ff' }));
const cape2 = canvasPng(paintCape({ main: '#7b3fd6', accent: '#ffd1f0' }));
const cape3 = canvasPng(paintCape({ main: '#2f8f4e', accent: '#f7e26b' }));

write(
  path.join(out, 'accounts.json'),
  JSON.stringify(
    {
      formatVersion: 3,
      accounts: [
        {
          type: 'MSA',
          'msa-client-id': '10ba024d-897d-422d-bf41-2f818b9a1468', // Havi Hub's Microsoft app
          ygg: { token: 'fixture-token', iat: Math.floor(now / 1000) - 3600, exp: Math.floor(now / 1000) + 20 * 3600 },
          profile: {
            id: '0123456789abcdef0123456789abcdef',
            name: 'havikun',
            cape: 'cape-1',
            skin: { id: 'skin-1', url: 'https://textures.minecraft.net/texture/fixture1', variant: 'CLASSIC', data: skinA.toString('base64') },
            capes: [
              { id: 'cape-1', alias: 'Moonlight Trail', url: 'https://textures.minecraft.net/texture/cape1', data: cape1.toString('base64') },
              { id: 'cape-2', alias: 'Purple Heart', url: 'https://textures.minecraft.net/texture/cape2', data: cape2.toString('base64') },
              { id: 'cape-3', alias: 'Home', url: 'https://textures.minecraft.net/texture/cape3', data: cape3.toString('base64') },
            ],
          },
          active: true,
        },
      ],
    },
    null,
    4,
  ),
);

write(path.join(out, 'skins', 'havikun.png'), skinA);
write(path.join(out, 'skins', 'rojo.png'), skinB);
write(path.join(out, 'skins', 'verde slim.png'), skinC);
write(path.join(out, 'skins', 'index.json'), JSON.stringify({ skins: [{ name: 'havikun', capeId: 'cape-1', url: 'https://textures.minecraft.net/texture/fixture1', model: 'CLASSIC' }, { name: 'verde slim', capeId: '', url: '', model: 'SLIM' }] }, null, 4));

// a fake prism executable (a script) so launching can be exercised
const fakeExe = path.join(out, 'prismlauncher');
write(fakeExe, '#!/bin/sh\necho "fake prism $@" >> "$(dirname "$0")/launch.log"\nsleep 1\n');
fs.chmodSync(fakeExe, 0o755);

console.log('Fixtures written to', out);
