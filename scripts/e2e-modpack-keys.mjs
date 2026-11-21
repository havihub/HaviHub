// Installing a modpack that brings its own key bindings, for someone who has
// key bindings of their own (Ajustes → Minecraft → Teclas): the window asks
// whose to use, and "Mis teclas" puts the person's in the new profile.
//   xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/e2e-modpack-keys.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const { writeZip } = require('../src/main/util/zip');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'havihub-modpack-keys'));
fs.mkdirSync(out, { recursive: true });
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'havihub-modpack-keys-'));
const data = path.join(work, 'PrismLauncher');
execFileSync(process.execPath, [path.join(root, 'scripts/make-fixtures.mjs'), data]);
fs.mkdirSync(path.join(work, 'userdata'), { recursive: true });
fs.writeFileSync(path.join(work, 'userdata', 'config.json'), JSON.stringify({ closeToTray: false, importPromptDone: true, layout: 'curseforge', themePreset: 'forge', inGameDefaults: { enabled: true, keys: { 'key.drop': 'key.keyboard.g' } } }));

// a modpack whose options.txt has its author's key for "drop"
const archive = path.join(work, 'Keys pack.mrpack');
const index = { formatVersion: 1, game: 'minecraft', versionId: '1.0', name: 'Keys pack', dependencies: { minecraft: '26.2', 'fabric-loader': '0.20.1' }, files: [] };
await writeZip(archive, [
  { name: 'modrinth.index.json', buffer: Buffer.from(JSON.stringify(index)) },
  { name: 'overrides/options.txt', buffer: Buffer.from('fov:0.0\nkey_key.drop:key.keyboard.q\n') },
]);

const app = await electron.launch({
  executablePath: require('electron'),
  args: [path.join(root, 'dist/main.js'), '--no-sandbox', '--lang=es-CL', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  env: { ...process.env, HAVIHUB_USER_DATA: path.join(work, 'userdata'), HAVIHUB_PRISM_DIR: data, HAVIHUB_PRISM_EXE: path.join(data, 'prismlauncher'), HAVIHUB_MOCK_NET: path.join(root, 'scripts/mock-net.cjs'), HAVIHUB_TEST_CF_KEY: 'test-key' },
});
await app.evaluate(({ dialog }, file) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
}, archive);
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1536, 864));
const optionsOf = () => {
  const dir = fs.readdirSync(path.join(data, 'instances')).find((d) => d.startsWith('Keys pack'));
  return dir ? fs.readFileSync(path.join(data, 'instances', dir, 'minecraft', 'options.txt'), 'utf8') : '';
};

try {
  await page.waitForSelector('.inst-card, .group-card', { timeout: 20000 });
  await page.locator('.toolbar button', { hasText: 'Importar' }).click();
  await page.locator('.menu-item', { hasText: 'Desde un archivo' }).click();
  await page.waitForSelector('.modal');
  const text = await page.locator('.modal').innerText();
  check('the window asks whose key bindings to use', /¿Qué teclas quieres usar en Keys pack\?/.test(text));
  check("until then, the pack's own stay", /key_key\.drop:key\.keyboard\.q/.test(optionsOf()));
  await page.screenshot({ path: path.join(out, 'modpack-keys.png') });
  await page.locator('.modal button', { hasText: 'Mis teclas' }).click();
  await page.waitForTimeout(1500);
  const after = optionsOf();
  check('"Mis teclas" puts the person\'s in the profile, the pack\'s other options stay', /key_key\.drop:key\.keyboard\.g/.test(after) && /fov:0\.0/.test(after), after.replace(/\n/g, ' | '));
} catch (e) {
  console.error('FAILED', e.message.slice(0, 800));
  await page.screenshot({ path: path.join(out, 'modpack-keys-failed.png') }).catch(() => {});
  failed++;
}
await app.close().catch(() => {});
fs.rmSync(work, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
