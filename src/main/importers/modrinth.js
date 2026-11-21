// Reading profiles of the Modrinth App. Its database (app.db, SQLite) lists the
// profiles; each one's game folder is "<app folder>/profiles/<path>". Both the
// current schema (instances, content sets, links, groups) and the older one
// (a single "profiles" table) are supported, plus the very old profile.json.
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { exists, listDir } = require('../util/fsx');
const { UserError } = require('../../shared/usertext');

const LOADERS = new Set(['forge', 'fabric', 'quilt', 'neoforge']);

function candidates() {
  const home = os.homedir();
  const extra = (process.env.HAVIHUB_IMPORT_MR_DIRS || '').split(path.delimiter).filter(Boolean);
  const list = [...extra];
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    list.push(path.join(appdata, 'ModrinthApp'), path.join(appdata, 'com.modrinth.theseus'));
  } else if (process.platform === 'darwin') {
    const sup = path.join(home, 'Library', 'Application Support');
    list.push(path.join(sup, 'ModrinthApp'), path.join(sup, 'com.modrinth.theseus'));
  } else {
    const data = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    const config = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    list.push(path.join(data, 'ModrinthApp'), path.join(config, 'ModrinthApp'), path.join(data, 'com.modrinth.theseus'));
  }
  return list;
}

async function resolveRoot(dir) {
  if (!dir) return null;
  let abs = path.resolve(dir);
  // a profile folder was picked: go up to the app folder
  if (path.basename(path.dirname(abs)).toLowerCase() === 'profiles') abs = path.dirname(path.dirname(abs));
  if (path.basename(abs).toLowerCase() === 'profiles') abs = path.dirname(abs);
  return abs;
}

// Opens a copy of the database (the app may be open and writing to it)
async function withDb(root, fn) {
  const db = path.join(root, 'app.db');
  if (!(await exists(db))) return null;
  let sqlite;
  try {
    sqlite = require('node:sqlite');
  } catch {
    const e = new UserError('Esta versión de Havi Hub no puede leer la base de datos de Modrinth.');
    e.code = 'NO_SQLITE';
    throw e;
  }
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'havihub-mr-'));
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      if (await exists(db + suffix)) await fsp.copyFile(db + suffix, path.join(tmp, `app.db${suffix}`));
    }
    const conn = new sqlite.DatabaseSync(path.join(tmp, 'app.db'));
    try {
      return await fn(conn);
    } finally {
      conn.close();
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function tables(conn) {
  return new Set(conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
}

function columns(conn, table) {
  return new Set(conn.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
}

const parse = (v, def) => {
  if (v == null) return def;
  try {
    return JSON.parse(String(v));
  } catch {
    return def;
  }
};

const seconds = (v) => (Number(v) > 0 ? Number(v) : 0);
const list = (v) => (Array.isArray(v) ? v : []);
// Modrinth keeps environment variables as [name, value] pairs
const envOf = (v) => {
  const out = {};
  for (const pair of list(v)) if (Array.isArray(pair) && pair[0]) out[String(pair[0])] = String(pair[1] == null ? '' : pair[1]);
  return out;
};
const hooksOf = (pre, wrapper, post) => ({ pre: String(pre || '').trim(), wrapper: String(wrapper || '').trim(), post: String(post || '').trim() });
const resolutionOf = (x, y) => (Number(x) > 0 && Number(y) > 0 ? [Math.round(Number(x)), Math.round(Number(y))] : null);
const flag = (v) => (v === null || v === undefined ? null : Boolean(v) && v !== 'false');

// What the app uses for every instance, when the person changed it from the
// app's own default (2048 MB, 854 × 480, no arguments, variables or commands)
function readLaunchSettings(conn, t) {
  if (!t.has('settings')) return {};
  const sc = columns(conn, 'settings');
  const want = ['extra_launch_args', 'custom_env_vars', 'mc_memory_max', 'mc_force_fullscreen', 'mc_game_resolution_x', 'mc_game_resolution_y', 'hook_pre_launch', 'hook_wrapper', 'hook_post_exit'].filter((c) => sc.has(c));
  if (!want.length) return {};
  const row = conn.prepare(`SELECT ${want.map((c) => (c === 'extra_launch_args' || c === 'custom_env_vars' ? `json(${c}) AS ${c}` : c)).join(', ')} FROM settings LIMIT 1`).get() || {};
  const res = resolutionOf(row.mc_game_resolution_x, row.mc_game_resolution_y);
  return {
    memory: Number(row.mc_memory_max) > 0 && Number(row.mc_memory_max) !== 2048 ? Number(row.mc_memory_max) : 0,
    jvmArgs: list(parse(row.extra_launch_args, [])).join(' '),
    env: envOf(parse(row.custom_env_vars, [])),
    resolution: res && !(res[0] === 854 && res[1] === 480) ? res : null,
    fullscreen: Boolean(row.mc_force_fullscreen),
    hooks: hooksOf(row.hook_pre_launch, row.hook_wrapper, row.hook_post_exit),
  };
}
// Modrinth stores unix seconds; accept milliseconds too
const toMs = (v) => {
  const n = Number(v) || 0;
  if (!n) return 0;
  return n < 1e11 ? n * 1000 : n;
};

function readDb(conn) {
  const t = tables(conn);
  let configDir = '';
  if (t.has('settings') && columns(conn, 'settings').has('custom_dir')) {
    const row = conn.prepare('SELECT custom_dir FROM settings LIMIT 1').get();
    if (row && row.custom_dir) configDir = String(row.custom_dir);
  }
  const groups = new Map();
  const addGroup = (id, name) => {
    if (!name || name === 'Favorites') return;
    if (!groups.has(id)) groups.set(id, name);
  };
  const out = [];
  if (t.has('instances')) {
    const ic = columns(conn, 'instances');
    const hasSets = t.has('instance_content_sets');
    const hasLinks = t.has('instance_links');
    const rows = conn
      .prepare(
        `SELECT i.id AS id, i.path AS path, i.name AS name, i.icon_path AS icon_path, i.last_played AS last_played,
                ${ic.has('submitted_time_played') ? 'i.submitted_time_played' : '0'} AS played_a,
                ${ic.has('recent_time_played') ? 'i.recent_time_played' : '0'} AS played_b,
                ${ic.has('install_stage') ? 'i.install_stage' : "'installed'"} AS stage,
                ${hasSets ? 'cs.game_version' : "''"} AS game_version, ${hasSets ? 'cs.loader' : "''"} AS loader, ${hasSets ? 'cs.loader_version' : "''"} AS loader_version,
                ${hasLinks ? 'l.modrinth_project_id' : 'NULL'} AS project_id, ${hasLinks ? 'l.modrinth_version_id' : 'NULL'} AS version_id
         FROM instances i
         ${hasSets ? 'LEFT JOIN instance_content_sets cs ON cs.id = i.applied_content_set_id' : ''}
         ${hasLinks ? 'LEFT JOIN instance_links l ON l.instance_id = i.id' : ''}`,
      )
      .all();
    if (t.has('instance_group_memberships') && t.has('instance_groups')) {
      for (const r of conn.prepare('SELECT m.instance_id AS id, g.name AS name FROM instance_group_memberships m JOIN instance_groups g ON g.id = m.group_id ORDER BY g.display_order').all()) addGroup(r.id, r.name);
    } else if (t.has('instance_groups') && columns(conn, 'instance_groups').has('group_name')) {
      for (const r of conn.prepare('SELECT instance_id AS id, group_name AS name FROM instance_groups').all()) addGroup(r.id, r.name);
    }
    const overrides = new Map();
    if (t.has('instance_launch_overrides')) {
      for (const r of conn.prepare('SELECT instance_id AS id, json(overrides) AS o FROM instance_launch_overrides').all()) overrides.set(r.id, parse(r.o, {}));
    }
    for (const r of rows) {
      const o = overrides.get(r.id) || {};
      const h = o.hooks || {};
      out.push({
        key: r.path,
        path: r.path,
        name: r.name,
        icon: r.icon_path || '',
        lastPlayed: toMs(r.last_played),
        played: seconds(r.played_a) + seconds(r.played_b),
        stage: r.stage,
        mcVersion: r.game_version || '',
        loader: r.loader,
        loaderVersion: r.loader_version || '',
        modpack: r.project_id && r.version_id ? { projectId: r.project_id, versionId: r.version_id } : null,
        group: groups.get(r.id) || '',
        memory: o.memory && Number(o.memory.maximum) > 0 ? Number(o.memory.maximum) : 0,
        jvmArgs: Array.isArray(o.extra_launch_args) ? o.extra_launch_args.join(' ') : '',
        javaPath: o.java_path ? String(o.java_path) : '',
        env: envOf(o.custom_env_vars),
        resolution: Array.isArray(o.game_resolution) ? resolutionOf(o.game_resolution[0], o.game_resolution[1]) : null,
        fullscreen: flag(o.force_fullscreen),
        hooks: hooksOf(h.pre_launch, h.wrapper, h.post_exit),
      });
    }
  } else if (t.has('profiles')) {
    const pc = columns(conn, 'profiles');
    const col = (c, def = 'NULL') => (pc.has(c) ? c : `${def} AS ${c}`);
    const rows = conn
      .prepare(
        `SELECT path, name, icon_path, game_version, mod_loader, mod_loader_version, ${pc.has('groups') ? 'json(groups) AS groups' : "'[]' AS groups"},
                ${col('linked_project_id')}, ${col('linked_version_id')}, ${col('last_played')}, ${col('submitted_time_played', '0')}, ${col('recent_time_played', '0')},
                ${col('override_mc_memory_max')}, ${pc.has('override_extra_launch_args') ? 'json(override_extra_launch_args) AS override_extra_launch_args' : "'[]' AS override_extra_launch_args"}, ${col('install_stage', "'installed'")},
                ${col('override_java_path')}, ${pc.has('override_custom_env_vars') ? 'json(override_custom_env_vars) AS override_custom_env_vars' : "'[]' AS override_custom_env_vars"},
                ${col('override_mc_force_fullscreen')}, ${col('override_mc_game_resolution_x')}, ${col('override_mc_game_resolution_y')},
                ${col('override_hook_pre_launch')}, ${col('override_hook_wrapper')}, ${col('override_hook_post_exit')}
         FROM profiles`,
      )
      .all();
    for (const r of rows) {
      const g = parse(r.groups, []);
      const args = parse(r.override_extra_launch_args, []);
      out.push({
        key: r.path,
        path: r.path,
        name: r.name,
        icon: r.icon_path || '',
        lastPlayed: toMs(r.last_played),
        played: seconds(r.submitted_time_played) + seconds(r.recent_time_played),
        stage: r.install_stage,
        mcVersion: r.game_version || '',
        loader: r.mod_loader,
        loaderVersion: r.mod_loader_version || '',
        modpack: r.linked_project_id && r.linked_version_id ? { projectId: r.linked_project_id, versionId: r.linked_version_id } : null,
        group: Array.isArray(g) ? g.find((x) => x && x !== 'Favorites') || '' : '',
        memory: Number(r.override_mc_memory_max) > 0 ? Number(r.override_mc_memory_max) : 0,
        jvmArgs: Array.isArray(args) ? args.join(' ') : '',
        javaPath: r.override_java_path ? String(r.override_java_path) : '',
        env: envOf(parse(r.override_custom_env_vars, [])),
        resolution: resolutionOf(r.override_mc_game_resolution_x, r.override_mc_game_resolution_y),
        fullscreen: flag(r.override_mc_force_fullscreen),
        hooks: hooksOf(r.override_hook_pre_launch, r.override_hook_wrapper, r.override_hook_post_exit),
      });
    }
  }
  return { configDir, profiles: out, launch: readLaunchSettings(conn, t) };
}

// Very old app (theseus 0.7 and earlier): profiles/<name>/profile.json
async function readLegacyJson(root) {
  const out = [];
  for (const e of await listDir(path.join(root, 'profiles'))) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const file = path.join(root, 'profiles', e.name, 'profile.json');
    if (!(await exists(file))) continue;
    try {
      const j = JSON.parse(await fsp.readFile(file, 'utf8'));
      const m = j.metadata || {};
      out.push({
        key: e.name,
        path: e.name,
        name: m.name || e.name,
        icon: m.icon || '',
        lastPlayed: Date.parse(m.last_played || '') || 0,
        played: 0,
        stage: j.install_stage || 'installed',
        mcVersion: m.game_version || '',
        loader: m.loader || 'vanilla',
        loaderVersion: (m.loader_version && m.loader_version.id) || '',
        modpack: m.linked_data && m.linked_data.project_id && m.linked_data.version_id ? { projectId: m.linked_data.project_id, versionId: m.linked_data.version_id } : null,
        group: Array.isArray(m.groups) ? m.groups[0] || '' : '',
        memory: j.memory && j.memory.maximum ? Number(j.memory.maximum) : 0,
        jvmArgs: Array.isArray(j.java && j.java.extra_arguments) ? j.java.extra_arguments.join(' ') : '',
        javaPath: j.java && j.java.override_version && j.java.override_version.path ? String(j.java.override_version.path) : '',
        env: envOf(j.java && j.java.custom_env_args),
        resolution: [j.resolution, j.game_resolution].some(Array.isArray) ? resolutionOf(...[j.resolution, j.game_resolution].find(Array.isArray)) : null,
        fullscreen: flag(j.fullscreen ?? j.force_fullscreen),
        hooks: hooksOf(j.hooks && j.hooks.pre_launch, j.hooks && j.hooks.wrapper, j.hooks && j.hooks.post_exit),
      });
    } catch {
      /* unreadable */
    }
  }
  return { configDir: '', profiles: out, launch: {} };
}

async function readApp(root) {
  const fromDb = await withDb(root, (conn) => readDb(conn));
  const data = fromDb || (await readLegacyJson(root));
  const configDir = data.configDir && (await exists(data.configDir)) ? data.configDir : root;
  const profiles = [];
  for (const p of data.profiles) {
    const dir = path.join(configDir, 'profiles', p.path);
    if (!(await exists(dir))) continue;
    profiles.push({
      id: p.key,
      dir,
      name: p.name,
      mcVersion: p.mcVersion,
      loader: LOADERS.has(String(p.loader || '').toLowerCase()) && p.loaderVersion ? { id: String(p.loader).toLowerCase(), version: p.loaderVersion } : null,
      image: p.icon && (await exists(p.icon)) ? p.icon : null,
      lastPlayed: p.lastPlayed,
      played: p.played,
      group: p.group,
      memory: p.memory,
      jvmArgs: p.jvmArgs,
      javaPath: p.javaPath || '',
      env: p.env || {},
      resolution: p.resolution || null,
      fullscreen: p.fullscreen === undefined ? null : p.fullscreen,
      hooks: p.hooks || hooksOf(),
      modpack: p.modpack,
      incomplete: p.stage && p.stage !== 'installed',
    });
  }
  return { configDir, profiles, launch: data.launch || {} };
}

async function isApp(root) {
  return Boolean(root) && ((await exists(path.join(root, 'app.db'))) || (await exists(path.join(root, 'profiles'))));
}

function sharedDirs(configDir) {
  return [
    [path.join(configDir, 'meta', 'assets'), 'assets'],
    [path.join(configDir, 'meta', 'libraries'), 'libraries'],
  ];
}

const SKIP = new Set(['logs', '.fabric', 'natives']);

module.exports = { candidates, resolveRoot, readApp, isApp, sharedDirs, SKIP, withDb, readDb };
