// App chrome: title bar, left sidebar, game header (search + account) and top tabs.
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { IconButton, Progress, Button } from './ui.jsx';
import { Popover, MenuItem, MenuSeparator, useMenu } from './Menu.jsx';
import { useApp } from '../lib/store.jsx';
import { call } from '../lib/api.js';
import { t, tm } from '../lib/i18n.js';
import { skinFace, defaultSkinUrl } from '../lib/skin.js';
import AddAccountDialog, { OfflineAccountDialog } from '../dialogs/AddAccountDialog.jsx';
import ImportLaunchersDialog from '../dialogs/ImportLaunchersDialog.jsx';
import { BRAND_MARK } from '../lib/brand-mark.js';
import { TopTabsDecor } from './Seasonal.jsx';
import BrandLogo from './BrandLogo.jsx';
import { mcSettled, mcUrl, useMcTextures } from '../lib/mc-textures.js';
import { useDropTarget } from '../lib/instanceDrag.js';

export function Logo({ size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" className="logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: BRAND_MARK }} />;
}

export function Titlebar() {
  const { back, forward, history, maximized } = useApp();
  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <Logo size={22} />
        <span className="titlebar-name">Havi Hub</span>
        <button className="tb-nav" disabled={history.index === 0} onClick={back} title={t('Atrás')}>
          <Icon name="arrowLeft" size={20} />
        </button>
        <button className="tb-nav" disabled={history.index >= history.stack.length - 1} onClick={forward} title={t('Adelante')}>
          <Icon name="arrowRight" size={20} />
        </button>
      </div>
      <div className="titlebar-drag" />
      <div className="titlebar-controls">
        <button className="tb-ctl" onClick={() => call('app.window', 'minimize')} title={t('Minimizar')}>
          <Icon name="minimize" size={16} />
        </button>
        <button className="tb-ctl" onClick={() => call('app.window', 'maximize')} title={maximized ? t('Restaurar') : t('Maximizar')}>
          <Icon name={maximized ? 'restore' : 'maximize'} size={15} />
        </button>
        <button className="tb-ctl tb-close" onClick={() => call('app.window', 'close')} title={t('Cerrar')}>
          <Icon name="x" size={18} />
        </button>
      </div>
    </div>
  );
}

// Icon sizes that give the same glyph sizes as CurseForge's sidebar
const SIDE_ICON_SIZE = { home: 38, plus: 42, download: 26, help: 31, settings: 30 };

// CurseForge-style label that slides out to the right of the sidebar
function SideTip({ label }) {
  return <span className="side-tip">{label}</span>;
}

function SideButton({ icon, label, active, onClick, badge, anchorRef, accent, children, tour }) {
  return (
    <button ref={anchorRef} className={`side-btn ${active ? 'active' : ''} ${accent ? 'accent' : ''}`} onClick={onClick} aria-label={label} data-tour={tour}>
      {children || <Icon name={icon} size={SIDE_ICON_SIZE[icon] || 30} />}
      {badge ? <span className="side-badge">{badge}</span> : null}
      <SideTip label={label} />
    </button>
  );
}

// The game's name in the header: its logo, taken from the Minecraft files on
// this computer like every other picture of the game (none ships with Havi
// Hub). Nothing shows while those files are first looked for; the name in
// plain text stands in only if they are not there.
function GameTitle() {
  useMcTextures();
  const logo = mcUrl('gui/title#logo');
  if (!logo && !mcSettled()) return <div className="game-title" aria-hidden="true" />;
  return (
    <div className="game-title">
      {logo ? (
        <img className="mc-logo" src={logo} alt="Minecraft Java Edition" draggable={false} />
      ) : (
        <>
          <span className="game-name">Minecraft</span>
          <span className="game-edition">Java Edition</span>
        </>
      )}
    </div>
  );
}

function GameTile({ active, onClick }) {
  return (
    <button className={`side-game ${active ? 'active' : ''}`} onClick={onClick} aria-label="Minecraft">
      <BrandLogo brand="minecraft" size={36} className="grass-block" />
      <SideTip label="Minecraft" />
    </button>
  );
}

export function Sidebar() {
  const { route, navigate, tasks } = useApp();
  const dl = useMenu();
  const runningTasks = tasks.filter((x) => x.status === 'running').length;
  const gamePages = ['library', 'instance', 'discover', 'browse', 'project', 'servers', 'screenshots', 'skins'];
  return (
    <nav className="sidebar">
      <div className="side-top">
        <SideButton icon="home" label={t('Inicio')} active={route.page === 'home'} onClick={() => navigate({ page: 'home' })} />
        <GameTile active={gamePages.includes(route.page)} onClick={() => navigate({ page: 'library' })} />
        <SideButton
          icon="plus"
          label={t('Crear instancia')}
          onClick={() => {
            if (route.page !== 'library') navigate({ page: 'library' });
            setTimeout(() => window.dispatchEvent(new CustomEvent('havihub:create-instance')), route.page === 'library' ? 0 : 80);
          }}
        />
      </div>
      <div className="side-bottom">
        <SideButton icon="download" label={t('Descargas')} anchorRef={dl.anchor} active={dl.open} onClick={dl.toggle} badge={runningTasks || null} />
        <SideButton icon="help" label={t('Ayuda')} active={route.page === 'help'} onClick={() => navigate({ page: 'help' })} />
        <SideButton icon="settings" tour="settings" label={t('Ajustes')} active={route.page === 'settings'} onClick={() => navigate({ page: 'settings', section: 'launcher' })} />
      </div>
      <Popover anchor={dl.anchor} open={dl.open} onClose={dl.close} className="downloads-pop">
        <DownloadsPanel />
      </Popover>
    </nav>
  );
}

export function DownloadsPanel() {
  const { tasks } = useApp();
  return (
    <div className="downloads">
      <div className="downloads-head">
        <h3>{t('Descargas y tareas')}</h3>
        {tasks.some((x) => x.status !== 'running') ? (
          <Button variant="ghost" size="sm" onClick={() => call('tasks.clear')}>
            {t('Limpiar')}
          </Button>
        ) : null}
      </div>
      {tasks.length === 0 ? <div className="downloads-empty">{t('No hay descargas en curso')}</div> : null}
      <div className="downloads-list">
        {tasks.map((task) => (
          <div key={task.id} className={`dl-item ${task.status}`}>
            <div className="dl-top">
              <Icon name={task.status === 'done' ? 'checkCircle' : task.status === 'error' ? 'xCircle' : task.status === 'cancelled' ? 'x' : 'download'} size={18} />
              <span className="dl-title">{tm(task.title, task.titleText)}</span>
              {task.status === 'running' && task.cancelable !== false ? (
                <button className="icon-btn dl-cancel" aria-label={t('Detener')} data-tip={t('Detener')} onClick={() => call('tasks.cancel', task.id)}>
                  <Icon name="x" size={16} />
                </button>
              ) : null}
            </div>
            {task.status === 'running' ? <Progress value={task.progress} indeterminate={!task.progress} /> : null}
            <div className="dl-detail">{task.status === 'error' ? tm(task.error, task.errorText) : tm(task.detail, task.detailText)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountAvatar({ account, size = 24 }) {
  const [face, setFace] = useState(null);
  useEffect(() => {
    let alive = true;
    skinFace((account && account.skin && account.skin.data) || defaultSkinUrl(), size * 2).then((f) => alive && setFace(f));
    return () => {
      alive = false;
    };
  }, [account && account.skin && account.skin.data, size]);
  return <span className="avatar" style={{ width: size, height: size }}>{face ? <img src={face} alt="" /> : null}</span>;
}

// Accounts: switch, add (Microsoft or offline), sign out. Used by both layouts.
export function AccountMenuContent({ onClose }) {
  const { accounts, activeAccount, refreshAccounts, confirm, showError, config, openDialog } = useApp();
  const streamer = config && config.privacy && config.privacy.streamerMode;
  return (
    <>
      {accounts.map((a) => (
        <MenuItem
          key={a.id}
          icon={null}
          label={
            <span className="account-row">
              <AccountAvatar account={a} size={20} />
              {streamer ? '••••••' : a.name}
              {a.type === 'Offline' ? <small>{t('offline')}</small> : null}
            </span>
          }
          checked={a.active}
          onClick={async () => {
            onClose();
            try {
              await call('accounts.setActive', a.id);
              await refreshAccounts();
            } catch (e) {
              showError(e);
            }
          }}
        />
      ))}
      {accounts.length ? <div className="menu-pad" /> : null}
      <div className="menu-pad">
        <Button
          variant="secondary"
          icon="plus"
          className="w-full"
          onClick={() => {
            onClose();
            openDialog(AddAccountDialog, {});
          }}
        >
          {t('Agregar cuenta')}
        </Button>
      </div>
      <OfflineAccountButton onDone={onClose} />
      <MenuSeparator />
      <MenuItem
        icon="signOut"
        label={t('Cerrar sesión')}
        disabled={!activeAccount}
        onClick={async () => {
          onClose();
          if (!activeAccount) return;
          const ok = await confirm({ title: t('Cerrar sesión'), message: t('¿Quitar la cuenta {name} de Havi Hub? Tendrás que volver a iniciar sesión para jugar online.', { name: activeAccount.name }), confirmLabel: t('Cerrar sesión'), danger: true });
          if (!ok) return;
          try {
            await call('accounts.remove', activeAccount.id);
            await refreshAccounts();
          } catch (e) {
            showError(e);
          }
        }}
      />
    </>
  );
}

export function GameHeader() {
  const { activeAccount, navigate, route, config, openDialog } = useApp();
  const [q, setQ] = useState(route.page === 'browse' ? route.query || '' : '');
  const acc = useMenu();
  const more = useMenu();
  const streamer = config && config.privacy && config.privacy.streamerMode;
  useEffect(() => {
    if (route.page === 'browse') setQ(route.query || '');
  }, [route.page, route.query]);
  return (
    <div className="game-header">
      <GameTitle />
      <div className="header-search">
        <Icon name="search" size={20} />
        <input
          value={q}
          maxLength={120}
          placeholder={t('Buscar proyectos de Minecraft…')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate({ page: 'browse', type: route.page === 'browse' ? route.type || 'mod' : 'mod', query: q.trim() });
          }}
        />
      </div>
      <div className="header-sep" />
      <button ref={acc.anchor} className={`account-btn ${acc.open ? 'open' : ''}`} onClick={acc.toggle} data-tour="account">
        <AccountAvatar account={activeAccount} />
        <span className="account-name">{activeAccount ? (streamer ? '••••••' : activeAccount.name) : t('Sin cuenta')}</span>
        <Icon name={acc.open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      <button ref={more.anchor} className={`icon-btn header-more ${more.open ? 'active' : ''}`} title={t('Más opciones')} onClick={more.toggle}>
        <Icon name="more" size={22} />
      </button>
      <Popover anchor={acc.anchor} open={acc.open} onClose={acc.close} align="right" matchWidth className="menu account-menu">
        <AccountMenuContent onClose={acc.close} />
      </Popover>
      <Popover anchor={more.anchor} open={more.open} onClose={more.close} align="right" className="menu">
        <MenuItem icon="folder" label={t('Abrir carpeta de Havi Hub')} onClick={() => (more.close(), call('app.openDataDir'))} />
        <MenuItem icon="import" label={t('Importar desde otro launcher…')} onClick={() => (more.close(), openDialog(ImportLaunchersDialog, {}))} />
        <MenuItem icon="settings" label={t('Ajustes del juego')} onClick={() => (more.close(), navigate({ page: 'settings', section: 'minecraft' }))} />
      </Popover>
    </div>
  );
}

// "Mis modpacks" also takes a dragged profile out of its group
function LibraryTab({ active, label, onClick }) {
  const app = useApp();
  const [props, over] = useDropTarget(async (id) => {
    const inst = app.instances.find((i) => i.id === id);
    if (!inst || !inst.group) return;
    try {
      await call('instances.setGroup', id, '');
      app.toast(t('{name} salió del grupo {group}', { name: inst.name, group: inst.group }), { type: 'success' });
    } catch (e) {
      app.showError(e);
    }
  });
  return (
    <button className={`top-tab ${active ? 'active' : ''} ${over ? 'drop' : ''}`} onClick={onClick} {...props}>
      {label}
    </button>
  );
}

// "Agregar cuenta offline": only once a Microsoft account (premium) is added
export function OfflineAccountButton({ onDone, className = 'menu-pad' }) {
  const { accounts, openDialog } = useApp();
  const premium = accounts.some((a) => a.type !== 'Offline');
  return (
    <div className={className} data-tip={premium ? undefined : t('Primero agrega una cuenta de Microsoft que tenga Minecraft')}>
      <Button
        variant="ghost"
        icon="offline"
        className="w-full"
        disabled={!premium}
        onClick={() => {
          onDone && onDone();
          openDialog(OfflineAccountDialog, {});
        }}
      >
        {t('Agregar cuenta offline')}
      </Button>
    </div>
  );
}

export function TopTabs() {
  const { route, navigate } = useApp();
  // adding content to a profile (and its project pages) belongs to "Mis modpacks"
  const page = route.page === 'instance' || ((route.page === 'browse' || route.page === 'project') && route.instanceId) ? 'library' : route.page === 'project' ? 'browse' : route.page;
  const tabs = [
    { id: 'library', label: t('Mis modpacks') },
    { id: 'discover', label: t('Descubrir') },
    { id: 'browse', label: t('Explorar') },
    { id: 'servers', label: t('Servidores') },
    { id: 'screenshots', label: t('Capturas') },
    { id: 'skins', label: t('Skins') },
  ];
  return (
    <div className="top-tabs">
      {tabs.map((tab) =>
        tab.id === 'library' ? (
          <LibraryTab key={tab.id} active={page === tab.id} label={tab.label} onClick={() => navigate({ page: tab.id })} />
        ) : (
          <button key={tab.id} className={`top-tab ${page === tab.id ? 'active' : ''}`} onClick={() => navigate({ page: tab.id })} data-tour={tab.id}>
            {tab.label}
          </button>
        ),
      )}
      <TopTabsDecor />
    </div>
  );
}

export { AccountAvatar };
export const useRefLatest = (v) => {
  const r = useRef(v);
  r.current = v;
  return r;
};
