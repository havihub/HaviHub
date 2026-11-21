// Minecraft's own textures (blocks, items, sky), read from the game files that
// are already on this computer: the client .jar the launcher downloads to play.
// Havi Hub ships none of them itself (they are Mojang's, and their terms do
// not allow passing them on); it only shows what the installed game contains.
// With no game downloaded yet, the latest release's client .jar is fetched
// once from Mojang's servers, the same file a first launch would download.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { readEntries } = require('./util/zip');
const { UserError } = require('../shared/usertext');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const NAME = /^[a-z0-9_]+(\/[a-z0-9_]+){1,3}$/;

// "1.21.8" / "26.2" → comparable numbers; snapshots and odd names sort last
function versionRank(name) {
  if (!/^\d+(\.\d+){1,2}$/.test(name)) return [-1, 0, 0];
  const [a, b = 0, c = 0] = name.split('.').map(Number);
  return [a, b, c];
}
function byNewest(x, y) {
  const a = versionRank(x);
  const b = versionRank(y);
  return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
}
function newest(names) {
  return [...names].sort(byNewest);
}

// Whether a version names its textures the way they are asked for here
// (block/…, item/…): every one since 1.13 (snapshot 17w43a) does. The ones
// before it have other names (blocks/grass_top…), so the game's grass block
// and much of the rest could not be drawn from them.
function currentNames(version) {
  const release = /^(\d+)\.(\d+)/.exec(version);
  if (release) return Number(release[1]) > 1 || Number(release[2]) >= 13;
  const snapshot = /^(\d\d)w(\d\d)[a-z]$/.exec(version);
  return Boolean(snapshot) && Number(snapshot[1]) * 100 + Number(snapshot[2]) >= 1743;
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

class McAssets {
  constructor({ dataDir, cacheDir, http, emit, allowDownload = true }) {
    this.dataDir = dataDir; // () => the launcher's data folder (or a promise of it)
    this.cacheDir = cacheDir;
    this.http = http;
    this.emit = emit || (() => {});
    this.allowDownload = allowDownload;
    this.cache = new Map(); // source key → Map(name → data URL | null)
    this.downloading = null;
    this.lastKey = null;
    this.current = false; // the source names its textures as asked (see currentNames)
    this.saving = null; // the write of textures.json in progress
    this.diskRead = false;
    // the download of the game's files (fetchLatest), for whoever waits for it
    this.fetching = { active: false, received: 0, total: 0, error: null };
    this.retryTimer = null;
  }

  // Whether the game's pictures are at hand, and how their download goes
  // (canFetch: false only in tests that keep Havi Hub off the network)
  status() {
    return { ...this.fetching, ready: Boolean(this.lastKey) && this.current, canFetch: Boolean(this.allowDownload && this.http) };
  }

  // What was read from the game's .jar, kept between starts (<cacheDir>/textures.json):
  // going through a client .jar takes a second or two, and it happens on every start.
  // The key carries the file and its size, so another game file is read afresh.
  async loadKept(key) {
    if (this.diskRead) return null;
    this.diskRead = true;
    try {
      const d = JSON.parse(await fsp.readFile(path.join(this.cacheDir, 'textures.json'), 'utf8'));
      if (!d || d.key !== key || !d.textures || typeof d.textures !== 'object') return null;
      const known = new Map();
      for (const [n, v] of Object.entries(d.textures)) {
        if (NAME.test(n) && (v === null || (typeof v === 'string' && v.startsWith('data:image/png;base64,')))) known.set(n, v);
      }
      return known;
    } catch {
      return null; // none yet, or unreadable: read from the game
    }
  }

  keep(key, known) {
    const write = async () => {
      try {
        await fsp.mkdir(this.cacheDir, { recursive: true });
        const tmp = path.join(this.cacheDir, `textures.json.${process.pid}.tmp`);
        await fsp.writeFile(tmp, JSON.stringify({ key, textures: Object.fromEntries(known) }));
        await fsp.rename(tmp, path.join(this.cacheDir, 'textures.json'));
      } catch {
        // not kept this time: read again on the next start
      }
    };
    this.saving = (this.saving || Promise.resolve()).then(write);
    return this.saving;
  }

  // a folder of extracted assets: <dir>/assets/minecraft/textures, <dir>/textures or <dir> itself
  async dirSource(dir) {
    for (const root of [path.join(dir, 'assets', 'minecraft', 'textures'), path.join(dir, 'textures'), dir]) {
      if (await exists(path.join(root, 'block', 'dirt.png'))) return { kind: 'dir', path: root, key: `dir:${root}` };
    }
    return null;
  }

  async jarSource(file) {
    try {
      const st = await fsp.stat(file);
      return st.isFile() && st.size > 1024 * 1024 ? { kind: 'jar', path: file, key: `jar:${file}:${st.size}` } : null;
    } catch {
      return null;
    }
  }

  // The newest client .jar at hand: the game as the launcher installed it, or
  // the copy fetched for this purpose (fetchLatest). One from before 1.13 is
  // used only while there is nothing newer.
  async source() {
    const forced = process.env.HAVIHUB_MC_ASSETS;
    if (forced) {
      const st = await fsp.stat(forced).catch(() => null);
      const s = st && st.isDirectory() ? await this.dirSource(forced) : await this.jarSource(forced);
      if (s) {
        this.current = true;
        return s;
      }
    }
    const found = []; // { version, file }
    try {
      const base = path.join(await this.dataDir(), 'libraries', 'com', 'mojang', 'minecraft');
      for (const v of await fsp.readdir(base)) found.push({ version: v, file: path.join(base, v, `minecraft-${v}-client.jar`) });
    } catch {
      // nothing installed yet
    }
    try {
      for (const f of await fsp.readdir(this.cacheDir)) {
        if (/^client-.+\.jar$/.test(f)) found.push({ version: f.slice(7, -4), file: path.join(this.cacheDir, f) });
      }
    } catch {
      // nothing fetched yet
    }
    found.sort((x, y) => byNewest(x.version, y.version)); // the installed game first when both have the same version
    let old = null;
    for (const { version, file } of found) {
      const s = await this.jarSource(file);
      if (!s) continue;
      if (currentNames(version)) {
        this.current = true;
        return s;
      }
      old = old || s;
    }
    this.current = false;
    return old;
  }

  async readFrom(src, names) {
    const out = new Map();
    if (src.kind === 'dir') {
      await Promise.all(
        names.map(async (n) => {
          const buf = await fsp.readFile(path.join(src.path, `${n}.png`)).catch(() => null);
          out.set(n, buf);
        }),
      );
      return out;
    }
    const wanted = new Map(names.map((n) => [`assets/minecraft/textures/${n}.png`, n]));
    const found = await readEntries(src.path, [...wanted.keys()], { maxSize: 4 * 1024 * 1024 });
    for (const [entry, n] of wanted) {
      const buf = found instanceof Map ? found.get(entry) : found[entry];
      out.set(n, buf || null);
    }
    return out;
  }

  // { source: key | null, textures: { name: 'data:image/png;base64,…' } } (only the ones that exist)
  async textures(names) {
    const list = [...new Set((Array.isArray(names) ? names : []).map(String).filter((n) => NAME.test(n)))].slice(0, 600);
    const src = await this.source();
    if (!src) {
      this.lastKey = null;
      this.fetchLatest();
      return { source: null, textures: {} };
    }
    this.lastKey = src.key;
    if (!this.current) this.fetchLatest(); // what this game has is shown meanwhile
    let known = this.cache.get(src.key);
    if (!known) {
      this.cache.clear();
      known = (src.kind === 'jar' && (await this.loadKept(src.key))) || new Map();
      this.cache.set(src.key, known);
    }
    const missing = list.filter((n) => !known.has(n));
    if (missing.length) {
      const read = await this.readFrom(src, missing);
      for (const n of missing) {
        const buf = read.get(n);
        known.set(n, buf ? `data:image/png;base64,${Buffer.from(buf).toString('base64')}` : null);
      }
      if (src.kind === 'jar') this.keep(src.key, known);
    }
    const textures = {};
    for (const n of list) if (known.get(n)) textures[n] = known.get(n);
    return { source: src.key, textures };
  }

  // A source appeared since the last look (a game was installed, or the download ended)?
  async recheck() {
    const src = await this.source();
    const key = src ? src.key : null;
    if (key && key !== this.lastKey) {
      this.lastKey = key;
      this.emit('mc:assets', { source: key });
    }
    return key;
  }

  // No game on this computer yet: the latest release's client .jar, once.
  // After a failed try the next automatic one waits ten minutes; force tries
  // again at once (the welcome's "Reintentar"). Progress goes out as 'mc:fetch'.
  fetchLatest({ force = false } = {}) {
    if (!this.allowDownload || !this.http) return this.downloading;
    if (this.downloading && (!force || this.fetching.active)) return this.downloading;
    clearTimeout(this.retryTimer);
    const report = (patch) => {
      this.fetching = { ...this.fetching, ...patch };
      this.emit('mc:fetch', this.status());
    };
    report({ active: true, received: 0, total: 0, error: null });
    this.downloading = (async () => {
      try {
        const manifest = await this.http.getJson(MANIFEST, { timeout: 20000 });
        const id = manifest.latest && manifest.latest.release;
        const entry = (manifest.versions || []).find((v) => v.id === id);
        if (!entry) throw new UserError('Mojang no indicó cuál es la última versión del juego.');
        const meta = await this.http.getJson(entry.url, { timeout: 20000 });
        const client = meta.downloads && meta.downloads.client;
        if (!client || !client.url) throw new UserError('Mojang no indicó dónde descargar el juego.');
        await fsp.mkdir(this.cacheDir, { recursive: true });
        const dest = path.join(this.cacheDir, `client-${id}.jar`);
        const tmp = `${dest}.part`;
        report({ total: client.size || 0 });
        let shown = 0;
        const onProgress = (received, total) => {
          this.fetching.received = received;
          this.fetching.total = total || client.size || 0;
          if (Date.now() - shown > 250) {
            shown = Date.now();
            this.emit('mc:fetch', this.status());
          }
        };
        await this.http.download(client.url, tmp, { ...(client.sha1 ? { hash: client.sha1 } : {}), onProgress });
        await fsp.rename(tmp, dest);
        for (const f of await fsp.readdir(this.cacheDir)) {
          if (/^client-.+\.jar$/.test(f) && f !== path.basename(dest)) await fsp.rm(path.join(this.cacheDir, f), { force: true });
        }
        await this.recheck();
        report({ active: false, error: null });
      } catch (e) {
        // offline, or Mojang's servers out of reach: the built-in drawings stay
        report({ active: false, error: String((e && e.message) || e) });
      } finally {
        this.retryTimer = setTimeout(() => (this.downloading = null), 10 * 60 * 1000);
        if (this.retryTimer.unref) this.retryTimer.unref();
      }
    })();
    return this.downloading;
  }
}

module.exports = { McAssets, versionRank, newest, currentNames };
