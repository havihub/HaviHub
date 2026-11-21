// Import profiles from other launchers: CurseForge, Modrinth and/or Prism
// Launcher (also PolyMC / MultiMC). First pick where from (one, two or all),
// then tick the profiles.
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/Modal.jsx';
import Icon from '../components/Icon.jsx';
import { Button, Checkbox, Spinner, Progress } from '../components/ui.jsx';
import InstanceImage, { LoaderIcon } from '../components/InstanceImage.jsx';
import { useApp } from '../lib/store.jsx';
import { call } from '../lib/api.js';
import { t, tm } from '../lib/i18n.js';
import { formatSize } from '../lib/format.js';
import BrandLogo from '../components/BrandLogo.jsx';

const KINDS = [
  { source: 'curseforge', name: 'CurseForge', icon: 'fire' },
  { source: 'modrinth', name: 'Modrinth', icon: 'package' },
  { source: 'prism', name: 'Prism Launcher', icon: 'prism' },
];
const keyOf = (s) => `${s.source}|${s.dir}`;

function SourceCard({ s, on, onToggle, onPick }) {
  const kind = KINDS.find((k) => k.source === s.source);
  const usable = Boolean(s.dir) && !s.shared && !s.error;
  return (
    <div className={`src-card src-${s.source} ${on ? 'on' : ''} ${usable ? '' : 'off'}`} onClick={() => (usable ? onToggle(!on) : onPick())}>
      <span className="src-card-logo">
        <BrandLogo brand={s.source} size={32} />
      </span>
      <span className="src-card-main">
        <strong>{s.label || kind.name}</strong>
        <small>
          {s.shared
            ? t('Ya compartes sus perfiles con Havi Hub')
            : s.error
              ? tm(s.error)
              : !s.dir
                ? t('No se encontró en este equipo')
                : s.count == null
                  ? t('Carpeta elegida')
                  : s.count === 1
                    ? t('1 perfil')
                    : t('{n} perfiles', { n: s.count })}
        </small>
        {s.dir ? (
          <small className="src-card-path" title={s.dir}>
            {s.dir}
          </small>
        ) : null}
      </span>
      {usable ? (
        <span className="src-card-check" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={on} onChange={onToggle} />
        </span>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          icon="folder"
          onClick={(e) => {
            e.stopPropagation();
            onPick();
          }}
        >
          {t('Buscar carpeta…')}
        </Button>
      )}
    </div>
  );
}

export default function ImportLaunchersDialog({ onResolve, only = null }) {
  const app = useApp();
  const [sources, setSources] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [step, setStep] = useState('pick');
  const [lists, setLists] = useState({});
  const [selected, setSelected] = useState({});
  const [sizes, setSizes] = useState({});
  const [opts, setOpts] = useState({ groups: true, accounts: true, skins: true, globals: true, shared: true, move: false });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const task = app.tasks.find((x) => x.kind === 'import' && x.status === 'running');
  const kinds = only ? KINDS.filter((k) => only.includes(k.source)) : KINDS;

  useEffect(() => {
    call('import.detectAll')
      .then((d) => {
        const list = [];
        for (const k of kinds) {
          const found = k.source === 'prism' ? (d.prism || []).map((p) => ({ source: 'prism', dir: p.dataDir, label: p.label, count: p.count, shared: p.shared })) : (d[k.source] || []).map((x) => ({ source: k.source, dir: x.dir, label: k.name, count: x.count, error: x.error }));
          const legacy = k.source === 'prism' && app.config && app.config.legacyPrismDir;
          if (legacy && !found.some((f) => f.dir.toLowerCase() === legacy.toLowerCase())) found.unshift({ source: 'prism', dir: legacy, label: 'Prism Launcher', count: null });
          list.push(...(found.length ? found : [{ source: k.source, dir: '', label: k.name }]));
        }
        setSources(list);
        setPicked(new Set(list.filter((s) => s.dir && !s.shared && !s.error && s.count).map(keyOf)));
      })
      .catch((e) => {
        setSources(kinds.map((k) => ({ source: k.source, dir: '', label: k.name })));
        setError(e.message);
      });
  }, []);

  const pickFolder = async (source) => {
    const p = await call('app.pickFolder', {
      title: source === 'curseforge' ? t('Carpeta "Instances" de CurseForge') : source === 'modrinth' ? t('Carpeta de la app de Modrinth') : t('Carpeta de datos de Prism Launcher'),
    });
    if (!p) return;
    try {
      const d = await call('import.listFrom', source, p);
      const s = { source, dir: d.dataDir, label: KINDS.find((k) => k.source === source).name, count: d.instances.length };
      setSources((l) => [...l.filter((x) => !(x.source === source && !x.dir) && keyOf(x) !== keyOf(s)), s]);
      setPicked((ps) => new Set(ps).add(keyOf(s)));
      setLists((m) => ({ ...m, [keyOf(s)]: d }));
      setSelected((m) => ({ ...m, [keyOf(s)]: new Set(d.instances.filter((i) => !i.exists).map((i) => i.id)) }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  const chosen = useMemo(() => (sources || []).filter((s) => picked.has(keyOf(s))), [sources, picked]);

  const goList = () => {
    setStep('list');
    for (const s of chosen) {
      const k = keyOf(s);
      if (lists[k]) continue;
      call('import.listFrom', s.source, s.dir)
        .then((d) => {
          setLists((m) => ({ ...m, [k]: d }));
          setSelected((m) => ({ ...m, [k]: new Set(d.instances.filter((i) => !i.exists).map((i) => i.id)) }));
          call('import.sizesFrom', s.source, s.dir, d.instances.map((i) => i.id))
            .then((z) => setSizes((m) => ({ ...m, [k]: z })))
            .catch(() => {});
        })
        .catch((e) => setLists((m) => ({ ...m, [k]: { error: e.message, instances: [] } })));
    }
  };

  const setOne = (k, id, v) =>
    setSelected((m) => {
      const n = new Set(m[k] || []);
      if (v) n.add(id);
      else n.delete(id);
      return { ...m, [k]: n };
    });

  const count = chosen.reduce((n, s) => n + ((selected[keyOf(s)] && selected[keyOf(s)].size) || 0), 0);
  const total = chosen.reduce((n, s) => n + [...(selected[keyOf(s)] || [])].reduce((a, id) => a + ((sizes[keyOf(s)] || {})[id] || 0), 0), 0);
  const hasPrism = chosen.some((s) => s.source === 'prism');
  const prismData = chosen.filter((s) => s.source === 'prism').map((s) => lists[keyOf(s)]).filter(Boolean);
  const prismAccounts = prismData.flatMap((d) => d.accounts || []);
  const prismSkins = prismData.reduce((n, d) => n + (d.skins || 0), 0);
  const loading = step === 'list' && chosen.some((s) => !lists[keyOf(s)]);

  const run = async () => {
    setRunning(true);
    const done = [];
    const failed = [];
    try {
      for (const s of chosen) {
        const ids = [...(selected[keyOf(s)] || [])];
        if (!ids.length) continue;
        const r = await call('import.runFrom', { source: s.source, srcDir: s.dir, ids, ...opts, move: s.source === 'prism' && opts.move });
        done.push(...r.imported);
        failed.push(...(r.failed || []));
      }
      await Promise.all([app.refreshInstances(), app.refreshAccounts()]);
      if (failed.length) app.toast(t('{n} perfiles no se pudieron importar: {list}', { n: failed.length, list: failed.map((f) => f.id).join(', ') }), { type: 'error', duration: 12000 });
      app.toast(t('Listo: {n} perfiles importados', { n: done.length }), { type: 'success' });
      onResolve({ imported: done, failed });
    } catch (e) {
      app.showError(e);
      setRunning(false);
    }
  };

  const close = () => {
    if (running) return;
    onResolve(null);
  };

  const footer =
    step === 'pick' ? (
      <>
        <span className="muted import-total">{chosen.length === 1 ? t('1 launcher elegido') : t('{n} launchers elegidos', { n: chosen.length })}</span>
        <span className="spacer" />
        <Button variant="ghost" onClick={close}>
          {t('Cancelar')}
        </Button>
        <Button variant="primary" iconRight="chevronRight" disabled={!chosen.length} onClick={goList}>
          {t('Continuar')}
        </Button>
      </>
    ) : (
      <>
        <span className="muted import-total">
          {count === 1 ? t('1 perfil seleccionado') : t('{n} perfiles seleccionados', { n: count })}
          {total ? ` · ${formatSize(total)}` : ''}
        </span>
        <span className="spacer" />
        <Button variant="ghost" onClick={() => setStep('pick')} disabled={running}>
          {t('Atrás')}
        </Button>
        <Button variant="primary" icon="import" disabled={!count || running || loading} loading={running} onClick={run}>
          {count === 1 ? (opts.move && hasPrism ? t('Mover 1 perfil') : t('Importar 1 perfil')) : opts.move && hasPrism ? t('Mover {n} perfiles', { n: count }) : t('Importar {n} perfiles', { n: count })}
        </Button>
      </>
    );

  return (
    <Modal title={t('Importar desde otro launcher')} icon="import" onClose={close} closeOnBackdrop={false} width={800} className="import-dialog launchers-dialog" footer={footer}>
      {step === 'pick' ? (
        <>
          <p className="import-intro">{t('Elige de dónde quieres traer tus perfiles: uno, dos o todos a la vez.')}</p>
          {sources === null ? (
            <div className="center-spinner">
              <Spinner />
            </div>
          ) : (
            <div className="src-cards">
              {sources.map((s) => (
                <SourceCard
                  key={keyOf(s) || s.source}
                  s={s}
                  on={picked.has(keyOf(s))}
                  onPick={() => pickFolder(s.source)}
                  onToggle={(v) =>
                    setPicked((ps) => {
                      const n = new Set(ps);
                      if (v) n.add(keyOf(s));
                      else n.delete(keyOf(s));
                      return n;
                    })
                  }
                />
              ))}
            </div>
          )}
          {error ? <div className="form-error">{error}</div> : null}
          <div className="src-more">
            {kinds.map((k) => (
              <button key={k.source} className="link-btn" onClick={() => pickFolder(k.source)}>
                {t('¿Tu {name} está en otra carpeta?', { name: k.name })}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="import-list launchers-list">
            {chosen.map((s) => {
              const k = keyOf(s);
              const d = lists[k];
              const sel = selected[k] || new Set();
              const ids = d ? d.instances.map((i) => i.id) : [];
              const all = ids.length > 0 && ids.every((id) => sel.has(id));
              return (
                <div key={k} className="import-group">
                  <div className={`import-source-head src-${s.source}`}>
                    <span className="src-card-logo small">
                      <BrandLogo brand={s.source} size={20} />
                    </span>
                    <strong>{s.label}</strong>
                    {d && !d.error ? <Checkbox checked={all} indeterminate={!all && sel.size > 0} onChange={(v) => setSelected((m) => ({ ...m, [k]: new Set(v ? ids : []) }))} label={t('Todos ({n})', { n: ids.length })} /> : null}
                  </div>
                  {!d ? (
                    <div className="center-spinner">
                      <Spinner size={22} />
                    </div>
                  ) : d.error ? (
                    <div className="form-error">{tm(d.error)}</div>
                  ) : !d.instances.length ? (
                    <div className="muted import-empty">{t('No hay perfiles aquí.')}</div>
                  ) : (
                    d.instances.map((i) => (
                      <div key={i.id} className={`import-row ${sel.has(i.id) ? 'on' : ''}`} onClick={() => setOne(k, i.id, !sel.has(i.id))}>
                        <Checkbox checked={sel.has(i.id)} onChange={(v) => setOne(k, i.id, v)} />
                        <InstanceImage instance={i} size={40} />
                        <span className="import-row-main">
                          <strong>{i.name}</strong>
                          <small className="muted">
                            <LoaderIcon loader={i.loader} size={13} /> {i.loader ? i.loader.name : 'Vanilla'} · {i.mcVersion || '?'}
                            {i.group ? ` · ${i.group}` : ''}
                            {i.incomplete ? ` · ${t('la instalación no terminó en ese launcher')}` : ''}
                            {i.exists ? ` · ${t('ya tienes uno con ese nombre: se importará como copia')}` : ''}
                          </small>
                        </span>
                        <span className="muted import-size">{(sizes[k] || {})[i.id] != null ? formatSize(sizes[k][i.id]) : <Spinner size={14} />}</span>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
          <div className="import-options">
            <Checkbox checked={opts.groups} onChange={(v) => setOpts((o) => ({ ...o, groups: v }))} label={t('Mantener los grupos')} />
            {hasPrism ? (
              <>
                <Checkbox checked={opts.accounts} disabled={!prismAccounts.length} onChange={(v) => setOpts((o) => ({ ...o, accounts: v }))} label={prismAccounts.length ? t('Importar cuentas de Prism Launcher ({list})', { list: prismAccounts.map((a) => a.name).join(', ') }) : t('Importar cuentas de Prism Launcher (no hay)')} />
                <Checkbox checked={opts.skins} disabled={!prismSkins} onChange={(v) => setOpts((o) => ({ ...o, skins: v }))} label={t('Importar skins de Prism Launcher ({n})', { n: prismSkins })} />
                <Checkbox checked={opts.globals} onChange={(v) => setOpts((o) => ({ ...o, globals: v }))} label={t('Importar ajustes de Prism Launcher (Java, memoria, argumentos, variables de entorno y comandos)')} />
              </>
            ) : null}
            <Checkbox checked={opts.shared} onChange={(v) => setOpts((o) => ({ ...o, shared: v }))} label={t('Reusar los archivos del juego que esos launchers ya descargaron (el primer inicio es mucho más rápido)')} />
            {hasPrism ? <Checkbox checked={opts.move} onChange={(v) => setOpts((o) => ({ ...o, move: v }))} label={t('Prism Launcher: mover en vez de copiar (más rápido; los perfiles dejan de estar en Prism Launcher)')} /> : null}
          </div>
        </>
      )}
      {running && task ? (
        <div className="import-progress">
          <Progress value={task.progress} indeterminate={!task.progress} />
          <small className="muted">
            {tm(task.title, task.titleText)} · {tm(task.detail, task.detailText)}
          </small>
        </div>
      ) : null}
    </Modal>
  );
}
