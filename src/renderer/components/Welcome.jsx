// The first start: a welcome that covers the whole window until Havi Hub is
// ready to use. It asks for the layout, for what the window's X does and
// whether Havikun's channels load on their own (nothing connects to them before
// that answer), has the person create a first instance (or bring theirs from another launcher),
// and waits for Minecraft's own files, so the game's title and grass block are
// already there the first time the app behind it shows them. Whoever quits
// halfway picks up where they left off on the next start. Its last step alone
// also covers any later start that finds no game files to draw those from.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../lib/store.jsx';
import { call, on } from '../lib/api.js';
import { t, getLanguage } from '../lib/i18n.js';
import { brandReady, mcSettled, reloadMcTextures, useMcTextures } from '../lib/mc-textures.js';
import { needsWelcome } from '../lib/welcome.js';
import Icon from './Icon.jsx';
import { Progress, Spinner } from './ui.jsx';
import { Logo } from './Shell.jsx';
import { LayoutChoice } from './LayoutPicker.jsx';
import { CloseChoice } from '../dialogs/CloseBehaviorDialog.jsx';
import { SocialChoice } from './SocialChoice.jsx';
import CreateInstanceDialog from '../dialogs/CreateInstanceDialog.jsx';
import ImportLaunchersDialog from '../dialogs/ImportLaunchersDialog.jsx';

// the steps after the greeting, shown as the bar at the top of each one
const STEPS = ['layout', 'close', 'socials', 'instance', 'prepare'];

// the welcome's main button (the white one at the end of each step)
function Go({ children, onClick, disabled, loading, icon = 'arrowRight' }) {
  return (
    <button className="lp-go" onClick={onClick} disabled={disabled || loading}>
      {children}
      {loading ? <Spinner size={20} /> : <Icon name={icon} size={20} />}
    </button>
  );
}

const socialsAsked = (config) => Boolean(config && config.privacy && config.privacy.socialAsked);

function firstStep(config, instances) {
  if (!config.layout) return 'hello';
  if (config.closeToTray === null || config.closeToTray === undefined) return 'close';
  if (!socialsAsked(config)) return 'socials';
  if (!instances.length) return 'instance';
  return 'prepare';
}

const mb = (bytes) => (bytes / 1024 / 1024).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// The window's own bar: the welcome covers the app's, so it brings one
function WindowBar() {
  const { maximized } = useApp();
  return (
    <div className="titlebar welcome-bar">
      <div className="titlebar-left">
        <Logo size={22} />
        <span className="titlebar-name">Havi Hub</span>
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

function StepBar({ step }) {
  const at = STEPS.indexOf(step);
  return (
    <div className="welcome-steps" aria-hidden="true">
      {STEPS.map((s, i) => (
        <span key={s} className={i <= at ? 'on' : ''} />
      ))}
    </div>
  );
}

function InstanceStep({ onDone }) {
  const app = useApp();
  const [found, setFound] = useState(null); // { n, launchers }: instances in other launchers on this computer
  useEffect(() => {
    let alive = true;
    call('import.detectAll')
      .then((d) => {
        const list = [...(d.prism || []), ...(d.curseforge || []), ...(d.modrinth || [])].filter((x) => x.count && !x.shared && !x.error);
        const names = [...new Set(list.map((x) => x.label))];
        const launchers = new Intl.ListFormat(getLanguage() === 'en' ? 'en' : 'es', { type: 'conjunction' }).format(names);
        if (alive) setFound({ n: list.reduce((n, x) => n + x.count, 0), launchers });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const create = async () => {
    const id = await app.openDialog(CreateInstanceDialog, {});
    if (!id) return;
    await app.refreshInstances();
    onDone();
  };
  const bring = async () => {
    const r = await app.openDialog(ImportLaunchersDialog, {});
    if (r && r.imported && r.imported.length) onDone();
  };
  return (
    <>
      <h1 id="welcome-title">{t('Crea tu primera instancia')}</h1>
      <p className="welcome-lead">{t('Una instancia es un Minecraft con su propia versión, sus mods y sus mundos. Puedes tener todas las que quieras.')}</p>
      <div className="welcome-cards">
        <button className="welcome-card" onClick={create}>
          <span className="welcome-card-icon">
            <Icon name="plus" size={26} />
          </span>
          <strong>{t('Crear una instancia')}</strong>
          <span>{t('Elige la versión de Minecraft y, si quieres, un cargador de mods como Fabric o Forge.')}</span>
        </button>
        <button className="welcome-card" onClick={bring}>
          <span className="welcome-card-icon">
            <Icon name="import" size={24} />
          </span>
          <strong>{t('Traer mis instancias')}</strong>
          <span>
            {found && found.n === 1
              ? t('Encontramos 1 en {launchers}. Se copia con sus mundos, mods y ajustes.', found)
              : found && found.n > 1
                ? t('Encontramos {n} en {launchers}. Se copian con sus mundos, mods y ajustes.', found)
                : t('Desde CurseForge, Modrinth o Prism Launcher, con sus mundos, mods y ajustes.')}
          </span>
        </button>
      </div>
    </>
  );
}

// Minecraft's own files (its title, its blocks): downloaded once from Mojang
// when the computer has no game yet, or only one from before 1.13. Tried again
// on its own every little while after a failure.
function PrepareStep({ onDone }) {
  useMcTextures();
  const ready = brandReady();
  const [st, setSt] = useState(null);
  useEffect(() => {
    let alive = true;
    call('mc.status')
      .then((s) => alive && setSt(s))
      .catch(() => {});
    const off = on('mc:fetch', (s) => setSt(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  useEffect(() => {
    if (ready) onDone();
  }, [ready]);
  // the files are there: one more look at them, and on even if the pictures could
  // not be made from them (a later version of the game may lay them out otherwise;
  // Havi Hub has to open anyway, with its own drawings). The same when they can't
  // be downloaded at all (only in tests kept off the network).
  const filesThere = Boolean(st && (st.ready || !st.canFetch));
  useEffect(() => {
    if (!filesThere || ready) return undefined;
    let alive = true;
    reloadMcTextures().then(() => alive && onDone());
    return () => {
      alive = false;
    };
  }, [filesThere]);
  const retry = () => call('mc.fetch').then(setSt).catch(() => {});
  const failed = Boolean(st && st.error && !st.active && !st.ready);
  useEffect(() => {
    if (!failed) return undefined;
    const timer = setTimeout(retry, 20000);
    return () => clearTimeout(timer);
  }, [st]);
  const share = st && st.active && st.total ? Math.min(1, st.received / st.total) : 0;
  return (
    <>
      <h1 id="welcome-title">{t('Preparando Minecraft')}</h1>
      <p className="welcome-lead">{t('Havi Hub descarga una sola vez los archivos del juego desde Mojang para mostrar sus imágenes, como su título y sus bloques.')}</p>
      <div className="welcome-download">
        {failed ? (
          <>
            <p className="welcome-error">
              <Icon name="alert" size={18} /> {t('No se pudieron descargar los archivos de Minecraft. Revisa tu conexión a internet.')}
            </p>
            <Go icon="refresh" onClick={retry}>
              {t('Reintentar')}
            </Go>
          </>
        ) : (
          <>
            <Progress value={share} indeterminate={!share} />
            <span className="welcome-progress-text">{share ? t('{done} de {total} MB', { done: mb(st.received), total: mb(st.total) }) : t('Conectando con Mojang…')}</span>
          </>
        )}
      </div>
    </>
  );
}

function Welcome({ onDone, only = null }) {
  const app = useApp();
  const [step, setStep] = useState(() => only || firstStep(app.config, app.instances));
  const [layout, setLayout] = useState((app.config && app.config.layout) || 'curseforge');
  const [closeChoice, setCloseChoice] = useState(app.config && typeof app.config.closeToTray === 'boolean' ? app.config.closeToTray : null);
  // on unless the person chooses otherwise
  const [socialChoice, setSocialChoice] = useState(!(app.config && app.config.privacy && app.config.privacy.socialAutoload === false));
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const finish = async () => {
    if (leaving) return;
    setLeaving(true);
    await app.updateConfig({ welcomeDone: true, tourPending: !(app.config && app.config.tourDone) }).catch(() => {});
    setTimeout(onDone, 280);
  };
  const afterSocials = () => {
    if (app.instances.length) afterInstance();
    else setStep('instance');
  };
  const afterClose = () => {
    if (!socialsAsked(app.config)) setStep('socials');
    else afterSocials();
  };
  // The game's files are usually there by the end (downloaded meanwhile, or
  // brought along with the instances): no need to show the last step then
  const afterInstance = async () => {
    if (!brandReady()) await reloadMcTextures().catch(() => {});
    if (brandReady()) finish();
    else setStep('prepare');
  };

  let body;
  if (step === 'hello') {
    body = (
      <>
        <Logo size={92} />
        <h1 id="welcome-title">{t('Te damos la bienvenida a Havi Hub')}</h1>
        <p className="welcome-lead">{t('Un launcher para Minecraft Java Edition, con mods y modpacks de CurseForge y Modrinth. Antes de empezar, vamos a dejar todo listo en unos pocos pasos.')}</p>
        <Go onClick={() => setStep('layout')}>{t('Empezar')}</Go>
      </>
    );
  } else if (step === 'layout') {
    body = (
      <>
        <h1 id="welcome-title">{t('¿Cómo quieres organizar Havi Hub?')}</h1>
        <p className="welcome-lead">{t('Las dos formas tienen todas las funciones; cambia dónde está cada cosa. Puedes cambiarla cuando quieras en Ajustes → Temas.')}</p>
        <LayoutChoice value={layout} onChange={setLayout} />
        <Go
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await app.setLayout(layout);
            setBusy(false);
            if (closeChoice === null) setStep('close');
            else afterClose();
          }}
        >
          {t('Continuar')}
        </Go>
      </>
    );
  } else if (step === 'close') {
    body = (
      <>
        <h1 id="welcome-title">{t('¿Qué hace la X de la ventana?')}</h1>
        <p className="welcome-lead">{t('Puedes cambiarlo cuando quieras en Ajustes → Launcher → Comportamiento.')}</p>
        <div className="welcome-x">
          <CloseChoice value={closeChoice} onChange={setCloseChoice} />
        </div>
        <Go
          disabled={closeChoice === null}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await app.updateConfig({ closeToTray: closeChoice === true }).catch(() => {});
            setBusy(false);
            afterClose();
          }}
        >
          {t('Continuar')}
        </Go>
      </>
    );
  } else if (step === 'socials') {
    body = (
      <>
        <h1 id="welcome-title">{t('Las redes de Havikun en Inicio')}</h1>
        <p className="welcome-lead">{t('Havikun es quien hace Havi Hub. En Inicio vas a ver sus últimos videos de YouTube, si está en vivo en Twitch y sus links. Es una forma de apoyarlo sin pagar nada.')}</p>
        <div className="welcome-x">
          <SocialChoice value={socialChoice} onChange={setSocialChoice} />
        </div>
        <p className="welcome-note">
          {t('Para mostrarlas, Havi Hub se conecta a YouTube, Twitch y Linktree, que reciben tu dirección IP como cualquier página que visitas.')} {t('Puedes cambiarlo cuando quieras en Ajustes → Privacidad.')}{' '}
          <button className="welcome-link" onClick={() => call('app.openExternal', 'https://havihub.github.io/privacy/')}>
            {t('Ver la política de privacidad')}
          </button>
        </p>
        <Go
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await app.updateConfig({ privacy: { socialAutoload: socialChoice, socialAsked: true } }).catch(() => {});
            setBusy(false);
            afterSocials();
          }}
        >
          {t('Continuar')}
        </Go>
      </>
    );
  } else if (step === 'instance') {
    body = <InstanceStep onDone={afterInstance} />;
  } else {
    body = <PrepareStep onDone={finish} />;
  }

  return createPortal(
    <div className={`welcome ${leaving ? 'leaving' : ''}`} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <WindowBar />
      <div className="welcome-body">
        <div className={`welcome-step welcome-${step}`} key={step}>
          {step === 'hello' || only ? null : <StepBar step={step} />}
          {body}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Decides once per start, when the settings, the instances and the game's files
// are known, whether the welcome is due (or its last step alone); until then a
// new installation shows nothing of the app behind it. `after` (the guided
// tour) only shows once it has decided there is nothing to show, so the tour
// never lands on top of the welcome or of its "Preparando Minecraft" step.
export default function WelcomeGate({ after = null }) {
  const app = useApp();
  useMcTextures();
  const settled = mcSettled();
  const [mode, setMode] = useState(null); // null: not decided yet | 'welcome' | 'prepare' | 'none'
  const deciding = useRef(false);
  useEffect(() => {
    if (mode || deciding.current || !app.config || !app.instancesLoaded || !settled) return;
    deciding.current = true;
    (async () => {
      if (needsWelcome(app.config, app.instances)) return setMode('welcome');
      if (brandReady()) return setMode('none');
      // no game files to draw the title and the grass block from: wait for them
      const st = await call('mc.status').catch(() => null);
      setMode(st && (st.ready || !st.canFetch) ? 'none' : 'prepare');
    })();
  }, [mode, app.config, app.instancesLoaded, settled]);
  if (mode === 'welcome' || mode === 'prepare') return <Welcome only={mode === 'prepare' ? 'prepare' : null} onDone={() => setMode('none')} />;
  if (mode === null && (!app.config || !app.config.layout || (settled && !brandReady()))) {
    return createPortal(
      <div className="welcome welcome-boot">
        <Spinner size={36} />
      </div>,
      document.body,
    );
  }
  return mode === 'none' ? after : null;
}
