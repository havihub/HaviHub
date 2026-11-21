// Path traversal: names from mods/.index/*.pw.toml, pack manifests, zip
// entries in overrides/ and the platform APIs must never leave their folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const yazl = require('yazl');

const { isPlainFileName, safeRelPath, resolveInside, resolveRelInside, tomlFileName } = require('../src/main/util/safepath');
const { readMetadata, writeMetadata, Content } = require('../src/main/prism/content');
const { extractPrefix } = require('../src/main/util/zip');

const EVIL = [
  '../../../../etc/passwd',
  '..\\..\\..\\..\\Windows\\System32',
  '../../../../',
  '..\\..\\..\\..\\',
  '..',
  '.',
  '/etc/passwd',
  'C:\\Windows\\win.ini',
  'C:evil.jar',
  '\\\\server\\share\\x.jar',
  '//server/share/x.jar',
  'mods/../../x.jar',
  'sub/x.jar',
  'sub\\x.jar',
  'CON',
  'nul.jar',
  'com1.txt',
  'LPT9',
  'x.jar:stream',
  'x.jar.',
  'x.jar ',
  'x\u0000.jar',
  '',
];

let tmp;
test.before(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'havihub-safepath-'));
});
test.after(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

test('plain file names: traversal, drives, UNC and device names are refused', () => {
  for (const n of EVIL) assert.equal(isPlainFileName(n), false, JSON.stringify(n));
  for (const n of ['sodium-fabric-0.5.8+mc1.20.1.jar', 'Complementary Shaders r5.zip', 'a.jar.disabled', '..hidden.jar', 'con-tent.jar']) assert.equal(isPlainFileName(n), true, n);
});

test('relative pack paths: ../ and ..\\ in any position are refused', () => {
  for (const p of ['../../../../x', '..\\..\\..\\..\\x', 'config/../../x', 'config\\..\\..\\x', '/abs', 'C:/x', 'C:\\x', '\\\\srv\\s\\x', 'mods/CON', 'a/b:c']) assert.equal(safeRelPath(p), null, p);
  assert.equal(safeRelPath('config\\sodium.json'), 'config/sodium.json');
  assert.equal(safeRelPath('./mods//a.jar'), 'mods/a.jar');
});

test('resolveInside / resolveRelInside stay inside the folder', async () => {
  const mods = path.join(tmp, 'inst', 'mods');
  await fsp.mkdir(mods, { recursive: true });
  assert.equal(await resolveInside(mods, 'a.jar'), path.join(mods, 'a.jar'));
  await assert.rejects(resolveInside(mods, '../../../../'), /Ruta inválida/);
  await assert.rejects(resolveInside(mods, '..\\..\\..\\..\\'), /Ruta inválida/);
  await assert.rejects(resolveRelInside(path.join(tmp, 'inst'), '../../../../x'), /Ruta inválida/);
  await assert.rejects(resolveRelInside(path.join(tmp, 'inst'), '..\\..\\..\\..\\x'), /Ruta inválida/);
});

test('links inside mods/ that point outside are refused', { skip: process.platform === 'win32' }, async () => {
  const mods = path.join(tmp, 'link', 'mods');
  const outside = path.join(tmp, 'outside');
  await fsp.mkdir(mods, { recursive: true });
  await fsp.mkdir(outside, { recursive: true });
  await fsp.symlink(outside, path.join(mods, 'evil'));
  await fsp.writeFile(path.join(outside, 'f.jar'), 'x');
  await fsp.symlink(path.join(outside, 'f.jar'), path.join(mods, 'f.jar'));
  await assert.rejects(resolveInside(mods, 'f.jar'), /Ruta inválida/);
  await assert.rejects(resolveRelInside(path.dirname(mods), 'mods/evil/x.jar'), /Ruta inválida/);
});

test('.pw.toml with a traversal filename is ignored and cannot delete anything', async () => {
  const game = path.join(tmp, 'toml');
  const mods = path.join(game, 'mods');
  const index = path.join(mods, '.index');
  const victim = path.join(tmp, 'victim');
  await fsp.mkdir(index, { recursive: true });
  await fsp.mkdir(victim, { recursive: true });
  await fsp.writeFile(path.join(victim, 'keep.txt'), 'keep');
  for (const [i, bad] of ['../../../../victim', '..\\..\\..\\..\\victim', '/etc', 'C:\\Windows'].entries()) {
    await fsp.writeFile(path.join(index, `evil${i}.pw.toml`), `filename = ${JSON.stringify(bad)}\nname = "Evil"\n\n[update.modrinth]\nmod-id = "x"\nversion = "y"\n`);
  }
  await fsp.writeFile(path.join(index, 'good.pw.toml'), 'filename = "good.jar"\nname = "Good"\n');
  const meta = await readMetadata(index);
  assert.deepEqual([...meta.keys()], ['good.jar']);

  await assert.rejects(writeMetadata(index, { filename: '../../../../victim', name: 'x', provider: 'modrinth', projectId: 'x', fileId: 'y' }), /Ruta inválida/);

  const content = new Content({ locate: async () => game }, path.join(tmp, 'cache'));
  content.folderFor = async () => mods;
  for (const bad of ['../../../../victim', '..\\..\\..\\..\\victim']) {
    await assert.rejects(content.remove('x', 'mods', bad), /Ruta inválida/);
    await assert.rejects(content.setEnabled('x', 'mods', bad, false), /Ruta inválida/);
  }
  assert.equal(fs.readFileSync(path.join(victim, 'keep.txt'), 'utf8'), 'keep');
});

function makeZip(file, entries) {
  return new Promise((resolve, reject) => {
    const z = new yazl.ZipFile();
    for (const [name, body] of entries) z.addBuffer(Buffer.from(body), name, { forceDosTimestamp: true });
    z.end();
    const ws = fs.createWriteStream(file);
    z.outputStream.pipe(ws);
    ws.on('close', resolve);
    ws.on('error', reject);
  });
}

test('overrides/: traversal entries and .pw.toml pointing outside mods/ are dropped', async () => {
  const zipFile = path.join(tmp, 'pack.zip');
  // yazl refuses "../" names, so write safe placeholders and patch the bytes
  await makeZip(zipFile, [
    ['overrides/config/ok.json', '{}'],
    ['overrides/mods/.index/ok.pw.toml', 'filename = "ok.jar"\n'],
    ['overrides/mods/.index/bad.pw.toml', 'filename = "../../../../victim"\n'],
    ['overrides/mods/.index/bdw.pw.toml', "filename = '..\\..\\..\\..\\victim'\n"],
    ['overrides/AA/AA/AA/AA/escape.txt', 'pwned'],
    ['overrides/BB\\BB\\BB\\BB\\escape2.txt', 'pwned'],
  ]);
  let buf = fs.readFileSync(zipFile);
  const patch = (from, to) => {
    let i;
    while ((i = buf.indexOf(Buffer.from(from))) >= 0) Buffer.from(to).copy(buf, i);
  };
  patch('AA/AA/AA/AA/', '../../../../');
  patch('BB\\BB\\BB\\BB\\', '..\\..\\..\\..\\');
  fs.writeFileSync(zipFile, buf);

  const game = path.join(tmp, 'extract', 'a', 'b', 'c', 'game');
  await fsp.mkdir(game, { recursive: true });
  // the zip reader may refuse the whole archive; either way nothing escapes
  await extractPrefix(zipFile, 'overrides/', game).catch(() => {});
  for (const f of fs.readdirSync(path.join(tmp, 'extract'), { recursive: true })) assert.ok(!String(f).includes('escape'), f);
  assert.ok(!fs.existsSync(path.join(tmp, 'escape.txt')));

  // same pack without the traversal entries: the bad metadata is still dropped
  const zip2 = path.join(tmp, 'pack2.zip');
  await makeZip(zip2, [
    ['overrides/config/ok.json', '{}'],
    ['overrides/mods/.index/ok.pw.toml', 'filename = "ok.jar"\n'],
    ['overrides/mods/.index/bad.pw.toml', 'filename = "../../../../victim"\n'],
    ['overrides/mods/.index/bdw.pw.toml', "filename = '..\\..\\..\\..\\victim'\n"],
  ]);
  await extractPrefix(zip2, 'overrides/', game);
  assert.ok(fs.existsSync(path.join(game, 'config', 'ok.json')));
  assert.ok(fs.existsSync(path.join(game, 'mods', '.index', 'ok.pw.toml')));
  assert.ok(!fs.existsSync(path.join(game, 'mods', '.index', 'bad.pw.toml')));
  assert.ok(!fs.existsSync(path.join(game, 'mods', '.index', 'bdw.pw.toml')));
});

test('tomlFileName reads both string styles', () => {
  assert.equal(tomlFileName('filename = "a.jar"'), 'a.jar');
  assert.equal(tomlFileName("name='x'\nfilename = '..\\\\x'"), '..\\\\x');
  assert.equal(tomlFileName('name = "x"'), null);
});

// A folder still to be created, reached through a link (or, on Windows, a
// short 8.3 name such as RUNNER~1 in the temp folder): what goes inside it is
// inside. Both paths are resolved the same way before they are compared.
test('a new folder behind a link: what goes inside it is accepted', async () => {
  const { assertInside } = require('../src/main/util/safepath');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'havihub-safepath-link-'));
  fs.mkdirSync(path.join(base, 'real'));
  fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const root = path.join(base, 'link', 'new-folder');
  const target = path.join(root, 'sub', 'a.txt');
  assert.equal(await assertInside(root, target), target);
  // and a link inside it that leads out is still refused
  fs.mkdirSync(path.join(base, 'outside'));
  fs.mkdirSync(path.join(base, 'real', 'pack'));
  fs.symlinkSync(path.join(base, 'outside'), path.join(base, 'real', 'pack', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(assertInside(path.join(base, 'link', 'pack'), path.join(base, 'link', 'pack', 'escape', 'a.txt')), { code: 'EUNSAFEPATH' });
  fs.rmSync(base, { recursive: true, force: true });
});
