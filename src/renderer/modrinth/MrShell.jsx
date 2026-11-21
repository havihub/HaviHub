// The Modrinth layout: a title bar with back/forward and breadcrumbs, a
// narrow icon bar on the left (pages, recent instances, create, settings,
// account), the page in a rounded panel, and a sidebar on the right with the
// account, first steps, downloads and Havikun's channels. Same features as the CurseForge
// layout, arranged the way the Modrinth app arranges them.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../components/Icon.jsx';
import { Progress, Spinner } from '../components/ui.jsx';
import { Popover, MenuItem, MenuSeparator, useMenu } from '../components/Menu.jsx';
import { Logo, AccountAvatar, AccountMenuContent, DownloadsPanel } from '../components/Shell.jsx';
import InstanceImage from '../components/InstanceImage.jsx';
import ImportLaunchersDialog from '../dialogs/ImportLaunchersDialog.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { useApp } from '../lib/store.jsx';
import { call } from '../lib/api.js';
import { t, tm } from '../lib/i18n.js';
import { timeAgo } from '../lib/format.js';
import MrSocials from './MrSocials.jsx';
import { useDropTarget } from '../lib/instanceDrag.js';
import { capturingInput } from '../lib/inputCapture.js';
import { MrNavDecor, MrTitleDecor } from './MrSeasonal.jsx';
import { SeasonBackdrop } from '../components/Seasonal.jsx';

// ---------------------------------------------------------------- sidebar slot
// Pages put their own sidebar content (browse filters) in the right sidebar.
const SlotCtx = createContext(null);

export function SidebarPortal({ children }) {
  const node = useContext(SlotCtx);
  if (!node) return null;
  return createPortal(children, node);
}

// pages with the right sidebar
const SIDEBAR_PAGES = new Set(['home', 'library', 'instance', 'browse', 'discover']);

// ---------------------------------------------------------------- title bar
function crumbsFor(route, app) {
  const inst = route.instanceId || route.id ? app.instances.find((i) => i.id === (route.instanceId || route.id)) : null;
  const TYPE = { modpack: t('Modpacks'), mod: t('Mods'), resourcepack: t('Resource Packs'), shader: t('Shaders'), datapack: t('Data Packs'), world: t('Mundos') };
  const TAB = { worlds: t('Mundos'), logs: t('Registros'), screenshots: t('Capturas') };
  switch (route.page) {
    case 'instance':
      return [{ label: t('Biblioteca'), to: { page: 'library' } }, { label: inst ? inst.name : route.id, to: { page: 'instance', id: route.id } }, ...(route.tab && TAB[route.tab] ? [{ label: TAB[route.tab] }] : [])];
    case 'browse':
    case 'discover':
      if (inst) return [{ label: t('Biblioteca'), to: { page: 'library' } }, { label: inst.name, to: { page: 'instance', id: inst.id } }, { label: t('Agregar contenido') }];
      return [{ label: t('Descubrir contenido') }, { label: TYPE[route.type || 'modpack'] || '' }];
    case 'project':
      return inst ? [{ label: inst.name, to: { page: 'instance', id: inst.id } }, { label: t('Proyecto') }] : [{ label: t('Descubrir contenido'), to: { page: 'browse', type: 'modpack' } }, { label: t('Proyecto') }];
    case 'servers':
      return [{ label: t('Servidores') }];
    case 'skins':
      return [{ label: t('Skins') }];
    case 'screenshots':
      return [{ label: t('Capturas') }];
    case 'help':
      return [{ label: t('Ayuda') }];
    case 'settings':
      return [{ label: t('Ajustes') }];
    default:
      return [{ label: t('Inicio') }];
  }
}

function TitleBar() {
  const app = useApp();
  const { back, forward, history, maximized, route, tasks } = app;
  const crumbs = useMemo(() => crumbsFor(route, app), [route, app.instances, app.langVersion]);
  const dl = useMenu();
  const more = useMenu();
  const running = tasks.filter((x) => x.status === 'running');
  const progress = running.length ? running.reduce((a, x) => a + (x.progress || 0), 0) / running.length : 0;
  const playing = app.instances.filter((i) => app.running.has(i.id));
  return (
    <header className="mr-titlebar">
      <MrTitleDecor />
      <div className="mr-tb-left">
        <span className="mr-wordmark">
          <Logo size={26} />
          <span>Havi Hub</span>
        </span>
        <button className="mr-nav-arrow" disabled={history.index === 0} onClick={back} aria-label={t('Atrás')} data-tip={t('Atrás')}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <button className="mr-nav-arrow" disabled={history.index >= history.stack.length - 1} onClick={forward} aria-label={t('Adelante')} data-tip={t('Adelante')}>
          <Icon name="chevronRight" size={16} />
        </button>
        <nav className="mr-crumbs" aria-label={t('Ubicación')}>
          {crumbs.map((c, i) => (
            <span key={i} className="mr-crumb-wrap">
              {i ? <Icon name="chevronRight" size={14} className="mr-crumb-sep" /> : null}
              {c.to && i < crumbs.length - 1 ? (
                <button className="mr-crumb" onClick={() => app.navigate(c.to)}>
                  {c.label}
                </button>
              ) : (
                <span className="mr-crumb current">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div className="mr-tb-drag" />
      <div className="mr-tb-actions">
        {playing.length ? (
          <button className="mr-playing" onClick={() => app.navigate({ page: 'instance', id: playing[0].id })} data-tip={t('Jugando')}>
            <span className="mr-playing-dot" />
            <span className="mr-playing-name">{playing[0].name}</span>
            <span
              className="mr-playing-stop"
              role="button"
              aria-label={t('Detener')}
              onClick={(e) => {
                e.stopPropagation();
                call('instances.stop', playing[0].id);
              }}
            >
              <Icon name="stop" size={14} />
            </span>
          </button>
        ) : null}
        <button ref={dl.anchor} className={`mr-tb-btn ${dl.open ? 'on' : ''}`} onClick={dl.toggle} aria-label={t('Descargas')} data-tip={t('Descargas')}>
          {running.length ? <span className="mr-ring" style={{ '--p': `${Math.round(progress * 100)}%` }} /> : null}
          <Icon name="download" size={18} />
        </button>
        <button ref={more.anchor} className={`mr-tb-btn ${more.open ? 'on' : ''}`} onClick={more.toggle} aria-label={t('Más opciones')}>
          <Icon name="moreH" size={18} />
        </button>
        <Popover anchor={dl.anchor} open={dl.open} onClose={dl.close} align="right" className="downloads-pop mr-pop">
          <DownloadsPanel />
        </Popover>
        <Popover anchor={more.anchor} open={more.open} onClose={more.close} align="right" className="menu mr-pop">
          <MenuItem icon="folder" label={t('Abrir carpeta de Havi Hub')} onClick={() => (more.close(), call('app.openDataDir'))} />
          <MenuItem icon="import" label={t('Importar desde otro launcher…')} onClick={() => (more.close(), app.openDialog(ImportLaunchersDialog, {}))} />
          <MenuItem icon="settings" label={t('Ajustes del juego')} onClick={() => (more.close(), app.navigate({ page: 'settings', section: 'minecraft' }))} />
          <MenuSeparator />
          <MenuItem icon="help" label={t('Ayuda')} onClick={() => (more.close(), app.navigate({ page: 'help' }))} />
        </Popover>
      </div>
      <div className="mr-window">
        <button className="mr-win-btn" onClick={() => call('app.window', 'minimize')} aria-label={t('Minimizar')}>
          <Icon name="minimize" size={15} />
        </button>
        <button className="mr-win-btn" onClick={() => call('app.window', 'maximize')} aria-label={maximized ? t('Restaurar') : t('Maximizar')}>
          <Icon name={maximized ? 'restore' : 'maximize'} size={14} />
        </button>
        <button className="mr-win-btn close" onClick={() => call('app.window', 'close')} aria-label={t('Cerrar')}>
          <Icon name="x" size={17} />
        </button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- left bar
function NavButton({ icon, label, active, sub, onClick, children, anchorRef, className = '', tour }) {
  return (
    <button ref={anchorRef} className={`mr-navbtn ${active ? 'active' : ''} ${sub ? 'sub' : ''} ${className}`} onClick={onClick} data-tour={tour} aria-label={label} data-tip={label} data-tip-pos="right">
      {children || <Icon name={icon} size={24} />}
    </button>
  );
}

// a recent instance in the bar; dropping a profile here does nothing special,
// but the library below it takes drops (see MrHome)
function QuickInstance({ inst, active }) {
  const app = useApp();
  const running = app.running.has(inst.id);
  return (
    <button className={`mr-quick ${active ? 'active' : ''} ${running ? 'running' : ''}`} onClick={() => app.navigate({ page: 'instance', id: inst.id })} aria-label={inst.name} data-tip={inst.name} data-tip-pos="right">
      <InstanceImage instance={inst} res={128} />
      {running ? <span className="mr-quick-dot" /> : null}
    </button>
  );
}

function NavBar() {
  const app = useApp();
  const { route, navigate, instances, activeAccount } = app;
  const acc = useMenu();
  const recent = useMemo(
    () =>
      [...instances]
        .filter((i) => i.lastLaunch)
        .sort((a, b) => b.lastLaunch - a.lastLaunch)
        .slice(0, 4),
    [instances],
  );
  const page = route.page;
  const inInstance = route.page === 'instance' || ((route.page === 'browse' || route.page === 'project') && route.instanceId);
  const browsing = (page === 'browse' || page === 'discover' || page === 'project') && !route.instanceId;
  // dropping a profile on Inicio takes it out of its group
  const [libProps, libOver] = useDropTarget(async (id) => {
    const inst = instances.find((i) => i.id === id);
    if (!inst || !inst.group) return;
    try {
      await call('instances.setGroup', id, '');
      app.toast(t('{name} salió del grupo {group}', { name: inst.name, group: inst.group }), { type: 'success' });
    } catch (e) {
      app.showError(e);
    }
  });
  return (
    <nav className="mr-navbar">
      <MrNavDecor />
      <div className={`mr-navbtn-wrap ${libOver ? 'drop' : ''}`} {...libProps}>
        <NavButton icon="play" label={t('Inicio')} active={page === 'home' || page === 'library'} sub={inInstance} onClick={() => navigate({ page: 'library' })} />
      </div>
      <NavButton icon="compass" tour="browse" label={t('Descubrir contenido')} active={browsing} onClick={() => navigate({ page: 'browse', type: route.type && browsing ? route.type : 'modpack' })} />
      <NavButton icon="shirt" label={t('Skins')} active={page === 'skins'} onClick={() => navigate({ page: 'skins' })} />
      <NavButton icon="image" label={t('Capturas')} active={page === 'screenshots'} onClick={() => navigate({ page: 'screenshots' })} />
      <NavButton icon="server" label={t('Servidores')} active={page === 'servers'} onClick={() => navigate({ page: 'servers' })} />
      {recent.length ? <span className="mr-nav-sep" /> : null}
      {recent.map((i) => (
        <QuickInstance key={i.id} inst={i} active={route.page === 'instance' && route.id === i.id} />
      ))}
      <NavButton
        icon="plus"
        label={t('Crear instancia')}
        className="mr-create"
        onClick={() => {
          if (page !== 'library' && page !== 'home') navigate({ page: 'library' });
          setTimeout(() => window.dispatchEvent(new CustomEvent('havihub:create-instance')), page === 'library' || page === 'home' ? 0 : 80);
        }}
      />
      <span className="mr-nav-spacer" />
      <NavButton icon="settings" tour="settings" label={t('Ajustes')} active={page === 'settings'} onClick={() => navigate({ page: 'settings', section: 'launcher' })} />
      <NavButton tour="account" label={activeAccount ? activeAccount.name : t('Iniciar sesión')} anchorRef={acc.anchor} active={acc.open} onClick={acc.toggle} className="mr-account">
        {activeAccount ? <AccountAvatar account={activeAccount} size={32} /> : <Icon name="logIn" size={24} className="mr-login" />}
      </NavButton>
      <Popover anchor={acc.anchor} open={acc.open} onClose={acc.close} side="right" className="menu account-menu mr-pop">
        <AccountMenuContent onClose={acc.close} />
      </Popover>
    </nav>
  );
}

// ---------------------------------------------------------------- right sidebar
function PlayingAs() {
  const app = useApp();
  const acc = useMenu();
  const a = app.activeAccount;
  const streamer = app.config && app.config.privacy && app.config.privacy.streamerMode;
  return (
    <section className="mr-side-section">
      <h3>{t('Jugando como')}</h3>
      <button ref={acc.anchor} className="mr-account-card" onClick={acc.toggle}>
        <AccountAvatar account={a} size={36} />
        <span className="mr-account-text">
          <strong>{a ? (streamer ? '••••••' : a.name) : t('Sin cuenta')}</strong>
          <small>{a ? (a.type === 'Offline' ? t('Cuenta offline') : t('Cuenta de Microsoft')) : t('Agrega una para jugar online')}</small>
        </span>
        <Icon name={acc.open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      <Popover anchor={acc.anchor} open={acc.open} onClose={acc.close} align="right" matchWidth className="menu account-menu mr-pop">
        <AccountMenuContent onClose={acc.close} />
      </Popover>
    </section>
  );
}

function FirstSteps() {
  const app = useApp();
  const [open, setOpen] = useState(true);
  const steps = [
    { done: app.instances.length > 0, label: t('Crear tu primera instancia'), go: () => window.dispatchEvent(new CustomEvent('havihub:create-instance')) },
    { done: app.accounts.some((a) => a.type !== 'Offline'), label: t('Iniciar sesión en Minecraft'), go: () => app.navigate({ page: 'settings', section: 'accounts' }) },
    { done: app.instances.some((i) => i.lastLaunch), label: t('Jugar por primera vez'), go: () => app.navigate({ page: 'library' }) },
  ];
  if (steps.every((s) => s.done) || (app.config && app.config.firstStepsHidden)) return null;
  return (
    <section className="mr-side-section">
      <button className="mr-side-toggle" onClick={() => setOpen((o) => !o)}>
        <h3>{t('Primeros pasos')}</h3>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      {open ? (
        <div className="mr-steps">
          {steps.map((s, i) => (
            <button key={i} className={`mr-step ${s.done ? 'done' : ''}`} onClick={s.done ? undefined : s.go} disabled={s.done}>
              <Icon name={s.done ? 'checkCircle' : 'circle'} size={20} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RunningTasks() {
  const { tasks } = useApp();
  const running = tasks.filter((x) => x.status === 'running').slice(0, 4);
  if (!running.length) return null;
  return (
    <section className="mr-side-section">
      <h3>{t('Descargando')}</h3>
      <div className="mr-side-tasks">
        {running.map((x) => (
          <div key={x.id} className="mr-side-task">
            <span className="mr-side-task-title">{tm(x.title, x.titleText)}</span>
            <Progress value={x.progress} indeterminate={!x.progress} />
            <small className="muted">{tm(x.detail, x.detailText)}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function RightSidebar({ setSlot }) {
  return (
    <aside className="mr-sidebar">
      <div className="mr-sidebar-scroll">
        <div className="mr-sidebar-slot" ref={setSlot} />
        <div className="mr-sidebar-default">
          <PlayingAs />
          <FirstSteps />
          <RunningTasks />
          <MrSocials />
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- shell
export default function MrShell({ pages }) {
  const app = useApp();
  const { route, appState, langVersion, history } = app;
  const [slot, setSlot] = useState(null);
  const viewport = useRef(null);
  const settingsOpen = route.page === 'settings';
  // Settings open as a window over the page you were on
  const under = settingsOpen ? [...history.stack.slice(0, history.index)].reverse().find((r) => r.page !== 'settings') || { page: 'library' } : route;
  const withSidebar = SIDEBAR_PAGES.has(under.page);
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [under.page, under.id, under.type]);
  // Escape closes the settings window, unless a dialog, a menu or a field
  // being edited takes it first
  const back = app.back;
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || capturingInput()) return;
      if (document.querySelector('.modal-backdrop, .popover, .lightbox')) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && el.value) return;
      back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, back]);
  const Page = pages.pick(under);
  return (
    <SlotCtx.Provider value={slot}>
      <div className="mr-app">
        <TitleBar />
        <NavBar />
        <div className={`mr-contents ${withSidebar ? 'with-sidebar' : ''}`}>
          <SeasonBackdrop />
          <main className="mr-viewport" ref={viewport} key={langVersion}>
            {!appState ? (
              <div className="center-spinner full">
                <Spinner size={36} />
              </div>
            ) : (
              <ErrorBoundary resetKey={JSON.stringify(under)}>
                <Page route={under} />
              </ErrorBoundary>
            )}
          </main>
          {withSidebar ? <RightSidebar setSlot={setSlot} /> : null}
        </div>
        {settingsOpen && appState ? (
          <div className="mr-settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && app.back()}>
            <div className="mr-settings-window" role="dialog" aria-modal="true" aria-label={t('Ajustes')}>
              <button className="mr-settings-close" onClick={app.back} aria-label={t('Cerrar')}>
                <Icon name="x" size={20} />
              </button>
              <ErrorBoundary resetKey={JSON.stringify(route)}>
                <pages.Settings key={langVersion} />
              </ErrorBoundary>
            </div>
          </div>
        ) : null}
      </div>
    </SlotCtx.Provider>
  );
}
