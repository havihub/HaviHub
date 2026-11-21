// Engine (private Prism Launcher), Prism Launcher import, sides of mods.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const http = require('../src/main/util/http');
const { EngineManager, prepareData, compareVersions, assetNames, mergeAccounts, engineLanguage } = require('../src/main/engine');
const { extractTarGz } = require('../src/main/util/tar');
const { Importer } = require('../src/main/importer');
const { PrismContext } = require('../src/main/prism/paths');
const { AppConfig } = require('../src/main/appconfig');
const { Instances } = require('../src/main/prism/instances');
const groups = require('../src/main/prism/groups');
const { IniFile } = require('../src/main/util/ini');
const { TaskManager } = require('../src/main/tasks');
const { envFromSides, envFromCurseVersions } = require('../src/main/platforms/env');
const { resolvePalette } = require('../src/shared/themes.js');

let tmp;
test.before(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'havihub-engine-test-'));
});
test.after(async () => {
  http.setFetch(null);
  await fsp.rm(tmp, { recursive: true, force: true });
});

test('engine versions and assets', () => {
  assert.equal(compareVersions('11.1.1', '11.1.0'), 1);
  assert.equal(compareVersions('11.1.0', '11.1.0-pre1'), 1);
  assert.equal(compareVersions('11.0.3', '11.1.0'), -1);
  assert.equal(compareVersions('v11.1.1', '11.1.1'), 0);
  assert.deepEqual(assetNames('11.1.1', 'win32', 'x64'), ['PrismLauncher-Windows-MSVC-Portable-11.1.1.zip', 'PrismLauncher-Windows-MinGW-w64-Portable-11.1.1.zip']);
  assert.deepEqual(assetNames('11.1.1', 'win32', 'arm64'), ['PrismLauncher-Windows-MSVC-arm64-Portable-11.1.1.zip']);
  assert.deepEqual(assetNames('11.1.1', 'linux', 'x64'), ['PrismLauncher-Linux-Qt6-Portable-11.1.1.tar.gz']);
  assert.equal(engineLanguage('', 'es-CL'), 'es');
  assert.equal(engineLanguage('', 'en-US'), 'en_US');
  assert.equal(engineLanguage('en', 'es-CL'), 'en_US');
});

test('engine data: no setup wizard, Havi Hub theme, existing settings kept', async () => {
  const dir = path.join(tmp, 'data1');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'prismlauncher.cfg'), '[General]\r\nConfigVersion=1.3\r\nMaxMemAlloc=6144\r\nPastebinURL=https://paste.ee\r\nShowConsole=true\r\n');
  await prepareData(dir, { palette: resolvePalette('forge'), language: 'es' });
  const cfg = await IniFile.load(path.join(dir, 'prismlauncher.cfg'));
  assert.equal(cfg.get('MaxMemAlloc'), '6144');
  assert.equal(cfg.get('Language'), 'es');
  assert.equal(cfg.get('ApplicationTheme'), 'havihub');
  assert.equal(cfg.get('IconTheme'), 'flat_white');
  assert.equal(cfg.get('IgnoreJavaWizard'), 'true');
  assert.equal(cfg.get('UserAskedAboutAutomaticJavaDownload'), 'true');
  assert.equal(cfg.get('AutomaticJavaDownload'), 'true');
  assert.equal(cfg.get('ShowConsole'), 'true', 'a choice the user made is kept');
  assert.equal(cfg.has('PastebinURL'), false, 'a legacy paste URL would force the wizard');
  const theme = JSON.parse(await fsp.readFile(path.join(dir, 'themes', 'havihub', 'theme.json'), 'utf8'));
  assert.equal(theme.colors.Highlight, '#eb622b');
  assert.equal(theme.widgets, 'Fusion');
  assert.match(await fsp.readFile(path.join(dir, 'themes', 'havihub', 'themeStyle.css'), 'utf8'), /QProgressBar::chunk \{ background-color: #eb622b/);
  // light palette -> dark icons
  await prepareData(dir, { palette: resolvePalette('light'), language: 'en_US' });
  const cfg2 = await IniFile.load(path.join(dir, 'prismlauncher.cfg'));
  assert.equal(cfg2.get('IconTheme'), 'flat');
  assert.equal(cfg2.get('Language'), 'en_US');
});

test('the engine gets Havi Hub\'s CurseForge key, and a key the person set there stays', async () => {
  const dir = path.join(tmp, 'flamekey');
  const read = async () => (await IniFile.load(path.join(dir, 'prismlauncher.cfg'))).get('FlameKeyOverride', '');
  let mine = '';
  const key = (value) => ({ value, isOurs: (k) => k === mine });
  // nothing there yet: Havi Hub's key is written
  let r = await prepareData(dir, { palette: resolvePalette('forge'), flameKey: key('BUILT-IN') });
  assert.equal(r.flameKey, 'BUILT-IN');
  assert.equal(await read(), 'BUILT-IN');
  mine = r.flameKey;
  // the person's own key in Havi Hub replaces the one written before
  r = await prepareData(dir, { palette: resolvePalette('forge'), flameKey: key('PERSONAL') });
  assert.equal(await read(), 'PERSONAL');
  mine = r.flameKey;
  // a key typed in the engine's own settings is not Havi Hub's: it stays
  const cfg = await IniFile.load(path.join(dir, 'prismlauncher.cfg'));
  cfg.set('FlameKeyOverride', 'TYPED-IN-ENGINE');
  await cfg.save(path.join(dir, 'prismlauncher.cfg'));
  r = await prepareData(dir, { palette: resolvePalette('forge'), flameKey: key('BUILT-IN') });
  assert.equal(r.flameKey, undefined);
  assert.equal(await read(), 'TYPED-IN-ENGINE');
  // no key at all: the setting is not added
  const empty = path.join(tmp, 'flamekey-none');
  await prepareData(empty, { palette: resolvePalette('forge'), flameKey: { value: '', isOurs: () => false } });
  assert.equal((await IniFile.load(path.join(empty, 'prismlauncher.cfg'))).has('FlameKeyOverride'), false);
});

// A tiny stand-in for a Prism Launcher portable build
function fakeRelease(version) {
  const src = path.join(tmp, `build-${version}`);
  fs.mkdirSync(path.join(src, 'PrismLauncher', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(src, 'PrismLauncher', 'PrismLauncher'), `#!/bin/sh\necho engine ${version}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(src, 'PrismLauncher', 'bin', 'prismlauncher_updater'), 'updater', { mode: 0o755 });
  fs.writeFileSync(path.join(src, 'PrismLauncher', 'portable.txt'), 'portable');
  const file = path.join(tmp, `PrismLauncher-Linux-Qt6-Portable-${version}.tar.gz`);
  execFileSync('tar', ['-czf', file, '-C', path.join(src, 'PrismLauncher'), '.']);
  return file;
}

test('engine: downloads, installs, updates and waits for the game to close', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async () => {
  let latest = '11.1.0';
  const archives = { '11.1.0': fakeRelease('11.1.0'), '11.1.1': fakeRelease('11.1.1') };
  let apiCalls = 0;
  http.setFetch(async (url) => {
    const u = new URL(url);
    if (u.host === 'api.github.com') {
      apiCalls++;
      const name = `PrismLauncher-Linux-Qt6-Portable-${latest}.tar.gz`;
      // GitHub gives each file's SHA-256 (an update is only installed with it)
      const digest = `sha256:${require('node:crypto').createHash('sha256').update(fs.readFileSync(archives[latest])).digest('hex')}`;
      return new Response(JSON.stringify({ tag_name: latest, assets: [{ name, size: 1, digest, browser_download_url: `https://github.com/PrismLauncher/PrismLauncher/releases/download/${latest}/${name}` }] }), { status: 200 });
    }
    if (u.host === 'github.com') {
      const v = u.pathname.split('/')[5];
      const buf = fs.readFileSync(archives[v]);
      return new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } });
    }
    return new Response('no', { status: 404 });
  });
  const dir = path.join(tmp, 'engine');
  let gameRunning = false;
  const tasks = new TaskManager(() => {});
  const eng = await new EngineManager({ dir, tasks, isRunning: () => gameRunning }).load();
  const exe = await eng.ensure();
  assert.equal(exe, path.join(dir, 'versions', '11.1.0', 'PrismLauncher'));
  assert.equal(execFileSync(exe).toString().trim(), 'engine 11.1.0');
  assert.equal(fs.existsSync(path.join(dir, 'versions', '11.1.0', 'bin', 'prismlauncher_updater')), false, "the engine's own updater is removed");
  // a new release while a game is running: installed now, activated later
  latest = '11.1.1';
  gameRunning = true;
  await eng.check({ force: true });
  assert.equal(eng.status().version, '11.1.0');
  assert.equal(eng.status().pending, '11.1.1');
  assert.equal(await eng.exe(), path.join(dir, 'versions', '11.1.0', 'PrismLauncher'));
  gameRunning = false;
  assert.equal(await eng.exe(), path.join(dir, 'versions', '11.1.1', 'PrismLauncher'));
  assert.equal(fs.existsSync(path.join(dir, 'versions', '11.1.0')), false, 'old version removed');
  // recent check: no new request unless forced
  const calls = apiCalls;
  await eng.check();
  assert.equal(apiCalls, calls);
  // state survives a restart
  const again = await new EngineManager({ dir, tasks }).load();
  assert.equal(again.status().version, '11.1.1');
});

test('tar extraction keeps symlinks, hard links and modes', { skip: process.platform === 'win32' }, async () => {
  const src = path.join(tmp, 'tarsrc');
  fs.mkdirSync(path.join(src, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(src, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(src, 'lib', 'libx.so.1'), 'lib');
  fs.symlinkSync('libx.so.1', path.join(src, 'lib', 'libx.so'));
  fs.linkSync(path.join(src, 'run.sh'), path.join(src, 'run2.sh'));
  const file = path.join(tmp, 'x.tar.gz');
  execFileSync('tar', ['-czf', file, '-C', src, '.']);
  const dest = path.join(tmp, 'tardest');
  await extractTarGz(file, dest);
  assert.equal(fs.readlinkSync(path.join(dest, 'lib', 'libx.so')), 'libx.so.1');
  assert.equal(fs.readFileSync(path.join(dest, 'run2.sh'), 'utf8'), '#!/bin/sh\n');
  assert.equal(fs.statSync(path.join(dest, 'run.sh')).mode & 0o777, 0o755);
});

test('accounts merge by profile without touching the others', async () => {
  const file = path.join(tmp, 'accounts.json');
  await fsp.writeFile(file, JSON.stringify({ formatVersion: 3, accounts: [{ type: 'MSA', profile: { id: 'a', name: 'uno' }, ygg: { token: 'old' }, active: true }] }));
  await mergeAccounts(file, [
    { type: 'MSA', profile: { id: 'a', name: 'uno' }, ygg: { token: 'new' } },
    { type: 'MSA', profile: { id: 'b', name: 'dos' }, ygg: { token: 'b' }, active: true },
  ]);
  const data = JSON.parse(await fsp.readFile(file, 'utf8'));
  assert.equal(data.accounts.length, 2);
  assert.equal(data.accounts[0].ygg.token, 'new');
  assert.equal(data.accounts[0].active, true, 'the default account stays the default');
  assert.equal(data.accounts[1].active, undefined);
  // fresh file: the first imported account becomes the default
  const f2 = path.join(tmp, 'accounts2.json');
  await mergeAccounts(f2, [{ type: 'MSA', profile: { id: 'c', name: 'tres' }, ygg: { token: 'c' } }]);
  assert.equal(JSON.parse(await fsp.readFile(f2, 'utf8')).accounts[0].active, true);
});

test('import from Prism Launcher: profiles, groups, images, accounts, skins, Java, general settings', async () => {
  const old = path.join(tmp, 'OldPrism');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-fixtures.mjs'), old]);
  // the old install pinned a Java inside its own folder
  const javaFile = path.join(old, 'java', 'java-runtime-delta', 'bin', 'javaw.exe');
  await fsp.mkdir(path.dirname(javaFile), { recursive: true });
  await fsp.writeFile(javaFile, 'java');
  const cfgFile = path.join(old, 'instances', '26.2 Vanilla', 'instance.cfg');
  const icfg = await IniFile.load(cfgFile);
  icfg.set('OverrideJavaLocation', true);
  icfg.set('JavaPath', javaFile);
  icfg.set('OverrideEnv', true);
  icfg.set('Env', '{"MESA_GL_VERSION_OVERRIDE":"4.6"}');
  await icfg.save(cfgFile);
  // and its general settings
  const gcfgFile = path.join(old, 'prismlauncher.cfg');
  const gcfg = await IniFile.load(gcfgFile);
  gcfg.set('MaxMemAlloc', 6144);
  gcfg.set('JvmArgs', '-XX:+UseG1GC');
  gcfg.set('Env', '{"GLOBAL":"1"}');
  gcfg.set('UseNativeGLFW', true);
  gcfg.set('CustomGLFWPath', '/usr/lib/libglfw.so.3');
  gcfg.set('JavaPath', javaFile);
  gcfg.set('Language', 'fr');
  await gcfg.save(gcfgFile);

  // game files Prism already downloaded
  await fsp.mkdir(path.join(old, 'assets', 'objects', 'ab'), { recursive: true });
  await fsp.writeFile(path.join(old, 'assets', 'objects', 'ab', 'abcdef'), 'sound');
  await fsp.mkdir(path.join(old, 'libraries', 'org', 'lwjgl'), { recursive: true });
  await fsp.writeFile(path.join(old, 'libraries', 'org', 'lwjgl', 'lwjgl.jar'), 'jar');

  const own = path.join(tmp, 'HaviHubData');
  await fsp.mkdir(path.join(own, 'instances'), { recursive: true });
  const ctx = new PrismContext(own, null);
  const cfg = new AppConfig(path.join(tmp, 'ud'));
  await cfg.load();
  const imp = new Importer({ ctxProvider: () => ctx, appConfig: cfg, tasks: new TaskManager(() => {}), emit: () => {} });
  const listed = await imp.list(old);
  const ids = listed.instances.map((i) => i.id);
  assert.ok(ids.includes('26.2 Vanilla'));
  assert.ok(listed.accounts.some((a) => a.name === 'havikun'));
  const sizes = await imp.sizes(old, ['26.2 Vanilla']);
  assert.ok(sizes['26.2 Vanilla'] > 0);

  const r = await imp.run({ srcDir: old, ids: ['26.2 Vanilla', 'The Fog'], accounts: true, skins: true, groups: true });
  assert.deepEqual(r.failed, []);
  assert.equal(r.imported.length, 2);
  const mine = await new Instances(ctx, cfg).list();
  const vanilla = mine.instances.find((i) => i.id === '26.2 Vanilla');
  assert.ok(vanilla, 'instance copied');
  assert.equal(vanilla.group, 'Vanilla');
  assert.equal(mine.instances.find((i) => i.id === 'The Fog').group, 'Horror');
  assert.ok(vanilla.icon, 'custom image copied');
  const newCfg = await IniFile.load(path.join(own, 'instances', '26.2 Vanilla', 'instance.cfg'));
  const ownJava = path.join(own, 'java', 'java-runtime-delta', 'bin', 'javaw.exe');
  assert.equal(newCfg.get('OverrideJavaLocation'), 'true', 'the profile keeps its own Java');
  assert.equal(newCfg.get('JavaPath'), ownJava, 'the same Java, now in Havi Hub\'s folder');
  assert.ok(fs.existsSync(ownJava));
  assert.equal(newCfg.get('Env'), '{"MESA_GL_VERSION_OVERRIDE":"4.6"}', 'environment variables kept');
  const ownCfg = await new PrismContext(own, null).loadCfg();
  assert.equal(String(ownCfg.get('MaxMemAlloc')), '6144');
  assert.equal(ownCfg.get('JvmArgs'), '-XX:+UseG1GC');
  assert.equal(ownCfg.get('Env'), '{"GLOBAL":"1"}');
  assert.equal(String(ownCfg.get('UseNativeGLFW')), 'true');
  assert.equal(ownCfg.get('CustomGLFWPath'), '/usr/lib/libglfw.so.3');
  assert.equal(ownCfg.get('JavaPath'), ownJava);
  assert.equal(ownCfg.has('Language'), false, "Havi Hub's own settings are not copied");
  assert.ok(r.globals >= 6);
  assert.ok(fs.existsSync(path.join(own, 'instances', '26.2 Vanilla', 'minecraft', 'mods')));
  const accounts = JSON.parse(await fsp.readFile(path.join(own, 'accounts.json'), 'utf8'));
  assert.equal(accounts.accounts[0].profile.name, 'havikun');
  assert.ok(r.skins > 0);
  assert.equal(r.shared, 3);
  const a1 = fs.statSync(path.join(old, 'assets', 'objects', 'ab', 'abcdef'));
  const a2 = fs.statSync(path.join(own, 'assets', 'objects', 'ab', 'abcdef'));
  assert.equal(a1.ino, a2.ino, 'linked, not copied');
  assert.ok(fs.existsSync(path.join(own, 'libraries', 'org', 'lwjgl', 'lwjgl.jar')));
  assert.ok(fs.existsSync(path.join(old, 'instances', '26.2 Vanilla')), 'copy keeps the original');

  // importing again does not overwrite: it becomes a copy
  const r2 = await imp.run({ srcDir: old, ids: ['26.2 Vanilla'], groups: true });
  assert.equal(r2.imported[0].id, '26.2 Vanilla (2)');

  // move
  const r3 = await imp.run({ srcDir: old, ids: ['Cave Dread'], move: true, groups: true });
  assert.equal(r3.imported[0].id, 'Cave Dread');
  assert.equal(fs.existsSync(path.join(old, 'instances', 'Cave Dread')), false);
  const oldGroups = await groups.loadGroups(new PrismContext(old, null));
  assert.equal(oldGroups.map.has('Cave Dread'), false, 'moved profile removed from the old groups');
});

test('mod sides', () => {
  assert.equal(envFromSides('required', 'unsupported'), 'client');
  assert.equal(envFromSides('optional', 'unsupported'), 'client');
  assert.equal(envFromSides('unsupported', 'required'), 'server');
  assert.equal(envFromSides('required', 'required'), 'both');
  assert.equal(envFromSides('optional', 'optional'), 'both');
  assert.equal(envFromSides('unknown', 'unknown'), '');
  assert.equal(envFromCurseVersions(['1.21.1', 'Fabric', 'Client']), 'client');
  assert.equal(envFromCurseVersions(['1.21.1', 'NeoForge', 'Server']), 'server');
  assert.equal(envFromCurseVersions(['1.21.1', 'Client', 'Server']), 'both');
  assert.equal(envFromCurseVersions(['1.21.1', 'Forge']), '');
});

test('a config that pointed at Prism Launcher\'s own folder is migrated', async () => {
  const dir = path.join(tmp, 'oldcfg');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'config.json'), JSON.stringify({ prismDataDir: 'C:\\Users\\x\\AppData\\Roaming\\PrismLauncher', prismExe: 'C:\\p.exe', uiScale: 100 }));
  const c = new AppConfig(dir);
  await c.load();
  assert.equal(c.get().legacyPrismDir, 'C:\\Users\\x\\AppData\\Roaming\\PrismLauncher');
  assert.equal(c.get().dataDir, '');
  assert.equal('prismDataDir' in c.get(), false);
  const saved = JSON.parse(await fsp.readFile(path.join(dir, 'config.json'), 'utf8'));
  assert.equal('prismExe' in saved, false);
});

// GitHub publishes a SHA-256 for each release file ("digest"): the download must match it
test('engine: a download that does not match the published SHA-256 is thrown away', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async () => {
  const crypto = require('node:crypto');
  const archive = fakeRelease('11.2.0');
  const good = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')}`;
  let digest = `sha256:${'0'.repeat(64)}`;
  http.setFetch(async (url) => {
    const u = new URL(url);
    if (u.host === 'api.github.com') {
      const name = 'PrismLauncher-Linux-Qt6-Portable-11.2.0.tar.gz';
      return new Response(JSON.stringify({ tag_name: '11.2.0', assets: [{ name, size: 1, digest, browser_download_url: `https://github.com/PrismLauncher/PrismLauncher/releases/download/11.2.0/${name}` }] }), { status: 200 });
    }
    if (u.host === 'github.com') {
      const buf = fs.readFileSync(archive);
      return new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } });
    }
    return new Response('no', { status: 404 });
  });
  const dir = path.join(tmp, 'engine-digest');
  const eng = await new EngineManager({ dir, tasks: new TaskManager(() => {}), testedVersion: '11.2.0' }).load();
  await eng.check({ force: true });
  assert.equal(await eng.exe(), null);
  assert.match(eng.status().error || '', /SHA-256/);
  assert.equal(fs.existsSync(path.join(dir, 'versions', '11.2.0')), false);
  assert.equal(fs.existsSync(path.join(dir, 'downloads', 'PrismLauncher-Linux-Qt6-Portable-11.2.0.tar.gz')), false, 'the bad file is not kept');
  // the right file installs
  digest = good;
  await eng.check({ force: true });
  assert.equal(await eng.exe(), path.join(dir, 'versions', '11.2.0', 'PrismLauncher'));
});

// Updating the engine keeps a snapshot; a damaged or non-starting engine goes back to it.
test('engine update: snapshot, integrity check and rollback', { skip: process.platform === 'win32' }, async () => {
  const { writeIntegrity } = require('../src/main/engine');
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'havihub-engine-rb-'));
  const cfg = path.join(base, 'data', 'prismlauncher.cfg');
  await fsp.mkdir(path.dirname(cfg), { recursive: true });
  await fsp.writeFile(cfg, 'Language=es\n');
  const toasts = [];
  const mk = () => new EngineManager({ dir: path.join(base, 'engine'), emit: (ev, x) => ev === 'toast' && toasts.push(x), configFiles: () => [cfg] });
  const putVersion = async (v, script) => {
    const dir = path.join(base, 'engine', 'versions', v);
    await fsp.mkdir(path.join(dir, 'lib'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'PrismLauncher'), `#!/bin/sh\n${script}\n#${'x'.repeat(1100)}\n`, { mode: 0o755 });
    await fsp.writeFile(path.join(dir, 'lib', 'core.so'), 'core-library');
    await writeIntegrity(dir);
  };
  await putVersion('9.0', 'exit 0');
  const eng = await mk().load();
  eng.state.version = '9.0';
  assert.equal(await eng.verifyOnStart(), null);
  assert.equal(eng.state.verified, '9.0');

  // update to 9.1: snapshot of 9.0 and its settings
  assert.equal(await eng.snapshot(), '9.0');
  await putVersion('9.1', 'kill -SEGV $$');
  eng.state.version = '9.1';
  await eng.save();
  await fsp.writeFile(cfg, 'Language=broken\n');

  // 9.1 crashes on start: back to 9.0 with its settings
  const rb = await (await mk().load()).verifyOnStart();
  assert.deepEqual([rb.from, rb.to, rb.reason], ['9.1', '9.0', 'start']);
  const after = await mk().load();
  assert.equal(after.state.version, '9.0');
  assert.equal(after.state.skipVersion, '9.1');
  assert.equal(await fsp.readFile(cfg, 'utf8'), 'Language=es\n');
  assert.ok(!fs.existsSync(path.join(base, 'engine', 'versions', '9.1')));
  assert.equal(toasts.length, 1);

  // a damaged file in the only engine: downloaded again
  await fsp.writeFile(path.join(base, 'engine', 'versions', '9.0', 'lib', 'core.so'), 'x');
  const rb2 = await after.verifyOnStart();
  assert.deepEqual([rb2.from, rb2.to, rb2.reason], ['9.0', '', 'corrupt']);
  assert.equal(after.state.version, '');
  await fsp.rm(base, { recursive: true, force: true });
});

// Going back to the engine before an update must not lose an account added
// (or a token renewed) since the snapshot: accounts.json is only restored when
// the newer engine left it in a format the older one may not read.
test('engine rollback keeps accounts added after the update, unless their format changed', { skip: process.platform === 'win32' }, async () => {
  const { writeIntegrity } = require('../src/main/engine');
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'havihub-engine-acc-'));
  const acc = path.join(base, 'data', 'accounts.json');
  await fsp.mkdir(path.dirname(acc), { recursive: true });
  const accounts = (names, formatVersion = 3) => JSON.stringify({ formatVersion, accounts: names.map((n) => ({ type: 'MSA', profile: { id: n, name: n } })) });
  const putVersion = async (v, script) => {
    const dir = path.join(base, 'engine', 'versions', v);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'PrismLauncher'), `#!/bin/sh\n${script}\n#${'x'.repeat(1100)}\n`, { mode: 0o755 });
    await writeIntegrity(dir);
  };
  const mk = () => new EngineManager({ dir: path.join(base, 'engine'), emit: () => {}, configFiles: () => [acc] });
  const updateAndFail = async (after) => {
    await putVersion('9.0', 'exit 0');
    const eng = await mk().load();
    eng.state.version = '9.0';
    eng.state.verified = '9.0';
    await fsp.writeFile(acc, accounts(['uno']));
    assert.equal(await eng.snapshot(), '9.0');
    await putVersion('9.1', 'kill -SEGV $$');
    eng.state.version = '9.1';
    await eng.save();
    await fsp.writeFile(acc, after);
    const rb = await (await mk().load()).verifyOnStart();
    assert.equal(rb.to, '9.0');
    return JSON.parse(await fsp.readFile(acc, 'utf8'));
  };
  // an account added while the new engine was in use stays
  assert.deepEqual((await updateAndFail(accounts(['uno', 'dos']))).accounts.map((a) => a.profile.name), ['uno', 'dos']);
  // the new engine wrote another format: the copy from before comes back
  assert.deepEqual((await updateAndFail(accounts(['uno', 'dos'], 4))).accounts.map((a) => a.profile.name), ['uno']);
  // a file that can't be read: the copy comes back too
  assert.deepEqual((await updateAndFail('{ broken')).accounts.map((a) => a.profile.name), ['uno']);
  await fsp.rm(base, { recursive: true, force: true });
});

// GitHub's API rate limit (403/429): the tag comes from github.com itself
test('engine: latest version without the API when it answers 403 or 429', async () => {
  const { engineErrorText } = require('../src/main/engine');
  const seen = [];
  const route = (atom) => async (url, opts) => {
    seen.push({ url, ua: opts.headers['User-Agent'] });
    if (url.startsWith('https://api.github.com/')) return new Response('{"message":"API rate limit exceeded"}', { status: 403 });
    if (url.endsWith('/releases/latest')) return atom ? new Response('', { status: 500 }) : new Response(null, { status: 302, headers: { location: 'https://github.com/PrismLauncher/PrismLauncher/releases/tag/9.4' } });
    if (url.endsWith('/releases.atom')) return new Response('<feed><entry><link href="https://github.com/PrismLauncher/PrismLauncher/releases/tag/10.0.0-rc1"/></entry><entry><link href="https://github.com/PrismLauncher/PrismLauncher/releases/tag/9.5"/></entry></feed>');
    return new Response('', { status: 404 });
  };
  const eng = new EngineManager({ dir: os.tmpdir() });
  try {
    http.setFetch(route(false));
    assert.equal((await eng.latestRelease()).version, '9.4');
    http.setFetch(route(true));
    assert.equal((await eng.latestRelease()).version, '9.5');
  } finally {
    http.setFetch(null);
  }
  assert.ok(seen.every((s) => /^HaviHub\//.test(s.ua)));
  assert.equal(engineErrorText(new http.HttpError(403, 'https://api.github.com/x')), 'GitHub limitó las consultas por un rato. Havi Hub lo intentará de nuevo más tarde.');
  assert.ok(!/https?:/.test(engineErrorText(new Error('HTTP 500 - https://api.github.com/x'))));
});

// Havi Hub installs a Prism release only once it has been tested with it
// (TESTED_VERSION): a newer one waits, and the tested one is installed instead.
test('engine: a release newer than the tested one is not installed', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async () => {
  const crypto = require('node:crypto');
  const archives = { '11.1.1': fakeRelease('11.1.1'), '12.0.0': fakeRelease('12.0.0') };
  const asset = (v) => {
    const name = `PrismLauncher-Linux-Qt6-Portable-${v}.tar.gz`;
    const digest = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(archives[v])).digest('hex')}`;
    return { tag_name: v, assets: [{ name, size: 1, digest, browser_download_url: `https://github.com/PrismLauncher/PrismLauncher/releases/download/${v}/${name}` }] };
  };
  const asked = [];
  http.setFetch(async (url) => {
    const u = new URL(url);
    asked.push(u.pathname);
    if (u.host === 'api.github.com' && u.pathname.endsWith('/releases/latest')) return new Response(JSON.stringify(asset('12.0.0')), { status: 200 });
    if (u.host === 'api.github.com' && u.pathname.endsWith('/releases/tags/11.1.1')) return new Response(JSON.stringify(asset('11.1.1')), { status: 200 });
    if (u.host === 'github.com') {
      const buf = fs.readFileSync(archives[u.pathname.split('/')[5]]);
      return new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } });
    }
    return new Response('no', { status: 404 });
  });
  const dir = path.join(tmp, 'engine-tested');
  const eng = await new EngineManager({ dir, tasks: new TaskManager(() => {}), testedVersion: '11.1.1' }).load();
  const exe = await eng.ensure();
  assert.equal(exe, path.join(dir, 'versions', '11.1.1', 'PrismLauncher'));
  assert.ok(!asked.some((p) => p.includes('/download/12.0.0/')), 'the untested release is not even downloaded');
  const st = eng.status();
  assert.equal(st.latest, '11.1.1', 'up to date: the newest release Havi Hub installs');
  assert.equal(st.published, '12.0.0');
  // checking again changes nothing
  await eng.check({ force: true });
  assert.equal(await eng.exe(), exe);
  // an engine newer than the tested one, installed before, is kept (never downgraded)
  const newer = await new EngineManager({ dir: path.join(tmp, 'engine-newer'), tasks: new TaskManager(() => {}), testedVersion: '12.0.0' }).load();
  await newer.ensure();
  const older = await new EngineManager({ dir: path.join(tmp, 'engine-newer'), tasks: new TaskManager(() => {}), testedVersion: '11.1.1' }).load();
  await older.check({ force: true });
  assert.equal(await older.exe(), path.join(tmp, 'engine-newer', 'versions', '12.0.0', 'PrismLauncher'));
});

// Without GitHub's API (rate limits) there is no SHA-256 to check the file
// against: the first engine is installed all the same (nothing can be played
// without it), but an update waits for a check that has one.
test('engine: an update whose SHA-256 is unknown waits', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async () => {
  const archives = { '11.1.0': fakeRelease('11.1.0'), '11.1.1': fakeRelease('11.1.1') };
  let latest = '11.1.0';
  http.setFetch(async (url) => {
    const u = new URL(url);
    if (u.host === 'api.github.com') {
      const name = `PrismLauncher-Linux-Qt6-Portable-${latest}.tar.gz`;
      return new Response(JSON.stringify({ tag_name: latest, assets: [{ name, size: 1, browser_download_url: `https://github.com/PrismLauncher/PrismLauncher/releases/download/${latest}/${name}` }] }), { status: 200 });
    }
    if (u.host === 'github.com') {
      const buf = fs.readFileSync(archives[u.pathname.split('/')[5]]);
      return new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } });
    }
    return new Response('no', { status: 404 });
  });
  const dir = path.join(tmp, 'engine-nodigest');
  const eng = await new EngineManager({ dir, tasks: new TaskManager(() => {}), testedVersion: '11.1.1' }).load();
  assert.equal(await eng.ensure(), path.join(dir, 'versions', '11.1.0', 'PrismLauncher'));
  latest = '11.1.1';
  await eng.check({ force: true });
  assert.equal(await eng.exe(), path.join(dir, 'versions', '11.1.0', 'PrismLauncher'));
  assert.equal(fs.existsSync(path.join(dir, 'versions', '11.1.1')), false);
});
