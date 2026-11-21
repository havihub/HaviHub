// "Discover content" in the Modrinth layout: project types as tabs, a big
// search, sort and source, results as cards, and the filters in the right
// sidebar. Inside an instance ("Add content") it only offers what works there
// (see shared/compat.js).
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Checkbox, Spinner, Toggle, Pills, useDebounced, envInfo } from '../components/ui.jsx';
import { Popover, MenuItem, useMenu } from '../components/Menu.jsx';
import InstanceImage, { LoaderIcon } from '../components/InstanceImage.jsx';
import BrandLogo from '../components/BrandLogo.jsx';
import { useApp } from '../lib/store.jsx';
import { call } from '../lib/api.js';
import { t } from '../lib/i18n.js';
import { formatCount, timeAgo } from '../lib/format.js';
import { TYPE_TABS, SOURCE_OPTIONS, useInstalled, isInstalled, useInstaller, useProjectSearch, cfKeyMissingBanner, ServiceDownNote } from '../pages/browseShared.jsx';
import { typesFor, searchFiltersFor, versionCompatible, compatIssue } from '../../shared/compat.js';
import { compatText } from '../lib/compatText.js';
import { SidebarPortal } from './MrShell.jsx';
import { MrTabs } from './MrInstance.jsx';
import { loaderText } from './MrHome.jsx';

const SORTS = () => [
  { value: 'relevance', label: t('Relevancia') },
  { value: 'downloads', label: t('Descargas') },
  { value: 'follows', label: t('Seguidores') },
  { value: 'newest', label: t('Más nuevos') },
  { value: 'updated', label: t('Actualizados') },
];
const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'];
const LOADER_NAME = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };
const TYPE_ICON = { modpack: 'package', mod: 'puzzle', resourcepack: 'layers', shader: 'sun', datapack: 'globe', world: 'map' };

function FilterSection({ title, children, open: initial = true }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="mr-side-section mr-filter">
      <button className="mr-side-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <h3>{title}</h3>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      {open ? <div className="mr-filter-body">{children}</div> : null}
    </section>
  );
}

function ResultCard({ p, instance, installed, busy, onInstall, onOpen, issue }) {
  const updated = p.updated ? Date.parse(p.updated) : 0;
  const env = p.type === 'mod' ? envInfo(p.env) : null;
  // as many tags as Modrinth shows next to a button: 4, or 5 without the
  // client/server one; categories first, then loaders, the rest as "+N"
  const all = [...(p.categories || []).map((category) => ({ category })), ...(p.loaders || []).filter((l) => LOADER_NAME[l]).map((loader) => ({ loader }))];
  const max = env ? 4 : 5;
  const tags = { shown: all.slice(0, max), more: Math.max(0, all.length - max), hidden: all.slice(max).map((x) => (x.loader ? LOADER_NAME[x.loader] : x.category)).join(', ') };
  return (
    <div className="mr-card mr-result" role="link" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      {p.icon ? <img className="mr-result-icon" src={p.icon} alt="" loading="lazy" draggable={false} /> : <span className="mr-result-icon ph"><Icon name={TYPE_ICON[p.type] || 'box'} size={36} /></span>}
      <div className="mr-result-info">
        <div className="mr-result-title">
          <strong>{p.title}</strong>
          {p.author ? <span>{t('por {a}', { a: p.author })}</span> : null}
        </div>
        <p>{p.description}</p>
      </div>
      <div className="mr-result-actions" onClick={(e) => e.stopPropagation()}>
        {installed ? (
          <span className="mr-installed">
            <Icon name="check" size={16} />
            {t('Instalado')}
          </span>
        ) : issue ? (
          // can't go into this profile (its filters were removed): say why
          <span className="mr-incompat" data-tip={compatText(issue)} data-tip-pos="left">
            <button className="mr-btn" disabled>
              <Icon name="xCircle" size={17} />
              {t('No compatible')}
            </button>
          </span>
        ) : (
          <button className="mr-btn brand" disabled={busy} onClick={onInstall}>
            {busy ? <Spinner size={16} /> : <Icon name="download" size={17} />}
            {instance || p.type !== 'modpack' ? t('Instalar') : t('Instalar modpack')}
          </button>
        )}
      </div>
      <div className="mr-result-stats">
        <span data-tip={t('Descargas')}>
          <Icon name="download" size={16} />
          {formatCount(p.downloads)}
        </span>
        {p.follows !== undefined ? (
          <span data-tip={t('Seguidores')}>
            <Icon name="heart" size={16} />
            {formatCount(p.follows)}
          </span>
        ) : null}
        {updated ? (
          // only how long ago, as Modrinth's list does ("Updated …" in its tooltip)
          <small data-tip={t('Actualizado {when}', { when: timeAgo(updated).toLowerCase() })}>
            <Icon name="history" size={14} />
            {timeAgo(updated)}
          </small>
        ) : null}
      </div>
      <div className="mr-result-tags">
        <BrandLogo brand={p.source} size={16} />
        {env ? (
          // where it goes: in the game, on the server, or on both (like Modrinth's own list)
          <span className="mr-tag env" data-tip={env.tip}>
            <Icon name={env.icon} size={16} />
            {env.short}
          </span>
        ) : null}
        {tags.shown.map((x) =>
          x.loader ? (
            <span key={`l:${x.loader}`} className={`mr-tag loader loader-${x.loader}`}>
              <LoaderIcon loader={x.loader} size={16} />
              {LOADER_NAME[x.loader]}
            </span>
          ) : (
            <span key={`c:${x.category}`} className="mr-tag">
              {x.category}
            </span>
          ),
        )}
        {tags.more ? (
          <span className="mr-tag" data-tip={tags.hidden}>
            +{tags.more}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// a filter option that matches the profile ("1.20.1  la del perfil")
function ProfileMark({ text, hint }) {
  return (
    <>
      {text}
      <span className="mr-profile-mark">{hint}</span>
    </>
  );
}

// Under the search: which filters come from the profile, with a way to see
// everything, or to go back to them after changing them.
function ProfileFilterNote({ instance, type, version, loader, defVersion, defLoader, olderMaps, changed, onClear, onReset }) {
  let text = '';
  if (type === 'mod' && version === defVersion && loader === defLoader && defVersion) text = t('Solo los que tienen una versión para {v} con {l}', { v: defVersion, l: loaderText(instance) });
  else if (type === 'datapack' && version === defVersion && defVersion) text = t('Solo los que tienen una versión para {v}', { v: defVersion });
  else if (type === 'world' && olderMaps && instance.mcVersion) text = t('Mapas de {v} o anteriores (el juego actualiza los mundos antiguos)', { v: instance.mcVersion });
  const info = type === 'shader' ? t('Los shaders necesitan Iris, Oculus u OptiFine en el perfil') : '';
  if (!text && !info && !changed) return null;
  return (
    <div className="mr-locked">
      <Icon name={text || changed ? 'filter' : 'info'} size={16} />
      <span>{text || (changed ? t('Filtros cambiados: también se muestra lo que no es compatible con este perfil') : info)}</span>
      {text ? (
        <button className="mr-link" onClick={onClear}>
          {t('Ver todos')}
        </button>
      ) : changed ? (
        <button className="mr-link" onClick={onReset}>
          {t('Restablecer filtros')}
        </button>
      ) : null}
    </div>
  );
}

export default function MrBrowse() {
  const app = useApp();
  const { route, config } = app;
  const instance = route.instanceId ? app.instances.find((i) => i.id === route.instanceId) : null;
  const allowed = instance ? typesFor(instance) : ['modpack', 'mod', 'resourcepack', 'shader', 'datapack', 'world'];
  const type = route.type && allowed.includes(route.type) ? route.type : allowed[0];
  // inside a profile each content type starts with the filters that fit it;
  // every one of them can be removed
  const rules = instance ? searchFiltersFor(instance, type) : {};
  const profileLoader = instance && instance.loader ? instance.loader.id : '';
  const source = type === 'world' ? 'curseforge' : route.source || (config && config.discoverSource) || 'both';
  const [query, setQuery] = useState(route.query || '');
  const dq = useDebounced(query, 400);
  const [sort, setSort] = useState('relevance');
  const [picks, setPicks] = useState({}); // per content type: { version, loader } chosen by the person
  const pick = picks[type] || {};
  const setPick = (patch) => setPicks((all) => ({ ...all, [type]: { ...(all[type] || {}), ...patch } }));
  const setVersion = (v) => setPick({ version: v });
  const setLoader = (l) => setPick({ loader: l });
  const [olderMaps, setOlderMaps] = useState(true);
  const [categories, setCategories] = useState([]);
  const [catList, setCatList] = useState([]);
  const [gameVersions, setGameVersions] = useState([]);
  const hideInstalled = !app.config || app.config.hideInstalledContent !== false;
  const setHideInstalled = (v) => app.updateConfig({ hideInstalledContent: typeof v === 'function' ? v(hideInstalled) : v });
  const [showAllVersions, setShowAllVersions] = useState(false);
  const sortMenu = useMenu();
  const sentinel = useRef(null);
  const usesLoader = type === 'mod' || type === 'modpack';
  const defVersion = rules.gameVersion || '';
  const defLoader = instance && type === 'mod' ? profileLoader : '';
  const version = pick.version !== undefined ? pick.version : defVersion;
  const loader = usesLoader ? (pick.loader !== undefined ? pick.loader : defLoader) : '';
  const changed = Boolean(instance) && (version !== defVersion || loader !== defLoader || (type === 'world' && !olderMaps));
  const resetFilters = () => {
    setPicks((all) => ({ ...all, [type]: {} }));
    setOlderMaps(true);
  };
  const clearProfileFilters = () => {
    setPick({ version: '', loader: '' });
    if (type === 'world') setOlderMaps(false);
  };
  const { installed } = useInstalled(instance ? instance.id : null, type, route.world);
  const { install, busy } = useInstaller();
  const search = useProjectSearch({ type, source, query: dq, sort, version, loader, categories });
  const results = useMemo(() => {
    let l = search.results;
    if (!l) return l;
    if (instance && type === 'world' && olderMaps) l = l.filter((p) => versionCompatible(p, instance, 'world'));
    if (instance && hideInstalled) l = l.filter((p) => !isInstalled(installed, p));
    return l;
  }, [search.results, type, instance, hideInstalled, installed, olderMaps]);

  useEffect(() => {
    if (route.type !== type) app.patchRoute({ type });
  }, [route.type, type]);
  useEffect(() => {
    setQuery(route.query || '');
  }, [route.query]);
  useEffect(() => {
    call('platforms.gameVersions')
      .then((v) => setGameVersions(v.filter((x) => x.type === 'release').map((x) => x.version)))
      .catch(() => setGameVersions([]));
  }, []);
  useEffect(() => {
    setCategories([]);
    call('platforms.categories', source === 'curseforge' ? 'curseforge' : 'modrinth', type)
      .then(setCatList)
      .catch(() => setCatList([]));
  }, [type, source]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !search.hasMore || search.loading) return undefined;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && search.loadMore());
    io.observe(el);
    return () => io.disconnect();
  }, [search.hasMore, search.loading, results]);

  const setType = (v) => app.patchRoute({ type: v });
  const setSource = (v) => {
    app.patchRoute({ source: v });
    app.updateConfig({ discoverSource: v });
  };
  const toggleCat = (id, v) => setCategories((l) => (v ? [...l, id] : l.filter((x) => x !== id)));
  const cfBanner = search.errors.curseforge && (search.errors.curseforge.code === 'CF_NO_KEY' || search.errors.curseforge.code === 'CF_BAD_KEY') ? cfKeyMissingBanner(app) : null;
  const typeTabs = TYPE_TABS().filter((x) => allowed.includes(x.value));
  const typeLabel = (typeTabs.find((x) => x.value === type) || typeTabs[0] || { label: '' }).label;
  const versionsShown = showAllVersions ? gameVersions : gameVersions.slice(0, 12);
  const catGroups = useMemo(() => {
    const m = new Map();
    for (const c of catList) {
      const h = c.header || '';
      if (!m.has(h)) m.set(h, []);
      m.get(h).push(c);
    }
    return [...m.entries()];
  }, [catList]);

  return (
    <div className="mr-page mr-browse">
      {instance ? (
        <div className="mr-install-head">
          <button className="mr-icon-btn round" onClick={() => app.navigate({ page: 'instance', id: instance.id })} aria-label={t('Volver al perfil')} data-tip={t('Volver al perfil')}>
            <Icon name="arrowLeft" size={18} />
          </button>
          <InstanceImage instance={instance} res={128} />
          <span className="mr-install-text">
            <small>{t('Agregando contenido a')}</small>
            <strong>{instance.name}</strong>
          </span>
          <span className="mr-chip">
            {loaderText(instance)} {instance.mcVersion}
          </span>
        </div>
      ) : null}
      <MrTabs value={type} onChange={setType} tabs={typeTabs.map((x) => ({ value: x.value, label: x.label, icon: TYPE_ICON[x.value] }))} />
      <div className="mr-search lg">
        <Icon name="search" size={20} />
        <input autoFocus value={query} maxLength={120} placeholder={t('Buscar {type}…', { type: typeLabel.toLowerCase() })} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        {query ? (
          <button className="mr-icon-btn quiet" aria-label={t('Borrar')} onClick={() => setQuery('')}>
            <Icon name="x" size={18} />
          </button>
        ) : null}
      </div>
      <div className="mr-browse-bar">
        <button ref={sortMenu.anchor} className="mr-combo" onClick={sortMenu.toggle}>
          <span className="mr-combo-prefix">{t('Ordenar por:')}</span>
          {(SORTS().find((s) => s.value === sort) || SORTS()[0]).label}
          <Icon name="chevronDown" size={16} />
        </button>
        <Popover anchor={sortMenu.anchor} open={sortMenu.open} onClose={sortMenu.close} className="menu mr-pop">
          {SORTS().map((s) => (
            <MenuItem key={s.value} label={s.label} checked={sort === s.value} onClick={() => (sortMenu.close(), setSort(s.value))} />
          ))}
        </Popover>
        {type !== 'world' ? <Pills value={source} onChange={setSource} options={SOURCE_OPTIONS()} /> : <span className="mr-chip">{t('Los mundos solo están en CurseForge')}</span>}
        <span className="spacer" />
        <span className="muted">{results === null ? '' : search.total === 1 ? t('1 proyecto') : t('{n} proyectos', { n: formatCount(search.total) })}</span>
      </div>
      {instance ? <ProfileFilterNote instance={instance} type={type} version={version} loader={loader} defVersion={defVersion} defLoader={defLoader} olderMaps={olderMaps} changed={changed} onClear={clearProfileFilters} onReset={resetFilters} /> : null}
      {cfBanner && source !== 'modrinth' ? (
        <div className="mr-notice warn">
          <Icon name="alert" size={18} />
          <span>{cfBanner.text}</span>
          <button className="mr-btn" onClick={cfBanner.action}>
            {t('Configurar')}
          </button>
        </div>
      ) : null}
      <ServiceDownNote errors={search.errors} />
      {results === null ? (
        <div className="center-spinner">
          <Spinner />
        </div>
      ) : !results.length ? (
        <div className="mr-empty">
          <Icon name="search" size={36} />
          <strong>{t('Sin resultados')}</strong>
          <span>{t('Prueba con otras palabras o quita algunos filtros.')}</span>
        </div>
      ) : (
        <div className="mr-results">
          {results.map((p) => {
            const key = `${p.source}:${p.id}`;
            return (
              <ResultCard
                key={key}
                p={p}
                instance={instance}
                installed={instance ? isInstalled(installed, p) : false}
                busy={busy.has(key)}
                issue={instance ? compatIssue(p, instance, type) : null}
                onInstall={() => install(p, { instanceId: instance ? instance.id : undefined, world: route.world })}
                onOpen={() => app.navigate({ page: 'project', source: p.source, id: p.id, instanceId: instance ? instance.id : undefined, alsoOn: p.alsoOn, world: route.world })}
              />
            );
          })}
          <div ref={sentinel} className="ac-sentinel">
            {search.hasMore && search.loading ? <Spinner size={22} /> : null}
          </div>
        </div>
      )}

      <SidebarPortal>
        {instance ? (
          <section className="mr-side-section">
            <label className="mr-side-switch">
              <span>{t('Ocultar ya descargados')}</span>
              <Toggle checked={hideInstalled} onChange={setHideInstalled} />
            </label>
          </section>
        ) : null}
        {type !== 'world' ? (
          <FilterSection title={t('Versión del juego')}>
            <div className="mr-filter-list">
              <label className="mr-check">
                <Checkbox checked={!version} onChange={() => setVersion('')} label={t('Todas')} />
              </label>
              {(version && !versionsShown.includes(version) ? [version, ...versionsShown] : versionsShown).map((v) => (
                <label key={v} className="mr-check">
                  <Checkbox checked={version === v} onChange={(on) => setVersion(on ? v : '')} label={instance && v === instance.mcVersion ? <ProfileMark text={v} hint={t('la del perfil')} /> : v} />
                </label>
              ))}
              {gameVersions.length > 12 ? (
                <button className="mr-link" onClick={() => setShowAllVersions((s) => !s)}>
                  {showAllVersions ? t('Ver menos') : t('Ver todas')}
                </button>
              ) : null}
            </div>
          </FilterSection>
        ) : null}
        {usesLoader ? (
          <FilterSection title={t('Cargador')}>
            <div className="mr-filter-list">
              {LOADERS.map((l) => (
                <label key={l} className="mr-check">
                  <Checkbox checked={loader === l} onChange={(on) => setLoader(on ? l : '')} label={instance && l === profileLoader ? <ProfileMark text={LOADER_NAME[l]} hint={t('el del perfil')} /> : LOADER_NAME[l]} />
                </label>
              ))}
            </div>
          </FilterSection>
        ) : null}
        {catGroups.map(([header, cats]) => (
          <FilterSection key={header || 'cats'} title={{ categories: t('Categorías'), features: t('Características'), resolutions: t('Resoluciones'), 'performance impact': t('Impacto en el rendimiento') }[header] || (header ? header.charAt(0).toUpperCase() + header.slice(1) : t('Categorías'))}>
            <div className="mr-filter-list">
              {cats.map((c) => (
                <label key={c.id} className="mr-check">
                  <Checkbox checked={categories.includes(c.id)} onChange={(v) => toggleCat(c.id, v)} label={c.name} />
                </label>
              ))}
            </div>
          </FilterSection>
        ))}
      </SidebarPortal>
    </div>
  );
}
