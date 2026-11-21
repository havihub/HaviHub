// Smaller instance dialogs: clone, share/export, move to group, install results.
import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal.jsx';
import { Button, Input, Checkbox, Select, Pills } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import InstanceImage from '../components/InstanceImage.jsx';
import { call } from '../lib/api.js';
import { t, tm } from '../lib/i18n.js';
import { useApp } from '../lib/store.jsx';
import { LIMITS } from '../../shared/limits.js';
import { compatIssue, cmpVersion } from '../../shared/compat.js';
import { compatText } from '../lib/compatText.js';
import CreateInstanceDialog from './CreateInstanceDialog.jsx';

export function CloneDialog({ instance, onResolve }) {
  const app = useApp();
  const [name, setName] = useState(`${instance.name} (copia)`);
  const [copyWorlds, setCopyWorlds] = useState(true);
  const [copyScreenshots, setCopyScreenshots] = useState(false);
  const [keepPlaytime, setKeepPlaytime] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={t('Clonar como…')}
      icon="clone"
      onClose={() => onResolve(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onResolve(null)}>
            {t('Cancelar')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const id = await call('instances.clone', instance.id, { name, copyWorlds, copyScreenshots, keepPlaytime });
                app.toast(t('Instancia clonada'), { type: 'success' });
                onResolve(id);
              } catch (e) {
                app.showError(e);
                setBusy(false);
              }
            }}
          >
            {t('Clonar')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <label className="label">{t('Nombre de la copia')}</label>
        <Input value={name} autoFocus maxLength={LIMITS.instanceName} counter onChange={(e) => setName(e.target.value)} />
        <Checkbox checked={copyWorlds} onChange={setCopyWorlds} label={t('Copiar mundos')} />
        <Checkbox checked={copyScreenshots} onChange={setCopyScreenshots} label={t('Copiar capturas de pantalla')} />
        <Checkbox checked={keepPlaytime} onChange={setKeepPlaytime} label={t('Conservar el tiempo de juego')} />
      </div>
    </Modal>
  );
}

// The name a setting has in Opciones del perfil (keys from launchsettings.js)
function settingLabel(key) {
  if (key.startsWith('Env ')) return t('variable {name}', { name: key.slice(4) });
  const names = { PreLaunchCommand: t('Antes de iniciar'), WrapperCommand: t('Comando envoltorio (wrapper)'), PostExitCommand: t('Después de cerrar'), JavaPath: t('Instalación de Java'), JvmArgs: t('Argumentos de la JVM'), CustomGLFWPath: t('Ruta de GLFW'), CustomOpenALPath: t('Ruta de OpenAL') };
  return names[key] || key;
}

// "Compartir perfil": a CurseForge modpack (.zip, what the CurseForge app
// imports), a Modrinth modpack (.mrpack) or a Prism instance (.zip).
export function ShareDialog({ instance, onResolve }) {
  const app = useApp();
  const [format, setFormat] = useState('curseforge');
  const [name, setName] = useState(instance.name);
  const [version, setVersion] = useState('1.0.0');
  const [author, setAuthor] = useState(app.activeAccount ? app.activeAccount.name : '');
  const [summary, setSummary] = useState('');
  const [includeWorlds, setIncludeWorlds] = useState(false);
  const [busy, setBusy] = useState(false);
  // this PC's commands, Java and variables: left out of a Prism .zip unless checked
  const [personal, setPersonal] = useState([]);
  const [sharePersonal, setSharePersonal] = useState(false);
  useEffect(() => {
    let alive = true;
    if (format === 'zip') call('instances.exportSettings', instance.id).then((list) => alive && setPersonal(list || []), () => {});
    return () => {
      alive = false;
    };
  }, [format, instance.id]);
  const exportFile = async () => {
    setBusy(true);
    try {
      const opts = format === 'mrpack' ? { format, name, version, summary } : format === 'curseforge' ? { format, name, version, author, includeWorlds } : { format, includeWorlds, personalSettings: sharePersonal ? 'keep' : 'drop' };
      const dest = await call('instances.export', instance.id, opts);
      if (dest) {
        app.toast(t('Exportado en {p}', { p: dest }), { type: 'success' });
        onResolve(dest);
      } else setBusy(false);
    } catch (e) {
      app.showError(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Compartir perfil')}
      icon="share"
      className="share-dialog"
      onClose={() => onResolve(null)}
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={() => onResolve(null)}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" icon="shareBox" loading={busy} onClick={exportFile}>
            {t('Exportar')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Pills
          value={format}
          onChange={setFormat}
          options={[
            { value: 'curseforge', label: t('CurseForge (.zip)'), logo: 'curseforge' },
            { value: 'mrpack', label: t('Modrinth (.mrpack)'), logo: 'modrinth' },
            { value: 'zip', label: t('Prism (.zip)'), logo: 'prism' },
          ]}
        />
        {format === 'curseforge' ? (
          <>
            <p className="muted">{t('El formato de la app de CurseForge: tus amigos lo abren con Importar → Archivo .zip en CurseForge, o en Havi Hub y Prism Launcher.')}</p>
            <label className="label">{t('Nombre')}</label>
            <Input value={name} maxLength={LIMITS.instanceName} counter onChange={(e) => setName(e.target.value)} />
            <div className="row">
              <span className="grow stack">
                <label className="label">{t('Versión')}</label>
                <Input value={version} maxLength={LIMITS.version} onChange={(e) => setVersion(e.target.value)} />
              </span>
              <span className="grow stack">
                <label className="label">{t('Autor')}</label>
                <Input value={author} maxLength={64} onChange={(e) => setAuthor(e.target.value)} />
              </span>
            </div>
            <Checkbox checked={includeWorlds} onChange={setIncludeWorlds} label={t('Incluir mundos')} />
            <p className="muted small">{t('Los mods, resource packs y shaders de CurseForge van como enlaces; el resto (configuración y archivos de otras fuentes) se copia dentro del .zip.')}</p>
            <div className="info-box">
              <Icon name="info" size={18} />
              <span>{t('Los códigos de perfil de CurseForge solo los crea la app de CurseForge con tu cuenta y duran 7 días. Para compartir con código: importa este .zip en CurseForge y usa "Compartir perfil" ahí.')}</span>
            </div>
          </>
        ) : format === 'mrpack' ? (
          <>
            <p className="muted">{t('El formato de Modrinth: se abre en la app de Modrinth, Prism Launcher, Havi Hub y otros launchers.')}</p>
            <label className="label">{t('Nombre')}</label>
            <Input value={name} maxLength={LIMITS.instanceName} counter onChange={(e) => setName(e.target.value)} />
            <label className="label">{t('Versión')}</label>
            <Input value={version} maxLength={LIMITS.version} onChange={(e) => setVersion(e.target.value)} />
            <label className="label">{t('Descripción (opcional)')}</label>
            <Input value={summary} maxLength={LIMITS.summary} counter onChange={(e) => setSummary(e.target.value)} />
            <p className="muted small">{t('Los mods descargados de Modrinth se incluyen como enlaces; el resto (configuración, mods de otras fuentes) se copia dentro del archivo.')}</p>
          </>
        ) : (
          <>
            <p className="muted">{t('Una copia completa del perfil para Prism Launcher o Havi Hub.')}</p>
            <Checkbox checked={includeWorlds} onChange={setIncludeWorlds} label={t('Incluir mundos')} />
            {personal.length ? (
              <>
                <Checkbox checked={sharePersonal} onChange={setSharePersonal} label={t('Incluir mis comandos y variables de entorno')} />
                <p className="muted small">
                  {t('Son de tu PC y pueden tener datos tuyos, como contraseñas o carpetas. Sin marcar, el perfil se comparte sin ellos: {list}.', { list: personal.map((p) => settingLabel(p.key)).join(', ') })}
                </p>
              </>
            ) : null}
            <p className="muted small">{t('Incluye todo el perfil: mods, configuración y paquetes de recursos.')}</p>
          </>
        )}
      </div>
    </Modal>
  );
}

export function MoveGroupDialog({ instance, instances, onResolve }) {
  const app = useApp();
  const list = instances || [instance];
  const [group, setGroup] = useState(list.length === 1 ? list[0].group || '' : '');
  const [newGroup, setNewGroup] = useState('');
  const options = [{ value: '', label: t('Sin grupo') }, ...app.groups.map((g) => ({ value: g, label: g })), { value: '__new', label: t('+ Nuevo grupo…') }];
  return (
    <Modal
      title={t('Mover a grupo')}
      icon="groupGrid"
      onClose={() => onResolve(null)}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={() => onResolve(null)}>
            {t('Cancelar')}
          </Button>
          <Button
            variant="primary"
            disabled={group === '__new' && !newGroup.trim()}
            onClick={async () => {
              const g = group === '__new' ? newGroup.trim() : group;
              try {
                // one at a time: every change rewrites the groups file
                for (const i of list) await call('instances.setGroup', i.id, g);
                onResolve(g);
              } catch (e) {
                app.showError(e);
              }
            }}
          >
            {t('Mover')}
          </Button>
        </>
      }
    >
      <div className="stack">
        {list.length === 1 ? (
          <div className="row">
            <InstanceImage instance={list[0]} size={44} className="rounded" />
            <strong>{list[0].name}</strong>
          </div>
        ) : (
          <strong>{t('{n} perfiles seleccionados', { n: list.length })}</strong>
        )}
        <Select value={group} options={options} onChange={setGroup} />
        {group === '__new' ? <Input value={newGroup} autoFocus placeholder={t('Nombre del grupo')} onChange={(e) => setNewGroup(e.target.value)} /> : null}
      </div>
    </Modal>
  );
}

// Summary after installing content/modpacks, including CurseForge files whose
// authors don't allow third-party downloads.
export function InstallResultDialog({ result, title, onResolve }) {
  const { installed = [], skipped = [], blocked = [], failed = [] } = result || {};
  return (
    <Modal
      title={title || t('Resultado de la instalación')}
      icon={blocked.length || failed.length ? 'alert' : 'checkCircle'}
      onClose={() => onResolve(true)}
      width={620}
      footer={
        <Button variant="primary" onClick={() => onResolve(true)}>
          {t('Listo')}
        </Button>
      }
    >
      <div className="stack result-list">
        {installed.length ? (
          <div>
            <h4>{t('Instalado')}</h4>
            {installed.map((i) => (
              <div key={i.fileName} className="result-row ok">
                <Icon name="check" size={16} />
                {i.title} <span className="muted">{i.version}</span> {i.isDep ? <span className="chip">{t('dependencia')}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {skipped.length ? (
          <div>
            <h4>{t('Omitido')}</h4>
            {skipped.map((i, n) => (
              <div key={n} className="result-row">
                <Icon name="info" size={16} />
                {i.title} <span className="muted">— {tm(i.reason)}</span>
              </div>
            ))}
          </div>
        ) : null}
        {blocked.length ? (
          <div>
            <h4>{t('Descarga manual necesaria')}</h4>
            <p className="muted small">{t('Los autores de estos archivos no permiten descargarlos desde otras apps. Descárgalos desde su página y ponlos en la carpeta indicada.')}</p>
            {blocked.map((b) => (
              <div key={b.fileName} className="result-row warn">
                <Icon name="alert" size={16} />
                <span className="grow">
                  {b.title} <span className="muted">({b.fileName})</span>
                </span>
                {b.url ? (
                  <Button size="sm" variant="secondary" icon="external" onClick={() => call('app.openExternal', b.url)}>
                    {t('Abrir página')}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" icon="folder" onClick={() => call('app.openPath', b.folder)}>
                  {t('Carpeta')}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        {failed.length ? (
          <div>
            <h4>{t('Con errores')}</h4>
            {failed.map((f, n) => (
              <div key={n} className="result-row err">
                <Icon name="xCircle" size={16} />
                {tm(f.title)} <span className="muted">— {tm(f.reason)}</span>
              </div>
            ))}
          </div>
        ) : null}
        {!installed.length && !skipped.length && !blocked.length && !failed.length ? <p className="muted">{t('No hubo cambios.')}</p> : null}
      </div>
    </Modal>
  );
}

// Choose which instance receives a mod/resource pack when browsing globally
// Which profile something from Discover goes into: only the profiles that
// can use it can be picked (no mods or shaders on vanilla, the right game
// version and loader for mods); the others are listed apart with the reason.
// "Crear un perfil compatible" makes one with a version and loader it supports.
function suggestProfile(subject, type) {
  const versions = (subject.gameVersions || []).filter((v) => /^\d+(\.\d+)+$/.test(v)).sort((a, b) => cmpVersion(b, a));
  const loaders = (subject.loaders || []).map((l) => String(l).toLowerCase());
  let loader = 'vanilla';
  if (type === 'mod') loader = ['fabric', 'neoforge', 'forge', 'quilt'].find((l) => loaders.includes(l)) || 'fabric';
  else if (type === 'shader') loader = 'fabric';
  return { mc: versions[0] || '', loader };
}

export function InstallTargetDialog({ project, version, onResolve }) {
  const app = useApp();
  const subject = version || project; // a chosen version says exactly where it runs
  const type = project.type;
  const rows = app.instances.filter((i) => !i.broken).map((i) => ({ inst: i, issue: compatIssue(subject, i, type) }));
  const ok = rows.filter((r) => !r.issue);
  const no = rows.filter((r) => r.issue);
  const [selected, setSelected] = useState(ok[0] ? ok[0].inst.id : '');
  const [showNo, setShowNo] = useState(!ok.length);
  const createCompatible = async () => {
    const id = await app.openDialog(CreateInstanceDialog, { preset: suggestProfile(subject, type) });
    if (!id) return;
    await app.refreshInstances();
    onResolve(id);
  };
  return (
    <Modal
      title={t('¿En qué perfil lo instalo?')}
      icon="download"
      onClose={() => onResolve(null)}
      width={580}
      footer={
        <>
          <Button variant="ghost" icon="plus" onClick={createCompatible}>
            {t('Crear un perfil compatible')}
          </Button>
          <span className="spacer" />
          <Button variant="ghost" onClick={() => onResolve(null)}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" disabled={!selected} onClick={() => onResolve(selected)}>
            {t('Instalar')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">
          {t('Instalar')} <strong>{project.title}</strong>
        </p>
        {ok.length ? (
          <div className="target-list">
            {ok.map(({ inst: i }) => (
              <button key={i.id} className={`target-row ${selected === i.id ? 'active' : ''}`} onClick={() => setSelected(i.id)} onDoubleClick={() => onResolve(i.id)}>
                <InstanceImage instance={i} size={40} />
                <span className="grow">
                  <strong>{i.name}</strong>
                  <small className="muted">
                    {i.mcVersion} · {i.loader ? i.loader.name : 'Vanilla'}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="target-none">
            <Icon name="info" size={20} />
            <span>{t('Ninguno de tus perfiles puede usar {name}. Crea uno compatible y se instala ahí.', { name: project.title })}</span>
          </div>
        )}
        {no.length ? (
          <>
            <button className="link-btn target-toggle" onClick={() => setShowNo((v) => !v)}>
              <Icon name={showNo ? 'chevronUp' : 'chevronDown'} size={16} />
              {t('No compatibles ({n})', { n: no.length })}
            </button>
            {showNo ? (
              <div className="target-list">
                {no.map(({ inst: i, issue }) => (
                  <div key={i.id} className="target-row disabled" aria-disabled="true">
                    <InstanceImage instance={i} size={40} />
                    <span className="grow">
                      <strong>{i.name}</strong>
                      <small className="muted">{compatText(issue)}</small>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
