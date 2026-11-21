// Havi Hub's private engine: an official, unmodified Prism Launcher portable
// build that Havi Hub downloads from Prism Launcher's GitHub releases and
// keeps up to date in the background. Havi Hub is the only interface: the
// engine runs only to start the game and, when adding a Microsoft account, to
// show Microsoft's sign-in (only an approved app may sign in to Minecraft).
//
// Layout:  <dir>/engine.json            state (active version, last check)
//          <dir>/versions/<version>/    extracted portable build
//          <dir>/downloads/             temporary archives
//          <dir>/snapshot/              the engine version and settings files
//                                       from before the last update (rollback)
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { spawn, execFile } = require('node:child_process');
const http = require('./util/http');
const { extractPrefix } = require('./util/zip');
const { extractTarGz } = require('./util/tar');
const { readJson, writeJson, exists, listDir, parseLenientJson } = require('./util/fsx');
const { IniFile } = require('./util/ini');
const { resolvePalette, luminance, mix } = require('../shared/themes.js');
const { brandEngine, isBranded } = require('./engine-brand');
const { UserError, tr } = require('../shared/usertext');

const REPO = 'PrismLauncher/PrismLauncher';
const API_RELEASES = `https://api.github.com/repos/${REPO}/releases`;
const API_LATEST = `${API_RELEASES}/latest`;
const LATEST_PAGE = `https://github.com/${REPO}/releases/latest`;
const RELEASES_ATOM = `https://github.com/${REPO}/releases.atom`;
const GH_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': http.USER_AGENT, 'X-GitHub-Api-Version': '2022-11-28' };

// A stable version tag (9.4, 10.0.1), not a pre-release
const STABLE_TAG = /^v?\d+(\.\d+)+$/;

// Errors shown under "Game engine" and in its toast: short and without raw
// URLs (Spanish source strings, translated by the renderer)
function engineErrorText(e) {
  const status = e && (e.status || (/^HTTP_(\d+)$/.exec(e.code || '') || [])[1]);
  if (Number(status) === 403 || Number(status) === 429) return 'GitHub limitó las consultas por un rato. Havi Hub lo intentará de nuevo más tarde.';
  if (status) return 'GitHub no respondió como se esperaba. Inténtalo de nuevo en unos minutos.';
  if (e && (e.code === 'NETWORK' || e.code === 'SLOW')) return 'No hay conexión con GitHub. Revisa tu conexión a internet.';
  const msg = String((e && e.message) || e || '');
  if (!msg || /https?:\/\//i.test(msg)) return 'No se pudo buscar la versión nueva del motor.';
  return msg;
}
const RECHECK_MS = 6 * 3600 * 1000;
const THEME_ID = 'havihub';

// The newest Prism Launcher this version of Havi Hub was tested with. Havi
// Hub relies on things Prism does not promise to keep (its command line, its
// files, lines of its log, the strings engine-brand.js replaces), and the
// start check before switching engines (checkVersion) cannot see those. So a
// newer release is not installed until it has been checked: run
// scripts/engine-smoke.mjs with it, then raise this. Releases up to this one
// are still installed as they come out.
const TESTED_VERSION = '11.1.1';

// Windows antivirus scanners briefly lock freshly extracted files
async function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (e) {
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}

// A release as GitHub's API describes it.
function releaseInfo(r) {
  return {
    tag: r.tag_name,
    version: String(r.tag_name).replace(/^v/i, ''),
    date: r.published_at || '',
    // digest: the SHA-256 GitHub computes for each release file ("sha256:<hex>")
    assets: (r.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, digest: typeof a.digest === 'string' ? a.digest : '' })),
  };
}

function releaseAssetUrl(tag, name) {
  return `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

// "11.1.1" > "11.1.0" > "11.1.0-pre1"
function compareVersions(a, b) {
  const parse = (v) => {
    const [main, pre] = String(v || '').replace(/^v/i, '').split('-');
    return { nums: main.split('.').map((n) => parseInt(n, 10) || 0), pre: pre || '' };
  };
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < Math.max(A.nums.length, B.nums.length); i++) {
    const d = (A.nums[i] || 0) - (B.nums[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre.localeCompare(B.pre, undefined, { numeric: true });
}

function assetNames(version, platform = process.platform, arch = process.arch) {
  if (platform === 'win32') {
    if (arch === 'arm64') return [`PrismLauncher-Windows-MSVC-arm64-Portable-${version}.zip`];
    return [`PrismLauncher-Windows-MSVC-Portable-${version}.zip`, `PrismLauncher-Windows-MinGW-w64-Portable-${version}.zip`];
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return [`PrismLauncher-Linux-aarch64-Qt6-Portable-${version}.tar.gz`];
    if (arch === 'x64') return [`PrismLauncher-Linux-Qt6-Portable-${version}.tar.gz`];
    return [];
  }
  if (platform === 'darwin') return [`PrismLauncher-macOS-${version}.zip`];
  return [];
}

function exeRelPath(platform = process.platform) {
  if (platform === 'win32') return 'prismlauncher.exe';
  if (platform === 'darwin') return path.join('Prism Launcher.app', 'Contents', 'MacOS', 'prismlauncher');
  return 'PrismLauncher'; // start script of the portable Linux build
}

// ------------------------------------------------------------------ engine data
// Settings that keep the engine invisible: no setup wizard, no console, no
// update prompts, and dialogs that use Havi Hub's colors and language.
function engineLanguage(appLanguage, systemLocale) {
  const lang = appLanguage || (String(systemLocale || '').toLowerCase().startsWith('es') ? 'es' : 'en');
  return lang === 'en' ? 'en_US' : 'es';
}

function qtTheme(palette) {
  const p = palette;
  const dark = luminance(p.bg) < 0.5;
  const theme = {
    name: 'Havi Hub',
    widgets: 'Fusion',
    qssFilePath: 'themeStyle.css',
    colors: {
      Window: p.surface,
      WindowText: p.text,
      Base: p.surface2,
      AlternateBase: p.surface3,
      ToolTipBase: p.surface3,
      ToolTipText: p.text,
      Text: p.text,
      Button: p.surface2,
      ButtonText: p.text,
      BrightText: p.danger,
      Link: p.accent,
      Highlight: p.accent,
      HighlightedText: p.accentText,
      fadeColor: p.surface,
      fadeAmount: 0.5,
    },
    logColors: {
      Launcher: p.info,
      Error: p.logError,
      Warning: p.logWarn,
      Debug: p.textMuted,
      Fatal: p.danger,
    },
  };
  const css = [
    `QToolTip { color: ${p.text}; background-color: ${p.surface3}; border: 1px solid ${p.border}; }`,
    `QProgressBar { border: 1px solid ${p.border}; border-radius: 3px; background-color: ${p.surface2}; color: ${p.text}; text-align: center; }`,
    `QProgressBar::chunk { background-color: ${p.accent}; border-radius: 2px; }`,
    `QPushButton:default { background-color: ${p.accent}; color: ${p.accentText}; border: 1px solid ${mix(p.accent, '#000000', 0.15)}; border-radius: 3px; padding: 4px 14px; }`,
    `QPushButton:default:hover { background-color: ${mix(p.accent, dark ? '#ffffff' : '#000000', 0.12)}; }`,
  ].join('\n');
  return { theme, css, iconTheme: dark ? 'flat_white' : 'flat' };
}

// folders: { shared, instancesDir, iconsDir } when Havi Hub shares Prism
// Launcher's profiles (see sharing.js); otherwise the data folder's own ones.
// msaClientId: the Microsoft app the engine signs in with: Havi Hub's own
// (HAVIHUB_MSA_CLIENT_ID, approved by Mojang) or the person's (Ajustes →
// Avanzado); empty = the engine's own.
// flameKey: { value, isOurs(key) } — the CurseForge API key Havi Hub uses, so
// the engine's own requests to CurseForge carry it too. It replaces only an
// empty setting or a key Havi Hub wrote before (isOurs): a key the person put
// in the engine's settings stays. Returns { flameKey } with the key now in
// the setting when Havi Hub wrote it (undefined when it was left alone).
// Havi Hub's app in Microsoft Entra, approved by Mojang for the Minecraft
// services. Microsoft's sign-in page shows its name. It is a public client ID,
// not a secret: it identifies the app, like the one built into the engine.
const HAVIHUB_MSA_CLIENT_ID = '10ba024d-897d-422d-bf41-2f818b9a1468';

async function prepareData(dataDir, { palette, language = 'es', showConsole, folders, msaClientId, flameKey } = {}) {
  await fsp.mkdir(dataDir, { recursive: true });
  const cfgPath = path.join(dataDir, 'prismlauncher.cfg');
  const cfg = await IniFile.load(cfgPath);
  const { theme, css, iconTheme } = qtTheme(palette || resolvePalette('forge'));
  const themeDir = path.join(dataDir, 'themes', THEME_ID);
  await fsp.mkdir(themeDir, { recursive: true });
  await writeJson(path.join(themeDir, 'theme.json'), theme, 4);
  await fsp.writeFile(path.join(themeDir, 'themeStyle.css'), css);

  const want = {
    Language: language,
    ApplicationTheme: THEME_ID,
    IconTheme: iconTheme,
    IgnoreJavaWizard: true,
    UserAskedAboutAutomaticJavaDownload: true,
  };
  if (folders) {
    want.InstanceDir = folders.shared ? folders.instancesDir : 'instances';
    want.IconsDir = folders.shared ? folders.iconsDir : 'icons';
  } else if (!cfg.has('InstanceDir')) want.InstanceDir = 'instances';
  if (!cfg.has('AutomaticJavaDownload')) want.AutomaticJavaDownload = true;
  if (!cfg.has('AutomaticJavaSwitch') && !cfg.get('JavaPath')) want.AutomaticJavaSwitch = true;
  if (msaClientId !== undefined) want.MSAClientIDOverride = /^[0-9a-f-]{36}$/i.test(String(msaClientId).trim()) ? String(msaClientId).trim().toLowerCase() : '';
  if (!cfg.has('ShowConsole')) want.ShowConsole = false;
  // a game that crashes is shown by Havi Hub: it opens the profile's log
  want.ShowConsoleOnError = false;
  if (showConsole !== undefined) want.ShowConsole = Boolean(showConsole);
  let flameKeyWritten;
  if (flameKey) {
    const current = String(cfg.get('FlameKeyOverride', '') || '');
    if (!current || flameKey.isOurs(current)) {
      if (current !== flameKey.value) want.FlameKeyOverride = flameKey.value;
      flameKeyWritten = flameKey.value;
    }
  }
  let changed = false;
  for (const [k, v] of Object.entries(want)) {
    if (String(cfg.get(k)) !== String(v)) {
      cfg.set(k, v);
      changed = true;
    }
  }
  // A non-empty legacy paste URL forces Prism's setup wizard
  if (cfg.has('PastebinURL') && cfg.get('PastebinURL')) {
    cfg.remove('PastebinURL');
    changed = true;
  }
  if (changed || !(await exists(cfgPath))) await cfg.save(cfgPath);
  return { flameKey: flameKeyWritten };
}

// ------------------------------------------------------------------ manager
// accounts.json is put back from the copy made before the update only when
// the current one can't be read or the newer engine changed its format: an
// account added, or a token renewed, since that copy (which can be days old if
// the update waited for the game to close) would be lost otherwise.
async function accountsNeedCopy(current, copy) {
  const now = await readJson(current, null);
  if (!now || !Array.isArray(now.accounts)) return true;
  const before = await readJson(copy, null);
  return Boolean(before && before.formatVersion !== now.formatVersion);
}

class EngineManager {
  // iconBitmap(size): Havi Hub's icon as BGRA pixels, for the engine program's own icon (Windows)
  // configFiles(): settings files worth restoring if an update has to be undone
  constructor({ dir, tasks, emit, isRunning, customExe, iconBitmap, configFiles, testedVersion = TESTED_VERSION }) {
    this.testedVersion = testedVersion;
    this.configFiles = configFiles || (() => []);
    this.dir = dir;
    this.iconBitmap = iconBitmap;
    this.tasks = tasks;
    this.emit = emit || (() => {});
    this.isRunning = isRunning || (() => false);
    this.customExe = customExe || (() => '');
    this.stateFile = path.join(dir, 'engine.json');
    this.state = { version: '', pending: '', latest: '', published: '', lastCheck: 0, previous: '', verified: '', skipVersion: '', rolledBack: null };
    this.checking = null;
    this.installing = null;
    this.progress = 0;
    this.error = '';
  }

  async load() {
    this.state = { ...this.state, ...(await readJson(this.stateFile, {})) };
    return this;
  }

  async save() {
    await fsp.mkdir(this.dir, { recursive: true });
    await writeJson(this.stateFile, this.state, 2);
  }

  versionDir(v) {
    return path.join(this.dir, 'versions', v);
  }

  exeFor(v) {
    return path.join(this.versionDir(v), exeRelPath());
  }

  supported() {
    return assetNames('x').length > 0;
  }

  status() {
    return {
      version: this.state.version || '',
      pending: this.state.pending || '',
      latest: this.state.latest || '',
      published: this.state.published || '',
      tested: this.testedVersion || '',
      lastCheck: this.state.lastCheck || 0,
      checking: Boolean(this.checking),
      installing: Boolean(this.installing),
      progress: this.progress,
      error: this.error,
      custom: this.customExe() || '',
      supported: this.supported(),
      previous: this.state.previous || '',
      rolledBack: this.state.rolledBack || null,
    };
  }

  emitStatus() {
    this.emit('engine:status', this.status());
  }

  async exe() {
    const custom = this.customExe();
    if (custom) return (await exists(custom)) ? custom : null;
    await this.activatePending();
    if (this.state.version && (await exists(this.exeFor(this.state.version)))) {
      await this.brand(this.versionDir(this.state.version));
      return this.exeFor(this.state.version);
    }
    return null;
  }

  // Havi Hub's name on the engine (engine-brand.js). An engine installed by an
  // older Havi Hub gets it here, the next time it isn't running. Never fatal.
  async brand(dir) {
    if (!this.branded) this.branded = new Set();
    if (this.branded.has(dir)) return; // checked already this session
    try {
      if (this.isRunning()) return;
      if (!(await isBranded(dir))) await brandEngine(dir, { iconBitmap: this.iconBitmap });
      this.branded.add(dir);
    } catch (e) {
      console.warn('engine brand:', e.message);
    }
  }

  async activatePending() {
    if (!this.state.pending || this.isRunning()) return;
    if (await exists(this.exeFor(this.state.pending))) {
      this.state.version = this.state.pending;
      this.state.pending = '';
      await this.save();
      await this.cleanup();
      this.emitStatus();
    }
  }

  async cleanup() {
    const keep = new Set([this.state.version, this.state.pending, this.state.previous].filter(Boolean));
    for (const ent of await listDir(path.join(this.dir, 'versions'))) {
      if (!keep.has(ent.name)) await fsp.rm(path.join(this.dir, 'versions', ent.name), { recursive: true, force: true }).catch(() => {});
    }
  }

  async latestRelease() {
    try {
      return releaseInfo(await http.getJson(API_LATEST, { headers: GH_HEADERS, timeout: 20000, retries: 1 }));
    } catch (apiError) {
      // Without the API (rate limit 403/429, or it's down): the tag from
      // github.com itself; the files are then downloaded by their direct URLs
      const tag = (await this.tagFromLatestPage().catch(() => null)) || (await this.tagFromAtom().catch(() => null));
      if (!tag) throw apiError;
      return { tag, version: tag.replace(/^v/i, ''), date: '', assets: [] };
    }
  }

  // "releases/latest" redirects to ".../releases/tag/<tag>"
  async tagFromLatestPage() {
    const res = await http.request(LATEST_PAGE, { timeout: 20000, retries: 1, redirect: 'manual', headers: { 'User-Agent': http.USER_AGENT } });
    const where = res.headers.get('location') || res.url || '';
    const m = /\/releases\/tag\/([^/?#]+)/.exec(where);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // The releases feed: the newest stable tag
  async tagFromAtom() {
    const res = await http.request(RELEASES_ATOM, { timeout: 20000, retries: 1, headers: { 'User-Agent': http.USER_AGENT, Accept: 'application/atom+xml' } });
    if (!res.ok) return null;
    const xml = await res.text();
    for (const m of xml.matchAll(/\/releases\/tag\/([^"'<>\s/?#]+)/g)) {
      const tag = decodeURIComponent(m[1]);
      if (STABLE_TAG.test(tag)) return tag;
    }
    return null;
  }

  // The release to install: the newest one, unless it is newer than the one
  // this Havi Hub was tested with; then that one (see TESTED_VERSION).
  async releaseToInstall(newest) {
    if (!this.testedVersion || compareVersions(newest.version, this.testedVersion) <= 0) return newest;
    const tag = this.testedVersion;
    try {
      return releaseInfo(await http.getJson(`${API_RELEASES}/tags/${encodeURIComponent(tag)}`, { headers: GH_HEADERS, timeout: 20000, retries: 1 }));
    } catch {
      // without the API (rate limits) its files are still at their usual addresses
      return { tag, version: tag, date: '', assets: [] };
    }
  }

  // Look for a newer Prism Launcher and install it in the background.
  check({ force = false } = {}) {
    if (this.customExe() || !this.supported()) return Promise.resolve(this.status());
    if (this.checking) return this.checking;
    if (!force && this.state.version && Date.now() - (this.state.lastCheck || 0) < RECHECK_MS) return Promise.resolve(this.status());
    this.checking = (async () => {
      this.emitStatus();
      try {
        const newest = await this.latestRelease();
        const rel = await this.releaseToInstall(newest);
        // latest: the newest one Havi Hub installs; published: the newest one there is
        this.state.latest = rel.version;
        this.state.published = newest.version;
        this.state.lastCheck = Date.now();
        this.error = '';
        await this.save();
        const current = this.state.pending || this.state.version;
        const installed = current && (await exists(this.exeFor(current)));
        // a version that failed its start check is not installed again; an
        // engine newer than the tested one (installed before that rule) is kept
        const skip = this.state.skipVersion && this.state.skipVersion === rel.version && installed;
        // an update waits until its SHA-256 can be checked (GitHub's API gives
        // it; the fallbacks without the API do not): only a first install goes
        // ahead without it
        const verifiable = (rel.assets || []).some((a) => /^sha256:[0-9a-f]{64}$/i.test(a.digest || ''));
        if (!skip && (!installed || (compareVersions(rel.version, current) > 0 && verifiable))) await this.install(rel);
      } catch (e) {
        this.error = engineErrorText(e);
      } finally {
        this.checking = null;
        this.emitStatus();
      }
      return this.status();
    })();
    return this.checking;
  }

  install(rel) {
    if (this.installing) return this.installing;
    this.installing = this.doInstall(rel).finally(() => {
      this.installing = null;
      this.progress = 0;
      this.emitStatus();
    });
    return this.installing;
  }

  async doInstall(rel) {
    const names = assetNames(rel.version);
    const listed = (rel.assets || []).find((a) => names.includes(a.name));
    const asset = listed || (names[0] ? { name: names[0], url: releaseAssetUrl(rel.tag || rel.version, names[0]) } : null);
    if (!asset) throw new UserError('No hay un motor de juego descargable para este sistema.');
    const title = tr('Motor de juego de Havi Hub {v}', { v: rel.version });
    const run = async (task) => {
      const archive = path.join(this.dir, 'downloads', asset.name);
      await http.download(asset.url, archive, {
        onProgress: (got, total) => {
          this.progress = total ? (got / total) * 0.85 : 0;
          if (task) task.progress(this.progress, total ? `${Math.round(got / 1048576)} / ${Math.round(total / 1048576)} MB` : '');
          this.emitStatus();
        },
      });
      // the file must be the one GitHub published (when GitHub gives its SHA-256)
      const want = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');
      if (want) {
        const hash = crypto.createHash('sha256');
        await pipeline(fs.createReadStream(archive), hash);
        if (hash.digest('hex') !== want[1].toLowerCase()) {
          await fsp.rm(archive, { force: true });
          throw new UserError('La descarga del motor no coincide con la huella SHA-256 que publica GitHub. Se descartó y se intentará de nuevo.');
        }
      }
      if (task) task.progress(0.88, tr('Descomprimiendo…'));
      const target = this.versionDir(rel.version);
      const tmp = `${target}.partial`;
      await fsp.rm(tmp, { recursive: true, force: true });
      await fsp.mkdir(tmp, { recursive: true });
      if (asset.name.endsWith('.tar.gz')) await extractTarGz(archive, tmp);
      else await extractPrefix(archive, '', tmp);
      // Some archives wrap everything in one folder
      let root = tmp;
      if (!(await exists(path.join(root, exeRelPath())))) {
        const ents = (await listDir(root)).filter((e) => e.isDirectory());
        if (ents.length === 1 && (await exists(path.join(root, ents[0].name, exeRelPath())))) root = path.join(root, ents[0].name);
      }
      if (!(await exists(path.join(root, exeRelPath())))) throw new UserError('El archivo descargado no contiene el motor de juego.');
      // Havi Hub handles updates: remove the engine's own updater
      for (const n of ['prismlauncher_updater.exe', 'prismlauncher_updater', path.join('bin', 'prismlauncher_updater')]) await fsp.rm(path.join(root, n), { force: true });
      if (process.platform !== 'win32') await fsp.chmod(path.join(root, exeRelPath()), 0o755).catch(() => {});
      if (task) task.progress(0.94, tr('Preparando…'));
      // Havi Hub's name on its windows and pages (engine-brand.js)
      await brandEngine(root, { iconBitmap: this.iconBitmap }).catch((e) => console.warn('engine brand:', e.message));
      await writeIntegrity(root);
      // the working engine and its settings, to go back to if this one fails
      await this.snapshot();
      await fsp.rm(target, { recursive: true, force: true });
      if (root === tmp) await renameRetry(tmp, target);
      else {
        await renameRetry(root, target);
        await fsp.rm(tmp, { recursive: true, force: true });
      }
      await fsp.rm(archive, { force: true });
      if (this.isRunning() && this.state.version) this.state.pending = rel.version;
      else {
        this.state.version = rel.version;
        this.state.pending = '';
      }
      await this.save();
      await this.cleanup();
    };
    if (this.tasks) await this.tasks.run(title, { kind: 'engine' }, run);
    else await run(null);
  }

  // ---------- snapshot and rollback ----------
  snapshotDir() {
    return path.join(this.dir, 'snapshot');
  }

  // Before switching to a new engine: keep the current one (not removed by
  // cleanup) and copy its settings files.
  async snapshot() {
    const v = this.state.version;
    if (!v || !(await exists(this.exeFor(v)))) return null;
    if (!(await this.checkVersion(v, { probe: false })).ok) return null; // never snapshot a broken engine
    const dir = this.snapshotDir();
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    const files = [];
    let i = 0;
    for (const from of [this.stateFile, ...(this.configFiles() || [])]) {
      if (!from || !(await exists(from))) continue;
      const name = `${i++}-${path.basename(from)}`;
      await fsp.copyFile(from, path.join(dir, name));
      files.push({ from, name });
    }
    if (!(await exists(path.join(this.versionDir(v), INTEGRITY)))) await writeIntegrity(this.versionDir(v)).catch(() => {});
    await writeJson(path.join(dir, 'snapshot.json'), { version: v, at: Date.now(), files }, 2);
    this.state.previous = v;
    return v;
  }

  // Integrity (every file the install wrote, same size) and, once per new
  // version, that the program can actually be started.
  async checkVersion(v, { probe = true } = {}) {
    const dir = this.versionDir(v);
    const exe = this.exeFor(v);
    const st = await fsp.stat(exe).catch(() => null);
    if (!st || !st.isFile() || st.size < 1024) return { ok: false, reason: 'missing' };
    const manifest = await readJson(path.join(dir, INTEGRITY), null);
    if (manifest && manifest.files) {
      for (const [rel, size] of Object.entries(manifest.files)) {
        const fst = await fsp.stat(path.join(dir, rel)).catch(() => null);
        if (!fst || fst.size !== size) return { ok: false, reason: 'corrupt', file: rel };
      }
    }
    if (probe && this.state.verified !== v && !this.isRunning()) {
      const r = await probeStart(exe);
      if (!r.ok) return { ok: false, reason: 'start', detail: r.detail };
    }
    return { ok: true };
  }

  // On every Havi Hub start: if the active engine is damaged or doesn't start,
  // go back to the snapshot taken before the update (and say so).
  async verifyOnStart() {
    if (this.customExe() || !this.state.version || this.isRunning()) return null;
    const v = this.state.version;
    const res = await this.checkVersion(v).catch((e) => ({ ok: false, reason: 'start', detail: e.message }));
    if (res.ok) {
      if (this.state.verified !== v) {
        this.state.verified = v;
        await this.save();
      }
      return null;
    }
    return this.rollback(v, res);
  }

  async rollback(failed, res) {
    const snap = await readJson(path.join(this.snapshotDir(), 'snapshot.json'), null);
    const prev = (snap && snap.version) || this.state.previous;
    const usable = prev && prev !== failed && (await this.checkVersion(prev, { probe: false })).ok;
    const why = res.reason === 'start' ? 'no arranca' : res.reason === 'corrupt' ? 'tiene archivos dañados' : 'no está completo';
    if (usable) {
      for (const f of (snap && snap.files) || []) {
        if (f.from === this.stateFile) continue;
        const copy = path.join(this.snapshotDir(), f.name);
        if (path.basename(f.from) === 'accounts.json' && !(await accountsNeedCopy(f.from, copy))) continue;
        await fsp.copyFile(copy, f.from).catch(() => {});
      }
      this.state.version = prev;
      this.state.pending = '';
      this.state.previous = '';
      this.state.verified = prev;
      // an engine that doesn't start isn't downloaded again until a newer one is out
      this.state.skipVersion = res.reason === 'start' ? failed : '';
      this.state.rolledBack = { from: failed, to: prev, reason: res.reason, at: Date.now() };
      await this.save();
      await fsp.rm(this.versionDir(failed), { recursive: true, force: true }).catch(() => {});
      this.emit('toast', { type: 'warning', message: 'El motor de juego {from} {why}: Havi Hub volvió a la versión anterior ({to}) y restauró su configuración.', vars: { from: failed, to: prev, why } });
    } else {
      // nothing to go back to: download it again
      this.state.version = '';
      this.state.verified = '';
      this.state.rolledBack = { from: failed, to: '', reason: res.reason, at: Date.now() };
      await this.save();
      await fsp.rm(this.versionDir(failed), { recursive: true, force: true }).catch(() => {});
      this.emit('toast', { type: 'warning', message: 'El motor de juego {from} {why}: se descargará de nuevo.', vars: { from: failed, why } });
    }
    this.emitStatus();
    return this.state.rolledBack;
  }

  // The engine executable, installing it first if needed.
  async ensure() {
    let exe = await this.exe();
    if (exe) return exe;
    if (this.customExe()) throw Object.assign(new UserError('No se encontró el motor personalizado configurado en Ajustes → Avanzado.'), { code: 'NO_ENGINE' });
    await this.check({ force: true });
    if (this.installing) await this.installing.catch(() => {});
    exe = await this.exe();
    if (!exe) throw Object.assign(new Error(this.error ? `No se pudo descargar el motor: ${this.error}` : 'No se pudo preparar el motor de Havi Hub.'), { code: 'NO_ENGINE' });
    return exe;
  }
}

// ------------------------------------------------------------ integrity
const INTEGRITY = '.havihub-integrity.json';
const NOT_TRACKED = new Set([INTEGRITY, 'havihub-brand.json']);

async function fileSizes(root) {
  const out = {};
  const walk = async (dir, rel) => {
    for (const ent of await listDir(dir)) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (!rel && NOT_TRACKED.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full, r);
      else if (ent.isFile()) out[r] = (await fsp.stat(full)).size;
    }
  };
  await walk(root, '');
  return out;
}

async function writeIntegrity(dir) {
  await writeJson(path.join(dir, INTEGRITY), { files: await fileSizes(dir) }, 0);
}

// Starts the engine with --version: a program that can't be executed at all
// (damaged, wrong format, blocked) fails right away. A window system
// missing, a slow start or the antivirus holding it count as started.
function probeStart(exe, timeout = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    let child;
    try {
      child = spawn(exe, ['--version'], { stdio: 'ignore', windowsHide: true, env: { ...process.env, QT_QPA_PLATFORM: process.platform === 'linux' ? 'offscreen' : process.env.QT_QPA_PLATFORM || '' } });
    } catch (e) {
      finish({ ok: false, detail: e.message });
      return;
    }
    child.on('error', (e) => finish({ ok: false, detail: e.code || e.message }));
    child.on('exit', (code, signal) => {
      const crashed = ['SIGSEGV', 'SIGILL', 'SIGBUS'].includes(signal) || (process.platform === 'win32' && code !== null && code >= 0xc0000000);
      finish(crashed ? { ok: false, detail: signal || `0x${code.toString(16)}` } : { ok: true });
    });
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
      finish({ ok: true });
    }, timeout).unref();
  });
}

// ------------------------------------------------------------------ sign-in
// Microsoft sign-in through the engine, in a temporary folder with no
// accounts: the engine then shows only its sign-in page. The new account is
// copied into Havi Hub's accounts.json and the engine is closed.
function startLogin({ exe, dataFile, prepare, onDone, onSpawn }) {
  let child = null;
  let finished = false;
  let timer = null;
  let poll = null;
  let tmp = null;

  const finish = async (result) => {
    if (finished) return;
    finished = true;
    clearInterval(poll);
    clearTimeout(timer);
    if (child && child.exitCode === null) killTree(child.pid);
    setTimeout(() => tmp && fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}), 1500);
    onDone(result);
  };

  (async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'havihub-login-'));
    await prepare(tmp);
    const inst = path.join(tmp, 'instances', '__havihub_login__');
    await fsp.mkdir(inst, { recursive: true });
    await fsp.writeFile(path.join(inst, 'instance.cfg'), '[General]\r\nConfigVersion=1.3\r\nInstanceType=OneSix\r\nname=Havi Hub\r\n');
    // --profile with an unknown name: after sign-in the engine starts nothing
    // and opens no window, so only Microsoft's sign-in is ever shown.
    child = spawn(exe, ['--dir', tmp, '--launch', '__havihub_login__', '--profile', '__havihub__'], { cwd: tmp, detached: process.platform !== 'win32', stdio: 'ignore' });
    if (onSpawn) onSpawn(exe);
    child.on('error', (e) => finish({ error: String(e.message || e) }));
    child.on('exit', () => setTimeout(() => finish({ cancelled: true }), 1200));
    const accountsFile = path.join(tmp, 'accounts.json');
    const logFile = path.join(tmp, 'logs', 'PrismLauncher-0.log');
    let wizardClosedAt = 0;
    poll = setInterval(async () => {
      try {
        const data = parseLenientJson(await fsp.readFile(accountsFile, 'utf8'));
        const found = (data.accounts || []).filter((a) => a.type === 'MSA' && a.profile && a.profile.id && a.ygg && a.ygg.token);
        if (found.length) {
          await mergeAccounts(dataFile, found);
          finish({ added: found.map((a) => a.profile.name) });
          return;
        }
      } catch {
        /* not written yet */
      }
      // The sign-in page was closed without an account: the engine logs that
      // it moves on to "launching" (and then idles), so close it.
      if (!wizardClosedAt) {
        const log = await fsp.readFile(logFile, 'utf8').catch(() => '');
        if (log.includes('__havihub_login__" launching') || log.includes('Setup wizard was not completed')) wizardClosedAt = Date.now();
      } else if (Date.now() - wizardClosedAt > 2500) finish({ cancelled: true });
    }, 800);
    timer = setTimeout(() => finish({ cancelled: true, timeout: true }), 20 * 60 * 1000);
  })().catch((e) => finish({ error: String(e.message || e) }));

  return { cancel: () => finish({ cancelled: true }) };
}

// Add/replace accounts (by profile id) without touching the others.
async function mergeAccounts(file, incoming) {
  let data = { formatVersion: 3, accounts: [] };
  if (await exists(file)) {
    data = parseLenientJson(await fsp.readFile(file, 'utf8'));
    if (!data || !Array.isArray(data.accounts)) throw new UserError('accounts.json tiene un formato inesperado; no se modificó.');
  }
  const hasActive = data.accounts.some((a) => a.active);
  for (const acc of incoming) {
    const copy = { ...acc };
    delete copy.active;
    const i = data.accounts.findIndex((a) => a.profile && acc.profile && a.profile.id === acc.profile.id);
    if (i >= 0) {
      if (data.accounts[i].active) copy.active = true;
      data.accounts[i] = copy;
    } else data.accounts.push(copy);
  }
  if (!hasActive && data.accounts.length) {
    const first = data.accounts.find((a) => incoming.some((n) => n.profile && a.profile && n.profile.id === a.profile.id)) || data.accounts[0];
    first.active = true;
  }
  if (!data.formatVersion) data.formatVersion = 3;
  await writeJson(file, data, 4);
  return data;
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
}

module.exports = { TESTED_VERSION, engineErrorText, probeStart, fileSizes, writeIntegrity, EngineManager, prepareData, HAVIHUB_MSA_CLIENT_ID, qtTheme, engineLanguage, compareVersions, assetNames, exeRelPath, startLogin, mergeAccounts, killTree, THEME_ID };
