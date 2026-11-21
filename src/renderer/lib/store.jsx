// Global app state and actions (React context).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { call, on, saved } from './api.js';
import { applyTheme } from './theme.js';
import { now, setClockOffset } from './clock.js';
import { activeSeason } from '../../shared/seasons.js';
import { setLanguage, t } from './i18n.js';
import { ConfirmDialog, PromptDialog } from '../components/Modal.jsx';
import ModpackKeysDialog from '../dialogs/ModpackKeysDialog.jsx';
import { capturingInput } from './inputCapture.js';
import { setQuiet } from './quiet.js';
import { loadMcTextures, useMcTextures } from './mc-textures.js';
import { parseRecipe, recipeKey, iconPng, usingMinecraft } from './instance-icons.js';
import { setInputNotice } from './inputGuard.js';

const Ctx = createContext(null);

export function useApp() {
  return useContext(Ctx);
}

let toastId = 1;

// After sleeping in the tray the window opens on the page it was on.
function resumeRoute() {
  if (typeof location === 'undefined' || location.hash !== '#resume') return null;
  try {
    const r = JSON.parse(localStorage.getItem('havihub.route') || 'null');
    return r && typeof r.page === 'string' ? r : null;
  } catch {
    return null;
  }
}

export function AppProvider({ children }) {
  const [appState, setAppState] = useState(null);
  const [instances, setInstances] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupImages, setGroupImages] = useState({});
  const [instancesLoaded, setInstancesLoaded] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [running, setRunning] = useState(new Set());
  const [launching, setLaunching] = useState(new Set());
  const [engineStatus, setEngineStatus] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [dialogs, setDialogs] = useState([]);
  const [history, setHistory] = useState(() => ({ stack: [resumeRoute() || { page: 'library' }], index: 0 }));
  const [maximized, setMaximized] = useState(false);
  const [langVersion, setLangVersion] = useState(0);
  const [contentVersion, setContentVersion] = useState(0);
  const [skinsVersion, setSkinsVersion] = useState(0);

  const route = history.stack[history.index];

  // Sleeping in the tray (see main.js): the page remembers where it was, says
  // when it may be put away (nothing open, nothing starting) and, once built
  // again, when it is ready to hear what happened meanwhile.
  useEffect(() => {
    try {
      localStorage.setItem('havihub.route', JSON.stringify(route));
    } catch {
      // not essential
    }
  }, [route]);
  const idleRef = useRef(true);
  idleRef.current = dialogs.length === 0 && launching.size === 0;
  useEffect(() => {
    window.__havihubCanSleep = () => idleRef.current && !document.querySelector('.modal-backdrop');
    return () => {
      delete window.__havihubCanSleep;
    };
  }, []);
  useEffect(() => {
    if (instancesLoaded) call('ui.ready').catch(() => {});
  }, [instancesLoaded]);
  // Havi Hub stands still ("quiet": snow, bats, lights, the 3D skin view, spinners)
  // while it is not the window in use: at once if a game is open, after half a
  // minute otherwise. Everything moves again the moment you come back.
  const gameOpen = running.size > 0;
  useEffect(() => {
    let timer = 0;
    const update = () => {
      clearTimeout(timer);
      timer = 0;
      if (document.hasFocus()) setQuiet(false);
      else if (gameOpen) setQuiet(true);
      else timer = setTimeout(() => setQuiet(!document.hasFocus()), window.__havihubQuietAfterMs || 30000);
    };
    update();
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      setQuiet(false);
    };
  }, [gameOpen]);

  // config arrives in replies and in change events (different IPC channels,
  // either can come first): keep only the newest revision
  const cfgRev = useRef(-1);
  const lastConfig = useRef(null);
  const freshConfig = useCallback((cfg) => {
    if (!cfg) return false;
    if (typeof cfg._rev === 'number') {
      if (cfg._rev < cfgRev.current) return false;
      cfgRev.current = cfg._rev;
    }
    lastConfig.current = cfg;
    return true;
  }, []);

  // ---- toasts ----
  const dismissToast = useCallback((id) => setToasts((l) => l.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message, opts = {}) => {
      const id = toastId++;
      const type = opts.type || 'info';
      // the same notice already on screen is not shown twice
      setToasts((l) => (l.some((x) => x.message === message && x.type === type) ? l : [...l.slice(-4), { id, message, type, action: opts.action, title: opts.title }]));
      setTimeout(() => dismissToast(id), opts.duration || (opts.type === 'error' ? 8000 : 4500));
      return id;
    },
    [dismissToast],
  );

  useEffect(() => {
    setInputNotice((max) => toast(t('El texto se recortó: este campo admite hasta {n} caracteres.', { n: max }), { type: 'warning' }));
  }, [toast]);

  const showError = useCallback(
    (e) => {
      if (e && e.code === 'CANCELLED') return; // stopped on purpose
      console.error(e);
      toast(e && e.message ? e.message : String(e), { type: 'error' });
    },
    [toast],
  );

  // ---- dialogs ----
  const openDialog = useCallback(
    (Component, props = {}) =>
      new Promise((resolve) => {
        const id = toastId++;
        const onResolve = (value) => {
          setDialogs((l) => l.filter((d) => d.id !== id));
          resolve(value);
        };
        setDialogs((l) => [...l, { id, Component, props: { ...props, onResolve } }]);
      }),
    [],
  );
  const confirm = useCallback((opts) => openDialog(ConfirmDialog, opts), [openDialog]);
  const prompt = useCallback((opts) => openDialog(PromptDialog, opts), [openDialog]);

  // ---- navigation ----
  const navigate = useCallback((r, { replace = false } = {}) => {
    setHistory((h) => {
      const cur = h.stack[h.index];
      if (JSON.stringify(cur) === JSON.stringify(r)) return h;
      if (replace) {
        const stack = [...h.stack];
        stack[h.index] = r;
        return { stack, index: h.index };
      }
      const stack = [...h.stack.slice(0, h.index + 1), r].slice(-60);
      return { stack, index: stack.length - 1 };
    });
  }, []);
  const back = useCallback(() => setHistory((h) => (h.index > 0 ? { ...h, index: h.index - 1 } : h)), []);
  const forward = useCallback(() => setHistory((h) => (h.index < h.stack.length - 1 ? { ...h, index: h.index + 1 } : h)), []);
  const patchRoute = useCallback((patch) => setHistory((h) => {
    const stack = [...h.stack];
    stack[h.index] = { ...stack[h.index], ...patch };
    return { stack, index: h.index };
  }), []);

  // ---- data ----
  const refreshState = useCallback(async () => {
    const s = await call('app.state');
    if (!freshConfig(s.config) && lastConfig.current) s.config = lastConfig.current;
    setAppState(s);
    if (s.engine) setEngineStatus(s.engine);
    return s;
  }, []);

  const refreshInstances = useCallback(async () => {
    try {
      const r = await call('instances.list');
      setInstances(r.instances);
      setGroups(r.groups);
      setGroupImages(r.groupImages || {});
    } catch (e) {
      if (e.code !== 'NO_DATA') showError(e);
      setInstances([]);
      setGroups([]);
      setGroupImages({});
    } finally {
      setInstancesLoaded(true);
    }
  }, [showError]);

  const refreshAccounts = useCallback(async () => {
    try {
      setAccounts(await call('accounts.list'));
    } catch {
      setAccounts([]);
    }
  }, []);

  const updateConfig = useCallback(async (patch) => {
    const config = await call('app.updateConfig', patch);
    if (freshConfig(config)) setAppState((s) => ({ ...s, config }));
    // a setting changed by hand (the Settings page or window is open): say it was saved.
    // The many things Havi Hub notes down by itself go through here too, and say nothing.
    if (document.querySelector('.settings, .mr-settings-window')) saved();
    return config;
  }, []);

  // Switch layout: its original theme comes with it
  const setLayout = useCallback(async (layout) => {
    await call('app.setConfigKey', 'palette', {});
    const config = await call('app.updateConfig', { layout, themePreset: layout === 'modrinth' ? 'modrinth' : 'forge' });
    if (freshConfig(config)) setAppState((s) => ({ ...s, config }));
    return config;
  }, []);

  const setConfigKey = useCallback(async (key, value) => {
    const config = await call('app.setConfigKey', key, value);
    if (freshConfig(config)) setAppState((s) => ({ ...s, config }));
    return config;
  }, []);

  // apply theme & language whenever config changes
  const config = appState ? appState.config : null;

  // Minecraft's textures (from the game on this computer) for icons and the skin
  // stage. The pictures saved for editor-made icons are redrawn once with them,
  // so the game's own windows and the other launchers show the same icon.
  const mcVersion = useMcTextures();
  const iconsRedrawn = useRef(false);
  useEffect(() => {
    loadMcTextures();
  }, []);
  useEffect(() => {
    if (!instancesLoaded || !config || config.iconStyle === 2 || iconsRedrawn.current || !usingMinecraft()) return;
    iconsRedrawn.current = true;
    (async () => {
      for (const inst of instances) {
        const r = parseRecipe(inst.iconRecipe);
        if (!r) continue;
        try {
          await window.havihub.call('instances.setImage', inst.id, await iconPng(r), { recipe: recipeKey(r) }); // straight to the bridge: nobody asked for this, so no "saved" mark
        } catch {
          // that one keeps its picture
        }
      }
      await updateConfig({ iconStyle: 2 });
      refreshInstances();
    })();
  }, [instancesLoaded, mcVersion, config && config.iconStyle]);

  // seasonal theme: the one whose week it is (unless turned off), or the one
  // being previewed from Settings; checked again every half minute
  const [seasonPreview, setSeasonPreview] = useState(null);
  const [seasonTick, setSeasonTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeasonTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  if (appState) setClockOffset(appState.clockOffset);
  const seasonsKey = config ? JSON.stringify(config.seasons || {}) : '';
  const season = useMemo(() => {
    if (!config) return null;
    if (seasonPreview) return seasonPreview;
    return activeSeason(now(), config.seasons || {});
  }, [seasonsKey, seasonPreview, seasonTick, appState && appState.clockOffset]);

  useEffect(() => {
    if (!config) return;
    applyTheme(config.themePreset, config.palette, { reduceMotion: config.reduceMotion, season, layout: config.layout || 'curseforge' });
  }, [config && config.themePreset, config && JSON.stringify(config.palette), config && config.reduceMotion, season, config && config.layout]);
  useEffect(() => {
    if (!appState) return;
    setLanguage(appState.config.language, appState.locale);
    setLangVersion((v) => v + 1);
  }, [appState && appState.config.language, appState && appState.locale]);

  // initial load + events
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    (async () => {
      try {
        const s = await refreshState();
        setLanguage(s.config.language, s.locale);
        setClockOffset(s.clockOffset);
        applyTheme(s.config.themePreset, s.config.palette, { reduceMotion: s.config.reduceMotion, season: activeSeason(now(), s.config.seasons || {}), layout: s.config.layout || 'curseforge' });
      } catch (e) {
        showError(e);
      }
      await Promise.all([refreshInstances(), refreshAccounts()]);
      try {
        setTasks(await call('tasks.list'));
        setRunning(new Set(await call('instances.running')));
      } catch {
        /* ignore */
      }
    })();
    const offs = [
      on('instances:changed', () => refreshInstances()),
      on('accounts:changed', () => refreshAccounts()),
      on('skins:changed', () => setSkinsVersion((v) => v + 1)),
      on('content:changed', () => setContentVersion((v) => v + 1)),
      on('tasks:update', (list) => setTasks(list)),
      on('config:changed', (cfg) => {
        if (freshConfig(cfg)) setAppState((s) => (s ? { ...s, config: cfg } : s));
      }),
      on('window:maximized', (m) => setMaximized(m)),
      on('engine:status', (st) => setEngineStatus(st)),
      // a modpack installed with key bindings of its own: whose to use (ModpackKeysDialog)
      on('modpack:keys', async ({ id, name }) => {
        const choice = await openDialog(ModpackKeysDialog, { name });
        if (choice !== 'mine') return;
        try {
          await call('instances.applyKeysTo', id);
          toast(t('Tus teclas quedaron puestas en {name}', { name }), { type: 'success' });
        } catch (e) {
          showError(e);
        }
      }),
      on('toast', (x) => toast(x.vars ? t(x.message, Object.fromEntries(Object.entries(x.vars).map(([k, v]) => [k, typeof v === 'string' ? t(v) : v]))) : x.message, { type: x.type || 'info', duration: x.vars ? 12000 : undefined })),
      on('instance:running', ({ id, running: isRunning, preparing, crashed, crash, failed, error }) => {
        setLaunching((prev) => {
          const n = new Set(prev);
          if (isRunning && preparing) n.add(id);
          else n.delete(id);
          return n;
        });
        setRunning((prev) => {
          const n = new Set(prev);
          if (isRunning) n.add(id);
          else n.delete(id);
          return n;
        });
        if (error) toast(t('No se pudo iniciar el juego: {e}', { e: error }), { type: 'error', duration: 10000 });
        if (!isRunning) refreshInstances();
        if (crashed) window.dispatchEvent(new CustomEvent('havihub:crashed', { detail: { id, crash, failed } }));
      }),
    ];
    return () => offs.forEach((f) => f());
  }, [refreshState, refreshInstances, refreshAccounts, showError, toast]);

  // keyboard / mouse navigation (mouse back/forward buttons, Alt+arrows)
  useEffect(() => {
    const onMouse = (e) => {
      if (capturingInput()) return; // a control is being assigned
      if (e.button === 3) back();
      if (e.button === 4) forward();
    };
    const onKey = (e) => {
      if (capturingInput()) return;
      if (e.altKey && e.key === 'ArrowLeft') back();
      if (e.altKey && e.key === 'ArrowRight') forward();
    };
    window.addEventListener('mouseup', onMouse);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mouseup', onMouse);
      window.removeEventListener('keydown', onKey);
    };
  }, [back, forward]);

  const launchingNow = useRef(new Set());
  const launch = useCallback(
    async (id, opts = {}) => {
      if (launchingNow.current.has(id) || launching.has(id)) return; // a double click starts it once
      launchingNow.current.add(id);
      setTimeout(() => launchingNow.current.delete(id), 4000);
      setLaunching((prev) => new Set(prev).add(id));
      const inst = instances.find((i) => i.id === id);
      toast(t('Iniciando {name}…', { name: inst ? inst.name : id }), { type: 'success' });
      try {
        await call('instances.launch', id, opts);
      } catch (e) {
        launchingNow.current.delete(id);
        setLaunching((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
        if (e.code === 'NO_ENGINE') {
          toast(e.message, { type: 'error', duration: 10000, action: { label: t('Abrir ajustes'), onClick: () => navigate({ page: 'settings', section: 'launcher' }) } });
        } else if (e.code === 'NEEDS_LOGIN') {
          // loaded here: the dialog itself uses this store
          const { default: AddAccountDialog } = await import('../dialogs/AddAccountDialog.jsx');
          const name = (e.data && e.data.account) || '';
          if (await openDialog(AddAccountDialog, { relogin: name })) launch(id, opts);
        } else showError(e);
      }
    },
    [instances, launching, toast, showError, navigate, openDialog],
  );

  // A game that crashed: Havi Hub comes to the front (main process) and opens
  // the file that tells why. One that could not start says so.
  useEffect(() => {
    const onCrash = (e) => {
      const { id, crash, failed } = e.detail;
      const inst = instances.find((i) => i.id === id);
      const name = inst ? inst.name : id;
      if (crash) {
        navigate({ page: 'instance', id, tab: 'logs', logFile: crash.file });
        toast(t('{name} se cerró por un error.', { name }), { type: 'error', duration: 9000 });
      } else if (failed) {
        toast(t('{name} no se pudo iniciar.', { name }), { type: 'error', duration: 10000, action: { label: t('Ver log'), onClick: () => navigate({ page: 'instance', id, tab: 'logs' }) } });
      }
    };
    window.addEventListener('havihub:crashed', onCrash);
    return () => window.removeEventListener('havihub:crashed', onCrash);
  }, [instances, navigate, toast]);

  const activeAccount = accounts.find((a) => a.active) || accounts[0] || null;

  const value = useMemo(
    () => ({
      appState,
      config,
      engineStatus,
      launching,
      instances,
      groups,
      groupImages,
      instancesLoaded,
      accounts,
      activeAccount,
      tasks,
      running,
      toasts,
      route,
      history,
      maximized,
      langVersion,
      contentVersion,
      skinsVersion,
      bumpContent: () => setContentVersion((v) => v + 1),
      navigate,
      back,
      forward,
      patchRoute,
      toast,
      dismissToast,
      showError,
      confirm,
      prompt,
      openDialog,
      refreshState,
      refreshInstances,
      refreshAccounts,
      updateConfig,
      setConfigKey,
      setLayout,
      launch,
      season,
      seasonPreview,
      setSeasonPreview,
    }),
    [season, seasonPreview, appState, config, engineStatus, launching, instances, groups, groupImages, instancesLoaded, accounts, activeAccount, tasks, running, toasts, route, history, maximized, langVersion, contentVersion, skinsVersion, navigate, back, forward, patchRoute, toast, dismissToast, showError, confirm, prompt, openDialog, refreshState, refreshInstances, refreshAccounts, updateConfig, setConfigKey, setLayout, launch],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {dialogs.map((d) => (
        <d.Component key={d.id} {...d.props} />
      ))}
    </Ctx.Provider>
  );
}
