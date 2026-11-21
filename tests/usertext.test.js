// Texts of the main process that the interface translates (src/shared/usertext.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tr, plain, textOf, UserError } = require('../src/shared/usertext');
const { TaskManager } = require('../src/main/tasks');

test('a UserError keeps its Spanish message and the template the interface translates', () => {
  const e = new UserError('{name} tiene que iniciar sesión de nuevo.', { name: 'Steve' }, { code: 'NEEDS_LOGIN' });
  assert.ok(e instanceof Error);
  assert.equal(e.message, 'Steve tiene que iniciar sesión de nuevo.');
  assert.equal(e.code, 'NEEDS_LOGIN');
  assert.deepEqual(e.i18n, { text: '{name} tiene que iniciar sesión de nuevo.', vars: { name: 'Steve' } });
  // it can go to the interface as it is (structured clone, as IPC does)
  assert.deepEqual(structuredClone(e.i18n), e.i18n);
});

test('plain and textOf take texts, errors and strings', () => {
  assert.equal(plain(tr('Instalando {name}', { name: 'Sodium' })), 'Instalando Sodium');
  assert.equal(plain(new Error('x')), 'x');
  assert.equal(plain(null), '');
  assert.deepEqual(textOf('Ruta inválida'), { text: 'Ruta inválida' });
  assert.deepEqual(textOf(new UserError('Ruta inválida')), { text: 'Ruta inválida' });
  assert.deepEqual(textOf(new Error('boom')), { text: 'boom' });
});

test('a task keeps its texts in Spanish and as templates', async () => {
  const sent = [];
  const tasks = new TaskManager((channel, list) => sent.push(list));
  await assert.rejects(
    tasks.run(tr('Importando {file}', { file: 'pack.zip' }), {}, async (task) => {
      task.progress(0.5, tr('Descargando {file}', { file: 'a.jar' }));
      const t = tasks.list().find((x) => x.id === task.id);
      assert.equal(t.title, 'Importando pack.zip');
      assert.deepEqual(t.titleText, { text: 'Importando {file}', vars: { file: 'pack.zip' } });
      assert.equal(t.detail, 'Descargando a.jar');
      assert.deepEqual(t.detailText, { text: 'Descargando {file}', vars: { file: 'a.jar' } });
      throw new UserError('El archivo no coincide con su hash ({file})', { file: 'a.jar' });
    }),
  );
  const t = tasks.list()[0];
  assert.equal(t.status, 'error');
  assert.equal(t.error, 'El archivo no coincide con su hash (a.jar)');
  assert.deepEqual(t.errorText, { text: 'El archivo no coincide con su hash ({file})', vars: { file: 'a.jar' } });
  // plain strings still work, as before
  await tasks.run('Algo', {}, async (task) => task.progress(1, ''));
  const plainTask = tasks.list().find((x) => x.title === 'Algo');
  assert.deepEqual(plainTask.titleText, { text: 'Algo' });
  assert.equal(plainTask.detailText, null);
});

// Every text the main process shows has its English translation (run
// scripts/i18n/gen.mjs and add the missing ones to src/renderer/lib/i18n-en.js).
test('every text of the main process has an English translation', () => {
  const root = path.join(__dirname, '..');
  const txt = fs.readFileSync(path.join(root, 'src/renderer/lib/i18n-en.js'), 'utf8');
  const en = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(path.join(root, 'src/main'));
  const missing = [];
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b(?:tr|UserError)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const text = m[2].replace(/\\(['"`\\])/g, '$1');
      assert.ok(!text.includes('${'), `${path.relative(root, f)}: a template literal cannot be translated: ${text}`);
      if (!(text in en)) missing.push(`${path.relative(root, f)}: ${text}`);
    }
  }
  assert.deepEqual(missing, []);
});
