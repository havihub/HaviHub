// "My Modpacks": group cards + instance cards, like the reference layout.
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Button, IconButton, Spinner, Empty, Checkbox, ExpandingSearch } from '../components/ui.jsx';
import PlayDropdown from '../components/PlayDropdown.jsx';
import ImportLaunchersDialog from '../dialogs/ImportLaunchersDialog.jsx';
import { Popover, MenuItem, MenuSeparator, MenuHeader, useMenu, useContextMenu } from '../components/Menu.jsx';
import InstanceImage, { LoaderIcon, GeneratedIcon } from '../components/InstanceImage.jsx';
import { parseRecipe } from '../lib/instance-icons.js';
import CreateInstanceDialog from '../dialogs/CreateInstanceDialog.jsx';
import { useApp } from '../lib/store.jsx';
import { call } from '../lib/api.js';
import { t } from '../lib/i18n.js';
import { formatPlaytime, timeAgo, compareVersions } from '../lib/format.js';
import * as actions from '../lib/actions.js';
import { LIMITS } from '../../shared/limits.js';
import { startInstanceDrag, endInstanceDrag, useDropTarget, useInstanceDrag } from '../lib/instanceDrag.js';
import DropBar from '../components/DropBar.jsx';
import CreateGroupDialog from '../dialogs/CreateGroupDialog.jsx';
import TileSize, { useTileSize } from '../components/TileSize.jsx';

export const SORTS = [
  { id: 'lastPlayed', label: () => t('Jugado recientemente') },
  { id: 'name', label: () => t('Nombre') },
  { id: 'version', label: () => t('Versión de Minecraft') },
  { id: 'created', label: () => t('Fecha de creación') },
  { id: 'playtime', label: () => t('Tiempo jugado') },
];

export function sortInstances(list, sort) {
  const l = [...list];
  if (sort === 'name') l.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  else if (sort === 'version') l.sort((a, b) => compareVersions(b.mcVersion, a.mcVersion) || a.name.localeCompare(b.name));
  else if (sort === 'created') l.sort((a, b) => (b.created || 0) - (a.created || 0));
  else if (sort === 'playtime') l.sort((a, b) => (b.totalPlayed || 0) - (a.totalPlayed || 0));
  else l.sort((a, b) => (b.lastLaunch || 0) - (a.lastLaunch || 0) || a.name.localeCompare(b.name));
  return l;
}

export function instanceSubtitle(inst) {
  if (inst.managed && inst.managed.type) return inst.managed.type === 'flame' ? 'CurseForge' : inst.managed.type === 'modrinth' ? 'Modrinth' : inst.managed.type;
  return t('Mi creación');
}

export function InstanceCard({ inst, onContext, view, selected, selecting, onSelect }) {
  const app = useApp();
  const running = app.running.has(inst.id);
  const open = () => app.navigate({ page: 'instance', id: inst.id, tab: 'content', sub: 'mods' });
  if (view === 'list') {
    return (
      <div
        className="inst-row"
        onClick={open}
        onContextMenu={(e) => onContext(e, inst)}
        draggable
        onDragStart={(e) => startInstanceDrag(e, inst)}
        onDragEnd={endInstanceDrag}
      >
        <InstanceImage instance={inst} size={56} />
        <div className="inst-row-main">
          <strong>{inst.name}</strong>
          <span className="muted">{instanceSubtitle(inst)}</span>
        </div>
        <span className="inst-row-meta">
          <Icon name="gamepad" size={18} />
          {inst.mcVersion || '?'}
        </span>
        <span className="inst-row-meta">
          <LoaderIcon loader={inst.loader} size={18} />
          {inst.loader ? `${inst.loader.name} ${inst.loader.version}` : 'Vanilla'}
        </span>
        <span className="inst-row-meta muted">{inst.lastLaunch ? timeAgo(inst.lastLaunch) : t('Nunca jugado')}</span>
        <span className="inst-row-meta muted">{formatPlaytime(inst.totalPlayed)}</span>
        <Button
          variant="primary"
          size="sm"
          icon={running ? 'stop' : 'play'}
          onClick={(e) => {
            e.stopPropagation();
            running ? call('instances.stop', inst.id) : app.launch(inst.id);
          }}
        >
          {running ? t('Detener') : t('Jugar')}
        </Button>
      </div>
    );
  }
  return <GridCard inst={inst} onContext={onContext} open={open} running={running} selected={selected} selecting={selecting} onSelect={onSelect} />;
}

// CurseForge-style card: on hover the image shrinks, the name slides up and
// "Play" + the worlds arrow appear (smoothly animated).
function GridCard({ inst, onContext, open, running, selected, selecting, onSelect }) {
  const app = useApp();
  const launching = app.launching && app.launching.has(inst.id);
  const play = useMenu();
  const [lists, setLists] = useState({ worlds: null, servers: null });
  useEffect(() => {
    if (!play.open) return;
    let alive = true;
    Promise.all([call('worlds.list', inst.id).catch(() => []), call('servers.list', inst.id).catch(() => [])]).then(([worlds, servers]) => alive && setLists({ worlds, servers }));
    return () => {
      alive = false;
    };
  }, [play.open, inst.id]);
  const toggleSelect = (e) => {
    e.stopPropagation();
    onSelect && onSelect(!selected);
  };
  return (
    <div
      className={`inst-card ${running ? 'running' : ''} ${inst.broken ? 'broken' : ''} ${play.open ? 'menu-open' : ''} ${selected ? 'selected' : ''} ${selecting ? 'selecting' : ''}`}
      onClick={selecting ? toggleSelect : open}
      onContextMenu={(e) => onContext(e, inst)}
      draggable
      onDragStart={(e) => startInstanceDrag(e, inst)}
      onDragEnd={endInstanceDrag}
      title={inst.broken ? inst.broken : undefined}
    >
      <div className="inst-card-img">
        <InstanceImage instance={inst} />
      </div>
      <button className="inst-check" onClick={toggleSelect} aria-pressed={Boolean(selected)} title={t('Seleccionar')}>
        {selected ? <Icon name="check" size={16} /> : null}
      </button>
      <div className="inst-badges">
        <span className="inst-badge loader" title={inst.loader ? `${inst.loader.name} ${inst.loader.version}` : 'Vanilla'}>
          <LoaderIcon loader={inst.loader} size={17} />
        </span>
        <span className="inst-badge">
          <Icon name="gamepad" size={17} />
          {inst.mcVersion || '?'}
        </span>
      </div>
      {launching ? <span className="inst-running starting">{t('Iniciando…')}</span> : running ? <span className="inst-running">{t('Jugando')}</span> : null}
      <div className="inst-card-body">
        <div className="inst-card-name">{inst.name}</div>
        <div className="inst-card-sub">{instanceSubtitle(inst)}</div>
      </div>
      <div className="inst-card-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className={`card-play ${running && !launching ? 'running' : ''} ${launching ? 'launching' : ''}`}
          disabled={inst.broken}
          title={launching ? t('Cancelar el inicio') : undefined}
          onClick={() => (running ? call('instances.stop', inst.id) : app.launch(inst.id))}
        >
          {launching ? (
            <>
              <Spinner size={16} />
              {t('Iniciando…')}
            </>
          ) : running ? (
            t('Detener')
          ) : (
            t('Jugar')
          )}
        </button>
        <button ref={play.anchor} className={`card-play-drop ${play.open ? 'open' : ''}`} onClick={play.toggle} title={t('Elegir mundo o servidor')} disabled={inst.broken}>
          <Icon name={play.open ? 'chevronUp' : 'chevronDown'} size={22} />
        </button>
      </div>
      <Popover anchor={play.anchor} open={play.open} onClose={play.close} offset={0} className="menu play-pop card-play-pop">
        <div onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
          <PlayDropdown instance={inst} worlds={lists.worlds} servers={lists.servers} onClose={play.close} />
        </div>
      </Popover>
    </div>
  );
}

export function useInstanceContextMenu() {
  const app = useApp();
  const cm = useContextMenu();
  const inst = cm.data;
  const menu = inst ? (
    <Popover point={cm.point} open={cm.open} onClose={cm.close} className="menu">
      <MenuItem icon={app.running.has(inst.id) ? 'stop' : 'play'} label={app.running.has(inst.id) ? t('Detener') : t('Jugar')} onClick={() => (cm.close(), app.running.has(inst.id) ? call('instances.stop', inst.id) : app.launch(inst.id))} />
      <MenuItem icon="arrowRight" label={t('Abrir perfil')} onClick={() => (cm.close(), app.navigate({ page: 'instance', id: inst.id, tab: 'content', sub: 'mods' }))} />
      <MenuItem icon="puzzle" label={t('Agregar contenido')} onClick={() => (cm.close(), app.navigate({ page: 'browse', type: 'mod', instanceId: inst.id }))} />
      <MenuSeparator />
      <MenuItem icon="folder" label={t('Abrir carpeta')} external onClick={() => (cm.close(), call('instances.openFolder', inst.id))} />
      <MenuItem icon="image" label={t('Cambiar ícono…')} onClick={() => (cm.close(), actions.editIcon(app, inst))} />
      <MenuItem icon="groupGrid" label={t('Mover a grupo…')} onClick={() => (cm.close(), actions.moveToGroup(app, inst))} />
      <MenuItem icon="listOptions" label={t('Opciones del perfil')} onClick={() => (cm.close(), actions.profileOptions(app, inst))} />
      <MenuItem icon="clone" label={t('Clonar como…')} onClick={() => (cm.close(), actions.cloneInstance(app, inst))} />
      <MenuSeparator />
      <MenuItem icon="share" label={t('Compartir perfil')} onClick={() => (cm.close(), actions.shareInstance(app, inst))} />
      <MenuItem icon="shareBox" label={t('Crear acceso directo')} onClick={() => (cm.close(), actions.createShortcut(app, inst))} />
      <MenuItem icon="trash" label={t('Eliminar perfil')} danger onClick={() => (cm.close(), actions.deleteInstance(app, inst))} />
    </Popover>
  ) : null;
  return { show: cm.show, menu };
}

// "Mis modpacks" in the breadcrumb: also where a profile is dropped to leave its group
function RootCrumb({ onDrop, onClick }) {
  const [props, over] = useDropTarget(onDrop);
  return (
    <button className={`crumb ${over ? 'drop' : ''}`} onClick={onClick} {...props}>
      {t('Mis modpacks')}
    </button>
  );
}

// Inside a group, while dragging: a wide target to take the profile out
function DropOut({ group, onDrop }) {
  const drag = useInstanceDrag();
  const [props, over] = useDropTarget(onDrop);
  if (!drag || drag.group !== group) return null;
  return (
    <div className={`drop-out visible ${over ? 'over' : ''}`} {...props}>
      <Icon name="signOut" size={22} />
      {t('Suelta aquí para sacarlo de {group}', { group })}
    </div>
  );
}

// A group's picture: its own, or the pictures of up to four of its profiles.
function GroupPicture({ image, members }) {
  if (image) {
    const made = parseRecipe(image.recipe);
    return <div className="group-card-img">{made ? <GeneratedIcon recipe={made} /> : <img src={image.url} alt="" draggable={false} decoding="async" />}</div>;
  }
  const four = members.slice(0, 4);
  if (!four.length) {
    return (
      <div className="group-card-img empty">
        <Icon name="groupGrid" size={44} />
      </div>
    );
  }
  return (
    <div className={`group-card-img group-mosaic n${four.length}`}>
      {four.map((i) => (
        <InstanceImage key={i.id} instance={i} res={640} />
      ))}
    </div>
  );
}

function GroupCard({ name, count, image, members, onOpen, onDrop }) {
  const app = useApp();
  const m = useMenu();
  const [over, setOver] = useState(false);
  return (
    <div
      className={`group-card ${over ? 'drop' : ''} ${m.open ? 'menu-open' : ''}`}
      onClick={onOpen}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/havihub-instance')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData('text/havihub-instance');
        if (id) onDrop(id);
      }}
    >
      <GroupPicture image={image} members={members} />
      <div className="group-card-foot">
        <Icon name="groupGrid" size={22} className="group-icon" />
        <span className="group-name">{name}</span>
        <span className="group-count">{count}</span>
        <button
          ref={m.anchor}
          className="icon-btn group-more"
          aria-label={t('Opciones del grupo')}
          onClick={(e) => {
            e.stopPropagation();
            m.toggle();
          }}
        >
          <Icon name="more" size={22} />
        </button>
      </div>
      <Popover anchor={m.anchor} open={m.open} onClose={m.close} className="menu" align="right">
        <MenuItem icon="arrowRight" label={t('Abrir grupo')} onClick={(e) => (e.stopPropagation(), m.close(), onOpen())} />
        <MenuItem icon="image" label={t('Cambiar imagen…')} onClick={(e) => (e.stopPropagation(), m.close(), actions.editGroupImage(app, name))} />
        {image ? <MenuItem icon="x" label={t('Quitar imagen')} onClick={(e) => (e.stopPropagation(), m.close(), actions.resetGroupImage(app, name))} /> : null}
        <MenuSeparator />
        <MenuItem
          icon="edit"
          label={t('Renombrar grupo')}
          onClick={async (e) => {
            e.stopPropagation();
            m.close();
            const n = await app.prompt({ title: t('Renombrar grupo'), value: name, maxLength: LIMITS.groupName, confirmLabel: t('Renombrar') });
            if (n && n !== name) call('instances.renameGroup', name, n).catch(app.showError);
          }}
        />
        <MenuItem
          icon="trash"
          danger
          label={t('Eliminar grupo')}
          onClick={async (e) => {
            e.stopPropagation();
            m.close();
            const ok = await app.confirm({ title: t('Eliminar grupo'), message: t('Las instancias del grupo "{g}" no se eliminan: quedan sin grupo.', { g: name }), confirmLabel: t('Eliminar grupo'), danger: true });
            if (ok) call('instances.deleteGroup', name).catch(app.showError);
          }}
        />
      </Popover>
    </div>
  );
}

export default function Library() {
  const app = useApp();
  const { instances, groups, instancesLoaded, route, config } = app;
  const group = route.group || null;
  const [search, setSearch] = useState('');
  const [loaderFilter, setLoaderFilter] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const sortMenu = useMenu();
  const filterMenu = useMenu();
  const importMenu = useMenu();
  const ctx = useInstanceContextMenu();
  const sort = (config && config.librarySort) || 'lastPlayed';
  const view = (config && config.libraryView) || 'grid';
  const size = useTileSize(app);

  useEffect(() => {
    const onCreate = () => openCreate();
    window.addEventListener('havihub:create-instance', onCreate);
    return () => window.removeEventListener('havihub:create-instance', onCreate);
  });

  const openCreate = async () => {
    const id = await app.openDialog(CreateInstanceDialog, { defaultGroup: group || '' });
    if (id) {
      await app.refreshInstances();
      app.navigate({ page: 'instance', id, tab: 'content', sub: 'mods' });
    }
  };

  const visible = useMemo(() => {
    let l = instances;
    if (group) l = l.filter((i) => i.group === group);
    else if (!search) l = l.filter((i) => !i.group);
    if (search) l = l.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()) || (i.mcVersion || '').includes(search));
    if (loaderFilter.length) l = l.filter((i) => loaderFilter.includes(i.loader ? i.loader.id : 'vanilla'));
    return sortInstances(l, sort);
  }, [instances, group, search, sort, loaderFilter]);

  const groupCounts = useMemo(() => {
    const m = {};
    for (const g of groups) m[g] = 0;
    for (const i of instances) if (i.group) m[i.group] = (m[i.group] || 0) + 1;
    return m;
  }, [instances, groups]);
  // the profiles shown on a group's card when it has no picture of its own
  const groupMembers = useMemo(() => {
    const m = {};
    for (const i of sortInstances(instances, sort)) if (i.group) (m[i.group] = m[i.group] || []).push(i);
    return m;
  }, [instances, sort]);

  // selection only covers what is visible
  useEffect(() => {
    setSelected((sel) => {
      const ids = new Set(instances.map((i) => i.id));
      const n = new Set([...sel].filter((id) => ids.has(id)));
      return n.size === sel.size ? sel : n;
    });
  }, [instances]);
  useEffect(() => setSelected(new Set()), [group]);
  const selectedList = instances.filter((i) => selected.has(i.id));
  const setOne = (id, v) =>
    setSelected((sel) => {
      const n = new Set(sel);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  const importArchive = async () => {
    try {
      const r = await actions.importArchive(app, { group: group || '' });
      if (r) {
        if (r.blocked && r.blocked.length) await actions.showInstallResult(app, { installed: [], skipped: [], blocked: r.blocked, failed: r.failed || [] }, t('Importación'));
        app.navigate({ page: 'instance', id: r.id, tab: 'content', sub: 'mods' });
      }
    } catch (e) {
      app.showError(e);
    }
  };

  const dropToGroup = async (id, g) => {
    try {
      await call('instances.setGroup', id, g);
    } catch (e) {
      app.showError(e);
    }
  };

  return (
    <div className="page library" style={size.style}>
      {group ? (
        <div className="lib-breadcrumb">
          <RootCrumb onDrop={(id) => dropToGroup(id, '')} onClick={() => app.navigate({ page: 'library' })} />
          <Icon name="chevronRight" size={18} className="crumb-sep" />
          <span className="crumb current">{group}</span>
        </div>
      ) : null}
      <div className="toolbar" data-tour="create">
        <Button variant="flat" icon="plus" iconSize={28} onClick={openCreate}>
          {t('Crear')}
        </Button>
        <button ref={importMenu.anchor} className={`btn btn-flat btn-md ${importMenu.open ? 'active' : ''}`} onClick={importMenu.toggle}>
          <Icon name="import" size={26} />
          <span>{t('Importar')}</span>
        </button>
        <Popover anchor={importMenu.anchor} open={importMenu.open} onClose={importMenu.close} className="menu">
          <MenuItem icon="cube" label={t('Desde otro launcher…')} hint={t('CurseForge, Modrinth o Prism Launcher')} onClick={() => (importMenu.close(), app.openDialog(ImportLaunchersDialog, {}))} />
          <MenuItem icon="box" label={t('Desde un archivo (.zip / .mrpack)…')} onClick={() => (importMenu.close(), importArchive())} />
        </Popover>
        <Button
          variant="flat"
          icon="groupAdd"
          iconSize={23}
          onClick={async () => {
            await app.openDialog(CreateGroupDialog, { groups });
          }}
        >
          {t('Crear grupo')}
        </Button>
        <span className="spacer" />
        <ExpandingSearch value={search} onChange={setSearch} placeholder={t('Buscar perfiles…')} />
        <button ref={sortMenu.anchor} className={`icon-btn tool-btn ${sortMenu.open ? 'active' : ''}`} data-tip={t('Ordenar')} aria-label={t('Ordenar')} onClick={sortMenu.toggle}>
          <Icon name="sort" size={27} />
        </button>
        <button ref={filterMenu.anchor} className={`icon-btn tool-btn ${filterMenu.open || loaderFilter.length ? 'active' : ''}`} data-tip={t('Filtrar')} aria-label={t('Filtrar')} onClick={filterMenu.toggle}>
          <Icon name="filter" size={29} />
          {loaderFilter.length ? <span className="badge-dot">{loaderFilter.length}</span> : null}
        </button>
        {view === 'grid' ? <TileSize size={size} /> : null}
        <IconButton className="tool-btn" icon={view === 'grid' ? 'list' : 'grid'} size={view === 'grid' ? 30 : 26} title={view === 'grid' ? t('Vista de lista') : t('Vista de cuadrícula')} onClick={() => app.updateConfig({ libraryView: view === 'grid' ? 'list' : 'grid' })} />
        <Popover anchor={sortMenu.anchor} open={sortMenu.open} onClose={sortMenu.close} align="right" className="menu">
          <MenuHeader>{t('Ordenar por')}</MenuHeader>
          {SORTS.map((s) => (
            <MenuItem key={s.id} label={s.label()} checked={sort === s.id} onClick={() => (sortMenu.close(), app.updateConfig({ librarySort: s.id }))} />
          ))}
        </Popover>
        <Popover anchor={filterMenu.anchor} open={filterMenu.open} onClose={filterMenu.close} align="right" className="menu filter-menu">
          <MenuHeader>{t('Cargador')}</MenuHeader>
          {['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].map((l) => (
            <div key={l} className="menu-check-row">
              <Checkbox checked={loaderFilter.includes(l)} onChange={(v) => setLoaderFilter((f) => (v ? [...f, l] : f.filter((x) => x !== l)))} label={l === 'neoforge' ? 'NeoForge' : l[0].toUpperCase() + l.slice(1)} />
            </div>
          ))}
          {loaderFilter.length ? (
            <div className="menu-pad">
              <Button size="sm" variant="ghost" onClick={() => setLoaderFilter([])}>
                {t('Quitar filtros')}
              </Button>
            </div>
          ) : null}
        </Popover>
      </div>

      {!instancesLoaded ? (
        <div className="center-spinner">
          <Spinner />
        </div>
      ) : (
        <>
          {!group && !search && groups.length ? (
            <div className="group-grid">
              {groups.map((g) => (
                <GroupCard key={g} name={g} count={groupCounts[g] || 0} image={(app.groupImages || {})[g]} members={groupMembers[g] || []} onOpen={() => app.navigate({ page: 'library', group: g })} onDrop={(id) => dropToGroup(id, g)} />
              ))}
            </div>
          ) : null}
          {group ? <DropOut group={group} onDrop={(id) => dropToGroup(id, '')} /> : null}
          {visible.length ? (
            <div className={view === 'list' ? 'inst-list' : 'inst-grid'}>
              {visible.map((inst) => (
                <InstanceCard key={inst.id} inst={inst} view={view} onContext={ctx.show} selected={selected.has(inst.id)} selecting={selected.size > 0} onSelect={(v) => setOne(inst.id, v)} />
              ))}
            </div>
          ) : instances.length === 0 ? (
            <Empty icon="cube" title={t('Todavía no tienes perfiles')} text={t('Crea un perfil nuevo, importa un modpack o instala uno desde Descubrir.')}>
              <div className="row">
                <Button variant="primary" icon="plus" onClick={openCreate}>
                  {t('Crear perfil')}
                </Button>
                <Button icon="import" onClick={() => app.openDialog(ImportLaunchersDialog, {})}>
                  {t('Importar desde otro launcher')}
                </Button>
                <Button icon="compass" onClick={() => app.navigate({ page: 'discover' })}>
                  {t('Descubrir modpacks')}
                </Button>
              </div>
            </Empty>
          ) : group || search || loaderFilter.length ? (
            <Empty icon="search" title={group && !search ? t('Este grupo está vacío') : t('Sin resultados')} text={group && !search ? t('Arrastra un perfil a la tarjeta del grupo o usa "Mover a grupo…" en su menú.') : ''} />
          ) : null}
        </>
      )}
      {selected.size ? (
        <div className="select-bar">
          <Checkbox checked={visible.length > 0 && visible.every((i) => selected.has(i.id))} indeterminate={!visible.every((i) => selected.has(i.id))} onChange={(v) => setSelected(new Set(v ? visible.map((i) => i.id) : []))} />
          <span>{selected.size === 1 ? t('1 perfil seleccionado') : t('{n} perfiles seleccionados', { n: selected.size })}</span>
          <span className="spacer" />
          <Button variant="secondary" icon="groupGrid" onClick={async () => (await actions.moveManyToGroup(app, selectedList)) && setSelected(new Set())}>
            {t('Mover a grupo…')}
          </Button>
          <Button variant="danger" icon="trash" onClick={async () => (await actions.deleteMany(app, selectedList)) && setSelected(new Set())}>
            {t('Eliminar')}
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            {t('Cancelar')}
          </Button>
        </div>
      ) : null}
      {ctx.menu}
      <DropBar />
    </div>
  );
}
