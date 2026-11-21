// Add a Microsoft account. Microsoft only lets approved apps sign in to
// Minecraft, so Havi Hub's engine (Prism Launcher) shows its sign-in window
// for a moment; the account is then copied into Havi Hub.
// relogin: the name of an account that has to sign in again (it was signed in
// with another Microsoft app); signing in replaces it.
import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal.jsx';
import { Button, Progress, Spinner, Input } from '../components/ui.jsx';
import { useApp } from '../lib/store.jsx';
import { call } from '../lib/api.js';
import { t, tm } from '../lib/i18n.js';

export default function AddAccountDialog({ onResolve, relogin }) {
  const app = useApp();
  const [state, setState] = useState('idle'); // idle | waiting | error
  const [error, setError] = useState('');
  const engine = app.engineStatus;
  const preparing = state === 'waiting' && engine && engine.installing;

  useEffect(() => () => call('accounts.cancelLogin').catch(() => {}), []);

  const start = async () => {
    setState('waiting');
    setError('');
    try {
      const r = await call('accounts.addMicrosoft');
      if (r && r.added) {
        await app.refreshAccounts();
        app.toast(relogin ? t('Sesión iniciada: {name}', { name: r.added.join(', ') }) : t('Cuenta agregada: {name}', { name: r.added.join(', ') }), { type: 'success' });
        onResolve(true);
        return;
      }
      if (r && r.error) {
        setError(tm(r.error));
        setState('error');
        return;
      }
      setState('idle');
    } catch (e) {
      setError(e.message);
      setState('error');
    }
  };

  const cancel = async () => {
    await call('accounts.cancelLogin').catch(() => {});
    onResolve(false);
  };

  return (
    <Modal title={relogin ? t('Iniciar sesión de nuevo') : t('Agregar cuenta de Microsoft')} onClose={cancel} width={520} closeOnBackdrop={false}>
      <div className="add-account">
        {state === 'waiting' ? (
          <>
            {preparing ? (
              <>
                <p>{t('Preparando el motor de Havi Hub (solo la primera vez)…')}</p>
                <Progress value={engine.progress} indeterminate={!engine.progress} />
              </>
            ) : (
              <>
                <div className="add-account-wait">
                  <Spinner />
                  <p>{t('Se abrió la ventana de inicio de sesión. Inicia sesión con tu cuenta de Microsoft ahí; esta ventana se cierra sola cuando termines.')}</p>
                </div>
                <small className="muted">{t('Si no la ves, revisa la barra de tareas.')}</small>
              </>
            )}
            <div className="row end">
              <Button variant="ghost" onClick={cancel}>
                {t('Cancelar')}
              </Button>
            </div>
          </>
        ) : (
          <>
            {relogin ? <p>{t('Havi Hub ahora inicia sesión con su propia aplicación de Microsoft, así que {name} tiene que entrar una vez más. Usa la misma cuenta de siempre: tus mundos, skins y compras no cambian.', { name: relogin })}</p> : null}
            <p>{t('Microsoft solo permite iniciar sesión en Minecraft desde aplicaciones aprobadas. Havi Hub usa para esto su motor de juego, que mostrará un momento su ventana de inicio de sesión.')}</p>
            {error ? <div className="form-error">{error}</div> : null}
            <div className="row end">
              <Button variant="ghost" onClick={cancel}>
                {t('Cancelar')}
              </Button>
              <Button variant="primary" icon="microsoft" onClick={start}>
                {t('Iniciar sesión con Microsoft')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function useAddAccount() {
  const app = useApp();
  return () => app.openDialog(AddAccountDialog, {});
}


// An offline account (only after a Microsoft account that owns Minecraft):
// for playing without internet or on LAN / offline-mode servers.
export function OfflineAccountDialog({ onResolve }) {
  const app = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^[A-Za-z0-9_]{3,16}$/.test(name);
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await call('accounts.addOffline', name);
      await app.refreshAccounts();
      app.toast(t('Cuenta offline agregada: {name}', { name }), { type: 'success' });
      onResolve(true);
    } catch (e) {
      app.showError(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Agregar cuenta offline')}
      icon="offline"
      onClose={() => onResolve(false)}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={() => onResolve(false)}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" icon="plus" loading={busy} disabled={!valid} onClick={save}>
            {t('Agregar')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <label className="label">{t('Nombre de jugador')}</label>
        <Input value={name} autoFocus maxLength={16} counter placeholder="Steve" onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <p className="muted small">{t('De 3 a 16 caracteres: letras, números y guion bajo.')}</p>
        <p className="muted">{t('Sirve para jugar sin internet, en LAN o en servidores en modo offline. No entra a servidores que verifican la cuenta y no puede cambiar su skin online.')}</p>
      </div>
    </Modal>
  );
}
