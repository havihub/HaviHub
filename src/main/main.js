// Havi Hub - Electron main process.
const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, clipboard, nativeImage, screen, session, Tray, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');

const { AppConfig } = require('./appconfig');
const { PrismContext } = require('./prism/paths');
const { Instances, gameDirOf } = require('./prism/instances');
const groups = require('./prism/groups');
const { Content, readMetadata } = require('./prism/content');
const { resolveInside } = require('./util/safepath');
const { Worlds } = require('./prism/worlds');
const { Logs, Screenshots } = require('./prism/logs');
const { Accounts, fetchPlayerSkin } = require('./prism/accounts');
const { Skins } = require('./prism/skins');
const { Launcher } = require('./prism/launch');
const { createDesktopShortcut, installUserMenuEntry, removeUserMenuEntry, userMenuEntryState, installSystemMenuEntry, repairLinuxShortcuts } = require('./prism/shortcuts');
const { TaskManager } = require('./tasks');
const { Platforms } = require('./platforms/unified');
const { Modpacks } = require('./platforms/modpacks');
const { Meta } = require('./platforms/meta');
const { modrinth } = require('./platforms/modrinth');
const { setKeyProvider } = require('./platforms/curseforge');
const { IniFile } = require('./util/ini');
const http = require('./util/http');
const { hashFile } = require('./util/hash');
const { findJavas } = require('./java');
const { JavaInstaller } = require('./javainstall');
const { pathFromUrl } = require('./urls');
const { Thumbs } = require('./thumbs');
const { SyncManager } = require('./sync');
const { McSounds } = require('./mcsounds');
const serverDirectory = require('./platforms/servers');
const serverPing = require('./serverping');
const { isInside, exists, safeName } = require('./util/fsx');
const { EngineManager, prepareData, engineLanguage, startLogin, HAVIHUB_MSA_CLIENT_ID } = require('./engine');
const { startLoginPage } = require('./loginpage');
const { BlockedDownloads } = require('./platforms/blocked');
const social = require('./social');
const { socialFeed } = social;
const { isSocialEmbed, SOCIALS } = require('../shared/socials');
const { McAssets } = require('./mcassets');
const { CF_BUILD_KEY } = require('./buildinfo');
const { Importer } = require('./importer');
const { cleanEnv } = require('../shared/envvars');
const { migrateLegacyFolders, relinkSynced, inUseOnLinux, repairShortcuts, DIR_NAME, LEGACY_NAMES } = require('./migrate');
const { Sharing } = require('./sharing');
const { startWindowHelper } = require('./winhelper');
const { resolvePalette } = require('../shared/themes.js');
const { LIMITS, cleanText } = require('../shared/limits.js');
const { UserError, tr, textOf } = require('../shared/usertext');

protocol.registerSchemesAsPrivileged([
  // codeCache: the page's compiled code is kept between starts, so later starts skip that work
  { scheme: 'havihub', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true } },
]);

const isDev = process.argv.includes('--dev');
const APP_REFERER = 'https://havihub.github.io/'; // the app's identifier (build.appId, io.github.havihub), as an address
// Linux: Electron turns Vulkan on, but Chromium's native Wayland backend can't
// draw with it ("'--ozone-platform=wayland' is not compatible with Vulkan") and
// some NVIDIA drivers crash with it. OpenGL works on Wayland and X11 alike.
// (Chromium also reaches Vulkan through ANGLE, hence the other two names: with only
// 'Vulkan' off, the message above still showed on Wayland.)
if (process.platform === 'linux') app.commandLine.appendSwitch('disable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE');
// Less memory and background work: none of what Chromium does on its own for a
// web browser (component updates, sync, default apps, pings), a modest disk
// cache and a ceiling for each page's JavaScript memory
for (const sw of ['disable-background-networking', 'disable-component-update', 'disable-default-apps', 'disable-sync', 'disable-breakpad', 'no-pings']) app.commandLine.appendSwitch(sw);
app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024));
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=768');
// Same ID as the installer's Start menu shortcut, so Windows groups and pins the window under it
const APP_ID = 'io.github.havihub';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
// eslint-disable-next-line no-undef
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : app.getVersion();
const RENDERER_DIR = path.join(__dirname, 'renderer');

// Every folder of Havi Hub is called "havihub" (Electron's own choice would be
// the product name, "Havi Hub"): %APPDATA%\havihub, ~/.config/havihub.
// HAVIHUB_USER_DATA is a development/test hook (never set in normal use).
if (process.env.HAVIHUB_USER_DATA) app.setPath('userData', process.env.HAVIHUB_USER_DATA);
else app.setPath('userData', path.join(app.getPath('appData'), DIR_NAME));
// Folders with an older name ("Havi Hub", "havi-hub") are moved on the first start.
// If a game or an old copy still uses them, keep using the old ones until the next start.
const legacyRoots = process.env.HAVIHUB_USER_DATA ? [] : LEGACY_NAMES.map((n) => path.join(app.getPath('appData'), n));
const legacy = process.env.HAVIHUB_USER_DATA
  ? { userData: null, localDir: null, moved: [], from: [] }
  : migrateLegacyFolders({
      appData: app.getPath('appData'),
      userData: app.getPath('userData'),
      localAppData: process.platform === 'win32' ? process.env.LOCALAPPDATA : '',
      busy: process.platform === 'linux' ? (dir) => inUseOnLinux(dir) : undefined,
    });
if (legacy.userData) app.setPath('userData', legacy.userData);
// links of synced profiles that still point into an old folder (another launcher was open during the move)
else if (legacyRoots.length) relinkSynced(app.getPath('userData'), legacyRoots);
if (process.env.HAVIHUB_MOCK_NET) {
  // eslint-disable-next-line import/no-dynamic-require
  http.setFetch(require(process.env.HAVIHUB_MOCK_NET).fetch);
}

let win = null;
let config;
let ctx = null; // PrismContext for Havi Hub's own data folder
let services = null;
let engine = null;
let prismCfgKey = ''; // FlameKeyOverride from the engine's settings, when the person put it there
let allowedRoots = [];
let thumbs = null; // screenshot previews (thumbs.js)
let mcSounds = null; // the game's own sounds for the seasonal effects
const pings = new Map(); // address -> { at, job } (a minute of cache)
let pingRunning = 0;
const pingWaiting = [];
async function pingServer(address) {
  const key = String(address || '').toLowerCase();
  const hit = pings.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.job;
  const job = (async () => {
    if (pingRunning >= 8) await new Promise((r) => pingWaiting.push(r));
    pingRunning++;
    try {
      const mock = process.env.HAVIHUB_MOCK_NET ? require(process.env.HAVIHUB_MOCK_NET) : null;
      if (mock && mock.ping) return await mock.ping(address);
      return await serverPing.ping(address);
    } finally {
      pingRunning--;
      const next = pingWaiting.shift();
      if (next) next();
    }
  })();
  pings.set(key, { at: Date.now(), job });
  job.catch(() => pings.delete(key));
  return job;
}
// tests can move the app's clock (seasonal themes): HAVIHUB_FAKE_DATE=2026-12-31T23:59:50
const CLOCK_OFFSET = process.env.HAVIHUB_FAKE_DATE && Number.isFinite(Date.parse(process.env.HAVIHUB_FAKE_DATE)) ? Date.parse(process.env.HAVIHUB_FAKE_DATE) - Date.now() : 0;
const extraRoots = new Set(); // import sources the renderer may show images from
function allowRoots(roots) {
  for (const r of roots || []) {
    if (!r || extraRoots.has(r)) continue;
    extraRoots.add(r);
    allowedRoots.push(r);
  }
}
const watchers = [];
let login = null;
let sharing = null; // profiles shared with Prism Launcher
// Interface size: 100% matches CurseForge (whose layout is 0.8x this app's CSS px)
const BASE_ZOOM = 0.8;

function defaultDataDir() {
  return path.join(app.getPath('userData'), 'launcher');
}

function engineDir() {
  if (process.env.HAVIHUB_ENGINE_DIR) return process.env.HAVIHUB_ENGINE_DIR;
  if (legacy.localDir) return path.join(legacy.localDir, 'engine');
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, DIR_NAME, 'engine');
  return path.join(app.getPath('userData'), 'engine');
}

// Engine windows titled "Havi Hub" with Havi Hub's icon (Windows only)
function watchEngineWindows(exe) {
  startWindowHelper({
    engineDir: engineDir(),
    exe,
    appId: APP_ID,
    title: 'Havi Hub',
    resourcesDir: app.isPackaged ? process.resourcesPath : null,
    devRoot: app.isPackaged ? null : path.join(__dirname, '..'),
    logFile: process.env.HAVIHUB_WINDOWS_LOG || '',
  });
}

// How this copy runs: 'installed' (Setup.exe), 'portable', 'unpacked' (zip) or 'dev'
function installKind() {
  if (!app.isPackaged) return 'dev';
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  if (process.platform === 'win32' && fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`))) return 'installed';
  return 'unpacked';
}

function systemLocale() {
  return (app.getPreferredSystemLanguages && app.getPreferredSystemLanguages()[0]) || app.getLocale();
}

// A short fingerprint of a CurseForge key: what config.json keeps of the key
// Havi Hub last wrote into the engine's settings (the key itself is not kept)
const keyMark = (key) => (key ? crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 16) : '');

// the Microsoft app the engine signs in with: the person's own, if they set
// one in Ajustes → Avanzado, or Havi Hub's
function msaClientIdNow() {
  return (config && config.get().msaClientId) || HAVIHUB_MSA_CLIENT_ID;
}

let preparedKey = '';
async function prepareEngineData(dir) {
  const c = config.get();
  const folders = sharing ? await sharing.activeDirs() : null;
  // the engine's own requests to CurseForge carry the same key as Havi Hub's
  const flameKey = { value: c.curseforgeApiKey || CF_BUILD_KEY || '', isOurs: (k) => keyMark(k) === (c.engineCfKeyMark || '') };
  const target = dir || ctx.dataDir;
  const cfgFile = path.join(target, 'prismlauncher.cfg');
  const mtime = async () => (await fsp.stat(cfgFile).catch(() => ({ mtimeMs: 0 }))).mtimeMs;
  const key = JSON.stringify([target, c.themePreset, c.palette, c.language, folders, msaClientIdNow(), keyMark(flameKey.value)]);
  if (!dir && preparedKey && preparedKey === `${key}|${await mtime()}`) return; // nothing changed since the last game
  const r = await prepareData(dir || ctx.dataDir, { palette: resolvePalette(c.themePreset, c.palette), language: engineLanguage(c.language, systemLocale()), folders, msaClientId: msaClientIdNow(), flameKey });
  if (r && r.flameKey !== undefined && keyMark(r.flameKey) !== (c.engineCfKeyMark || '')) await config.update({ engineCfKeyMark: keyMark(r.flameKey) });
  if (!dir) preparedKey = `${key}|${await mtime()}`;
}

function emit(channel, payloadIn) {
  const payload = channel === 'config:changed' && config ? config.snapshot() : payloadIn;
  if (channel === 'instance:running' && payload && payload.running === false) setTimeout(payload.crash || payload.failed ? bringToFront : restoreAfterGame, 400);
  // a first game may just have been downloaded: its textures can be used now
  if (channel === 'instance:running' && mcAssets && !mcAssets.lastKey) mcAssets.recheck().catch(() => {});
  if (!rendererReady) {
    // the window is asleep (or just waking up): keep what its page must still
    // hear about (a game that closed or crashed, a request to open something)
    const keep = channel === 'app:launch-request' || (channel === 'instance:running' && payload && payload.running === false);
    if (keep) {
      heldEvents.push([channel, payload]);
      if (heldEvents.length > 50) heldEvents.shift();
    }
    return;
  }
  if (win && !win.isDestroyed()) win.webContents.send('event', channel, payload);
}

// ------------------------------------------------------------------ sleep
// Hidden in the tray (while playing, or after the X) the window is not needed:
// after a minute it is put away completely, which gives its memory back to the
// game. Clicking the tray icon, or the game closing, builds it again on the
// page it was on. Downloads, the game and everything else live in this (main)
// process and keep going. Never while something is downloading or a dialog is
// open; can be turned off in Settings.
let asleep = null; // { bounds, maximized } while the window is put away
let sleepTimer = null;
let rendererReady = true;
let heldEvents = [];
const SLEEP_MS = Number(process.env.HAVIHUB_SLEEP_MS) || 60000;

function cancelSleep() {
  clearTimeout(sleepTimer);
  sleepTimer = null;
}

function scheduleSleep() {
  cancelSleep();
  if (!config || config.get().sleepInTray === false) return;
  sleepTimer = setTimeout(() => trySleep().catch(() => {}), SLEEP_MS);
}

async function trySleep() {
  sleepTimer = null;
  const gone = () => asleep || quitting || !tray || !win || win.isDestroyed() || win.isVisible();
  if (gone()) return;
  const busy = (services && services.tasks && services.tasks.running().length > 0) || BrowserWindow.getAllWindows().length > 1;
  let ok = !busy;
  if (ok) {
    ok = await Promise.race([
      win.webContents.executeJavaScript('window.__havihubCanSleep ? window.__havihubCanSleep() : false', true).catch(() => false),
      new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
  }
  if (gone()) return;
  if (!ok) return scheduleSleep();
  // nobody is reading a log any more
  const logs = services && services.logs;
  if (logs && logs.watchers) for (const id of [...logs.watchers.keys()]) logs.unwatch(id);
  asleep = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
  rendererReady = false;
  heldEvents = [];
  const old = win;
  win = null;
  old.destroy();
}

function wake() {
  if (!asleep) return false;
  const state = asleep;
  asleep = null;
  createWindow(state);
  return true;
}

// tests only: say something to the page the way the services do
if (process.env.HAVIHUB_MOCK_NET) process.on('havihub-test-emit', (channel, payload) => emit(channel, payload));

function pageReady() {
  if (rendererReady) return;
  rendererReady = true;
  const held = heldEvents;
  heldEvents = [];
  for (const [channel, payload] of held) if (win && !win.isDestroyed()) win.webContents.send('event', channel, payload);
}

// ------------------------------------------------------------------ tray
// "Minimize to the tray while the game is open": the window leaves the taskbar
// and Alt+Tab; an icon next to the clock brings it back. It comes back by
// itself when the last game closes.
let tray = null;
let hiddenForGame = false;
let quitting = false; // true once the user really quits (tray menu, update, etc.)

function uiSpanish() {
  return engineLanguage(config ? config.get().language : '', systemLocale()) === 'es';
}

function showWindow() {
  hiddenForGame = false;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  cancelSleep();
  if (wake()) return; // it shows itself as soon as its page is ready
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

// reason: 'game' (comes back when the game closes) or 'close' (the window's X)
function hideToTray({ gameName = '', reason = 'game' } = {}) {
  if (!win || win.isDestroyed()) return;
  const es = uiSpanish();
  if (!tray) {
    const icon = path.join(RENDERER_DIR, 'static', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
    tray = new Tray(nativeImage.createFromPath(icon));
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: es ? 'Abrir Havi Hub' : 'Open Havi Hub', click: showWindow },
        { type: 'separator' },
        { label: es ? 'Salir de Havi Hub' : 'Quit Havi Hub', click: () => quitApp() },
      ]),
    );
  }
  tray.setToolTip(gameName ? (es ? `Havi Hub: jugando ${gameName}` : `Havi Hub: playing ${gameName}`) : 'Havi Hub');
  if (reason === 'game') hiddenForGame = true;
  win.hide();
  scheduleSleep();
  // the first time the X hides it, say where it went
  if (reason === 'close' && process.platform === 'win32' && config && !config.get().trayHintShown) {
    try {
      tray.displayBalloon({
        iconType: 'info',
        title: 'Havi Hub',
        content: es ? 'Havi Hub sigue abierto aquí. Haz clic en el ícono para volver, o clic derecho y "Salir".' : 'Havi Hub is still running here. Click the icon to come back, or right-click and "Quit".',
      });
    } catch {
      /* balloons are optional */
    }
    config.update({ trayHintShown: true }).catch(() => {});
  }
}

// force: skip the "tasks are running" question (already answered)
function quitApp(force = false) {
  if (!force && askBeforeClosing()) return;
  quitting = true;
  app.quit();
}

// Closing while something is downloading, importing or installing: ask first.
// The renderer shows the question; its answer comes back as 'app.closeChoice'.
let closeAsked = false;
function askBeforeClosing() {
  const tasks = services && services.tasks ? services.tasks.running() : [];
  if (!tasks.length || !win || win.isDestroyed()) return false;
  showWindow();
  if (!closeAsked) {
    closeAsked = true;
    emit('app:close-request', {
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, progress: t.progress, detail: t.detail, cancelable: t.cancelable })),
      tray: Boolean(config && config.get().closeToTray === true),
    });
    // if the window can't answer (it crashed), ask again next time
    setTimeout(() => {
      closeAsked = false;
    }, 60000).unref();
  }
  return true;
}

// A game that crashed (or could not start) brings Havi Hub to the front, even
// from the tray or minimized; its page then opens the log
function bringToFront() {
  showWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  // Windows won't let a window in the background take the focus by itself
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();
  win.moveTop();
  setTimeout(() => win && !win.isDestroyed() && win.setAlwaysOnTop(false), 600);
}

function restoreAfterGame() {
  if (!hiddenForGame) return;
  const running = services && services.launcher ? services.launcher.runningIds() : [];
  if (!running.length) showWindow();
}

// ------------------------------------------------------------------ services
async function initPrism() {
  const cfg = config.get();
  const dataDir = cfg.dataDir || defaultDataDir();
  await fsp.mkdir(path.join(dataDir, 'instances'), { recursive: true });
  const tasks = services ? services.tasks : new TaskManager(emit);
  if (!sharing) {
    sharing = new Sharing({
      dataDir: () => config.get().dataDir || defaultDataDir(),
      appConfig: config,
      tasks,
      isRunning: (id) => Boolean(services && services.launcher && services.launcher.isRunning(id)),
    });
  }
  ctx = new PrismContext(dataDir, null);
  await prepareEngineData(dataDir).catch((e) => console.error('engine data', e));

  if (!engine) {
    engine = new EngineManager({
      dir: engineDir(),
      tasks,
      emit,
      isRunning: () => Boolean(services && services.launcher && services.launcher.anyEngineRunning()),
      customExe: () => config.get().engineExe || process.env.HAVIHUB_PRISM_EXE || '',
      iconBitmap: appIconBitmap,
      configFiles: () => [path.join(dataDir, 'prismlauncher.cfg'), path.join(dataDir, 'accounts.json')],
    });
    await engine.load();
    // integrity and start check; goes back to the pre-update snapshot if it fails
    await engine.verifyOnStart().catch((e) => console.error('engine verify', e));
  }
  const javaInstaller = new JavaInstaller({ dir: path.join(app.getPath('userData'), 'java'), tasks, prismJavaDir: async () => (ctx ? (await ctx.dirs()).javaDir : null) });
  const instances = new Instances(ctx, config);
  const content = new Content(instances, path.join(app.getPath('userData'), 'cache'));
  const platforms = new Platforms({ instances, content, tasks, appConfig: config, emit });
  services = {
    tasks,
    instances,
    content,
    platforms,
    worlds: new Worlds(instances),
    logs: new Logs(instances, emit),
    screenshots: new Screenshots(instances),
    accounts: new Accounts(ctx, { msaClientId: msaClientIdNow }),
    skins: new Skins(ctx),
    launcher: services && services.launcher ? services.launcher : new Launcher(() => ctx, emit, {
          engine,
          prepare: () => prepareEngineData(),
          gameDir: async (id) => gameDirOf(await need('instances').locate(id)),
          onEngineStart: watchEngineWindows,
          ensureJava: async (id) => {
            if (config.get().autoJava === false) return null;
            const inst = await need('instances').get(id);
            const cfg = await IniFile.load(path.join(inst.root, 'instance.cfg'));
            return javaInstaller.ensureFor(cfg, inst.mcVersion);
          },
        }),
    modpacks: new Modpacks({ ctxProvider: () => ctx, instances, tasks, appConfig: config, emit }),
    meta: new Meta(path.join(app.getPath('userData'), 'cache'), () => metaUrl),
    importer: new Importer({ ctxProvider: () => ctx, appConfig: config, tasks, emit, allowRoot: allowRoots }),
  };
  services.sync = new SyncManager({
    appConfig: config,
    tasks,
    ctxProvider: () => ctx,
    importer: services.importer,
    emit,
    isRunning: (id) => Boolean(services && services.launcher && services.launcher.isRunning(id)),
    allowRoot: allowRoots,
  });
  services.sync.check().catch(() => {});
  if (services.launcher) services.launcher.ctxProvider = () => ctx;
  await refreshPrismCfgCache();
  await setupWatchers();
}

let metaUrl = '';
async function refreshPrismCfgCache() {
  if (!ctx) return;
  try {
    const cfg = await ctx.loadCfg();
    // the key in the engine's settings counts as the person's own unless Havi Hub wrote it there
    const engineKey = cfg.get('FlameKeyOverride', '') || '';
    prismCfgKey = engineKey && keyMark(engineKey) !== (config.get().engineCfKeyMark || '') ? engineKey : '';
    metaUrl = cfg.get('MetaURLOverride', '') || '';
    const d = await ctx.dirs();
    allowedRoots = [ctx.dataDir, ...d.instanceDirs, d.iconsDir, d.skinsDir, path.join(app.getPath('userData'), 'cache'), RENDERER_DIR];
  } catch {
    allowedRoots = [ctx.dataDir, path.join(app.getPath('userData'), 'cache'), RENDERER_DIR];
  }
  allowedRoots.push(...extraRoots);
}

// CurseForge's API key: the person's own (Ajustes → Addons), one they put in
// the engine's settings, or the one Havi Hub is built with
function curseforgeKey() {
  return (config && config.get().curseforgeApiKey) || prismCfgKey || CF_BUILD_KEY || '';
}
function curseforgeKeySource() {
  if (config && config.get().curseforgeApiKey) return 'app';
  if (prismCfgKey) return 'prism';
  return CF_BUILD_KEY ? 'builtin' : '';
}
setKeyProvider(curseforgeKey);
// CurseForge's file servers (edge/mediafilez.forgecdn.net) want the API key with each download
// (required since July 16, 2026). It is sent to them only.
const isForgeCdn = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)forgecdn\.net$/i.test(u.hostname);
  } catch {
    return false;
  }
};
http.setHostRules({
  headers: (url) => {
    const key = isForgeCdn(url) ? curseforgeKey() : '';
    return key ? { 'x-api-key': key } : null;
  },
  explain: (status, url) =>
    (status === 401 || status === 403) && isForgeCdn(url)
      ? Object.assign(new UserError('CurseForge no aceptó la descarga: falta su API key o no es válida. Revísala en Ajustes → Addons.'), { code: 'CF_KEY' })
      : null,
});

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

async function setupWatchers() {
  for (const w of watchers.splice(0)) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  if (!ctx) return;
  const changed = debounce(() => emit('instances:changed', {}), 400);
  const accountsChanged = debounce(() => emit('accounts:changed', {}), 300);
  const watch = (p, cb) => {
    try {
      watchers.push(fs.watch(p, { persistent: false }, cb));
    } catch {
      /* missing folder */
    }
  };
  const d = await ctx.dirs();
  for (const dir of d.instanceDirs) {
    watch(dir, changed);
    try {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) if (ent.isDirectory()) watch(path.join(dir, ent.name), (ev, f) => {
        if (!f || /instance\.cfg|mmc-pack\.json/.test(f)) changed();
      });
    } catch {
      /* ignore */
    }
  }
  watch(d.iconsDir, changed);
  watch(ctx.dataDir, (ev, f) => {
    if (f === 'instgroups.json') changed();
    if (f === 'accounts.json') accountsChanged();
    if (f && f.endsWith('.cfg')) refreshPrismCfgCache();
  });
  watch(d.skinsDir, debounce(() => emit('skins:changed', {}), 300));
}

function need(name) {
  if (!services || !services[name]) {
    const e = new UserError('La carpeta de datos de Havi Hub no está disponible. Revisa Ajustes → Avanzado.');
    e.code = 'NO_DATA';
    throw e;
  }
  return services[name];
}

const trash = (p) => shell.trashItem(p);

async function pickFiles(opts = {}) {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', ...(opts.multi ? ['multiSelections'] : [])],
    filters: opts.filters,
    title: opts.title,
  });
  return r.canceled ? [] : r.filePaths;
}

// a PNG as raw pixels (to tell whether two skins are the same picture)
function decodePng(buf) {
  try {
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    return { width, height, data: img.toBitmap() };
  } catch {
    return null;
  }
}

function toBuffer(bytes) {
  if (!bytes) return null;
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (typeof bytes === 'string' && bytes.startsWith('data:')) return Buffer.from(bytes.split(',')[1], 'base64');
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  return Buffer.from(bytes);
}

// ------------------------------------------------------------------ API
// Havikun's channels on the Home page load on their own only once the person
// said so: the first-start welcome asks (or, for someone updating, a dialog;
// App.jsx), and Ajustes → Privacidad changes it. Until that answer, nothing
// connects to them.
const OPENABLE_FILE = /\.(png|jpe?g|gif|webp|bmp)$/i;

function socialAutoload() {
  const p = config && config.get().privacy;
  return Boolean(p && p.socialAsked === true && p.socialAutoload !== false);
}

const api = {
  // ---- app ----
  'app.state': async () => ({
    config: config.snapshot(),
    prism: ctx ? { dataDir: ctx.dataDir, ok: true, defaultDataDir: defaultDataDir() } : { dataDir: '', ok: false, defaultDataDir: defaultDataDir() },
    engine: engine ? engine.status() : null,
    sharing: sharing ? await sharing.status().catch(() => null) : null,
    platform: process.platform,
    version: APP_VERSION,
    installKind: installKind(),
    locale: systemLocale(),
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    cfKeySource: curseforgeKeySource(),
    cfBuiltin: Boolean(CF_BUILD_KEY),
    clockOffset: CLOCK_OFFSET,
  }),
  // a sound of the game (fireworks, the scare), or null if it is not on this computer
  'season.sound': async (name) => {
    if (!mcSounds) mcSounds = new McSounds(() => [ctx && ctx.dataDir, config.get().legacyPrismDir]);
    return mcSounds.get(name);
  },
  'app.updateConfig': async (patch) => {
    await config.update(patch);
    emit('config:changed');
    if (patch && ('uiScale' in patch || 'autoScale' in patch)) {
      lastZoom = 0;
      applyZoom();
    }
    return config.snapshot();
  },
  'app.setConfigKey': async (key, value) => {
    await config.replaceKey(key, value);
    emit('config:changed');
    return config.snapshot();
  },
  // Advanced: use another folder for Havi Hub's data (files are not moved)
  'app.setDataDir': async (dir) => {
    if (dir) await fsp.mkdir(dir, { recursive: true });
    await config.update({ dataDir: dir || '' });
    await initPrism();
    emit('instances:changed', {});
    emit('accounts:changed', {});
    emit('skins:changed', {});
    return api['app.state']();
  },
  'app.setEngineExe': async (exe) => {
    if (exe && !(await exists(exe))) throw new UserError('No se encontró el ejecutable indicado');
    await config.update({ engineExe: exe || '' });
    if (!exe) engine.check({ force: true });
    return engine.status();
  },
  'app.openDataDir': async () => ctx && shell.openPath(ctx.dataDir),

  // ---- profiles shared with Prism Launcher ----
  'share.status': async () => sharing.status(),
  'share.preview': async (dir) => {
    const p = await sharing.preview(dir);
    extraRoots.add(sharing.ownDirs().iconsDir);
    extraRoots.add(p.iconsDir);
    await refreshPrismCfgCache();
    return p;
  },
  'share.enable': async (opts) => {
    const r = await sharing.enable(opts);
    await initPrism();
    emit('instances:changed', {});
    emit('config:changed', config.get());
    return r;
  },
  'share.disable': async () => {
    const r = await sharing.disable();
    await initPrism();
    emit('instances:changed', {});
    emit('config:changed', config.get());
    return r;
  },

  // ---- engine (Prism Launcher, updated automatically) ----
  'engine.status': async () => engine.status(),
  'engine.check': async () => engine.check({ force: true }),

  // ---- import from Prism Launcher ----
  'import.detect': async () => need('importer').detect(),
  'import.list': async (dir) => {
    const r = await need('importer').list(dir);
    await refreshPrismCfgCache();
    return r;
  },
  'import.sizes': async (dir, ids) => need('importer').sizes(dir, ids),
  'import.run': async (opts) => {
    const r = await need('importer').run(opts);
    await config.update({ importPromptDone: true });
    await setupWatchers();
    emit('instances:changed', {});
    return r;
  },
  // CurseForge, Modrinth and Prism Launcher in one dialog
  'import.detectAll': async () => need('importer').detectAll(),
  'import.listFrom': async (source, dir) => {
    const r = await need('importer').listFrom(source, dir);
    await refreshPrismCfgCache();
    return r;
  },
  'import.sizesFrom': async (source, dir, ids) => need('importer').sizesFrom(source, dir, ids),
  'import.runFrom': async (opts) => {
    const r = await need('importer').runFrom(opts);
    await config.update({ importPromptDone: true });
    await setupWatchers();
    emit('config:changed', config.get());
    return r;
  },
  'app.openExternal': async (url) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  },
  // folders and pictures (the interface opens nothing else): opening any other
  // file would run it if it is a program
  'app.openPath': async (p) => {
    const st = await fsp.stat(String(p || '')).catch(() => null);
    if (!st || (!st.isDirectory() && !OPENABLE_FILE.test(String(p)))) throw new UserError('Havi Hub solo abre carpetas e imágenes.');
    return shell.openPath(p);
  },
  'app.showItem': async (p) => shell.showItemInFolder(p),
  'app.pickFiles': async (opts) => pickFiles(opts),
  'app.pickFolder': async (opts = {}) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: opts.title, defaultPath: opts.defaultPath });
    return r.canceled ? '' : r.filePaths[0];
  },
  'app.saveDialog': async (opts = {}) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: opts.defaultPath, filters: opts.filters, title: opts.title });
    return r.canceled ? '' : r.filePath;
  },
  'app.window': async (action) => {
    if (!win) return false;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
    return win.isMaximized();
  },
  'app.copyImage': async (p) => {
    const image = nativeImage.createFromPath(p);
    if (image.isEmpty()) throw new UserError('No se pudo leer la imagen');
    // Electron's newer clipboard takes items by type (like the web one); the older one takes the image
    const { ClipboardItem } = require('electron');
    if (typeof ClipboardItem === 'function') {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })]);
    } else clipboard.writeImage(image);
    return true;
  },
  'app.copyText': async (t) => {
    clipboard.writeText(String(t));
    return true;
  },
  'app.fetchImage': async (url) => {
    // Remote image -> data URL (avoids CORS issues in the 3D skin viewer)
    if (!/^https:\/\//.test(url)) throw new UserError('URL inválida');
    const buf = await http.getBuffer(url);
    return `data:image/png;base64,${buf.toString('base64')}`;
  },

  // ---- prism settings ----
  'prism.getSettings': async () => {
    if (!ctx) return {};
    return (await ctx.loadCfg()).toObject();
  },
  'prism.setSettings': async (patch) => {
    if (!ctx) throw Object.assign(new UserError('Prism no configurado'), { code: 'NO_PRISM' });
    const cfg = await ctx.loadCfg();
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) cfg.remove(k);
      else cfg.set(k, k === 'Env' ? cleanEnv(v) : v); // environment variables: always a clean JSON object
    }
    await cfg.save();
    await refreshPrismCfgCache();
    return cfg.toObject();
  },
  'prism.findJava': async () => {
    const javaDir = ctx ? (await ctx.dirs()).javaDir : null;
    return findJavas(javaDir);
  },
  'prism.openDataDir': async () => ctx && shell.openPath(ctx.dataDir),

  // ---- instances ----
  'instances.list': async () => need('instances').list(),
  'instances.get': async (id) => need('instances').get(id),
  'instances.counts': async (id) => need('instances').counts(id),
  'instances.create': async (opts) => {
    let imagePng = toBuffer(opts.imagePng);
    // a picture from the web (a server's icon)
    if (!imagePng && opts.iconUrl && /^https:\/\//.test(opts.iconUrl)) imagePng = await http.getBuffer(opts.iconUrl).catch(() => undefined);
    const id = await need('instances').create({ ...opts, name: cleanText(opts.name, LIMITS.instanceName), group: cleanText(opts.group, LIMITS.groupName), imagePng });
    emit('instances:changed', {});
    return id;
  },
  'instances.rename': async (id, name) => {
    await need('instances').rename(id, cleanText(name, LIMITS.instanceName));
    emit('instances:changed', {});
  },
  'instances.setGroup': async (id, group) => {
    await need('instances').setGroup(id, cleanText(group, LIMITS.groupName));
    emit('instances:changed', {});
  },
  'instances.createGroup': async (name) => {
    const n = cleanText(name, LIMITS.groupName);
    if (!n) throw new UserError('El grupo necesita un nombre');
    const extra = new Set(config.get().extraGroups || []);
    extra.add(n);
    await config.replaceKey('extraGroups', [...extra]);
    emit('instances:changed', {});
  },
  'instances.renameGroup': async (from, to) => {
    const t = cleanText(to, LIMITS.groupName);
    if (!t) throw new UserError('El grupo necesita un nombre');
    await groups.renameGroup(ctx, from, t);
    await config.replaceKey('extraGroups', (config.get().extraGroups || []).map((g) => (g === from ? t : g)));
    await need('instances').renameGroupImage(from, t);
    emit('instances:changed', {});
  },
  'instances.deleteGroup': async (name) => {
    await groups.deleteGroup(ctx, name);
    await config.replaceKey('extraGroups', (config.get().extraGroups || []).filter((g) => g !== name));
    await need('instances').resetGroupImage(name);
    emit('instances:changed', {});
  },
  // the picture on a group's card: a picture of the user's or an icon made in the editor
  'instances.setGroupImage': async (name, bytes, opts) => {
    const n = cleanText(name, LIMITS.groupName);
    if (!n) throw new UserError('El grupo necesita un nombre');
    await need('instances').setGroupImage(n, toBuffer(bytes), opts || {});
    emit('instances:changed', {});
  },
  'instances.resetGroupImage': async (name) => {
    await need('instances').resetGroupImage(cleanText(name, LIMITS.groupName));
    emit('instances:changed', {});
  },
  'instances.setImage': async (id, bytes, opts) => {
    await need('instances').setImage(id, toBuffer(bytes), opts || {});
    emit('instances:changed', {});
  },
  'instances.resetImage': async (id) => {
    await need('instances').resetImage(id);
    emit('instances:changed', {});
  },
  'instances.clone': async (id, opts) => {
    const o = opts || {};
    const newId = await need('instances').clone(id, { ...o, name: cleanText(o.name, LIMITS.instanceName), group: o.group ? cleanText(o.group, LIMITS.groupName) : o.group });
    emit('instances:changed', {});
    return newId;
  },
  'instances.remove': async (id) => {
    // a synced instance only loses its link: the shared folder stays for the others
    const root = await need('instances').locate(id);
    await need('sync').forgetInstance(id, gameDirOf(root)).catch(() => {});
    await need('instances').remove(id, trash);
    emit('instances:changed', {});
  },
  // ---- profiles synced with CurseForge / Modrinth
  'sync.scan': async () => need('sync').scan(),
  'sync.link': async (opts) => need('sync').link(opts),
  'sync.bring': async (ref) => need('sync').bringToHavi(ref),
  'sync.detach': async (groupId, dir) => need('sync').detach(groupId, dir),
  'instances.getSettings': async (id) => need('instances').getSettings(id),
  'instances.setSettings': async (id, patch) => {
    const p = { ...(patch || {}) };
    if ('name' in p) {
      p.name = cleanText(p.name, LIMITS.instanceName);
      if (!p.name) throw new UserError('El nombre no puede estar vacío');
    }
    for (const [k, v] of Object.entries(p)) if (typeof v === 'string' && v.length > LIMITS.textarea) p[k] = v.slice(0, LIMITS.textarea);
    if ('Env' in p && p.Env !== undefined) p.Env = cleanEnv(p.Env);
    const r = await need('instances').setSettings(id, p);
    emit('instances:changed', {});
    return r;
  },
  'instances.setVersion': async (id, v) => {
    await need('instances').setVersion(id, v);
    emit('instances:changed', {});
  },
  'instances.openFolder': async (id, sub) => {
    const root = await need('instances').locate(id);
    const target = sub ? path.join(gameDirOf(root), sub) : gameDirOf(root);
    await fsp.mkdir(target, { recursive: true });
    return shell.openPath(target);
  },
  'instances.openRoot': async (id) => shell.openPath(await need('instances').locate(id)),
  'instances.launch': async (id, opts = {}) => {
    let profile = opts.profile;
    const instSettings = await need('instances').getSettings(id).catch(() => ({}));
    const ownAccount = String(instSettings.UseAccountForInstance) === 'true';
    // a crash is shown by Havi Hub (its log), not by the engine's console
    if (String(instSettings.OverrideConsole) === 'true' && String(instSettings.ShowConsoleOnError) !== 'false') await need('instances').setSettings(id, { ShowConsoleOnError: false }).catch(() => {});
    const accounts = opts.offline ? [] : await need('accounts').list().catch(() => []);
    if (!profile && !opts.offline && !ownAccount) {
      const active = accounts.find((a) => a.active);
      if (active) profile = active.name;
    }
    // an account signed in with another Microsoft app: the engine would refuse
    // it with its own window, so Havi Hub asks for the sign-in first
    const using = ownAccount ? accounts.find((a) => a.id === String(instSettings.InstanceAccountId || '')) : accounts.find((a) => a.name === profile);
    if (using && using.needsLogin) {
      const e = new UserError('{name} tiene que iniciar sesión de nuevo.', { name: using.name });
      e.code = 'NEEDS_LOGIN';
      e.data = { account: using.name };
      throw e;
    }
    const r = await need('launcher').launch(id, { ...opts, profile });
    const c = config.get();
    if (!r.already) {
      if (c.closeOnLaunch) setTimeout(() => app.quit(), 1500);
      else if (c.trayOnLaunch) hideToTray({ gameName: ((await need('instances').get(id).catch(() => null)) || {}).name || '', reason: 'game' });
      else if (c.minimizeOnLaunch && win) win.minimize();
    }
    return r;
  },
  'instances.stop': async (id) => need('launcher').stop(id),
  'instances.applyKeys': async () => need('instances').applyKeys((id) => need('launcher').isRunning(id)),
  // a modpack that brought its own key bindings: the person chose theirs (modpacks.js, packKeys)
  'instances.applyKeysTo': async (id) => need('instances').applyKeysTo(id),
  'instances.running': async () => (services && services.launcher ? services.launcher.runningIds() : []),
  'instances.shortcut': async (id) => {
    const inst = await need('instances').get(id);
    let png = null;
    if (inst.icon) {
      try {
        png = await fsp.readFile(pathFromUrl(inst.icon));
      } catch {
        png = null;
      }
    }
    if (png && (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47)) {
      // JPG/other icons: convert to PNG for the shortcut's .ico
      const img = png.length >= 8 ? nativeImage.createFromBuffer(png) : null;
      png = img && !img.isEmpty() ? img.toPNG() : null;
    }
    // The shortcut opens Havi Hub (not the engine) and starts the instance
    const { exe, preArgs } = selfCommand();
    if (!png) png = await fsp.readFile(path.join(RENDERER_DIR, 'static', 'icon.png')).catch(() => null);
    return createDesktopShortcut({ electron: { app, shell }, exe, preArgs, instanceId: id, name: inst.name, iconPng: png, instanceRoot: inst.root });
  },
  // ---- Linux: Havi Hub in the application menu
  'linux.menuState': async () => {
    if (process.platform !== 'linux') return { supported: false };
    const st = await userMenuEntryState();
    return { supported: true, appImage: Boolean(process.env.APPIMAGE), ...st, enabled: config.get().linuxMenu !== false };
  },
  'linux.menuInstall': async () => {
    await config.update({ linuxMenu: true });
    return syncLinuxMenu(true);
  },
  'linux.menuRemove': async () => {
    await config.update({ linuxMenu: false });
    await removeUserMenuEntry();
    return api['linux.menuState']();
  },
  'linux.menuInstallSystem': async () => {
    if (!process.env.APPIMAGE) throw new UserError('Esta opción es para la versión AppImage. Con el paquete .deb, Havi Hub ya aparece para todos los usuarios.');
    const iconFile = path.join(RENDERER_DIR, 'static', 'icon.png');
    const r = await installSystemMenuEntry({ appImage: process.env.APPIMAGE, iconFile });
    return { ...r, ...(await api['linux.menuState']()) };
  },
  // what a Prism .zip of this profile would carry of this computer (the share dialog asks)
  'instances.exportSettings': async (id) => need('modpacks').exportSettings(id),
  'instances.export': async (id, opts = {}) => {
    const inst = await need('instances').get(id);
    const ext = opts.format === 'mrpack' ? 'mrpack' : 'zip';
    const curse = opts.format === 'curseforge';
    const dest = await api['app.saveDialog']({
      defaultPath: path.join(app.getPath('downloads'), `${safeName(inst.name)}${curse ? ' (CurseForge)' : ''}.${ext}`),
      filters: [{ name: ext === 'mrpack' ? 'Modrinth modpack' : curse ? 'CurseForge modpack' : 'Prism instance', extensions: [ext] }],
    });
    if (!dest) return '';
    if (ext === 'mrpack') await need('modpacks').exportMrpack(id, dest, opts);
    else if (curse) await need('modpacks').exportCurseZip(id, dest, { name: cleanText(opts.name, LIMITS.instanceName), version: cleanText(opts.version, LIMITS.version) || '1.0.0', author: cleanText(opts.author, 64), includeWorlds: Boolean(opts.includeWorlds) });
    else await need('modpacks').exportZip(id, dest, { includeWorlds: opts.includeWorlds !== false, personalSettings: opts.personalSettings === 'keep' ? 'keep' : 'drop' });
    shell.showItemInFolder(dest);
    return dest;
  },
  // A Prism instance that would run something on this computer when it starts
  // (its commands, a Java of its own…): the first call returns what it found
  // ({ confirm: 'launchSettings' }) and the page asks; the second one says
  // whether those settings stay (launchSettings: 'keep' | 'drop').
  'instances.import': async (opts = {}) => {
    const files = opts.path ? [opts.path] : await pickFiles({ filters: [{ name: 'Modpacks / instancias', extensions: ['zip', 'mrpack'] }] });
    if (!files.length) return null;
    if (opts.launchSettings !== 'keep' && opts.launchSettings !== 'drop') {
      const settings = await need('modpacks').archiveLaunchSettings(files[0]);
      if (settings.length) return { confirm: 'launchSettings', path: files[0], settings };
    }
    const r = await need('modpacks').importArchive(files[0], { group: opts.group, launchSettings: opts.launchSettings });
    emit('instances:changed', {});
    return r;
  },
  'instances.repair': async (id) => repairInstance(id),

  // ---- content ----
  'content.list': async (id, kind, opts) => need('content').list(id, kind, opts),
  'content.setEnabled': async (id, kind, files, enabled, opts) => {
    for (const f of [].concat(files)) await need('content').setEnabled(id, kind, f, enabled, opts);
  },
  'content.remove': async (id, kind, files, opts) => {
    for (const f of [].concat(files)) await need('content').remove(id, kind, f, opts, trash);
  },
  'content.addFiles': async (id, kind, opts = {}) => {
    const exts = kind === 'mods' ? ['jar', 'zip', 'litemod'] : ['zip', 'jar'];
    const files = opts.paths || (await pickFiles({ multi: true, filters: [{ name: 'Archivos', extensions: exts }] }));
    if (!files.length) return [];
    return need('content').addFiles(id, kind, files, opts);
  },
  'content.openFolder': async (id, kind, opts) => {
    const folder = await need('content').folderFor(id, kind, opts || {});
    await fsp.mkdir(folder, { recursive: true });
    return shell.openPath(folder);
  },
  'content.checkUpdates': async (id, kind, opts) => need('platforms').checkUpdates(id, kind, opts),
  'content.cachedUpdates': async (id, kind, opts = {}) => need('platforms').cachedUpdates(id, kind, opts.world),
  'content.update': async (id, kind, fileName, upd, opts) => need('platforms').applyUpdate(id, kind, fileName, upd, opts),
  'content.updateAll': async (id, kind, opts) => need('platforms').updateAll(id, kind, opts),
  'content.enrich': async (items) => need('platforms').enrich(items),
  'content.projectOf': async (id, kind, fileName, opts) => need('platforms').projectOf(id, kind, fileName, opts || {}),
  'content.versions': async (id, kind, fileName, opts) => need('platforms').versionsFor(id, kind, fileName, opts || {}),
  'content.switchVersion': async (id, kind, fileName, target, opts) => need('platforms').switchVersion(id, kind, fileName, target, opts || {}),
  'content.previousVersions': async (id) => need('platforms').previousVersions(id),
  'platforms.changelog': async (source, projectId, versionId) => need('platforms').changelog(source, projectId, versionId),

  // ---- worlds & servers ----
  'worlds.list': async (id) => need('worlds').list(id),
  'worlds.remove': async (id, folder) => need('worlds').remove(id, folder, trash),
  'worlds.duplicate': async (id, folder) => need('worlds').duplicate(id, folder),
  'worlds.backupAll': async (id) => need('worlds').backupAll(id, { keep: 3 }),
  'worlds.backup': async (id, folder) => {
    const dest = await need('worlds').backup(id, folder);
    shell.showItemInFolder(dest);
    return dest;
  },
  'worlds.import': async (id) => {
    const files = await pickFiles({ filters: [{ name: 'Mundo (.zip)', extensions: ['zip'] }] });
    if (!files.length) return null;
    return need('worlds').importZip(id, files[0]);
  },
  'servers.list': async (id) => need('worlds').listServers(id),
  // the server directory (Modrinth) and pings from this computer
  'servers.discover': async (opts) => serverDirectory.search(opts || {}),
  'servers.ping': async (address) => pingServer(address),
  'servers.link': async (id, projectId) => {
    await need('instances').setSettings(id, { HaviHubServer: projectId || undefined });
    emit('instances:changed', {});
  },
  'servers.add': async (id, s) => need('worlds').addServer(id, { ...s, name: cleanText(s && s.name, LIMITS.serverName), ip: cleanText(s && (s.ip || s.address), LIMITS.serverAddress) || (s && s.ip) }),
  'servers.edit': async (id, index, s) => need('worlds').editServer(id, index, s),
  'servers.remove': async (id, index) => need('worlds').removeServer(id, index),

  // ---- logs & screenshots ----
  'logs.list': async (id) => need('logs').list(id),
  'logs.read': async (id, rel) => need('logs').read(id, rel),
  'logs.watch': async (id) => need('logs').watch(id),
  'logs.unwatch': async (id) => need('logs').unwatch(id),
  'logs.zip': async (id) => {
    const dest = await need('logs').createZip(id);
    shell.showItemInFolder(dest);
    return dest;
  },
  'logs.upload': async (text) => need('logs').upload(text),
  'screenshots.list': async (id) => need('screenshots').list(id),
  'screenshots.all': async () => need('screenshots').listAll(),
  'screenshots.remove': async (id, name) => need('screenshots').remove(id, name, trash),

  // ---- accounts & skins ----
  'accounts.list': async () => (ctx ? need('accounts').list() : []),
  'accounts.setActive': async (pid) => {
    await need('accounts').setActive(pid);
    emit('accounts:changed', {});
  },
  'accounts.addOffline': async (name) => {
    const r = await need('accounts').addOffline(cleanText(name, LIMITS.offlineName));
    emit('accounts:changed', {});
    return r;
  },
  'accounts.remove': async (pid) => {
    await need('accounts').remove(pid);
    emit('accounts:changed', {});
  },
  'accounts.refresh': async (pid) => need('accounts').refreshProfile(pid),
  // Microsoft sign-in through the engine (resolves when finished or cancelled)
  'accounts.addMicrosoft': async () => {
    if (login) login.cancel();
    const exe = await engine.ensure();
    return new Promise((resolve) => {
      login = startLogin({
        exe,
        dataFile: ctx.accountsFile(),
        prepare: (dir) => prepareEngineData(dir),
        onSpawn: watchEngineWindows,
        onDone: (result) => {
          login = null;
          if (result && result.added) emit('accounts:changed', {});
          resolve(result);
        },
      });
    });
  },
  'accounts.cancelLogin': async () => {
    if (login) login.cancel();
  },
  'accounts.setCape': async (pid, capeId) => need('accounts').setCape(pid, capeId),
  'skins.list': async () => (ctx ? need('skins').list() : []),
  'skins.add': async (bytes, opts) => {
    const name = await need('skins').add(toBuffer(bytes), opts);
    emit('skins:changed', {});
    return name;
  },
  'skins.update': async (name, patch) => {
    await need('skins').update(name, patch);
    emit('skins:changed', {});
  },
  'skins.remove': async (name) => {
    await need('skins').remove(name);
    emit('skins:changed', {});
  },
  'skins.importPlayer': async (username) => {
    const s = await fetchPlayerSkin(username);
    const name = await need('skins').add(s.png, { name: s.name, model: s.model });
    emit('skins:changed', {});
    return name;
  },
  'skins.apply': async (pid, { name, png, model, capeId }) => {
    const buf = png ? toBuffer(png) : await need('skins').read(name);
    await need('accounts').uploadSkin(pid, buf, model);
    let list;
    if (capeId !== undefined) list = await need('accounts').setCape(pid, capeId || null);
    list = list || (await need('accounts').list());
    // the library remembers which skin of Mojang's it became, so it is found again
    const acc = list.find((a) => a.id === pid);
    if (name) await need('skins').update(name, { model, capeId: capeId || '', ...(acc && acc.skin.url ? { url: acc.skin.url } : {}) }).catch(() => {});
    emit('accounts:changed', {});
    return list;
  },
  // Which library skin the account is wearing; with keep, a skin of the
  // account's that is not in the library yet (put on elsewhere) is saved into it.
  'skins.current': async (pid, { keep = false } = {}) => {
    const acc = (await need('accounts').list()).find((a) => a.id === pid);
    if (!acc || !acc.skin || !acc.skin.data) return null;
    const png = Buffer.from(String(acc.skin.data).replace(/^data:image\/png;base64,/, ''), 'base64');
    const found = await need('skins').findSame(png, decodePng, acc.skin.url);
    if (found || !keep) return found;
    const added = await need('skins').add(png, { name: acc.name, model: acc.skin.variant === 'SLIM' ? 'SLIM' : 'CLASSIC', url: acc.skin.url || '' });
    emit('skins:changed', {});
    return added;
  },

  // ---- platforms ----
  'platforms.search': async (opts) => need('platforms').search(opts),
  'platforms.discover': async (opts) => need('platforms').discover(opts),
  'platforms.categories': async (source, type) => need('platforms').categories(source, type),
  'platforms.project': async (source, id) => need('platforms').project(source, id),
  'platforms.resolveLink': async (link) => need('platforms').resolveLink(String(link)),
  'platforms.versions': async (source, id, opts) => need('platforms').versions(source, id, opts),
  'platforms.install': async (opts) => need('platforms').install(opts),
  'platforms.resolveBlocked': async (entries, mode) => getBlockedDownloads().resolve(Array.isArray(entries) ? entries.filter((e) => e && e.key && e.resume) : [], mode === 'browser' ? 'browser' : 'window'),
  'platforms.cancelBlocked': async () => {
    if (blockedDownloads) blockedDownloads.cancel();
    return true;
  },
  'platforms.installModpack': async (opts) => {
    const r = await need('modpacks').install(opts);
    emit('instances:changed', {});
    return r;
  },
  'platforms.gameVersions': async () => modrinth.gameVersions(),

  // ---- meta ----
  'meta.minecraft': async () => need('meta').minecraftVersions(),
  'meta.loaderVersions': async (loader, mc) => need('meta').loaderVersions(loader, mc),
  'meta.loadersFor': async (mc) => need('meta').loadersFor(mc),

  // ---- tasks ----
  'tasks.list': async () => (services ? services.tasks.list() : []),
  'tasks.clear': async () => services && services.tasks.clearFinished(),
  'tasks.cancel': async (id) => (services ? services.tasks.cancel(Number(id)) : false),
  // Havikun's channels in the Modrinth layout's side column (social.js)
  'social.signIn': async (id) => openSocialSignIn(String(id)),
  'mc.textures': async (names) => getMcAssets().textures(names),
  // the game's pictures: at hand yet? (the welcome waits for them)
  'mc.status': async () => {
    const mc = getMcAssets();
    if (!mc.lastKey) await mc.recheck().catch(() => null);
    return mc.status();
  },
  // try the download of the game's files again now (after a failure, or with only a game from before 1.13)
  'mc.fetch': async () => {
    const mc = getMcAssets();
    const key = await mc.recheck().catch(() => null);
    if (!key || !mc.current) mc.fetchLatest({ force: true });
    return mc.status();
  },
  // `auto`: asked for without the person opening the channel (the panel showing
  // up, the check for a live stream). While the automatic loading is off (or not
  // answered yet), those get only what is already on disk and nothing connects.
  'social.feed': async (id, opts) => socialFeed(String(id), { force: Boolean(opts && opts.force), cachedOnly: Boolean(opts && opts.auto) && !socialAutoload() }),
  // the instance a shortcut asked to start (taken once)
  'app.takePendingLaunch': async () => {
    const p = pendingLaunch;
    pendingLaunch = null;
    return p && Date.now() - p.at < 5 * 60 * 1000 ? p.id : null;
  },
  // The answer to "there are tasks running" when the window was being closed
  'ui.ready': async () => {
    pageReady();
    return true;
  },
  'app.closeChoice': async (choice) => {
    closeAsked = false;
    if (choice === 'background') {
      hideToTray({ reason: 'close' });
      return true;
    }
    if (choice !== 'stop') return false;
    const tasks = services && services.tasks;
    if (tasks) {
      await tasks.cancelAll();
      // moving folders can't stop half way: close as soon as that ends
      if (tasks.running().length) {
        emit('app:closing', { waiting: tasks.running().map((t) => t.title) });
        await tasks.waitForUncancelable();
      }
    }
    quitApp(true);
    return true;
  },
};

// "Repair profile": restore missing/corrupted files that have download metadata
// and remove orphaned metadata.
async function repairInstance(id) {
  const content = need('content');
  const tasks = need('tasks');
  return tasks.run(tr('Reparando perfil'), { kind: 'repair', instanceId: id }, async (task) => {
    const report = { redownloaded: [], removedMetadata: [], ok: 0, problems: [] };
    const kinds = ['mods', 'resourcepacks', 'shaderpacks'];
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[k];
      const { folder, indexDir, meta } = await content.metadataFor(id, kind);
      const entries = [...meta.values()];
      for (let i = 0; i < entries.length; i++) {
        const m = entries[i];
        task.progress((k + i / Math.max(1, entries.length)) / kinds.length, tr('Revisando {file}', { file: m.filename }));
        const file = await resolveInside(folder, m.filename).catch(() => null);
        if (!file) {
          report.problems.push({ file: m.filename, error: tr('ruta inválida') });
          continue;
        }
        const disabled = `${file}.disabled`;
        const present = (await exists(file)) ? file : (await exists(disabled)) ? disabled : null;
        const algo = m.download['hash-format'];
        const expected = m.download.hash;
        let bad = !present;
        if (present && expected && ['sha1', 'sha512', 'sha256', 'md5'].includes(algo)) {
          bad = (await hashFile(present, algo)).toLowerCase() !== String(expected).toLowerCase();
        }
        if (!bad) {
          report.ok++;
          continue;
        }
        let url = m.download.url;
        if (!url && m.provider === 'curseforge') {
          try {
            const f = await require('./platforms/curseforge').curseforge.file(m.projectId, m.fileId);
            url = f.files[0].url;
          } catch {
            url = null;
          }
        }
        if (url) {
          try {
            await http.download(url, present || file, { hash: expected, hashAlgo: algo || 'sha1' });
            report.redownloaded.push(m.filename);
          } catch (e) {
            report.problems.push({ file: m.filename, error: textOf(e) });
          }
        } else if (!present) {
          await fsp.rm(m.metaFile, { force: true });
          report.removedMetadata.push(m.filename);
        } else {
          report.problems.push({ file: m.filename, error: tr('no coincide con su hash y no se puede volver a descargar') });
        }
      }
      void indexDir;
    }
    // natives get re-extracted by Prism on next launch
    const root = await need('instances').locate(id);
    await fsp.rm(path.join(root, 'natives'), { recursive: true, force: true });
    emit('content:changed', { instanceId: id });
    return report;
  });
}

ipcMain.handle('api', async (event, method, args) => {
  const fn = api[method];
  if (!fn) return { ok: false, error: { message: `Método desconocido: ${method}`, code: 'NO_METHOD' } };
  // HAVIHUB_TRACE=1: when each call from the page started (ms since the app started) and how long it took
  const t0 = process.env.HAVIHUB_TRACE ? process.uptime() * 1000 : 0;
  try {
    const value = await fn(...(args || []));
    if (t0) console.error(`[trace] ${Math.round(t0)} +${Math.round(process.uptime() * 1000 - t0)} ${method}`);
    return { ok: true, value };
  } catch (e) {
    if (isDev) console.error(method, e);
    // i18n: the template and values the interface translates (shared/usertext.js)
    return { ok: false, error: { message: String((e && e.message) || e), code: (e && e.code) || 'ERROR', data: e && e.data, i18n: e && e.i18n } };
  }
});

// ------------------------------------------------------------------ protocol
function mimeOf(p) {
  const ext = path.extname(p).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.json': 'application/json',
      '.txt': 'text/plain; charset=utf-8',
    }[ext] || 'application/octet-stream'
  );
}

function registerProtocol() {
  const IMAGE_SIZES = new Set([128, 640, 1024]);
  protocol.handle('havihub', async (request) => {
    const url = new URL(request.url);
    let file;
    if (url.host === 'app') {
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      file = path.join(RENDERER_DIR, rel);
      if (!isInside(file, RENDERER_DIR)) return new Response('forbidden', { status: 403 });
    } else if (url.host === 'local') {
      file = pathFromUrl(request.url);
      if (!allowedRoots.some((r) => r && isInside(file, r))) return new Response('forbidden', { status: 403 });
      // instance pictures are asked for at the size they are drawn (a 4K photo
      // behind a 50 px icon would otherwise be decoded whole, every time)
      const max = Number(url.searchParams.get('w'));
      if (IMAGE_SIZES.has(max) && !process.env.HAVIHUB_NO_SCALED && /\.(png|jpe?g)$/i.test(file)) {
        try {
          if (!thumbs) thumbs = new Thumbs(path.join(app.getPath('userData'), 'cache', 'thumbs'), nativeImage);
          const data = await thumbs.scaled(file, max);
          if (data) return new Response(data, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' } });
        } catch {
          // fall through to the file itself
        }
      }
    } else if (url.host === 'thumb') {
      // a cached small JPEG of a screenshot (the gallery)
      file = pathFromUrl(request.url);
      if (!allowedRoots.some((r) => r && isInside(file, r))) return new Response('forbidden', { status: 403 });
      try {
        if (!thumbs) thumbs = new Thumbs(path.join(app.getPath('userData'), 'cache', 'thumbs'), nativeImage);
        const data = await thumbs.get(file);
        return new Response(data, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' } });
      } catch {
        return new Response('not found', { status: 404 });
      }
    } else return new Response('not found', { status: 404 });
    try {
      const data = await fsp.readFile(file);
      return new Response(data, {
        headers: { 'Content-Type': mimeOf(file), 'Access-Control-Allow-Origin': '*', 'Cache-Control': url.host === 'app' ? 'no-cache' : 'max-age=3600' },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// ------------------------------------------------------------------ window
// How big everything is drawn. The size chosen in Settings is the one of a
// window that fills the screen. A smaller window draws its contents a little
// smaller, so more of them fit, but only down to what is still comfortable:
// ordinary text never under about 14 real pixels on this screen (which also
// keeps buttons around 35 pixels tall, easy to hit). Below that the contents
// keep their size and the window simply stops getting smaller.
const READABLE_PX = 14; // ordinary text (16 px in the layout), in real screen pixels
function autoScaling() {
  if (process.env.HAVIHUB_ZOOM || !config || config.get().autoScale === false) return false;
  return !process.env.HAVIHUB_MOCK_NET || Boolean(process.env.HAVIHUB_AUTOSCALE); // the tests measure fixed layouts
}
// the smallest the contents may get, as a part of their full size (1 = they never shrink)
function fitFloor(display) {
  const d = display || screen.getPrimaryDisplay();
  return Math.max(0.6, Math.min(1, READABLE_PX / (16 * (d.scaleFactor || 1) * baseZoom())));
}
function fitFactor() {
  if (!autoScaling() || !win || win.isDestroyed()) return 1;
  const [w, h] = win.getContentSize();
  const display = screen.getDisplayMatching(win.getBounds());
  const fit = Math.min(1, w / display.workAreaSize.width, h / display.workAreaSize.height);
  const floor = fitFloor(display);
  // full size while the window takes most of the screen, the floor from about half of it, and a smooth way between
  const t = Math.max(0, Math.min(1, (fit - 0.55) / 0.4));
  return floor + (1 - floor) * t * t * (3 - 2 * t);
}

function baseZoom() {
  const scale = Math.max(50, Math.min(200, Number(config.get().uiScale) || 100)) / 100;
  return Number(process.env.HAVIHUB_ZOOM) || BASE_ZOOM * scale;
}

function zoomFactor() {
  return baseZoom() * fitFactor();
}

// the smallest window: with the contents at their smallest, the layout still fits
function minimumSize() {
  const z = baseZoom() * (autoScaling() ? fitFloor(win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : null) : 1);
  return [Math.round(1040 * z), Math.round(660 * z)];
}

let lastZoom = 0;
function applyZoom() {
  if (!win || win.isDestroyed()) return;
  if (!process.env.HAVIHUB_NO_MIN) win.setMinimumSize(...minimumSize()); // (tests: a tiling window manager ignores it anyway)
  const z = zoomFactor();
  if (Math.abs(z - lastZoom) < 0.004) return;
  lastZoom = z;
  win.webContents.setZoomFactor(z);
}

function createWindow(resume = null) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const z = zoomFactor();
  const w = Number(process.env.HAVIHUB_WIN_W) || Math.min(Math.round(1600 * z), Math.round(width * 0.9));
  const h = Number(process.env.HAVIHUB_WIN_H) || Math.min(Math.round(1000 * z), Math.round(height * 0.9));
  win = new BrowserWindow({
    width: w,
    height: h,
    ...(resume && resume.bounds ? resume.bounds : {}),
    minWidth: minimumSize()[0],
    minHeight: minimumSize()[1],
    frame: false,
    backgroundColor: '#0d0d0d',
    show: false,
    title: 'Havi Hub',
    icon: path.join(RENDERER_DIR, 'static', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: true, // only for the social networks' own embeddable pages (see below)
      zoomFactor: z,
    },
  });
  win.once('ready-to-show', () => {
    if (resume && resume.maximized) win.maximize();
    win.show();
    if (resume) win.focus();
  });
  // "Close to the tray": the X hides the window instead of quitting
  win.on('close', (e) => {
    if (quitting) return;
    if (askBeforeClosing()) {
      e.preventDefault();
      return;
    }
    if (!config || config.get().closeToTray !== true) return;
    e.preventDefault();
    hideToTray({ reason: 'close' });
  });
  win.webContents.on('did-finish-load', applyZoom);
  // Ctrl + / Ctrl - / Ctrl 0 and Ctrl+wheel change "Interface size" (Settings → Themes)
  const setScale = (v) => {
    const uiScale = Math.max(75, Math.min(150, Math.round(v / 5) * 5));
    config.update({ uiScale }).then((c) => {
      emit('config:changed', c);
      applyZoom();
    });
  };
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const cur = Number(config.get().uiScale) || 100;
    let next = null;
    if (input.key === '=' || input.key === '+') next = cur + 10;
    else if (input.key === '-' || input.key === '_') next = cur - 10;
    else if (input.key === '0') next = 100;
    if (next === null) return;
    e.preventDefault();
    setScale(next);
  });
  win.webContents.on('zoom-changed', (e, direction) => setScale((Number(config.get().uiScale) || 100) + (direction === 'in' ? 10 : -10)));
  // the contents follow the size of the window (see fitFactor)
  lastZoom = 0;
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'moved']) win.on(ev, applyZoom);
  win.on('maximize', () => emit('window:maximized', true));
  win.on('unmaximize', () => emit('window:maximized', false));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('havihub://app/')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.loadURL(resume ? 'havihub://app/index.html#resume' : 'havihub://app/index.html');
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
}

// How to start this copy of Havi Hub again: the AppImage file (not its
// temporary mount), the portable .exe, or the installed program.
function selfCommand() {
  if (!app.isPackaged) return { exe: process.execPath, preArgs: [app.getAppPath()] };
  if (process.env.PORTABLE_EXECUTABLE_FILE) return { exe: process.env.PORTABLE_EXECUTABLE_FILE, preArgs: [] };
  if (process.platform === 'linux' && process.env.APPIMAGE) return { exe: process.env.APPIMAGE, preArgs: [] };
  return { exe: process.execPath, preArgs: [] };
}

// Linux: keep ~/.local/share/applications/havihub.desktop pointing at this
// copy (the AppImage can be moved), unless the user turned it off or a
// package (.deb) already put Havi Hub in the menu.
async function syncLinuxMenu(force = false) {
  if (process.platform !== 'linux' || (!app.isPackaged && !force)) return null;
  if (!force && config.get().linuxMenu === false) return null;
  const st = await userMenuEntryState();
  if (!force && !process.env.APPIMAGE && st.system) return st; // installed from a package
  const { exe, preArgs } = selfCommand();
  const iconPng = await fsp.readFile(path.join(RENDERER_DIR, 'static', 'icon.png')).catch(() => null);
  await installUserMenuEntry({ exe, preArgs, iconPng });
  return { supported: true, appImage: Boolean(process.env.APPIMAGE), ...(await userMenuEntryState()), enabled: true };
}

// CurseForge's own download page in a window of Havi Hub, for the files whose
// authors only allow downloads from there (platforms/blocked.js). The page is
// shown as it is; the download it starts is handed to onDownload.
function curseSiteAllowed(url) {
  try {
    const u = new URL(url);
    if (process.env.HAVIHUB_CF_SITE && u.origin === new URL(process.env.HAVIHUB_CF_SITE).origin) return true;
    return u.protocol === 'https:' && /(^|\.)(curseforge\.com|forgecdn\.net)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

// Minecraft's textures, from the game files on this computer (see mcassets.js)
let mcAssets = null;
function getMcAssets() {
  if (!mcAssets) {
    mcAssets = new McAssets({
      dataDir: () => (ctx && ctx.dataDir) || config.get().dataDir || defaultDataDir(),
      cacheDir: path.join(app.getPath('userData'), 'cache', 'mc'),
      http: require('./util/http'),
      emit,
      allowDownload: !process.env.HAVIHUB_MOCK_NET || Boolean(process.env.HAVIHUB_MC_FETCH),
    });
  }
  return mcAssets;
}

// Signing in to a network (X shows its posts only to people signed in): its own
// page, in a window of Havi Hub that shares its cookies with that network's
// panel and with nothing else. Havi Hub never sees the password.
let socialSignInWindow = null;
function openSocialSignIn(id) {
  const s = SOCIALS.find((x) => x.id === id && x.signIn);
  if (!s) throw new Error('unknown network');
  if (socialSignInWindow && !socialSignInWindow.isDestroyed()) {
    socialSignInWindow.focus();
    return true;
  }
  const ses = session.fromPartition('persist:social');
  const w = new BrowserWindow({
    width: 520,
    height: 760,
    parent: win && !win.isDestroyed() && win.isVisible() ? win : undefined,
    title: `Havi Hub · ${s.name}`,
    icon: path.join(RENDERER_DIR, 'static', 'icon.png'),
    backgroundColor: '#0d0d0d',
    autoHideMenuBar: true,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  socialSignInWindow = w;
  w.removeMenu();
  w.webContents.setUserAgent(app.userAgentFallback.replace(/\s(?:Electron|havi-hub|HaviHub)\/\S+/gi, ''));
  // "sign in with Google/Apple" opens in this same window; anything else stays https
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) setImmediate(() => !w.isDestroyed() && w.loadURL(url));
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!/^https:\/\//.test(url)) e.preventDefault();
  });
  w.on('page-title-updated', (e) => e.preventDefault());
  w.on('closed', () => {
    socialSignInWindow = null;
    emit('social:signed', id);
  });
  w.loadURL(process.env.HAVIHUB_SOCIAL_TEST ? `${process.env.HAVIHUB_SOCIAL_TEST}/signin` : s.signIn);
  return true;
}

function openCurseBrowser({ onDownload, onClosed }) {
  const ses = session.fromPartition('persist:curseforge-site');
  // the same identity as any browser: the site then serves its normal page
  ses.setUserAgent(app.userAgentFallback.replace(/\s(?:Electron|havi-hub|HaviHub)\/\S+/gi, ''));
  const w = new BrowserWindow({
    width: 1180,
    height: 820,
    parent: win && !win.isDestroyed() && win.isVisible() ? win : undefined,
    title: 'Havi Hub · CurseForge',
    icon: path.join(RENDERER_DIR, 'static', 'icon.png'),
    backgroundColor: '#0d0d0d',
    autoHideMenuBar: true,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  w.removeMenu();
  // pop-ups stay closed (ads); one that is the file itself is downloaded here
  w.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (curseSiteAllowed(url) && (/forgecdn\.net$/i.test(u.hostname) || /\/download(\/|$)|\/api\/v1\/mods\//.test(u.pathname))) setImmediate(() => !w.isDestroyed() && w.webContents.downloadURL(url));
    } catch {
      /* not a URL */
    }
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!curseSiteAllowed(url)) e.preventDefault();
  });
  w.on('page-title-updated', (e) => e.preventDefault());
  const handler = (_e, item) => onDownload(item);
  ses.on('will-download', handler);
  w.on('closed', () => {
    ses.removeListener('will-download', handler);
    onClosed();
  });
  return {
    load: (url) => {
      if (!w.isDestroyed() && curseSiteAllowed(url)) w.loadURL(url).catch(() => {});
    },
    close: () => {
      if (!w.isDestroyed()) w.destroy();
    },
    setTitle: (text) => {
      if (!w.isDestroyed()) w.setTitle(text);
    },
  };
}

let blockedDownloads = null;
function getBlockedDownloads() {
  if (blockedDownloads) return blockedDownloads;
  const PACK_FOLDERS = ['mods', 'resourcepacks', 'shaderpacks', 'datapacks', 'saves'];
  blockedDownloads = new BlockedDownloads({
    openBrowser: openCurseBrowser,
    // (with the test network nothing outside the app is opened)
    openExternal: (url) => curseSiteAllowed(url) && !process.env.HAVIHUB_MOCK_NET && shell.openExternal(url),
    downloadsDir: () => process.env.HAVIHUB_DOWNLOADS_DIR || app.getPath('downloads'),
    emit,
    // the file is on this computer now: the install that was waiting for it finishes
    complete: async (entry) => {
      const r = entry.resume || {};
      if (r.kind === 'pack') {
        if (!PACK_FOLDERS.includes(r.folder) || !r.version || !r.version.files || !r.version.files[0]) throw new UserError('Archivo de modpack no válido');
        r.version.files[0].filename = path.basename(String(r.version.files[0].filename));
        await need('modpacks').placeFile({ game: String(r.game), folder: r.folder, version: r.version, mod: r.mod });
        emit('content:changed', {});
        return;
      }
      const out = r.kind === 'world' ? await need('platforms').installWorld(r.args) : await need('platforms').install(r.args);
      if (out.failed && out.failed.length) throw new Error(out.failed[0].reason);
      if (out.blocked && out.blocked.length) throw new UserError('No se pudo instalar el archivo descargado.');
    },
  });
  return blockedDownloads;
}

// Havi Hub's icon at a given size as BGRA pixels with straight alpha (for the
// engine program's own icon, see engine-brand.js)
let appIconImage = null;
function appIconBitmap(size) {
  try {
    if (!appIconImage) appIconImage = nativeImage.createFromPath(path.join(RENDERER_DIR, 'static', 'icon.png'));
    if (appIconImage.isEmpty()) return null;
    const bmp = appIconImage.resize({ width: size, height: size, quality: 'best' }).toBitmap({ scaleFactor: 1 });
    if (bmp.length !== size * size * 4) return null;
    for (let i = 0; i < bmp.length; i += 4) {
      const a = bmp[i + 3];
      if (a === 0 || a === 255) continue; // stored premultiplied
      bmp[i] = Math.min(255, Math.round((bmp[i] * 255) / a));
      bmp[i + 1] = Math.min(255, Math.round((bmp[i + 1] * 255) / a));
      bmp[i + 2] = Math.min(255, Math.round((bmp[i + 2] * 255) / a));
    }
    return bmp;
  } catch {
    return null;
  }
}

// A shortcut asked to start an instance: Havi Hub comes to the front on that
// instance's page and starts it from there (the renderer takes the request).
let pendingLaunch = null;

function launchArg(argv) {
  const i = (argv || []).indexOf('--launch');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

function launchFromArgs(argv) {
  const id = launchArg(argv);
  if (!id) return false;
  pendingLaunch = { id, at: Date.now() };
  showWindow();
  emit('app:launch-request', { id });
  return true;
}

// The only guest pages the app shows are the social networks' own embeddable
// pages (Instagram, X, TikTok). A guest gets no access to the app, stays on
// those hosts, and every link in it opens in the person's browser.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!isSocialEmbed(params.src)) event.preventDefault();
  });
  if (contents.getType() !== 'webview') return;
  // a link inside a network's page (a post, a profile): in the default browser
  const outside = (url) => {
    if (!/^https:\/\//i.test(url)) return;
    if (process.env.HAVIHUB_MOCK_NET) (global.__havihubOpened = global.__havihubOpened || []).push(url); // tests: only noted
    else shell.openExternal(url);
  };
  contents.setWindowOpenHandler(({ url }) => {
    outside(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (isSocialEmbed(url)) return;
    e.preventDefault();
    outside(url);
  });
  contents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    if (launchFromArgs(argv)) return;
    showWindow();
  });
  app.whenReady().then(async () => {
    config = new AppConfig(app.getPath('userData'));
    await config.load();
    if (process.env.HAVIHUB_PRISM_DIR) await config.update({ dataDir: process.env.HAVIHUB_PRISM_DIR });
    if (process.env.HAVIHUB_TEST_CF_KEY) await config.update({ curseforgeApiKey: process.env.HAVIHUB_TEST_CF_KEY });
    registerProtocol();
    await initPrism().catch((e) => console.error('initPrism', e));
    // YouTube's player refuses to play ("error 153") when the page that embeds
    // it does not say who it is, and a page of an app has no address to give.
    // So the player's own requests say it for it: the app's identifier, the
    // way YouTube asks apps to identify themselves.
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*', 'https://www.youtube-nocookie.com/embed/*'] }, (details, done) => {
      done({ requestHeaders: { ...details.requestHeaders, Referer: APP_REFERER } });
    });
    createWindow();
    // Havikun's channels: what was fetched is kept on disk, and fetched again shortly after start
    social.configure({ file: path.join(app.getPath('userData'), 'cache', 'social.json'), emit });
    if (!process.env.HAVIHUB_MOCK_NET) setTimeout(() => socialAutoload() && social.warm(), 6000);
    launchFromArgs(process.argv);
    // tests: the social networks' pages are served by a stand-in on this computer
    if (process.env.HAVIHUB_SOCIAL_TEST) {
      session.fromPartition('persist:social').webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (d, cb) => cb({ redirectURL: `${process.env.HAVIHUB_SOCIAL_TEST}/embed?u=${encodeURIComponent(d.url)}` }));
    }
    syncLinuxMenu().catch((e) => console.error('linux menu', e));
    // the browser tab after a Microsoft sign-in shows Havi Hub's own page (loginpage.js)
    fsp
      .readFile(path.join(RENDERER_DIR, 'static', 'icon.png'))
      .catch(() => null)
      .then((png) => startLoginPage({ language: () => (engineLanguage(config.get().language, systemLocale()) === 'en_US' ? 'en' : 'es'), iconPng: png ? nativeImage.createFromBuffer(png).resize({ width: 192, quality: 'best' }).toPNG() : null }));
    // Profile shortcuts made before the app moved to its new folder point to the old .exe and folders
    if (process.platform === 'win32' && app.isPackaged) {
      setTimeout(() => {
        try {
          const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
          repairShortcuts({ shell, dirs: [app.getPath('desktop')], exe, oldRoots: legacyRoots, newRoot: app.getPath('userData') });
        } catch (e) {
          console.error('shortcuts', e);
        }
      }, 5000);
    }
    // Linux: profile shortcuts whose program is gone (the package moved to /opt/havihub, a newer AppImage file)
    if (process.platform === 'linux' && app.isPackaged) {
      setTimeout(() => {
        const { exe, preArgs } = selfCommand();
        const apps = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications');
        repairLinuxShortcuts({ dirs: [app.getPath('desktop'), apps], exe, preArgs }).catch((e) => console.error('shortcuts', e));
      }, 5000);
    }
    // Every start: look for a new Prism Launcher release in the background
    if (engine) {
      setTimeout(() => engine.check({ force: true }), 2500);
      setInterval(() => engine.check(), 6 * 3600 * 1000).unref();
    }
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    if (asleep || BrowserWindow.getAllWindows().length) return; // put away in the tray, not closed
    app.quit();
  });
}

module.exports = { api, readMetadata };
