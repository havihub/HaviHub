// A modpack that brought its own key bindings (its author chose them so its
// mods don't clash), installed by someone who has key bindings of their own
// (Ajustes → Minecraft → Teclas): which ones the new profile uses
// (src/main/platforms/modpacks.js, packKeys). Resolves 'mine', 'pack', or
// null when closed (the pack's stay, as installed).
import { Modal } from '../components/Modal.jsx';
import { Button } from '../components/ui.jsx';
import { t } from '../lib/i18n.js';

export default function ModpackKeysDialog({ name, onResolve }) {
  return (
    <Modal
      title={t('¿Qué teclas quieres usar en {name}?', { name })}
      icon="keyboard"
      width={520}
      onClose={() => onResolve(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onResolve('pack')}>
            {t('Las del modpack')}
          </Button>
          <Button variant="primary" autoFocus onClick={() => onResolve('mine')}>
            {t('Mis teclas')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p>{t('Este modpack trae sus propias teclas, elegidas por su autor para que sus mods no choquen entre sí.')}</p>
        <p>{t('Mis teclas: se usan las que cambiaste en Ajustes → Minecraft → Teclas, y las demás quedan como las dejó el autor.')}</p>
        <p className="muted">{t('Puedes cambiarlo después con "Aplicar las teclas a todos los perfiles", en Ajustes → Minecraft → Teclas.')}</p>
      </div>
    </Modal>
  );
}
