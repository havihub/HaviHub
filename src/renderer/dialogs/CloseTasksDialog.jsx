// The window's X (or "Quit" in the tray) while something is still running:
// stop it and close, keep it going in the background, or go back.
import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal.jsx';
import { Button, Progress } from '../components/ui.jsx';
import { useApp } from '../lib/store.jsx';
import { call } from '../lib/api.js';
import { t, tm } from '../lib/i18n.js';

export default function CloseTasksDialog({ tasks: initial, tray, onResolve }) {
  const app = useApp();
  const [stopping, setStopping] = useState(false);
  // live progress from the downloads panel; finished tasks drop out
  const live = app.tasks.filter((x) => x.status === 'running');
  const list = live.length ? live : stopping ? [] : initial;
  const blocking = list.filter((x) => x.cancelable === false);
  const answer = (choice) => {
    call('app.closeChoice', choice).catch(() => {});
    onResolve(choice);
  };
  useEffect(() => {
    // everything finished while the question was open: nothing left to stop
    if (!stopping && initial.length && !live.length && app.tasks.length) answer('cancel');
  }, [live.length]);
  return (
    <Modal
      title={list.length === 1 ? t('Hay una tarea en curso') : t('Hay {n} tareas en curso', { n: list.length })}
      icon="alert"
      width={540}
      onClose={() => !stopping && answer('cancel')}
      footer={
        <>
          <Button variant="ghost" disabled={stopping} onClick={() => answer('cancel')}>
            {t('Seguir aquí')}
          </Button>
          {tray ? (
            <Button variant="secondary" disabled={stopping} onClick={() => answer('background')}>
              {t('Seguir en segundo plano')}
            </Button>
          ) : null}
          <Button
            variant="danger"
            loading={stopping}
            onClick={() => {
              // the dialog stays up until Havi Hub closes
              setStopping(true);
              call('app.closeChoice', 'stop').catch(app.showError);
            }}
          >
            {t('Detener y cerrar')}
          </Button>
        </>
      }
    >
      <div className="stack close-tasks">
        <p className="muted">
          {stopping
            ? blocking.length
              ? t('Esperando a que termine lo que no se puede cortar a medias. Havi Hub se cerrará solo.')
              : t('Deteniendo…')
            : t('Si cierras ahora, se detienen y se borra lo que quedó a medias (por ejemplo, un modpack que se estaba instalando).')}
        </p>
        <div className="close-task-list">
          {list.map((x) => (
            <div key={x.id} className="close-task">
              <div className="close-task-top">
                <strong>{tm(x.title, x.titleText)}</strong>
                <span className="muted small">{x.progress ? `${Math.round(x.progress * 100)} %` : ''}</span>
              </div>
              <Progress value={x.progress || 0} indeterminate={!x.progress} />
              {x.cancelable === false ? <span className="muted small">{t('Mover carpetas no se puede detener a medias: Havi Hub se cerrará cuando termine.')}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
