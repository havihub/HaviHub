// Share profiles with Prism Launcher: both launchers use Prism's profiles
// folder (worlds, mods and per-profile settings stay in sync). Accounts, the
// engine and each launcher's own settings stay separate.
import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal.jsx';
import Icon from '../components/Icon.jsx';
import { Button, Checkbox, Spinner, Select, Progress } from '../components/ui.jsx';
import InstanceImage, { LoaderIcon } from '../components/InstanceImage.jsx';
import { useApp } from '../lib/store.jsx';
import { call } from '../lib/api.js';
import { t, tm } from '../lib/i18n.js';

export default function SharePrismDialog({ onResolve }) {
  const app = useApp();
  const [sources, setSources] = useState(null);
  const [dir, setDir] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [move, setMove] = useState(new Set());
  const [running, setRunning] = useState(false);
  const task = app.tasks.find((x) => x.kind === 'share' && x.status === 'running');

  useEffect(() => {
    call('import.detect')
      .then((list) => {
        const prism = list.filter((s) => s.label === 'Prism Launcher');
        setSources(prism);
        if (prism.length) setDir(prism[0].dataDir);
      })
      .catch(() => setSources([]));
  }, []);

  useEffect(() => {
    if (!dir) return;
    setData(null);
    setError('');
    call('share.preview', dir)
      .then((d) => {
        setData(d);
        // profiles that only exist in Havi Hub move by default; copies that
        // Prism already has stay put (no duplicates)
        setMove(new Set(d.own.filter((i) => !i.inPrism && !i.running).map((i) => i.id)));
      })
      .catch((e) => setError(e.message));
  }, [dir]);

  const pickFolder = async () => {
    const p = await call('app.pickFolder', { title: t('Carpeta de datos de Prism Launcher') });
    if (!p) return;
    setSources((l) => (l && l.some((s) => s.dataDir === p) ? l : [...(l || []), { dataDir: p, label: t('Otra carpeta'), count: null }]));
    setDir(p);
  };

  const toggle = (id, v) =>
    setMove((m) => {
      const n = new Set(m);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  const run = async () => {
    setRunning(true);
    try {
      const r = await call('share.enable', { prismDir: dir, move: [...move] });
      await Promise.all([app.refreshState(), app.refreshInstances()]);
      if (r.failed && r.failed.length) app.toast(t('{n} perfiles no se pudieron mover: {list}', { n: r.failed.length, list: r.failed.map((f) => f.id).join(', ') }), { type: 'error', duration: 12000 });
      app.toast(t('Listo: Havi Hub y Prism Launcher ahora comparten los perfiles'), { type: 'success' });
      onResolve(r);
    } catch (e) {
      app.showError(e);
      setRunning(false);
    }
  };

  return (
    <Modal
      title={t('Compartir perfiles con Prism Launcher')}
      icon="link"
      onClose={() => !running && onResolve(null)}
      closeOnBackdrop={false}
      width={760}
      className="import-dialog share-dialog"
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={() => onResolve(null)} disabled={running}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" icon="link" disabled={!data || running} loading={running} onClick={run}>
            {t('Compartir perfiles')}
          </Button>
        </>
      }
    >
      <p className="import-intro">{t('Havi Hub y Prism Launcher van a usar la misma carpeta de perfiles: lo que cambies en un perfil (mundos, mods, ajustes) aparece en los dos. Las cuentas, el motor y los ajustes de cada launcher siguen separados.')}</p>
      <div className="import-source">
        <span className="label">{t('Prism Launcher')}</span>
        {sources === null ? (
          <Spinner size={18} />
        ) : sources.length ? (
          <Select value={dir} onChange={setDir} options={sources.map((s) => ({ value: s.dataDir, label: `${s.dataDir}${s.count != null ? `  (${s.count})` : ''}` }))} />
        ) : (
          <span className="muted">{t('No se encontró Prism Launcher en las carpetas habituales.')}</span>
        )}
        <Button variant="secondary" icon="folder" onClick={pickFolder}>
          {t('Elegir carpeta…')}
        </Button>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      {dir && !data && !error ? (
        <div className="center-spinner">
          <Spinner />
        </div>
      ) : null}
      {data ? (
        <>
          <div className="share-path">
            <Icon name="folder" size={22} />
            <span>
              <strong>{t('Carpeta de perfiles compartida')}</strong>
              <small className="muted">
                {data.instancesDir} · {data.prismCount === 1 ? t('1 perfil') : t('{n} perfiles', { n: data.prismCount })}
              </small>
            </span>
          </div>
          {data.own.length ? (
            <>
              <div className="import-list-head">
                <strong>{t('Tus perfiles de Havi Hub ({n})', { n: data.own.length })}</strong>
                <span className="muted small">{t('Marca los que quieres pasar a la carpeta compartida. Los demás quedan guardados en Havi Hub y vuelven si dejas de compartir.')}</span>
              </div>
              <div className="import-list share-list">
                {data.own.map((i) => (
                  <div key={i.id} className={`import-row ${move.has(i.id) ? 'on' : ''} ${i.running ? 'disabled' : ''}`} onClick={() => !i.running && toggle(i.id, !move.has(i.id))}>
                    <Checkbox checked={move.has(i.id)} disabled={i.running} onChange={(v) => toggle(i.id, v)} />
                    <InstanceImage instance={i} size={40} />
                    <span className="import-row-main">
                      <strong>{i.name}</strong>
                      <small className="muted">
                        <LoaderIcon loader={i.loader} size={13} /> {i.loader ? i.loader.name : 'Vanilla'} · {i.mcVersion || '?'}
                        {i.running ? ` · ${t('está abierto en el juego')}` : i.inPrism ? ` · ${move.has(i.id) ? t('Prism Launcher ya tiene uno con ese nombre: se moverá como "{name} (Havi Hub)"', { name: i.name }) : t('Prism Launcher ya tiene uno con ese nombre')}` : ''}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <div className="banner warn share-warn">
            <Icon name="alert" size={20} />
            <span>{t('No abras el mismo perfil en Havi Hub y en Prism Launcher al mismo tiempo.')}</span>
          </div>
        </>
      ) : null}
      {running && task ? (
        <div className="import-progress">
          <Progress value={task.progress} indeterminate={!task.progress} />
          <small className="muted">{tm(task.detail, task.detailText)}</small>
        </div>
      ) : null}
    </Modal>
  );
}
