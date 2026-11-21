// Modrinth layout home: "Jump back in" (the profiles played last), popular
// modpacks, and the library: every profile as a card, grouped, with search,
// sort, grouping and drag & drop between groups.
import { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Spinner } from '../components/ui.jsx';
import { Popover, MenuItem, MenuHeader, useMenu } from '../components/Menu.jsx';
import InstanceImage, { LoaderIcon, GeneratedIcon } from '../components/InstanceImage.jsx';
import { parseRecipe } from '../lib/instance-icons.js';
import CreateInstanceDialog from '../dialogs/CreateInstanceDialog.jsx';
import ImportLaunchersDialog from '../dialogs/ImportLaunchersDialog.jsx';
import { useApp } from '../lib/store.jsx';
import { call } from '../lib/api.js';
import { t } from '../lib/i18n.js';
import { timeAgo, formatCount } from '../lib/format.js';
import * as actions from '../lib/actions.js';
import { LIMITS } from '../../shared/limits.js';
import { SORTS, sortInstances, useInstanceContextMenu } from '../pages/Library.jsx';
import { startInstanceDrag, endInstanceDrag, useDropTarget, useInstanceDrag } from '../lib/instanceDrag.js';
import { useInstaller } from '../pages/browseShared.jsx';
import DropBar from '../components/DropBar.jsx';
import CreateGroupDialog from '../dialogs/CreateGroupDialog.jsx';
import TileSize, { useTileSize } from '../components/TileSize.jsx';

const LOADER_NAME = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };
export const loaderText = (inst) => (inst.loader ? LOADER_NAME[inst.loader.id] || inst.loader.name || inst.loader.id : 'Vanilla');

// a profile card: the square picture, its name, loader and version; Play
// appears over the picture on hover (Stop while it runs)
export function MrInstanceCard({ inst, onContext, compact = false }) {
  const app = useApp();
  const running = app.running.has(inst.id);
  const launching = app.launching && app.launching.has(inst.id);
  const open = () => app.navigate({ page: 'instance', id: inst.id });
  return (
    <div
      className={`mr-card mr-inst ${compact ? 'compact' : ''} ${running ? 'running' : ''}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && open()}
      onContextMenu={(e) => onContext && onContext(e, inst)}
      draggable
      onDragStart={(e) => startInstanceDrag(e, inst)}
      onDragEnd={endInstanceDrag}
      title={inst.broken || undefined}
    >
      <div className="mr-inst-art">
        <InstanceImage instance={inst} />
        <button
          className={`mr-inst-play ${running ? 'stop' : ''}`}
          aria-label={running ? t('Detener') : t('Jugar')}
          data-tip={running ? t('Detener') : t('Jugar')}
          onClick={(e) => {
            e.stopPropagation();
            if (running) call('instances.stop', inst.id);
            else app.launch(inst.id);
          }}
        >
          {launching ? <Spinner size={20} /> : <Icon name={running ? 'stop' : 'play'} size={22} />}
        </button>
      </div>
      <div className="mr-inst-text">
        <strong title={inst.name}>{inst.name}</strong>
        <span>
          {loaderText(inst)} {inst.mcVersion}
        </span>
      </div>
    </div>
  );
}

function JumpBackIn() {
  const app = useApp();
  const recent = useMemo(
    () =>
      app.instances
        .filter((i) => i.lastLaunch)
        .sort((a, b) => b.lastLaunch - a.lastLaunch)
        .slice(0, 4),
    [app.instances],
  );
  if (!recent.length) return null;
  return (
    <section className="mr-section">
      <h2 className="mr-h2">{t('Volver a jugar')}</h2>
      <div className="mr-jump">
        {recent.map((inst) => {
          const running = app.running.has(inst.id);
          return (
            <div key={inst.id} className="mr-card mr-jump-item" role="button" tabIndex={0} onClick={() => app.navigate({ page: 'instance', id: inst.id })} onKeyDown={(e) => e.key === 'Enter' && app.navigate({ page: 'instance', id: inst.id })}>
              <InstanceImage instance={inst} res={128} />
              <span className="mr-jump-text">
                <strong>{inst.name}</strong>
                <small>
                  <Icon name="clock" size={14} />
                  {t('Jugado {when}', { when: timeAgo(inst.lastLaunch).toLowerCase() })}
                </small>
              </span>
              <button
                className={`mr-btn ${running ? 'danger' : 'brand'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (running) call('instances.stop', inst.id);
                  else app.launch(inst.id);
                }}
              >
                <Icon name={running ? 'stop' : 'play'} size={18} />
                {running ? t('Detener') : t('Jugar')}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PopularPacks() {
  const app = useApp();
  const [list, setList] = useState(null);
  const { install, busy } = useInstaller();
  useEffect(() => {
    call('platforms.discover', { source: (app.config && app.config.discoverSource) || 'both', type: 'modpack' })
      .then((r) => setList((r.popular || []).slice(0, 6)))
      .catch(() => setList([]));
  }, []);
  if (!list || !list.length) return null;
  return (
    <section className="mr-section">
      <div className="mr-section-head">
        <h2 className="mr-h2">{t('Modpacks populares')}</h2>
        <button className="mr-link" onClick={() => app.navigate({ page: 'browse', type: 'modpack' })}>
          {t('Ver más')}
          <Icon name="chevronRight" size={16} />
        </button>
      </div>
      <div className="mr-popular">
        {list.map((p) => (
          <div key={`${p.source}:${p.id}`} className="mr-card mr-pop-card" role="button" tabIndex={0} onClick={() => app.navigate({ page: 'project', source: p.source, id: p.id })}>
            {p.icon ? <img src={p.icon} alt="" loading="lazy" /> : <span className="mr-pop-ph"><Icon name="box" size={28} /></span>}
            <span className="mr-pop-text">
              <strong>{p.title}</strong>
              <small>
                <Icon name="download" size={14} />
                {formatCount(p.downloads)}
              </small>
            </span>
            <button
              className="mr-icon-btn brand"
              aria-label={t('Instalar')}
              data-tip={t('Instalar')}
              disabled={busy.has(`${p.source}:${p.id}`)}
              onClick={(e) => {
                e.stopPropagation();
                install(p);
              }}
            >
              {busy.has(`${p.source}:${p.id}`) ? <Spinner size={18} /> : <Icon name="download" size={18} />}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// a group of the library; profiles dropped on it join the group
function Group({ name, label, list, collapsed, onToggle, onContext, canEdit }) {
  const app = useApp();
  const picture = canEdit ? (app.groupImages || {})[name] : null;
  const drag = useInstanceDrag();
  const menu = useMenu();
  const [props, over] = useDropTarget(async (id) => {
    const inst = app.instances.find((i) => i.id === id);
    if (!inst || (inst.group || '') === name) return;
    try {
      await call('instances.setGroup', id, name);
      app.toast(name ? t('{name} ahora está en {group}', { name: inst.name, group: name }) : t('{name} salió del grupo {group}', { name: inst.name, group: inst.group }), { type: 'success' });
    } catch (e) {
      app.showError(e);
    }
  });
  // groups by loader or version can't take drops
  const droppable = name !== null && name !== undefined;
  const target = droppable && drag && (drag.group || '') !== name;
  return (
    <section className={`mr-group ${over && droppable ? 'drop' : ''} ${target ? 'can-drop' : ''}`} {...(droppable ? props : {})}>
      <div className="mr-group-head">
        <button className="mr-group-toggle" onClick={onToggle} aria-expanded={!collapsed}>
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={18} />
          {picture ? <span className="mr-group-pic">{parseRecipe(picture.recipe) ? <GeneratedIcon recipe={parseRecipe(picture.recipe)} /> : <img src={picture.url} alt="" draggable={false} />}</span> : null}
          <span className="mr-group-name">{label}</span>
          <span className="mr-group-count">{list.length}</span>
        </button>
        {canEdit ? (
          <>
            <button ref={menu.anchor} className="mr-icon-btn quiet" aria-label={t('Opciones del grupo')} onClick={menu.toggle}>
              <Icon name="moreH" size={18} />
            </button>
            <Popover anchor={menu.anchor} open={menu.open} onClose={menu.close} align="right" className="menu mr-pop">
              <MenuItem icon="image" label={t('Cambiar imagen…')} onClick={() => (menu.close(), actions.editGroupImage(app, name))} />
              {picture ? <MenuItem icon="x" label={t('Quitar imagen')} onClick={() => (menu.close(), actions.resetGroupImage(app, name))} /> : null}
              <MenuItem
                icon="edit"
                label={t('Renombrar grupo')}
                onClick={async () => {
                  menu.close();
                  const n = await app.prompt({ title: t('Renombrar grupo'), value: name, maxLength: LIMITS.groupName, confirmLabel: t('Renombrar') });
                  if (n && n !== name) call('instances.renameGroup', name, n).catch(app.showError);
                }}
              />
              <MenuItem
                icon="trash"
                danger
                label={t('Eliminar grupo')}
                onClick={async () => {
                  menu.close();
                  const ok = await app.confirm({ title: t('Eliminar grupo'), message: t('Los perfiles de {group} quedan sin grupo; no se borra ninguno.', { group: name }), confirmLabel: t('Eliminar grupo'), danger: true });
                  if (ok) call('instances.deleteGroup', name).catch(app.showError);
                }}
              />
            </Popover>
          </>
        ) : null}
        {target ? <span className="mr-group-drop">{t('Suelta aquí')}</span> : null}
      </div>
      {!collapsed ? (
        list.length ? (
          <div className="mr-inst-grid">
            {list.map((inst) => (
              <MrInstanceCard key={inst.id} inst={inst} onContext={onContext} />
            ))}
          </div>
        ) : (
          <p className="mr-group-empty">{t('Arrastra perfiles aquí para agruparlos.')}</p>
        )
      ) : null}
    </section>
  );
}

export default function MrHome() {
  const app = useApp();
  const { instances, groups, instancesLoaded, config } = app;
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const sortMenu = useMenu();
  const size = useTileSize(app);
  const groupMenu = useMenu();
  const importMenu = useMenu();
  const ctx = useInstanceContextMenu();
  const sort = (config && config.librarySort) || 'lastPlayed';
  const groupBy = (config && config.libraryGroupBy) || 'group';

  const openCreate = async () => {
    const id = await app.openDialog(CreateInstanceDialog, { defaultGroup: '' });
    if (id) {
      await app.refreshInstances();
      app.navigate({ page: 'instance', id });
    }
  };
  useEffect(() => {
    const onCreate = () => openCreate();
    window.addEventListener('havihub:create-instance', onCreate);
    return () => window.removeEventListener('havihub:create-instance', onCreate);
  });

  const importArchive = async () => {
    try {
      const r = await actions.importArchive(app, {});
      if (r) {
        if (r.blocked && r.blocked.length) await actions.showInstallResult(app, { installed: [], skipped: [], blocked: r.blocked, failed: r.failed || [] }, t('Importación'));
        app.navigate({ page: 'instance', id: r.id });
      }
    } catch (e) {
      app.showError(e);
    }
  };

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = sortInstances(q ? instances.filter((i) => i.name.toLowerCase().includes(q) || (i.mcVersion || '').includes(q)) : instances, sort);
    if (groupBy === 'none') return [{ key: 'all', name: '', label: t('Todos los perfiles'), list }];
    if (groupBy === 'loader') {
      const m = new Map();
      for (const i of list) {
        const k = loaderText(i);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(i);
      }
      return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, l]) => ({ key: `l:${k}`, label: k, list: l, fixed: true }));
    }
    if (groupBy === 'version') {
      const m = new Map();
      for (const i of list) {
        const k = i.mcVersion || '?';
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(i);
      }
      return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true })).map(([k, l]) => ({ key: `v:${k}`, label: k, list: l, fixed: true }));
    }
    // by group: each group, then the profiles without one
    const out = groups.map((g) => ({ key: `g:${g}`, name: g, label: g, list: list.filter((i) => i.group === g), editable: true }));
    out.push({ key: 'g:', name: '', label: t('Sin grupo'), list: list.filter((i) => !i.group) });
    return q ? out.filter((s) => s.list.length) : out;
  }, [instances, groups, search, sort, groupBy, app.langVersion]);

  const toggle = (k) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="mr-page mr-home">
      <JumpBackIn />
      <PopularPacks />
      <section className="mr-section" style={size.style}>
        <h2 className="mr-h2">{t('Biblioteca')}</h2>
        <div className="mr-toolbar" data-tour="create">
          <div className="mr-search">
            <Icon name="search" size={18} />
            <input value={search} maxLength={120} placeholder={t('Buscar en tu biblioteca…')} onChange={(e) => setSearch(e.target.value)} />
            {search ? (
              <button className="mr-icon-btn quiet" aria-label={t('Borrar')} onClick={() => setSearch('')}>
                <Icon name="x" size={16} />
              </button>
            ) : null}
          </div>
          <button ref={sortMenu.anchor} className="mr-combo" onClick={sortMenu.toggle}>
            <span className="mr-combo-prefix">{t('Ordenar:')}</span>
            {(SORTS.find((s) => s.id === sort) || SORTS[0]).label()}
            <Icon name="chevronDown" size={16} />
          </button>
          <button ref={groupMenu.anchor} className="mr-combo" onClick={groupMenu.toggle}>
            <span className="mr-combo-prefix">{t('Agrupar:')}</span>
            {{ group: t('Grupo'), loader: t('Cargador'), version: t('Versión'), none: t('Nada') }[groupBy]}
            <Icon name="chevronDown" size={16} />
          </button>
          <TileSize size={size} variant="mr" />
          <span className="spacer" />
          <button
            className="mr-btn"
            onClick={async () => {
              await app.openDialog(CreateGroupDialog, { groups });
            }}
          >
            <Icon name="groupAdd" size={18} />
            {t('Nuevo grupo')}
          </button>
          <button ref={importMenu.anchor} className="mr-btn" onClick={importMenu.toggle}>
            <Icon name="import" size={18} />
            {t('Importar')}
          </button>
          <button className="mr-btn brand" onClick={openCreate}>
            <Icon name="plus" size={18} />
            {t('Crear instancia')}
          </button>
          <Popover anchor={sortMenu.anchor} open={sortMenu.open} onClose={sortMenu.close} className="menu mr-pop">
            <MenuHeader>{t('Ordenar por')}</MenuHeader>
            {SORTS.map((s) => (
              <MenuItem key={s.id} label={s.label()} checked={sort === s.id} onClick={() => (sortMenu.close(), app.updateConfig({ librarySort: s.id }))} />
            ))}
          </Popover>
          <Popover anchor={groupMenu.anchor} open={groupMenu.open} onClose={groupMenu.close} className="menu mr-pop">
            <MenuHeader>{t('Agrupar por')}</MenuHeader>
            {[
              ['group', t('Grupo')],
              ['loader', t('Cargador')],
              ['version', t('Versión de Minecraft')],
              ['none', t('Nada')],
            ].map(([v, l]) => (
              <MenuItem key={v} label={l} checked={groupBy === v} onClick={() => (groupMenu.close(), app.updateConfig({ libraryGroupBy: v }))} />
            ))}
          </Popover>
          <Popover anchor={importMenu.anchor} open={importMenu.open} onClose={importMenu.close} align="right" className="menu mr-pop">
            <MenuItem icon="cube" label={t('Desde otro launcher…')} hint={t('CurseForge, Modrinth o Prism Launcher')} onClick={() => (importMenu.close(), app.openDialog(ImportLaunchersDialog, {}))} />
            <MenuItem icon="box" label={t('Desde un archivo (.zip / .mrpack)…')} onClick={() => (importMenu.close(), importArchive())} />
          </Popover>
        </div>
        {!instancesLoaded ? (
          <div className="center-spinner">
            <Spinner />
          </div>
        ) : !instances.length ? (
          <div className="mr-empty">
            <Icon name="cube" size={40} />
            <strong>{t('Todavía no tienes perfiles')}</strong>
            <span>{t('Crea uno, importa tus perfiles de otro launcher o instala un modpack.')}</span>
            <div className="row">
              <button className="mr-btn brand" onClick={openCreate}>
                <Icon name="plus" size={18} />
                {t('Crear instancia')}
              </button>
              <button className="mr-btn" onClick={() => app.openDialog(ImportLaunchersDialog, {})}>
                <Icon name="import" size={18} />
                {t('Importar desde otro launcher')}
              </button>
              <button className="mr-btn" onClick={() => app.navigate({ page: 'browse', type: 'modpack' })}>
                <Icon name="compass" size={18} />
                {t('Descubrir modpacks')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mr-groups">
            {sections.map((s) => (
              <Group
                key={s.key}
                name={s.fixed ? null : s.name}
                label={s.label}
                list={s.list}
                collapsed={collapsed.has(s.key)}
                onToggle={() => toggle(s.key)}
                onContext={ctx.show}
                canEdit={Boolean(s.editable)}
              />
            ))}
            {!sections.length ? <p className="muted">{t('Sin resultados')}</p> : null}
          </div>
        )}
      </section>
      {ctx.menu}
      <DropBar rootLabel={t('Sin grupo')} />
    </div>
  );
}

