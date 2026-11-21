// The yearly notice about the Halloween scare, the well-known servers in the
// main list, the support card, the aligned theme presets and same-size theme icons.
//   xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/e2e-misc.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'havihub-misc'));
fs.mkdirSync(out, { recursive: true });
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
};

// a fresh copy of the app: its own data, and the clock at `fakeDate` when given
async function start(fakeDate = '', env = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'havihub-misc-'));
  const data = path.join(work, 'PrismLauncher');
  execFileSync(process.execPath, [path.join(root, 'scripts/make-fixtures.mjs'), data]);
  fs.mkdirSync(path.join(work, 'userdata'), { recursive: true });
  fs.writeFileSync(path.join(work, 'userdata', 'config.json'), JSON.stringify({ closeToTray: false, importPromptDone: true, layout: 'curseforge', themePreset: 'forge' }));
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(root, 'dist/main.js'), '--no-sandbox', '--lang=es-CL', '--force-device-scale-factor=1.25', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    env: { ...process.env, HAVIHUB_USER_DATA: path.join(work, 'userdata'), HAVIHUB_PRISM_DIR: data, HAVIHUB_PRISM_EXE: path.join(data, 'prismlauncher'), HAVIHUB_MOCK_NET: path.join(root, 'scripts/mock-net.cjs'), HAVIHUB_TEST_CF_KEY: 'test-key', HAVIHUB_FAKE_DATE: fakeDate, HAVIHUB_MC_ASSETS: process.env.HAVIHUB_MC_ASSETS || '', ...env },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1536, 864));
  await page.waitForSelector('.inst-card, .group-card', { timeout: 20000 });
  const config = () => JSON.parse(fs.readFileSync(path.join(work, 'userdata', 'config.json'), 'utf8'));
  const stop = async () => {
    await app.close().catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
  };
  return { app, page, config, stop };
}

// ---- the notice about the scare: not at start, only once the Halloween week begins
{
  const s = await start('2026-10-20T12:00:00', { HAVIHUB_SCARE_NOTICE: '1' });
  try {
    await s.page.waitForTimeout(4000);
    check('no notice about the scare before the Halloween week', (await s.page.locator('.modal').count()) === 0);
  } catch (e) {
    console.error('FAILED', e.message.slice(0, 500));
    failed++;
  }
  await s.stop();
}
{
  const s = await start('2026-10-25T10:00:00', { HAVIHUB_SCARE_NOTICE: '1' });
  try {
    await s.page.waitForSelector('.modal', { timeout: 8000 });
    const text = await s.page.locator('.modal').innerText();
    check('the notice about the scare shows when the Halloween week begins', /sustos en la semana de Halloween/.test(text) && /epilepsia/.test(text));
    await s.page.screenshot({ path: path.join(out, 'scare-notice.png') });
    await s.page.locator('.modal button', { hasText: 'Desactivar los sustos' }).click();
    await s.page.waitForTimeout(700);
    const c = s.config();
    check('"Desactivar los sustos" turns them off, and this year\'s notice is answered', c.seasons.scares === false && c.scareNotice === '2026');
  } catch (e) {
    console.error('FAILED', e.message.slice(0, 500));
    failed++;
  }
  await s.stop();
}

const { page, stop } = await start();
try {
  // ---- the support card (home)
  await page.evaluate(() => document.querySelector('[aria-label="Inicio"]').click());
  await page.waitForSelector('.mr-support');
  check('the support card is under the channels, with one clear button', (await page.locator('.cf-socials .mr-social ~ .mr-support .mr-support-btn').count()) === 1 && /Ko-fi/.test(await page.locator('.mr-support-btn').innerText()));
  await page.locator('.mr-support').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'support.png') });
  // ---- well-known servers, in the main list
  await page.locator('.side-game').click();
  await page.locator('.top-tab', { hasText: 'Servidores' }).click();
  await page.waitForSelector('.page.servers .srv-row.known');
  const tabs = await page.locator('.page.servers .browse-top .tab').allInnerTexts();
  check('two tabs: Descubrir and Mis servidores', tabs.map((x) => x.trim()).join('|') === 'Descubrir|Mis servidores', tabs.join(' | '));
  const all = await page.locator('.srv-row.known').count();
  const names = await page.locator('.srv-row .srv-title').allTextContents();
  check('the well-known servers are in the list', all >= 28 && ['Hypixel', 'CubeCraft Games', 'UniversoCraft', 'LibreCraft'].some((n) => names.includes(n)) && ['CubeCraft Games', 'UniversoCraft', 'LibreCraft'].every((n) => names.includes(n)), `${all} servers`);
  const addresses = await page.evaluate(() => [...document.querySelectorAll('.srv-row')].map((r) => (r.querySelector('.known-ip') || {}).textContent || r.querySelector('.srv-title').textContent));
  check('no server is listed twice (Hypixel is also in the directory)', names.filter((n) => /hypixel/i.test(n)).length === 1 && new Set(addresses).size === addresses.length, names.filter((n) => /hypixel/i.test(n)).join(', '));
  await page.locator('.page.servers .browse-top').screenshot({ path: path.join(out, 'servers-tabs.png') });
  await page.screenshot({ path: path.join(out, 'known-servers.png') });
  await page.getByPlaceholder('Buscar servidores…').fill('universo');
  await page.waitForFunction(() => document.querySelectorAll('.srv-row').length === 1, null, { timeout: 8000 }).catch(() => {});
  check('the search finds a well-known server', (await page.locator('.srv-row.known', { hasText: 'UniversoCraft' }).count()) === 1 && (await page.locator('.srv-row').count()) === 1);
  await page.getByPlaceholder('Buscar servidores…').fill('');
  // ---- theme presets: two rows of five, CurseForge above Modrinth; theme icons of one size
  await page.locator('.side-btn[aria-label="Ajustes"]').click();
  await page.waitForSelector('.settings');
  await page.locator('.settings-item', { hasText: 'Temas' }).click();
  await page.waitForSelector('.preset-grid .preset');
  const grid = await page.evaluate(() => [...document.querySelectorAll('.preset-grid .preset')].map((b) => { const r = b.getBoundingClientRect(); return { name: b.innerText.trim(), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }));
  const rows = [...new Set(grid.map((g) => g.y))];
  check('presets: two rows of five, all the same size', grid.length === 10 && rows.length === 2 && new Set(grid.map((g) => `${g.w}x${g.h}`)).size === 1, grid.map((g) => g.name).join(' | '));
  const top = grid.filter((g) => g.y === rows[0]);
  const bottom = grid.filter((g) => g.y === rows[1]);
  check('each CurseForge theme is above its Modrinth counterpart', ['original', 'OLED', 'claro'].every((k, i) => top[i].name.includes('CurseForge') && top[i].name.includes(k) && bottom[i].name.includes('Modrinth') && bottom[i].name.toLowerCase().includes(k.toLowerCase()) && top[i].x === bottom[i].x));
  const icons = await page.evaluate(() => [...document.querySelectorAll('.season-row > .mc-art, .season-row > .pixels')].map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }));
  // the game's own art keeps its shape: each one fills the same 44 px box on its longer side
  const longest = icons.map((x) => Math.max(...x.split('x').map(Number)));
  check('the three theme pictures are the same size', icons.length === 3 && Math.max(...longest) - Math.min(...longest) <= 1, icons.join(' '));
  await page.locator('.season-row').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'themes.png') });
  // ---- licenses: every bundled library, the full texts and the notices
  await page.locator('.settings-licenses').click();
  await page.waitForSelector('.license-row');
  await page.waitForFunction(() => document.querySelectorAll('.license-row').length > 10);
  const libs = await page.locator('.license-row').allInnerTexts();
  check('the licenses list names every bundled library', ['three', 'skinview3d', 'react', 'marked', 'dompurify', 'yauzl', 'smol-toml'].every((n) => libs.some((r) => r.startsWith(n))), `${libs.length} rows`);
  const dlg = await page.locator('.modal').innerText();
  check('…says it is not an official Minecraft product, nor Prism Launcher', /NO ES UN PRODUCTO OFICIAL DE MINECRAFT/.test(dlg) && /no es Prism Launcher/.test(dlg));
  check('…starts with Havi Hub\'s own license (GPL-3.0, no warranty)', /Havi Hub © 2026 Havikun/.test(dlg) && /GPL-3\.0/.test(dlg) && /sin ninguna garantía/.test(dlg));
  await page.locator('.modal button', { hasText: 'Ver la licencia de Havi Hub' }).click();
  await page.waitForSelector('.own-license .license-texts');
  check('…and shows its full text', /GNU GENERAL PUBLIC LICENSE/.test(await page.locator('.own-license .license-texts').innerText()));
  await page.locator('.modal button', { hasText: 'Ver los textos completos' }).click();
  await page.waitForFunction(() => !document.querySelector('.own-license .license-texts') && /Permission/.test((document.querySelector('.license-texts') || {}).innerText || ''));
  check('…and shows the full license texts', /Permission is hereby granted/.test(await page.locator('.license-texts').last().innerText()));
  await page.screenshot({ path: path.join(out, 'licenses.png') });
  await page.keyboard.press('Escape');
} catch (e) {
  console.error('FAILED', e.message.slice(0, 500));
  failed++;
}
await stop();
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
