// Profiles synced between launchers, all in one place: Prism Launcher (which
// can share Havi Hub's whole profiles folder), CurseForge and the Modrinth App
// (one profile at a time). Shows what is synced, profiles that look like the
// same one in two launchers, and the other launchers' profiles that can come
// to Havi Hub without copying them.
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../components/Modal.jsx';
import Icon from '../components/Icon.jsx';
import { Button, Spinner, Checkbox } from '../components/ui.jsx';
import { GeneratedIcon, LoaderIcon, loaderLabel } from '../components/InstanceImage.jsx';
import { defaultRecipe, parseRecipe } from '../lib/instance-icons.js';
import { useApp } from '../lib/store.jsx';
import { call } from '../lib/api.js';
import { t, tm } from '../lib/i18n.js';
import { timeAgo } from '../lib/format.js';
import BrandLogo from '../components/BrandLogo.jsx';
import SharePrismDialog from './SharePrismDialog.jsx';
import { Logo } from '../components/Shell.jsx';

const LAUNCHER_LABEL = { havi: 'Havi Hub', curseforge: 'CurseForge', modrinth: 'Modrinth App' };
const lowerFirst = (s) => String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1);

function ProfileIcon({ p, size = 40 }) {
  return (
    <span className="sync-icon" style={{ width: size, height: size }}>
      {p.icon ? <img loading="lazy" decoding="async" src={p.icon} alt="" /> : <GeneratedIcon recipe={parseRecipe(p.iconRecipe) || defaultRecipe(p.instanceId || p.dir)} />}
    </span>
  );
}

function Version({ mcVersion, loader }) {
  const l = loader ? (typeof loader === 'string' ? { id: loader } : loader) : null;
  return (
    <span className="sync-version">
      <LoaderIcon loader={l} size={15} />
      {loaderLabel(l ? { id: l.id, name: { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }[l.id] || l.id } : null)} {mcVersion}
    </span>
  );
}

// one suggested match: choose which ones join and whose mods win
function Suggestion({ s, onLink, busy }) {
  const [chosen, setChosen] = useState(() => new Set(s.profiles.map((p) => p.dir)));
  const [main, setMain] = useState(() => [...s.profiles].sort((a, b) => b.lastPlayed - a.lastPlayed)[0].dir);
  const toggle = (dir, v) =>
    setChosen((c) => {
      const n = new Set(c);
      if (v) n.add(dir);
      else n.delete(dir);
      return n;
    });
  return (
    <div className="sync-card">
      <div className="sync-card-head">
        <strong>{s.name}</strong>
        <Version mcVersion={s.mcVersion} loader={s.loader} />
      </div>
      {s.profiles.map((p) => (
        <div key={p.dir} className="sync-member">
          <Checkbox checked={chosen.has(p.dir)} onChange={(v) => toggle(p.dir, v)} label="" />
          <ProfileIcon p={p} size={32} />
          <span className="sync-member-text">
            <strong className="with-logo">
              {p.launcher === 'havi' ? <Logo size={16} /> : <BrandLogo brand={p.launcher} size={16} title="" />}
              {p.label}
            </strong>
            <span className="muted">{p.lastPlayed ? t('Jugado {when}', { when: lowerFirst(timeAgo(p.lastPlayed)) }) : t('Sin jugar')}</span>
          </span>
          <button className={`sync-main ${main === p.dir ? 'on' : ''}`} disabled={!chosen.has(p.dir)} onClick={() => setMain(p.dir)} role="radio" aria-checked={main === p.dir}>
            <span className="radio-dot" />
            {t('Sus mods y ajustes')}
          </button>
        </div>
      ))}
      <div className="sync-card-foot">
        <span className="muted small">{t('Se juntan en una sola carpeta. Lo que no quepa se guarda en una copia de respaldo.')}</span>
        <Button variant="primary" icon="link" loading={busy} disabled={chosen.size < 2 || !chosen.has(main)} onClick={() => onLink(main, [...chosen].filter((d) => d !== main))}>
          {t('Sincronizar')}
        </Button>
      </div>
    </div>
  );
}

// Prism Launcher shares the whole profiles folder with Havi Hub (not one profile at a time)
function PrismShare({ app }) {
  const st = app.appState && app.appState.sharing;
  const on = Boolean(st && st.enabled);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (!on) {
      await app.openDialog(SharePrismDialog, {});
      await app.refreshState();
      return;
    }
    const ok = await app.confirm({
      title: t('Dejar de compartir los perfiles'),
      message: t('Havi Hub volverá a usar su propia carpeta de perfiles. Los perfiles compartidos siguen en Prism Launcher; los que dejaste guardados en Havi Hub vuelven a aparecer.'),
      confirmLabel: t('Dejar de compartir'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await call('share.disable');
      await Promise.all([app.refreshState(), app.refreshInstances()]);
    } catch (e) {
      app.showError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h3 className="sync-h with-logo">
        <BrandLogo brand="prism" size={18} title="" />
        Prism Launcher
      </h3>
      <div className="sync-card sync-prism">
        <span className="sync-member-text">
          <strong>{on ? t('Todos los perfiles están compartidos') : t('Compartir todos los perfiles')}</strong>
          <span className="muted">
            {on && st ? (st.missing ? t('No se encuentra la carpeta de Prism Launcher ({dir}); Havi Hub usa su propia carpeta mientras tanto.', { dir: st.prismDir }) : t('Carpeta compartida: {dir}', { dir: st.instancesDir })) : t('Havi Hub y Prism Launcher usan la misma carpeta de perfiles.')}
          </span>
        </span>
        {on && st && !st.missing ? (
          <Button size="sm" variant="secondary" icon="folder" onClick={() => call('app.openPath', st.instancesDir)}>
            {t('Abrir carpeta')}
          </Button>
        ) : null}
        <Button size="sm" variant={on ? 'ghost' : 'primary'} icon={on ? undefined : 'link'} loading={busy} onClick={toggle}>
          {on ? t('Dejar de compartir') : t('Compartir')}
        </Button>
      </div>
    </section>
  );
}

export default function SyncProfilesDialog({ onResolve }) {
  const app = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    setError('');
    call('sync.scan')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const run = async (key, fn, done) => {
    setBusy(key);
    try {
      const r = await fn();
      await app.refreshInstances();
      if (r && r.problems && r.problems.length) app.toast(r.problems.map((p) => `${p.name}: ${tm(p.error)}`).join('\n'), { type: 'warning', duration: 12000 });
      else if (done) app.toast(done, { type: 'success' });
      load();
    } catch (e) {
      app.showError(e);
    } finally {
      setBusy('');
    }
  };

  const link = async (s, mainDir, others) => {
    const main = s.profiles.find((p) => p.dir === mainDir);
    const ok = await app.confirm({
      title: t('Sincronizar {name}', { name: s.name }),
      message: t('Los perfiles elegidos pasarán a usar una sola carpeta dentro de los datos de Havi Hub, y en cada launcher quedará un enlace a ella. Se quedan los mods y ajustes de {launcher}; los mundos, capturas y paquetes de recursos de todos se juntan. Nada se borra: lo que no quepa queda en una copia de respaldo.', { launcher: main.label }),
      confirmLabel: t('Sincronizar'),
    });
    if (!ok) return;
    run(s.key, () => call('sync.link', { main: { dir: mainDir }, others: others.map((dir) => ({ dir })) }), t('{name} quedó sincronizado', { name: s.name }));
  };

  const bring = (p) => run(p.dir, () => call('sync.bring', { dir: p.dir }), t('{name} ya está en Havi Hub, sincronizado con {launcher}', { name: p.name, launcher: p.label }));

  const detach = async (g, m) => {
    const ok = await app.confirm({
      title: t('Dejar de sincronizar'),
      message: t('{launcher} volverá a tener su propia copia de "{name}" (se copia la carpeta compartida tal como está ahora). Los demás siguen sincronizados.', { launcher: m.label || LAUNCHER_LABEL[m.launcher], name: g.name }),
      confirmLabel: t('Dejar de sincronizar'),
    });
    if (!ok) return;
    run(`${g.id}:${m.dir}`, () => call('sync.detach', g.id, m.dir), t('Listo: ya no se sincroniza'));
  };

  const inGroup = new Set(data ? data.profiles.filter((p) => p.group).map((p) => p.dir) : []);
  const suggested = new Set(data ? data.suggestions.flatMap((s) => s.profiles.map((p) => p.dir)) : []);
  const loose = data ? data.profiles.filter((p) => p.launcher !== 'havi' && !inGroup.has(p.dir) && !suggested.has(p.dir)) : [];
  const open = data ? data.running : [];

  return (
    <Modal
      title={t('Sincronizar perfiles')}
      icon="link"
      onClose={() => onResolve(null)}
      width={760}
      footer={
        <Button variant="ghost" onClick={() => onResolve(null)}>
          {t('Cerrar')}
        </Button>
      }
    >
      <p className="sync-intro">{t('Un perfil sincronizado usa una sola carpeta en todos los launchers: juegas en Prism Launcher, CurseForge, Modrinth o Havi Hub y los mundos, mods y ajustes son los mismos. Cada launcher conserva sus cuentas y su configuración.')}</p>
      {open.length ? (
        <div className="banner warn">
          <Icon name="alert" size={20} />
          <span>{t('Cierra {apps} antes de sincronizar: sus perfiles no se pueden mover mientras está abierto.', { apps: open.map((l) => LAUNCHER_LABEL[l]).join(' y ') })}</span>
          <Button size="sm" variant="secondary" icon="refresh" onClick={load}>
            {t('Revisar de nuevo')}
          </Button>
        </div>
      ) : null}
      {error ? <div className="form-error">{error}</div> : null}
      {!data && !error ? (
        <div className="center-spinner">
          <Spinner />
        </div>
      ) : null}
      {data ? (
        <div className="sync-sections">
          <PrismShare app={app} />
          {data.groups.length ? (
            <section>
              <h3 className="sync-h">{t('Sincronizados')}</h3>
              {data.groups.map((g) => (
                <div key={g.id} className="sync-card">
                  <div className="sync-card-head">
                    <strong>{g.name}</strong>
                    <Version mcVersion={g.mcVersion} loader={g.loader ? { id: g.loader } : null} />
                    <span className="spacer" />
                    <Button size="sm" variant="secondary" icon="folder" onClick={() => call('app.openPath', g.store)}>
                      {t('Abrir carpeta')}
                    </Button>
                  </div>
                  {g.members.map((m) => (
                    <div key={m.dir} className="sync-member">
                      <Icon name={m.ok ? 'checkCircle' : 'alert'} size={20} className={m.ok ? 'ok' : 'warn'} />
                      <span className="sync-member-text">
                        <strong className="with-logo">
                          {m.launcher === 'havi' ? <Logo size={18} /> : <BrandLogo brand={m.launcher} size={18} title="" />}
                          {m.label || LAUNCHER_LABEL[m.launcher]}
                        </strong>
                        <span className="muted">{m.ok ? m.name : m.missing ? t('Ya no existe en ese launcher') : t('Ya no está enlazado')}</span>
                      </span>
                      <Button size="sm" variant="ghost" loading={busy === `${g.id}:${m.dir}`} onClick={() => detach(g, m)}>
                        {t('Dejar de sincronizar')}
                      </Button>
                    </div>
                  ))}
                  {!g.members.some((m) => m.launcher === 'havi') ? (
                    <div className="sync-card-foot">
                      <span className="muted small">{t('Todavía no está en Havi Hub.')}</span>
                      <Button size="sm" variant="secondary" icon="plus" loading={busy === g.members[0].dir} onClick={() => bring({ dir: g.members[0].dir, name: g.name, label: g.members[0].label })}>
                        {t('Agregar a Havi Hub')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}
          {data.suggestions.length ? (
            <section>
              <h3 className="sync-h">{t('Parecen el mismo perfil')}</h3>
              {data.suggestions.map((s) => (
                <Suggestion key={s.key} s={s} busy={busy === s.key} onLink={(main, others) => link(s, main, others)} />
              ))}
            </section>
          ) : null}
          <section>
            <h3 className="sync-h">{t('Perfiles de CurseForge y Modrinth')}</h3>
            {loose.length ? (
              loose.map((p) => (
                <div key={p.dir} className="sync-row">
                  <ProfileIcon p={p} />
                  <span className="sync-member-text">
                    <strong>{p.name}</strong>
                    <span className="muted">
                      {p.label} <Version mcVersion={p.mcVersion} loader={p.loader} />
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" icon="link" loading={busy === p.dir} onClick={() => bring(p)}>
                    {t('Traer a Havi Hub sincronizado')}
                  </Button>
                </div>
              ))
            ) : (
              <p className="muted small">{t('No hay más perfiles de CurseForge ni de Modrinth en este computador.')}</p>
            )}
          </section>
          <p className="muted small sync-note">
            {t('Para que un perfil de Havi Hub aparezca en CurseForge o Modrinth, crea ahí un perfil con la misma versión y cargador, y vuelve aquí para sincronizarlos.')}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
