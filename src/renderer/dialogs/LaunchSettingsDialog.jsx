// A Prism instance (.zip) that would run something on this computer when the
// game starts: its own commands, a Java of its own, Java arguments or
// variables that load another program, native libraries
// (src/main/prism/launchsettings.js). Before importing it, the person sees
// them and chooses: import without them (the safe choice), with them, or not
// at all. Resolves 'drop', 'keep' or null.
import { Modal } from '../components/Modal.jsx';
import { Button } from '../components/ui.jsx';
import { t } from '../lib/i18n.js';

export default function LaunchSettingsDialog({ file, settings, onResolve }) {
  return (
    <Modal
      title={t('Este perfil ejecuta programas al iniciar')}
      icon="alert"
      width={560}
      onClose={() => onResolve(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onResolve(null)}>
            {t('Cancelar')}
          </Button>
          <Button variant="ghost" onClick={() => onResolve('keep')}>
            {t('Importar con ellos')}
          </Button>
          <Button variant="primary" autoFocus onClick={() => onResolve('drop')}>
            {t('Importar sin ellos')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p>{t('{file} trae ajustes que hacen que tu PC ejecute algo cada vez que juegas con él, además del juego y sus mods:', { file })}</p>
        <div className="info-box warn">
          <div className="stack">
            {settings.map((s) => (
              <div key={s.key}>
                <strong>{s.key}</strong>
                <div className="mono selectable" style={{ overflowWrap: 'anywhere' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="muted">{t('Déjalos solo si sabes qué hacen y confías en quien te pasó el perfil. Sin ellos, el perfil se importa igual y después puedes agregarlos en Opciones del perfil.')}</p>
      </div>
    </Modal>
  );
}
