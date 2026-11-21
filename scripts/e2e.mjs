// Drives the real Electron app with fixture data + offline API mock and saves
// screenshots of every page. Usage (Linux): xvfb-run -s "-screen 0 1920x1080x24" node scripts/e2e.mjs [outDir] [steps]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'havihub-shots'));
const only = process.argv[3] ? process.argv[3].split(',') : null;
fs.mkdirSync(out, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'havihub-e2e-'));
const data = path.join(work, 'PrismLauncher');
execFileSync(process.execPath, [path.join(root, 'scripts/make-fixtures.mjs'), data]);
// a second copy plays the user's existing Prism Launcher (import source)
const oldPrism = path.join(work, 'OldPrismLauncher');
execFileSync(process.execPath, [path.join(root, 'scripts/make-fixtures.mjs'), oldPrism]);
// and a CurseForge app + Modrinth App with a few profiles
const others = path.join(work, 'others');
execFileSync(process.execPath, ['--no-warnings', path.join(root, 'scripts/make-import-fixtures.mjs'), others]);
// Emulate the user's screen: Windows at 125% on a 1920x1080 display
const DSF = process.env.HAVIHUB_E2E_DSF || '1.25';
const WIN_W = Number(process.env.HAVIHUB_E2E_W || 1536);
const WIN_H = Number(process.env.HAVIHUB_E2E_H || 864);

// the first-start question about the X is covered by e2e-welcome.mjs
fs.mkdirSync(path.join(work, 'userdata'), { recursive: true });
fs.writeFileSync(path.join(work, 'userdata', 'config.json'), JSON.stringify({ closeToTray: false, layout: 'curseforge' }));

const app = await electron.launch({
  executablePath: require('electron'),
  args: [process.env.HAVIHUB_E2E_APP || path.join(root, 'dist/main.js'), '--no-sandbox', '--lang=es-CL', `--force-device-scale-factor=${DSF}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: {
    ...process.env,
    HAVIHUB_USER_DATA: path.join(work, 'userdata'),
    HAVIHUB_PRISM_DIR: data,
    HAVIHUB_PRISM_EXE: path.join(data, 'prismlauncher'),
    HAVIHUB_MOCK_NET: path.join(root, 'scripts/mock-net.cjs'),
    HAVIHUB_TEST_CF_KEY: process.env.HAVIHUB_TEST_CF_KEY ?? 'test-key',
    HAVIHUB_IMPORT_DIRS: oldPrism,
    HAVIHUB_IMPORT_CF_DIRS: path.join(others, 'curseforge', 'minecraft', 'Instances'),
    HAVIHUB_IMPORT_MR_DIRS: path.join(others, 'ModrinthApp'),
  },
});

const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
await app.evaluate(({ BrowserWindow }, [w0, h0]) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(w0, h0);
  w.center();
}, [WIN_W, WIN_H]);
await page.waitForSelector('.inst-card', { timeout: 20000 });
await page.waitForTimeout(800);

// Playwright sizes Electron screenshots as CSS viewport x DSF, which ignores
// the app zoom; clipping to the window keeps exactly what is on screen.
const shot = async (name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(out, `${name}.png`), clip: { x: 0, y: 0, width: WIN_W, height: WIN_H } });
  console.log('shot', name);
};
// CSS :hover is lost when Playwright takes a screenshot; Electron's own
// capture keeps it (used for hover effects and tooltips)
const cap = async (name, wait = 450) => {
  await page.waitForTimeout(wait);
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(b64, 'base64'));
  console.log('cap', name);
};
const want = (n) => !only || only.includes(n);
const clickText = async (text, opts = {}) => page.getByText(text, { exact: true, ...opts }).first().click();

try {
  if (want('library')) await shot('01-library');

  if (want('hover')) {
    await page.locator('.group-card', { hasText: 'Vanilla' }).click();
    const card = page.locator('.inst-card', { hasText: '[26.2] Vanilla' });
    await card.hover();
    await cap('01b-card-hover', 1400);
    await card.locator('.card-play-drop').click();
    await page.waitForSelector('.card-play-pop .play-row', { timeout: 10000 });
    await shot('01c-card-worlds');
    await page.keyboard.press('Escape');
    await page.mouse.move(5, 5);
    await card.locator('.inst-check').click({ force: true });
    await page.waitForTimeout(300);
    await shot('01d-card-selected');
    await page.locator('.select-bar .btn', { hasText: 'Cancelar' }).click();
    await page.locator('.crumb').first().click();
  }

  if (want('group')) {
    await page.locator('.group-card', { hasText: 'Vanilla' }).click();
    await shot('02-group-vanilla');
    await page.locator('.crumb').first().click();
  }

  if (want('instance')) {
    await page.locator('.inst-card').first().click();
    // open the 26.2 Vanilla instance via group
    await page.locator('.top-tab').first().click();
    await page.locator('.group-card', { hasText: 'Vanilla' }).click();
    await page.locator('.inst-card', { hasText: '[26.2] Vanilla' }).click();
    await page.waitForSelector('.ctable-row');
    await page.waitForTimeout(1500);
    await shot('03-instance-mods');
    await page.locator('.kebab').click();
    await shot('04-instance-kebab');
    await page.keyboard.press('Escape');
    await page.locator('.play-drop').click();
    await shot('05-play-dropdown');
    await page.keyboard.press('Escape');
    await page.locator('.subtab', { hasText: 'Resource Packs' }).click();
    await shot('06-resourcepacks');
    await page.locator('.subtab', { hasText: 'Mundos' }).click();
    await shot('07-worlds');
    await page.locator('.subtab', { hasText: 'Data Packs' }).click();
    await shot('07b-datapacks');
    await page.locator('.tab', { hasText: 'Logs' }).click();
    await page.waitForSelector('.log-line');
    await shot('08-logs');
    await page.locator('.recent-logs').click();
    await shot('08b-recent-logs');
    await page.keyboard.press('Escape');
    await page.locator('.tab', { hasText: 'Capturas' }).click();
    await page.waitForSelector('.shot img');
    await shot('09-screenshots');
    await page.locator('.shot').first().click();
    await shot('09b-lightbox');
    await page.keyboard.press('Escape');
    await page.locator('.tab', { hasText: 'Contenido' }).click();
    await page.locator('.subtab', { hasText: 'Mods' }).click();
  }

  if (want('options')) {
    if (!(await page.locator('.kebab').count())) {
      await page.locator('.group-card', { hasText: 'Vanilla' }).click();
      await page.locator('.inst-card', { hasText: '[26.2] Vanilla' }).click();
      await page.waitForSelector('.kebab');
    }
    await page.locator('.kebab').click();
    await clickText('Opciones del perfil');
    await page.waitForSelector('.options-layout');
    await shot('10-profile-options');
    await page.locator('.options-nav-item', { hasText: 'Java y memoria' }).click();
    await shot('10b-profile-java');
    await page.keyboard.press('Escape');
    // one option for both: the icon editor, which leads to uploading a picture
    await page.locator('.kebab').click();
    await clickText('Cambiar ícono…');
    await page.waitForSelector('.icon-editor .ie-sym');
    await shot('11b-edit-icon');
    await page.locator('.icon-editor .btn', { hasText: 'Usar una imagen propia…' }).click();
    await page.waitForSelector('.cropper');
    await shot('11-change-image');
    await page.keyboard.press('Escape');
  }

  if (want('discover')) {
    await page.locator('.top-tab', { hasText: 'Descubrir' }).click();
    await page.waitForSelector('.carousel-card', { timeout: 15000 });
    await page.waitForTimeout(800);
    await shot('12-discover');
  }

  if (want('browse')) {
    await page.locator('.top-tab', { hasText: 'Explorar' }).click();
    await page.waitForSelector('.proj-row', { timeout: 15000 });
    await shot('13-browse-both');
    await page.locator('.proj-row').first().click();
    await page.waitForSelector('.project-head');
    await page.waitForTimeout(500);
    await shot('14-project');
    await page.locator('.tab', { hasText: 'Versiones' }).click();
    await page.waitForSelector('.version-item', { timeout: 15000 });
    await shot('14b-project-versions');
    // filters: game version + loader
    await page.locator('.version-filters .select').nth(1).click();
    await page.locator('.select-menu .menu-item', { hasText: 'NeoForge' }).first().click();
    await page.waitForTimeout(600);
    await shot('14c-project-versions-neoforge');
  }

  if (want('targets')) {
    // Explorar → Mods → Instalar…: only profiles that can use the mod can be picked
    await page.locator('.top-tab', { hasText: 'Explorar' }).click();
    await page.locator('.tabs .tab', { hasText: /^Mods$/ }).click();
    await page.waitForSelector('.proj-row', { timeout: 15000 });
    await page.locator('.proj-row').first().locator('.btn', { hasText: 'Instalar' }).click();
    await page.waitForSelector('.target-list', { timeout: 10000 });
    const pickable = await page.locator('.target-row:not(.disabled) strong').allTextContents();
    if (await page.locator('.target-toggle').count()) await page.locator('.target-toggle').click().catch(() => {});
    const refused = await page.locator('.target-row.disabled').allTextContents();
    console.log('install targets:', pickable.join(' | '), '|| not compatible:', refused.map((x) => x.replace(/\s+/g, ' ').trim()).join(' | '));
    if (pickable.some((x) => /PVP/.test(x))) throw new Error('a vanilla profile was offered for a mod');
    if (!refused.some((x) => /PVP/.test(x) && /vanilla/i.test(x))) throw new Error('the vanilla profile is not listed as not compatible');
    await shot('14d-install-targets');
    await page.locator('.modal-foot .btn', { hasText: 'Cancelar' }).click();
  }

  if (want('skins')) {
    await page.locator('.top-tab', { hasText: 'Skins' }).click();
    await page.waitForSelector('.skin-card img', { timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot('15-skins-night');
    await page.locator('.skin-tool.wide').click();
    await shot('16-skins-capes');
    await page.keyboard.press('Escape');
    await page.locator('.skin-tool').nth(1).click(); // elytra
    await page.locator('.skin-tool').nth(2).click(); // background menu
    await clickText('Cielo de día');
    await page.waitForTimeout(800);
    await shot('17-skins-day-elytra');
    await page.locator('.skin-tool').nth(2).click();
    await clickText('Sin fondo');
    await page.locator('.skin-tool').nth(4).click(); // slim
    await page.locator('.skin-card', { hasText: 'verde slim' }).click();
    await page.waitForTimeout(800);
    await shot('18-skins-none-slim');
  }

  if (want('servers')) {
    await page.locator('.top-tab', { hasText: 'Servidores' }).click();
    await page.waitForSelector('.srv-row', { timeout: 15000 });
    await page.waitForSelector('.ping-chip.good, .ping-chip.ok, .ping-chip.bad', { timeout: 15000 });
    await page.waitForTimeout(800);
    await shot('19-servers-discover');
    const n = await page.locator('.srv-row:not(.known)').count();
    if (n !== 6) throw new Error(`discover shows ${n} directory servers (6 online expected)`);
    // the well-known servers are in the same list, each once (Hypixel is also in the directory)
    const known = await page.locator('.srv-row.known').count();
    if (known < 28) throw new Error(`only ${known} well-known servers in the list`);
    if ((await page.locator('.srv-row', { hasText: 'Hypixel' }).count()) !== 1) throw new Error('Hypixel is listed twice');
    if (await page.locator('.page.servers .browse-top .tab', { hasText: 'Conocidos' }).count()) throw new Error('the "Conocidos" tab is still there');
    // filters: Spanish-speaking servers in Europe
    await page.locator('.srv-filters .select').nth(3).click();
    await page.locator('.select-menu .menu-item', { hasText: 'Europa' }).click();
    await page.waitForTimeout(900);
    if ((await page.locator('.srv-row').count()) !== 2) throw new Error('region filter');
    await page.locator('.srv-head .link-btn', { hasText: 'Quitar filtros' }).click();
    await page.waitForSelector('.srv-row >> nth=4');
    // play a vanilla server: pick the 1.21.8 instance
    await page.locator('.srv-row', { hasText: 'PvP Arena Club' }).locator('.btn', { hasText: 'Jugar' }).click();
    await page.waitForSelector('.sid-row');
    await shot('19b-servers-pick-instance');
    await page.locator('.sid-row', { hasText: '[1.21.8] PVP' }).click();
    await page.locator('.modal .btn-primary', { hasText: 'Jugar' }).click();
    await page.waitForSelector('.modal', { state: 'detached' });
    await page.waitForTimeout(2500);
    const cfg = fs.readFileSync(path.join(data, 'instances', '1.21.8 PVP', 'instance.cfg'), 'utf8');
    if (!/HaviHubServer=srvA0002/.test(cfg)) throw new Error('the server was not linked to the instance');
    const listed = await page.evaluate(() => window.havihub.call('servers.list', '1.21.8 PVP'));
    if (!listed.value.some((x) => x.ip === 'pvp.arenaclub.example')) throw new Error('the server was not added to the multiplayer list');
    await shot('19c-servers-playing');
    // add another one to an instance's list
    await page.locator('.srv-row', { hasText: 'Reino Técnico' }).locator('.icon-btn[aria-label="Agregar a una instancia"]').click();
    await page.waitForSelector('.sid-row');
    await shot('19d-servers-add');
    await page.keyboard.press('Escape');
    await page.locator('.tab', { hasText: 'Mis servidores' }).click();
    await page.waitForSelector('.server-row', { timeout: 15000 });
    await shot('19e-servers-saved');
    await page.locator('.tab', { hasText: 'Descubrir' }).click();
  }

  if (want('gallery')) {
    await page.locator('.top-tab', { hasText: 'Capturas' }).click();
    await page.waitForSelector('.gallery-shot img', { timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot('29a-gallery');
    const n = await page.locator('.gallery-shot').count();
    if (n !== 11) throw new Error(`gallery shows ${n} screenshots, expected 11`);
    await page.locator('.gallery-shot').first().hover();
    await cap('29b-gallery-hover', 700);
    await page.locator('.gf-inst').click();
    await page.locator('.select-menu .menu-item', { hasText: 'Cave Dread' }).click();
    await page.waitForTimeout(400);
    if ((await page.locator('.gallery-shot').count()) !== 4) throw new Error('instance filter');
    await page.locator('.gf-date').click();
    await shot('29c-gallery-dates');
    await page.locator('.select-menu .menu-item', { hasText: 'Hoy' }).click();
    await page.waitForTimeout(400);
    const today = await page.locator('.gallery-shot').count();
    await shot('29d-gallery-filtered');
    if (today < 1 || today > 2) throw new Error(`today filter shows ${today}`);
    await page.locator('.gf-date').click();
    await page.locator('.select-menu .menu-item', { hasText: 'Cualquier fecha' }).click();
    await page.locator('.gallery-shot').first().click();
    await page.waitForSelector('.lightbox-img');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    await shot('29e-gallery-lightbox');
    const pos = await page.locator('.lightbox-pos').textContent();
    if (!/^2 de 4/.test(pos.trim())) throw new Error(`lightbox position ${pos}`);
    // zoom: the mouse wheel over the picture
    const box = await page.locator('.lightbox-img').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(400);
    await shot('29f-lightbox-zoom');
    const tf = await page.locator('.lightbox-img').evaluate((e) => e.style.transform);
    if (!/scale\(1\.[1-9]/.test(tf)) throw new Error(`lightbox zoom ${tf}`);
    await page.keyboard.press('Escape');
    await page.locator('.gf-inst').click();
    await page.locator('.select-menu .menu-item', { hasText: 'Todas las instancias' }).click();
  }

  if (want('settings')) {
    await page.locator('.side-btn[aria-label="Ajustes"]').click();
    await page.waitForSelector('.settings');
    await shot('20-settings-launcher');
    await page.locator('.settings-item', { hasText: 'Minecraft' }).click();
    await shot('21-settings-minecraft');
    await page.locator('.settings-content').evaluate((el) => (el.scrollTop = 900));
    await shot('21b-settings-minecraft-sound');
    await page.locator('.settings-item', { hasText: 'Java y memoria' }).click();
    await shot('22-settings-java');
    await page.locator('.settings-item', { hasText: 'Temas' }).click();
    await shot('23-settings-themes');
    await page.locator('.settings-item', { hasText: 'Addons' }).click();
    await shot('24-settings-addons');
    // try a different theme preset then come back
    await page.locator('.settings-item', { hasText: 'Temas' }).click();
    await page.locator('.preset').filter({ hasText: /^Esmeralda/ }).click();
    await page.locator('.settings-close').click();
    await page.waitForTimeout(600);
    await shot('25-library-emerald');
    await page.locator('.side-btn[aria-label="Ajustes"]').click();
    await page.locator('.settings-item', { hasText: 'Temas' }).click();
    await page.locator('.preset').filter({ hasText: /^CurseForge \(original\)/ }).click();
    await page.locator('.settings-close').click();
  }

  if (want('create')) {
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    await page.locator('.toolbar .btn', { hasText: 'Crear' }).first().click();
    await page.waitForSelector('.version-row', { timeout: 15000 });
    await page.locator('.loader-opt', { hasText: 'Fabric' }).click();
    await page.waitForTimeout(800);
    await shot('26-create-instance');
    await page.keyboard.press('Escape');
  }

  if (want('icons')) {
    // the new instance gets a generated icon; the editor changes it
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    await page.locator('.toolbar .btn', { hasText: 'Crear' }).first().click();
    await page.waitForSelector('.version-row', { timeout: 15000 });
    await page.locator('.create-left input').first().fill('Prueba de ícono');
    await shot('28a-create-icon');
    await page.locator('.create-icon-actions .btn', { hasText: 'Cambiar ícono' }).click();
    await page.waitForSelector('.icon-editor .ie-sym');
    await shot('28b-icon-editor');
    await page.locator('.ie-bg[aria-label="Morado"]').click();
    await page.locator('.ie-sym[aria-label="Casa"]').click();
    await page.locator('.ie-sym[aria-label="Casa"]').hover();
    await cap('28c-icon-editor-picked', 600);
    await page.locator('.ie-main').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await shot('28d-icon-editor-items');
    await page.locator('.icon-editor .btn', { hasText: 'Guardar ícono' }).click();
    await page.waitForSelector('.icon-editor', { state: 'detached' });
    await shot('28e-create-with-icon');
    await page.locator('.modal .btn-primary', { hasText: 'Crear' }).click();
    await page.waitForSelector('.modal', { state: 'detached', timeout: 20000 });
    await page.waitForTimeout(1200);
    const instDir = path.join(data, 'instances');
    const id = fs.readdirSync(instDir).find((d) => d.startsWith('Prueba de'));
    const cfg = fs.readFileSync(path.join(instDir, id, 'instance.cfg'), 'utf8');
    const key = /iconKey=(.*)/.exec(cfg)[1].trim();
    const recipe = /HaviHubIcon=(.*)/.exec(cfg);
    const png = fs.readFileSync(path.join(data, 'icons', `${key}.png`));
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    console.log('icon', key, recipe && recipe[1], `${w}x${h}`, png.length, 'bytes');
    if (!recipe || recipe[1].trim() !== 'purple/house' || w !== 512 || h !== 512) throw new Error('generated icon was not saved as expected');
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    await page.waitForTimeout(600);
    await shot('28f-library-icons');
    // edit it again from the context menu
    await page.locator('.inst-card', { hasText: 'Prueba de ícono' }).click({ button: 'right' });
    await page.locator('.menu-item', { hasText: 'Cambiar ícono…' }).click();
    await page.waitForSelector('.icon-editor .ie-sym.on');
    const sel = await page.locator('.ie-sym.on').getAttribute('aria-label');
    const selBg = await page.locator('.ie-bg.on').getAttribute('aria-label');
    if (sel !== 'Casa' || selBg !== 'Morado') throw new Error(`editor opened with ${selBg}/${sel}`);
    await page.locator('.ie-bg[aria-label="Celeste"]').click();
    await page.locator('.ie-sym[aria-label="Cohete"]').click();
    await shot('28g-icon-editor-recents');
    await page.locator('.icon-editor .btn', { hasText: 'Guardar ícono' }).click();
    await page.waitForTimeout(1200);
    const cfg2 = fs.readFileSync(path.join(instDir, id, 'instance.cfg'), 'utf8');
    if (!/HaviHubIcon=sky\/rocket/.test(cfg2)) throw new Error('edited icon was not saved');
    await shot('28h-library-icon-edited');
  }

  if (want('photo')) {
    // a big square picture is kept byte for byte; a wide one is cut to a
    // square at its own pixel size
    const { encodePng } = require('./png.cjs');
    const make = (w, h) => {
      const px = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          px[i] = (x * 255) / w;
          px[i + 1] = (y * 255) / h;
          px[i + 2] = ((x ^ y) & 255);
          px[i + 3] = 255;
        }
      return encodePng(w, h, px);
    };
    const big = path.join(work, 'big-3840.png');
    fs.writeFileSync(big, make(3840, 3840));
    const wide = path.join(work, 'wide-4000x3000.png');
    fs.writeFileSync(wide, make(4000, 3000));
    const upload = async (file) => {
      await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
      await page.locator('.inst-card', { hasText: '[1.21.8] PVP' }).click({ button: 'right' });
      await page.locator('.menu-item', { hasText: 'Cambiar ícono…' }).click();
      await page.locator('.icon-editor .btn', { hasText: 'Usar una imagen propia…' }).click();
      await page.locator('.cropper input[type=file]').setInputFiles(file);
      await page.waitForTimeout(1500);
      await shot(`30-photo-${path.basename(file, '.png')}`);
      await page.locator('.modal .btn-primary', { hasText: 'Guardar' }).click();
      await page.waitForSelector('.cropper', { state: 'detached', timeout: 60000 });
      await page.waitForTimeout(1500);
      const cfg = fs.readFileSync(path.join(data, 'instances', '1.21.8 PVP', 'instance.cfg'), 'utf8');
      const key = /iconKey=(.*)/.exec(cfg)[1].trim();
      const saved = fs.readFileSync(path.join(data, 'icons', `${key}.png`));
      return { saved, w: saved.readUInt32BE(16), h: saved.readUInt32BE(20), recipe: /HaviHubIcon=/.test(cfg) };
    };
    const a = await upload(big);
    console.log('square upload', `${a.w}x${a.h}`, a.saved.equals(fs.readFileSync(big)) ? 'identical' : 'changed');
    if (!a.saved.equals(fs.readFileSync(big)) || a.recipe) throw new Error('the square picture was not kept as it is');
    const b = await upload(wide);
    console.log('wide upload', `${b.w}x${b.h}`);
    if (b.w !== 3000 || b.h !== 3000) throw new Error('the wide picture lost resolution');
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    await shot('30c-photo-library');
  }

  if (want('oled')) {
    await page.locator('.side-btn[aria-label="Ajustes"]').click();
    await page.locator('.settings-item', { hasText: 'Temas' }).click();
    await page.locator('.preset').filter({ hasText: /^CurseForge OLED/ }).click();
    await shot('31a-settings-oled');
    await page.locator('.settings-close').click();
    await page.waitForTimeout(500);
    await shot('31b-library-oled');
    await page.locator('.group-card', { hasText: 'Vanilla' }).click();
    await page.locator('.inst-card', { hasText: '[26.2] Vanilla' }).click();
    await page.waitForSelector('.ctable-row');
    await page.waitForTimeout(800);
    await shot('31c-instance-oled');
    await page.locator('.side-btn[aria-label="Ajustes"]').click();
    await page.locator('.settings-item', { hasText: 'Temas' }).click();
    await page.locator('.preset').filter({ hasText: /^CurseForge \(original\)/ }).click();
    await page.locator('.settings-close').click();
  }

  if (want('tray')) {
    // with "close to the tray" on, the X hides the window and Havi Hub keeps running
    await page.evaluate(() => window.havihub.call('app.updateConfig', { closeToTray: true }));
    await page.locator('.tb-close').click();
    await page.waitForTimeout(800);
    const hidden = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { alive: !w.isDestroyed(), visible: w.isVisible() };
    });
    console.log('close to tray', JSON.stringify(hidden));
    if (!hidden.alive || hidden.visible) throw new Error('the window should be hidden, not closed');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await page.evaluate(() => window.havihub.call('app.updateConfig', { closeToTray: false }));
    await page.waitForTimeout(400);
  }

  if (want('sync')) {
    // the same pack in CurseForge, the Modrinth App and Havi Hub (imported above)
    const cfProfile = path.join(others, 'curseforge', 'minecraft', 'Instances', 'Fabric 1.21.1');
    fs.mkdirSync(path.join(cfProfile, 'saves', 'Desde CurseForge'), { recursive: true });
    fs.writeFileSync(path.join(cfProfile, 'saves', 'Desde CurseForge', 'level.dat'), 'cf');
    fs.writeFileSync(path.join(cfProfile, 'minecraftinstance.json'), JSON.stringify({ name: 'Fabric 1.21.1', gameVersion: '1.21.1', baseModLoader: { name: 'fabric-0.16.5-1.21.1', minecraftVersion: '1.21.1', type: 4 }, installedAddons: [], lastPlayed: '2026-11-01T10:00:00' }));
    await page.locator('.side-btn[aria-label="Ajustes"]').click();
    await page.locator('.settings-item', { hasText: 'Launcher' }).click();
    await page.locator('.btn', { hasText: 'Sincronizar perfiles…' }).click();
    await page.waitForSelector('.sync-sections', { timeout: 15000 });
    await page.waitForTimeout(800);
    await shot('35a-sync-dialog');
    const card = page.locator('.sync-card', { hasText: 'Fabric 1.21.1' }).first();
    await card.locator('.btn', { hasText: 'Sincronizar' }).click();
    await page.locator('.modal .btn-primary', { hasText: 'Sincronizar' }).last().click();
    await page.waitForSelector('.sync-h:text("Sincronizados")', { timeout: 30000 });
    await page.waitForTimeout(800);
    await shot('35b-sync-linked');
    const st = fs.lstatSync(cfProfile);
    if (!st.isSymbolicLink()) throw new Error('the CurseForge profile was not linked');
    await page.locator('.sync-row', { hasText: 'Cobblemon' }).locator('.btn').click();
    await page.waitForFunction(() => document.querySelectorAll('.sync-sections .sync-card').length >= 2, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await shot('35c-sync-brought');
    await page.locator('.modal-foot .btn', { hasText: 'Cerrar' }).click();
    await page.waitForTimeout(400);
    await shot('35d-settings-sync');
    await page.locator('.settings-close').click();
  }

  if (want('launch')) {
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    await page.locator('.group-card', { hasText: 'Vanilla' }).click();
    await page.locator('.inst-card', { hasText: '[26.2] Vanilla' }).click();
    await page.locator('.play-btn').click();
    const playedAt = Date.now();
    await page.waitForTimeout(400);
    await shot('28-launching');
    // the stand-in game closes after a second; a world can only start once it
    // has (on a busy machine that takes longer than a fixed wait)
    for (let i = 0; i < 60 && !(fs.existsSync(path.join(data, 'launch.log')) && fs.readFileSync(path.join(data, 'launch.log'), 'utf8').includes('--launch 26.2 Vanilla')); i++) await page.waitForTimeout(500);
    await page.waitForFunction(async () => {
      const r = await window.havihub.call('instances.running');
      return Array.isArray(r.value) && !r.value.includes('26.2 Vanilla');
    }, null, { timeout: 30000, polling: 250 });
    // and Play ignores the same profile for 4 s after a click (a double click starts it once)
    await page.waitForTimeout(Math.max(0, playedAt + 4500 - Date.now()));
    await page.locator('.play-drop').click();
    await page.locator('.play-row', { hasText: 'Hardcore - copia' }).click();
    await page.waitForTimeout(2500);
    const log = fs.readFileSync(path.join(data, 'launch.log'), 'utf8');
    console.log('launch.log:\n' + log);
    if (!log.includes('--launch 26.2 Vanilla --profile havikun')) throw new Error('launch args not as expected');
    if (!log.includes('--world Hardcore - copia')) throw new Error('world launch args not as expected');
  }

  if (want('english')) {
    await page.locator('.side-btn').last().click();
    await page.locator('.settings-item', { hasText: 'Idiomas' }).click();
    await page.locator('.lang-item', { hasText: 'English' }).click();
    await page.waitForTimeout(500);
    await shot('29-settings-english');
    await page.locator('.settings-close').click();
    await page.locator('.top-tab', { hasText: 'My Modpacks' }).click();
    await page.locator('.group-card', { hasText: 'Vanilla' }).click();
    await page.locator('.inst-card', { hasText: '[26.2] Vanilla' }).click();
    await page.waitForSelector('.ctable-row');
    await page.locator('.kebab').click();
    await shot('30-instance-english');
    await page.keyboard.press('Escape');
    await page.locator('.side-btn').last().click();
    await page.locator('.settings-item', { hasText: 'Languages' }).click();
    await page.locator('.lang-item', { hasText: 'Español' }).click();
    await page.locator('.settings-close').click();
  }

  if (want('light')) {
    await page.locator('.side-btn').last().click();
    await page.locator('.settings-item', { hasText: 'Temas' }).click();
    await page.locator('.preset').filter({ hasText: /^CurseForge claro/ }).click();
    await page.locator('.settings-close').click();
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    await page.locator('.group-card', { hasText: 'Vanilla' }).click();
    await page.locator('.inst-card', { hasText: '[26.2] Vanilla' }).click();
    await page.waitForSelector('.ctable-row');
    await shot('31-instance-light');
    await page.locator('.side-btn').last().click();
    await page.locator('.settings-item', { hasText: 'Temas' }).click();
    await page.locator('.preset').filter({ hasText: /^CurseForge \(original\)/ }).click();
    await page.locator('.settings-close').click();
  }

  if (want('account')) {
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    await page.locator('.account-btn').click();
    await page.locator('.account-menu .btn').filter({ hasText: /^Agregar cuenta$/ }).click();
    await page.waitForSelector('.add-account');
    await shot('32-add-account');
    await page.keyboard.press('Escape');
    // offline account: offered because there is a premium account
    await page.locator('.account-btn').click();
    await page.locator('.account-menu .btn').filter({ hasText: /^Agregar cuenta offline$/ }).click();
    const nameBox = page.locator('.modal input').first();
    await nameBox.fill('Pe rro!_99');
    const typed = await nameBox.inputValue();
    if (typed !== 'Perro_99') throw new Error(`offline name not cleaned: ${typed}`);
    await shot('32b-offline-account');
    await page.locator('.modal-foot .btn-primary').click();
    await page.waitForSelector('.modal', { state: 'detached' });
    const accs = (await page.evaluate(() => window.havihub.call('accounts.list'))).value || [];
    const off = accs.find((a) => a.name === 'Perro_99');
    if (!off || off.type !== 'Offline') throw new Error('offline account not saved: ' + JSON.stringify(accs.map((a) => [a.name, a.type])));
    console.log('offline account', off.name, off.id);
    await page.locator('.account-btn').click();
    await shot('32c-account-menu-offline');
    await page.keyboard.press('Escape');
  }

  if (want('import')) {
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    await page.locator('.toolbar .btn', { hasText: 'Importar' }).click();
    await shot('33a-import-menu');
    await page.locator('.menu-item', { hasText: 'Desde otro launcher' }).click();
    await page.waitForSelector('.src-card', { timeout: 15000 });
    await page.waitForTimeout(600);
    await shot('33b-import-sources');
    const before = await page.locator('.inst-card').count();
    await page.locator('.modal-foot .btn-primary').click();
    await page.waitForSelector('.import-row', { timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot('33c-import-list');
    // only CurseForge's All the Mods 9 + Modrinth's Fabric profile + Prism's PVP
    for (const head of await page.locator('.import-source-head .checkbox').all()) {
      const box = head.locator('input');
      if (await box.isChecked()) await head.click();
      if (await box.isChecked()) await head.click();
    }
    await page.locator('.import-row', { hasText: 'All the Mods 9' }).click();
    await page.locator('.import-row', { hasText: 'Fabric 1.21.1' }).first().click();
    await page.locator('.import-row', { hasText: '[1.21.8] PVP' }).click();
    await page.waitForTimeout(300);
    await page.locator('.import-list').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await shot('33d-import-chosen');
    await page.locator('.modal-foot .btn-primary').click();
    await page.waitForSelector('.import-dialog', { state: 'detached', timeout: 60000 });
    await page.waitForTimeout(1200);
    await shot('34-after-import');
    const after = await page.locator('.inst-card').count();
    if (after < before + 1) throw new Error(`import: expected more cards (${before} -> ${after})`);
  }

  if (want('addcontent')) {
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    await page.locator('.group-card', { hasText: 'Vanilla' }).click();
    await page.locator('.inst-card', { hasText: '[26.2] Vanilla' }).click();
    await page.waitForSelector('.ctable-row');
    await page.locator('.btn', { hasText: 'Agregar contenido' }).click();
    await page.waitForSelector('.proj-row, .ac-row', { timeout: 20000 });
    await page.waitForTimeout(1200);
    await shot('40a-add-content');
    if (await page.locator('.ac-type').count()) {
      await page.locator('.ac-row').nth(1).hover();
      await cap('40b-add-content-hover', 500);
      await page.locator('.ac-filters-btn:not(.ac-hide-btn)').click();
      await page.waitForTimeout(400);
      await shot('40c-add-content-filters');
      await page.keyboard.press('Escape');
      await page.locator('.ac-sort').click();
      await shot('40d-add-content-sort');
      await page.keyboard.press('Escape');
      await page.locator('.ac-type').click();
      await shot('40e-add-content-types');
      await page.locator('.select-menu .menu-item', { hasText: 'Shaders' }).click();
      await page.waitForSelector('.ac-row', { timeout: 20000 });
      await page.waitForTimeout(900);
      await shot('40f-add-content-shaders');
      await page.locator('.ac-type').click();
      await page.locator('.select-menu .menu-item', { hasText: 'Mundos' }).click();
      await page.waitForTimeout(1500);
      await shot('40g-add-content-worlds');
      await page.locator('.ac-type').click();
      await page.locator('.select-menu .menu-item', { hasText: 'Mods' }).click();
      await page.waitForSelector('.ac-row', { timeout: 20000 });
      // mods start filtered by the profile's version and loader, and both can be removed
      const chips = await page.locator('.ac-chip').evaluateAll((els) => els.map((e) => [e.textContent.trim(), !!e.querySelector('.ac-chip-x')]));
      console.log('mod filter chips:', JSON.stringify(chips));
      const vchip = chips.find((c) => c[0].includes('26.2'));
      if (!vchip || !vchip[1]) throw new Error('the 26.2 chip should be there and removable');
      await page.locator('.ac-chip', { hasText: '26.2' }).locator('.ac-chip-x').click();
      await page.locator('.ac-chip', { hasText: 'Fabric' }).locator('.ac-chip-x').click();
      await page.waitForTimeout(1500);
      const incompatible = await page.locator('.ac-incompat').count();
      const tip = incompatible ? await page.locator('.ac-incompat').first().getAttribute('data-tip') : '';
      // (every mock mod has a 26.2 Fabric version, so none is "No compatible" here;
      // the Modrinth layout test checks that with a Forge 1.20.1 profile)
      console.log('without the profile filters:', await page.locator('.ac-row').count(), 'rows,', incompatible, 'not compatible', tip || '');
      await shot('40h-add-content-unfiltered');
      await page.locator('.ac-reset').click();
      await page.waitForTimeout(1200);
      if ((await page.locator('.ac-chip', { hasText: '26.2' }).count()) !== 1) throw new Error('"Restablecer filtros" did not bring back the profile version');
      await page.locator('.ac-row', { hasText: 'Sodium Extra' }).locator('.ac-install').click();
      await page.waitForTimeout(2500);
      await shot('40i-add-content-installed');
      await page.locator('.ac-close').click();
      await page.waitForSelector('.ctable-row');
      await shot('40j-back-to-instance');
    }
  }

  if (want('tips')) {
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    if (await page.locator('.crumb').count()) await page.locator('.crumb').first().click();
    await page.waitForSelector('.toolbar .btn');
    await page.locator('.side-game').hover();
    await cap('35a-tip-minecraft', 600);
    await page.locator('.side-btn[aria-label="Inicio"]').hover();
    await cap('35b-tip-home-anim', 130);
    await cap('35c-tip-home', 600);
    await page.locator('.toolbar .btn', { hasText: 'Crear grupo' }).hover();
    await cap('35d-hover-fade', 120);
    await page.mouse.move(700, 600);
  }

  if (want('sort')) {
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    await page.locator('.group-card', { hasText: 'Vanilla' }).click();
    await page.locator('.inst-card', { hasText: '[26.2] Vanilla' }).click();
    await page.waitForSelector('.ctable-row');
    await page.locator('.sortable', { hasText: 'Acción' }).click();
    await shot('36a-sort-action');
    await page.locator('.sortable', { hasText: 'Acción' }).click();
    await shot('36b-sort-action-reverse');
    await page.locator('.sortable', { hasText: 'Autor' }).click();
    await shot('36c-sort-author');
    // with updates found: outdated ones first when sorting Acción backwards
    // (an old AppleSkin and an old Sodium, so the check finds updates)
    for (const [projectId, versionId] of [
      ['EsAfCjCV', 'EsAfCjCV-2-26_2'],
      ['AANobbMI', 'AANobbMI-1-26_2'],
    ]) {
      const r = await page.evaluate((o) => window.havihub.call('platforms.install', o), { source: 'modrinth', projectId, versionId, instanceId: '26.2 Vanilla', type: 'mod' });
      if (!r.ok) throw new Error(`install ${projectId}: ${r.error && r.error.message}`);
    }
    await page.locator('[aria-label="Buscar actualizaciones"]').click();
    await page.waitForSelector('.cell-action .btn', { timeout: 20000 }).catch(() => {});
    await page.locator('.sortable', { hasText: 'Acción' }).click();
    await page.locator('.sortable', { hasText: 'Acción' }).click();
    await shot('36d-sort-outdated-first');
  }

  if (want('keys')) {
    await page.locator('.side-btn[aria-label="Ajustes"]').click();
    await page.locator('.settings-item', { hasText: 'Minecraft' }).click();
    await page.locator('.set-sub', { hasText: 'Teclas' }).scrollIntoViewIfNeeded();
    await page.locator('.set-sub', { hasText: 'Teclas' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot('37a-keys');
    const drop = page.locator('.key-field', { hasText: 'Tirar el ítem seleccionado' }).locator('.keycap-btn');
    await drop.click();
    await shot('37b-keys-listening');
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);
    await page.locator('.key-field', { hasText: 'Tirar el ítem seleccionado' }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.locator('.key-field', { hasText: 'Tirar el ítem seleccionado' }).locator('.keycap-warn').hover();
    await page.waitForTimeout(700);
    await shot('37c-keys-conflict');
    await page.locator('.key-field', { hasText: 'Tirar el ítem seleccionado' }).locator('.icon-btn').click();
    await page.locator('.settings-content').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await shot('37d-keys-debug');
    await page.locator('.settings-close').click();
  }

  if (want('behavior')) {
    await page.locator('.side-btn[aria-label="Ajustes"]').click();
    await page.locator('.settings-item', { hasText: 'Launcher' }).click();
    await page.locator('h3', { hasText: 'Comportamiento' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const subs = await page.locator('.set-sub').allInnerTexts();
    if (!['Al cerrar la ventana', 'Al iniciar el juego', 'Perfiles'].every((x) => subs.includes(x))) throw new Error(`behavior subsections: ${subs.join(' | ')}`);
    await page.locator('.set-sub:text-is("Al iniciar el juego") + .field .select').click();
    await page.locator('.select-menu .menu-item', { hasText: 'Se esconde en la bandeja' }).click();
    await page.waitForTimeout(300);
    await shot('38-behavior-tray');
    const cfgFile = path.join(work, 'userdata', 'config.json');
    const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    if (!c.trayOnLaunch || c.minimizeOnLaunch || c.closeOnLaunch) throw new Error('tray option not saved alone');
    await page.locator('.settings-close').click();
  }

  if (want('share')) {
    // sharing with Prism Launcher is part of the one "Sincronizar perfiles" dialog
    await page.locator('.side-btn[aria-label="Ajustes"]').click();
    await page.locator('.settings-item', { hasText: 'Launcher' }).click();
    if (await page.locator('.field', { hasText: 'Compartir los perfiles con Prism Launcher' }).count()) throw new Error('the separate sharing option is still there');
    await page.locator('.btn', { hasText: 'Sincronizar perfiles…' }).click();
    await page.waitForSelector('.sync-prism');
    await page.waitForTimeout(400);
    await shot('39-sync-dialog');
    await page.locator('.sync-prism .btn', { hasText: 'Compartir' }).click();
    await page.waitForSelector('.share-dialog .import-row', { timeout: 15000 });
    await page.waitForTimeout(600);
    await shot('39a-share-dialog');
    await page.locator('.share-dialog .modal-foot .btn-primary').click();
    await page.waitForSelector('.share-dialog', { state: 'detached', timeout: 60000 });
    await page.locator('.sync-prism', { hasText: 'Todos los perfiles están compartidos' }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await shot('39b-share-on');
    const cfg = fs.readFileSync(path.join(data, 'prismlauncher.cfg'), 'utf8').match(/^InstanceDir=.*$/m);
    console.log('engine cfg while sharing:', cfg && cfg[0]);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sync-prism', { state: 'detached' });
    if (!(await page.locator('.sync-summary-row', { hasText: 'Prism Launcher' }).count())) throw new Error('the settings do not say the profiles are shared');
    await page.locator('.settings-close').click();
    await page.locator('.top-tab', { hasText: 'Mis modpacks' }).click();
    await page.waitForTimeout(800);
    await shot('39c-library-shared');
    await page.locator('.side-btn[aria-label="Ajustes"]').click();
    await page.locator('.settings-item', { hasText: 'Launcher' }).click();
    await page.locator('.btn', { hasText: 'Sincronizar perfiles…' }).click();
    await page.locator('.sync-prism .btn', { hasText: 'Dejar de compartir' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.modal').length === 2);
    // Escape closes only the question on top, not the dialog under it
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('.modal').length === 1);
    await page.locator('.sync-prism .btn', { hasText: 'Dejar de compartir' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.modal').length === 2);
    await page.locator('.modal').last().locator('.btn-primary, .btn-danger').last().click();
    await page.locator('.sync-prism', { hasText: 'Compartir todos los perfiles' }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await shot('39d-share-off');
    await page.keyboard.press('Escape');
    await page.locator('.settings-close').click();
  }

  if (want('home')) {
    await page.locator('.side-btn[aria-label="Inicio"]').click();
    await shot('27-home');
  }
} catch (e) {
  console.error('E2E step failed:', e.message);
  await page.screenshot({ path: path.join(out, 'zz-failure.png') });
  process.exitCode = 1;
} finally {
  if (errors.length) {
    console.log('--- renderer errors ---');
    for (const e of [...new Set(errors)]) console.log(e);
  }
  await app.close();
  fs.rmSync(work, { recursive: true, force: true });
}
