// Files that only CurseForge's own page may hand out (their authors don't let
// other apps download them). Havi Hub opens that page in a window, or the
// person's browser, takes the download and installs it. See main/platforms/blocked.js.
import { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Modal } from '../components/Modal.jsx';
import { Button, Spinner, Progress } from '../components/ui.jsx';
import { call, on } from '../lib/api.js';
import { t, tm } from '../lib/i18n.js';

const stateText = (it) =>
  ({
    waiting: t('En espera'),
    opening: t('Abriendo su página…'),
    downloading: `${Math.round((it.progress || 0) * 100)}%`,
    installing: t('Instalando…'),
    done: t('Instalado'),
    failed: it.reason ? tm(it.reason) : t('No se pudo instalar'),
    pending: t('Pendiente'),
  })[it.state] || '';

export default function BlockedFilesDialog({ entries, onResolve }) {
  const [items, setItems] = useState(() => entries.map((e) => ({ key: e.key, title: e.title, fileName: e.fileName, state: 'waiting', progress: 0 })));
  const [mode, setMode] = useState('window');
  const [running, setRunning] = useState(true);
  const done = useRef([]);
  const left = useRef(entries);
  const started = useRef(false);
  const alive = useRef(true);

  const run = async (m) => {
    setMode(m);
    setRunning(true);
    let r;
    try {
      r = await call('platforms.resolveBlocked', left.current, m);
    } catch {
      r = { done: [], pending: left.current };
    }
    if (!alive.current) return;
    done.current = [...done.current, ...r.done];
    left.current = r.pending;
    setRunning(false);
    if (!r.pending.length) onResolve({ done: done.current, pending: [] });
  };

  useEffect(() => {
    alive.current = true;
    const off = on('blocked:status', (s) => {
      const byKey = new Map((s.items || []).map((i) => [i.key, i]));
      setItems((prev) => prev.map((it) => (it.state === 'done' ? it : byKey.get(it.key) || it)));
    });
    if (!started.current) {
      started.current = true;
      run('window');
    }
    return () => {
      alive.current = false;
      off();
      call('platforms.cancelBlocked').catch(() => {});
    };
  }, []);

  // the other way: stop this one (the call in flight resolves), then start again
  const switchTo = async (m) => {
    setMode(m);
    await call('platforms.cancelBlocked').catch(() => {});
    const wait = () => (left.current.length ? run(m) : null);
    setTimeout(wait, 150);
  };
  const close = () => onResolve({ done: done.current, pending: left.current });
  const n = items.length;
  const ready = items.filter((i) => i.state === 'done').length;

  return (
    <Modal
      title={n === 1 ? t('Descargando 1 archivo desde CurseForge') : t('Descargando {n} archivos desde CurseForge', { n })}
      icon="download"
      onClose={close}
      width={640}
      className="blocked-files"
      footer={
        running ? (
          <>
            <Button variant="ghost" icon={mode === 'window' ? 'external' : 'download'} onClick={() => switchTo(mode === 'window' ? 'browser' : 'window')}>
              {mode === 'window' ? t('Usar mi navegador') : t('Usar la ventana de Havi Hub')}
            </Button>
            <span className="spacer" />
            <Button variant="secondary" onClick={() => call('platforms.cancelBlocked')}>
              {t('Detener')}
            </Button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <Button variant="ghost" onClick={close}>
              {t('Cerrar')}
            </Button>
            <Button variant="primary" icon="refresh" onClick={() => run(mode)}>
              {t('Reintentar')}
            </Button>
          </>
        )
      }
    >
      <div className="stack">
        <p className="muted">
          {mode === 'window'
            ? t('Sus autores solo permiten descargarlos desde la página de CurseForge. Havi Hub abre esa página en una ventana: la descarga empieza sola en unos segundos y queda instalada en el perfil. Si la página te pide algo (por ejemplo, confirmar que no eres un robot), hazlo ahí.')
            : t('Se abre la página de cada archivo en tu navegador. Descárgalo ahí: Havi Hub lo encuentra en tu carpeta de Descargas y lo instala solo.')}
        </p>
        <div className="blocked-list">
          {items.map((it) => (
            <div key={it.key} className={`blocked-row ${it.state}`}>
              <span className="blocked-mark">{it.state === 'done' ? <Icon name="check" size={18} /> : it.state === 'failed' ? <Icon name="alert" size={18} /> : ['opening', 'downloading', 'installing'].includes(it.state) ? <Spinner size={16} /> : <Icon name="clock" size={18} />}</span>
              <span className="grow blocked-name">
                <strong>{it.title}</strong>
                <small className="muted">{it.fileName}</small>
                {it.state === 'downloading' ? <Progress value={it.progress} /> : null}
              </span>
              <span className="blocked-state muted">{stateText(it)}</span>
            </div>
          ))}
        </div>
        {n > 1 ? <p className="muted small">{t('{a} de {n} listos', { a: ready, n })}</p> : null}
      </div>
    </Modal>
  );
}
