import { useEffect, useRef } from 'react';
import SavedMark from './components/SavedMark.jsx';
import { useApp, AppProvider } from './lib/store.jsx';
import { call } from './lib/api.js';
import { t } from './lib/i18n.js';
import CloseBehaviorDialog from './dialogs/CloseBehaviorDialog.jsx';
import SocialsDialog from './dialogs/SocialsDialog.jsx';
import CloseTasksDialog from './dialogs/CloseTasksDialog.jsx';
import { on } from './lib/api.js';
import { Titlebar, Sidebar, GameHeader, TopTabs } from './components/Shell.jsx';
import Icon from './components/Icon.jsx';
import { Spinner } from './components/ui.jsx';
import Library from './pages/Library.jsx';
import InstancePage from './pages/Instance.jsx';
import Discover from './pages/Discover.jsx';
import Browse from './pages/Browse.jsx';
import Project from './pages/Project.jsx';
import Servers from './pages/Servers.jsx';
import Skins from './pages/Skins.jsx';
import SeasonLayer, { Garland, SeasonBackdrop } from './components/Seasonal.jsx';
import Gallery from './pages/Gallery.jsx';
import Settings from './pages/Settings.jsx';
import Home from './pages/Home.jsx';
import { Help } from './pages/Misc.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import TooltipLayer from './components/Tooltip.jsx';
import WelcomeGate from './components/Welcome.jsx';
import Tour from './components/Tour.jsx';
import { needsWelcome } from './lib/welcome.js';
import MrShell from './modrinth/MrShell.jsx';
import MrHome from './modrinth/MrHome.jsx';
import MrInstance from './modrinth/MrInstance.jsx';
import MrBrowse from './modrinth/MrBrowse.jsx';

function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.type}`}>
          <Icon name={x.type === 'error' ? 'xCircle' : x.type === 'success' ? 'checkCircle' : x.type === 'warning' ? 'alert' : 'info'} size={20} />
          <div className="toast-text">
            {x.title ? <strong>{x.title}</strong> : null}
            {x.message}
            {x.action ? (
              <div>
                <button
                  className="toast-action"
                  onClick={() => {
                    x.action.onClick();
                    dismissToast(x.id);
                  }}
                >
                  {x.action.label}
                </button>
              </div>
            ) : null}
          </div>
          <button className="icon-btn" onClick={() => dismissToast(x.id)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Main() {
  const { route, appState, langVersion } = useApp();
  if (!appState) {
    return (
      <div className="main">
        <div className="center-spinner full">
          <Spinner size={36} />
        </div>
      </div>
    );
  }
  if (route.page === 'settings')
    return (
      <ErrorBoundary resetKey={JSON.stringify(route)}>
        <Settings key={langVersion} />
      </ErrorBoundary>
    );
  const gamePage = ['library', 'instance', 'discover', 'browse', 'project', 'servers', 'screenshots', 'skins'].includes(route.page);
  let page;
  switch (route.page) {
    case 'home':
      page = <Home />;
      break;
    case 'instance':
      page = <InstancePage />;
      break;
    case 'discover':
      page = <Discover />;
      break;
    case 'browse':
      page = <Browse />;
      break;
    case 'project':
      page = <Project />;
      break;
    case 'servers':
      page = <Servers />;
      break;
    case 'skins':
      page = <Skins />;
      break;
    case 'screenshots':
      page = <Gallery />;
      break;
    case 'help':
      page = <Help />;
      break;
    default:
      page = <Library />;
  }
  return (
    <div className="main" key={langVersion}>
      <SeasonBackdrop />
      {gamePage ? (
        <>
          <Garland />
          <GameHeader />
          <TopTabs />
        </>
      ) : null}
      <ErrorBoundary resetKey={JSON.stringify(route)}>{page}</ErrorBoundary>
    </div>
  );
}

// Whoever updated from a version that didn't ask it yet: what the window's X
// does, and whether Havikun's channels load on their own. A new installation
// answers both in the welcome (components/Welcome.jsx).
// Asked once per start, even if the shell changes layout under it.
let firstRunStarted = false;
function FirstRun() {
  const app = useApp();
  useEffect(() => {
    if (firstRunStarted || !app.config || !app.instancesLoaded) return;
    firstRunStarted = true;
    // decided once per start, like the welcome: a welcome shown now asks the
    // same itself, even once its first answers make it look no longer due
    // (a layout chosen with instances already there)
    if (needsWelcome(app.config, app.instances)) return;
    // what the welcome asks, for whoever updated from a version that didn't
    const askClose = app.config.closeToTray === null || app.config.closeToTray === undefined;
    const askSocials = !(app.config.privacy && app.config.privacy.socialAsked);
    if (!askClose && !askSocials) return;
    (async () => {
      if (askClose) {
        const choice = await app.openDialog(CloseBehaviorDialog, {});
        await app.updateConfig({ closeToTray: choice === true });
      }
      if (askSocials) {
        const auto = await app.openDialog(SocialsDialog, {});
        await app.updateConfig({ privacy: { socialAutoload: auto !== false, socialAsked: true } });
      }
    })();
  }, [app.config, app.instancesLoaded]);
  return null;
}

// A desktop shortcut asked to start an instance: show its page and start it
function LaunchRequests() {
  const app = useApp();
  const ref = useRef(app);
  ref.current = app;
  const ready = Boolean(app.appState && app.instancesLoaded);
  const take = async () => {
    const a = ref.current;
    const id = await call('app.takePendingLaunch').catch(() => null);
    if (!id) return;
    const inst = a.instances.find((i) => i.id === id);
    if (!inst) {
      a.toast(t('No encontré el perfil de ese acceso directo ({id}). Puede que lo hayas borrado.', { id }), { type: 'error', duration: 9000 });
      return;
    }
    a.navigate({ page: 'instance', id });
    a.launch(id);
  };
  useEffect(() => {
    if (ready) take();
  }, [ready]);
  useEffect(
    () =>
      on('app:launch-request', () => {
        const a = ref.current;
        if (a.appState && a.instancesLoaded) take();
      }),
    [],
  );
  return null;
}

// The X while tasks are running: main asks, this answers (CloseTasksDialog)
function CloseGuard() {
  const app = useApp();
  const open = useRef(false);
  useEffect(
    () =>
      on('app:close-request', async ({ tasks, tray }) => {
        if (open.current) return;
        open.current = true;
        await app.openDialog(CloseTasksDialog, { tasks, tray });
        open.current = false;
      }),
    [app.openDialog],
  );
  return null;
}

// Pages of the Modrinth layout (the shared ones are the same components)
const MR_PAGES = {
  pick(route) {
    switch (route.page) {
      case 'instance':
        return MrInstance;
      case 'browse':
      case 'discover':
        return MrBrowse;
      case 'project':
        return Project;
      case 'servers':
        return Servers;
      case 'skins':
        return Skins;
      case 'screenshots':
        return Gallery;
      case 'help':
        return Help;
      default:
        return MrHome;
    }
  },
  Settings,
};

function Shell() {
  const app = useApp();
  const { route } = app;
  const layout = (app.config && app.config.layout) || 'curseforge';
  const tree =
    layout === 'modrinth' ? (
      <>
        <MrShell pages={MR_PAGES} />
        <Toasts />
        <SavedMark />
        <FirstRun />
        <CloseGuard />
        <LaunchRequests />
        <TooltipLayer />
        <ErrorBoundary resetKey="season" fallback={() => null}>
          <SeasonLayer />
        </ErrorBoundary>
      </>
    ) : (
      <div className="app">
        <Titlebar />
        <div className={`app-body ${route.page === 'settings' ? 'settings-open' : ''}`}>
          {route.page === 'settings' ? null : <Sidebar />}
          <Main />
        </div>
        <Toasts />
        <SavedMark />
        <FirstRun />
        <CloseGuard />
        <LaunchRequests />
        <TooltipLayer />
        <ErrorBoundary resetKey="season" fallback={() => null}>
          <SeasonLayer />
        </ErrorBoundary>
      </div>
    );
  // the welcome sits outside both layouts, so choosing one in it keeps it in place
  return (
    <>
      {tree}
      <WelcomeGate after={app.config && app.config.welcomeDone ? <Tour /> : null} />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
