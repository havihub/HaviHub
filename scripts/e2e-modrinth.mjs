// The Modrinth layout end to end, from the layout picker on the first start,
// with what it holds: content table, switch version, update all,
// browse with filters in the sidebar, settings window, drag between groups.
//   xvfb-run -s "-screen 0 1920x1080x24" node scripts/e2e-modrinth.mjs [outDir] [steps]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'havihub-mr'));
const only = process.argv[3] ? process.argv[3].split(',') : null;
fs.mkdirSync(out, { recursive: true });
const W = 1536;
const H = 864;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'havihub-mr-'));
const data = path.join(work, 'PrismLauncher');
execFileSync(process.execPath, [path.join(root, 'scripts/make-fixtures.mjs'), data]);
fs.mkdirSync(path.join(work, 'userdata'), { recursive: true });
// no layout chosen yet: the picker comes first
fs.writeFileSync(path.join(work, 'userdata', 'config.json'), JSON.stringify({ closeToTray: false, importPromptDone: true, tourDone: true }));

// stand-in for the social networks' embeddable pages
const embedsAsked = [];
const xLimited = { on: true, asked: 0 };
const socialSite = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x').searchParams.get('u') || '';
  embedsAsked.push(u);
  // X turns visitors away like this when it limits them
  if ((xLimited.on === 'all' ? /twitter\.com|x\.com/ : /twitter\.com/).test(u) && xLimited.on) {
    xLimited.asked++;
    res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Rate limit exceeded');
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<body style="margin:0;background:#fff;font:14px sans-serif"><div style="padding:12px"><b>${new URL(u || 'https://x').hostname}</b><p id="w"></p><a id="post" target="_blank" href="https://www.instagram.com/p/abc123/">post</a><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">${'<div style="aspect-ratio:1;background:#c9c"></div>'.repeat(6)}</div></div><script>document.getElementById('w').textContent='ancho '+innerWidth+' px'</script></body>`);
});
await new Promise((r) => socialSite.listen(0, '127.0.0.1', r));
const socialOrigin = `http://127.0.0.1:${socialSite.address().port}`;

const app = await electron.launch({
  executablePath: require('electron'),
  args: [path.join(root, 'dist/main.js'), '--no-sandbox', '--lang=es-CL', '--force-device-scale-factor=1.25', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  env: { ...process.env, HAVIHUB_USER_DATA: path.join(work, 'userdata'), HAVIHUB_PRISM_DIR: data, HAVIHUB_PRISM_EXE: path.join(data, 'prismlauncher'), HAVIHUB_MOCK_NET: path.join(root, 'scripts/mock-net.cjs'), HAVIHUB_SOCIAL_TEST: socialOrigin, HAVIHUB_TEST_CF_KEY: 'test-key' },
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await app.evaluate(({ BrowserWindow }, [w, h]) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(w, h);
  win.center();
}, [W, H]);
const cap = async (name, wait = 450) => {
  await page.waitForTimeout(wait);
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(b64, 'base64'));
  console.log('cap', name);
};
const want = (n) => !only || only.includes(n);
// HTML5 drag and drop the way the browser fires it (Playwright's mouse drag
// doesn't start native drags in Electron)
const group = (n) => page.locator('.mr-group').filter({ has: page.locator('.mr-group-name', { hasText: new RegExp(`^${n}$`) }) });
async function htmlDrag(src, dst) {
  const a = await src.elementHandle();
  const b = await dst.elementHandle();
  await page.evaluate(
    async ([from, to]) => {
      const dt = new DataTransfer();
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire(from, 'dragstart');
      await new Promise((r) => setTimeout(r, 150));
      fire(to, 'dragenter');
      fire(to, 'dragover');
      await new Promise((r) => setTimeout(r, 150));
      fire(to, 'drop');
      fire(from, 'dragend');
    },
    [a, b],
  );
}
const config = () => JSON.parse(fs.readFileSync(path.join(work, 'userdata', 'config.json'), 'utf8'));

try {
  // the first start: the welcome asks for the layout (the rest is answered already)
  await page.waitForSelector('.welcome-hello', { timeout: 20000 });
  await page.locator('.welcome .lp-go', { hasText: 'Empezar' }).click();
  await page.waitForSelector('.welcome-layout .lp-choice');
  await cap('00-layout-picker', 800);
  await page.locator('.lp-choice', { hasText: 'Estilo Modrinth' }).click();
  await cap('00b-layout-picked', 300);
  await page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
  await page.waitForSelector('.welcome', { state: 'detached', timeout: 15000 });
  await page.waitForSelector('.mr-app', { timeout: 15000 });
  await page.waitForSelector('.mr-inst', { timeout: 20000 });
  const c = config();
  if (c.layout !== 'modrinth' || c.themePreset !== 'modrinth') throw new Error(`layout not saved: ${c.layout} / ${c.themePreset}`);
  const attr = await page.evaluate(() => document.documentElement.dataset.layout);
  if (attr !== 'modrinth') throw new Error(`data-layout is ${attr}`);
  await cap('01-home', 1200);

  if (want('icons')) {
    // a wide photo and generated icons: every instance picture fills its box
    // exactly (no cropping off one side, no overflow)
    const ok = await page.evaluate(async () => {
      const c = new OffscreenCanvas(300, 180);
      const g = c.getContext('2d');
      g.fillStyle = '#e0e0e0';
      g.fillRect(0, 0, 300, 180);
      g.fillStyle = '#d02020';
      g.fillRect(0, 0, 30, 180);
      g.fillStyle = '#2040d0';
      g.fillRect(270, 0, 30, 180);
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      return window.havihub.call('instances.setImage', 'Cave Dread', bytes, {});
    });
    if (!ok.ok) throw new Error('setImage: ' + (ok.error && ok.error.message));
    await page.waitForTimeout(1200);
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('.mr-quick .inst-image, .mr-inst-art .inst-image, .mr-jump-item .inst-image')].map((box) => {
        const img = box.querySelector('img');
        const a = box.getBoundingClientRect();
        const b = img.getBoundingClientRect();
        return { where: box.parentElement.className.split(' ')[0], box: [Math.round(a.width), Math.round(a.height)], img: [Math.round(b.width), Math.round(b.height)], dx: Math.round(b.left - a.left), dy: Math.round(b.top - a.top), fit: getComputedStyle(img).objectFit, radius: getComputedStyle(box).borderRadius };
      }),
    );
    const bad = boxes.filter((x) => Math.abs(x.box[0] - x.img[0]) > 1 || Math.abs(x.box[1] - x.img[1]) > 1 || x.dx || x.dy || x.box[0] !== x.box[1] || x.fit !== 'cover');
    console.log('instance pictures:', boxes.length, 'checked;', JSON.stringify(boxes.slice(0, 3)));
    if (bad.length) throw new Error('pictures not fitted: ' + JSON.stringify(bad.slice(0, 4)));
    await cap('01a-icons', 300);
  }

  if (want('drag')) {
    // drag a profile from its group to "Sin grupo"
    const card = group('Vanilla').locator('.mr-inst').first();
    const name = (await card.locator('.mr-inst-text strong').textContent()).trim();
    await htmlDrag(card, group('Sin grupo').locator('.mr-group-head'));
    await page.waitForTimeout(1200);
    const moved = await group('Sin grupo').locator('.mr-inst', { hasText: name }).count();
    console.log('dragged', name, moved ? 'out of its group' : 'NOT moved');
    if (!moved) throw new Error('drag and drop did not move the profile');
    await cap('01b-home-dragged', 400);
    // and back into the group, dropped on its header
    const back = group('Sin grupo').locator('.mr-inst', { hasText: name });
    await htmlDrag(back, group('Vanilla').locator('.mr-group-head'));
    await page.waitForTimeout(1200);
    if (!(await group('Vanilla').locator('.mr-inst', { hasText: name }).count())) throw new Error('drag back into the group failed');
    // while dragging, the bar at the bottom offers every place to drop it
    const again = group('Vanilla').locator('.mr-inst', { hasText: name });
    await again.evaluate((el) => {
      window.__dt = new DataTransfer();
      el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
    });
    await page.waitForSelector('.dropbar-target', { timeout: 5000 });
    const targets = await page.locator('.dropbar-target').allTextContents();
    console.log('drop bar:', targets.join(' | '));
    await page.locator('.dropbar-target', { hasText: 'Sin grupo' }).evaluate((el) => {
      for (const type of ['dragenter', 'dragover']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
    });
    await cap('01c-drop-bar', 300);
    await page.locator('.dropbar-target', { hasText: 'Sin grupo' }).evaluate((el) => el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt })));
    await again.evaluate((el) => el.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: window.__dt }))).catch(() => {});
    await page.waitForTimeout(1200);
    if (!(await group('Sin grupo').locator('.mr-inst', { hasText: name }).count())) throw new Error('the drop bar did not move the profile');
    if (await page.locator('.dropbar').count()) throw new Error('the drop bar stayed after the drop');
    // put it back for the next steps
    await htmlDrag(group('Sin grupo').locator('.mr-inst', { hasText: name }), group('Vanilla').locator('.mr-group-head'));
    await page.waitForTimeout(1000);
  }

  if (want('instance')) {
    // an old Sodium and an old AppleSkin, so there are updates to choose from
    for (const [projectId, versionId] of [
      ['EsAfCjCV', 'EsAfCjCV-2-26_2'],
      ['AANobbMI', 'AANobbMI-1-26_2'],
    ]) {
      const r = await page.evaluate((o) => window.havihub.call('platforms.install', o), { source: 'modrinth', projectId, versionId, instanceId: '26.2 Vanilla', type: 'mod' });
      if (!r.ok) throw new Error(`install ${projectId}: ${r.error && r.error.message}`);
    }
    await page.locator('.mr-inst', { hasText: 'Fabric' }).first().click();
    await page.waitForSelector('.mr-tr:not(.mr-th)', { timeout: 15000 });
    await cap('02-instance-content', 1500);
    await page.locator('.mr-pill', { hasText: 'Resource Packs' }).click();
    await cap('02b-instance-resourcepacks', 600);
    await page.locator('.mr-pill', { hasText: 'Todo' }).click();
    // switch version
    await page.locator('.mr-tr', { hasText: 'Clumps' }).locator('.mr-icon-btn[aria-label="Cambiar versión"]').click();
    await page.waitForSelector('.switch-version', { timeout: 15000 });
    await page.waitForTimeout(1500);
    await cap('03-switch-version', 400);
    await page.locator('.sv-incompatible').click();
    await page.waitForTimeout(1500);
    await cap('03b-switch-version-all', 300);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.switch-version', { state: 'detached' });
    // update all: check, choose, update one of the two
    await page.locator('.mr-textbtn', { hasText: 'Recargar' }).click();
    await page.waitForSelector('.mr-textbtn.brand:not(:disabled)', { timeout: 20000 });
    await page.locator('.mr-textbtn.brand', { hasText: 'Actualizar todo' }).click();
    await page.waitForSelector('.update-projects .up-row', { timeout: 15000 });
    await cap('04-update-projects', 600);
    const rows = await page.locator('.update-projects .up-row').count();
    await page.locator('.update-projects .up-row', { hasText: 'AppleSkin' }).locator('.checkbox').click();
    await page.locator('.update-projects .up-row', { hasText: 'Sodium' }).locator('.btn', { hasText: 'Ver' }).click();
    await cap('04b-update-unchecked-log', 900);
    const label = await page.locator('.update-projects .modal-foot .btn-primary').textContent();
    console.log('update dialog:', rows, 'rows,', label.trim());
    if (!/1 proyecto/.test(label)) throw new Error('unchecking did not change the count');
    await page.locator('.update-projects .modal-foot .btn-primary').click();
    await page.waitForSelector('.update-projects', { state: 'detached', timeout: 30000 });
    await page.waitForTimeout(1500);
    // the version used before shows up as "Anterior" in Switch version (the
    // table no longer marks it since 1.0.0)
    await page.locator('.mr-tr', { hasText: 'Sodium' }).first().locator('.mr-icon-btn[aria-label="Cambiar versión"]').click();
    await page.waitForSelector('.sv-chip.previous', { timeout: 15000 });
    await cap('04d-switch-previous', 800);
    await page.keyboard.press('Escape');
    // the other tabs
    await page.locator('.mr-tab', { hasText: 'Mundos' }).click();
    await cap('05-worlds', 900);
    await page.locator('.mr-tab', { hasText: 'Registros' }).click();
    await cap('05b-logs', 1200);
    await page.locator('.mr-tab', { hasText: 'Contenido' }).click();
    // kebab menu
    await page.locator('.mr-inst-head .mr-icon-btn[aria-label="Más opciones"]').click();
    await cap('05c-kebab', 400);
    await page.keyboard.press('Escape');
  }

  if (want('addcontent')) {
    await page.locator('.mr-btn', { hasText: 'Explorar contenido' }).click();
    await page.waitForSelector('.mr-result', { timeout: 15000 });
    await cap('06-add-content', 900);
    await page.locator('.mr-result').first().click();
    await page.waitForSelector('.project-head', { timeout: 15000 });
    await cap('07-project', 900);
  }

  if (want('browse')) {
    await page.locator('.mr-navbtn[aria-label="Descubrir contenido"]').click();
    await page.waitForSelector('.mr-result', { timeout: 15000 });
    await cap('08-browse-modpacks', 900);
    await page.locator('.mr-tab', { hasText: 'Mods' }).click();
    await page.waitForSelector('.mr-result', { timeout: 15000 });
    await cap('08b-browse-mods', 900);
  }

  if (want('compat')) {
    // a Forge 1.20.1 profile: its filters come on by default and can be
    // removed; then the mods without a 1.20.1 Forge version say "No compatible"
    await page.locator('.mr-navbtn[aria-label="Inicio"]').click();
    await page.locator('.mr-inst', { hasText: 'Survival 1.20.1' }).first().click();
    await page.waitForSelector('.mr-content');
    await page.locator('.mr-btn', { hasText: 'Explorar contenido' }).first().click();
    await page.waitForSelector('.mr-tabs');
    const note = await page.locator('.mr-locked').textContent();
    console.log('profile filter note:', note.trim());
    if (!/1\.20\.1/.test(note)) throw new Error('the profile filters are not on by default');
    await cap('06c-compat-default', 1200);
    await page.locator('.mr-locked .mr-link').click();
    await page.waitForSelector('.mr-result', { timeout: 15000 });
    await page.waitForTimeout(800);
    const n = await page.locator('.mr-incompat').count();
    const tip = n ? await page.locator('.mr-incompat').first().getAttribute('data-tip') : '';
    console.log('without the profile filters:', await page.locator('.mr-result').count(), 'results,', n, 'not compatible:', tip);
    if (!n || !/1\.20\.1/.test(tip)) throw new Error('mods without a 1.20.1 Forge version should say "No compatible"');
    await cap('06d-compat-unfiltered', 600);
    await page.locator('.mr-locked .mr-link', { hasText: 'Restablecer filtros' }).click();
    await page.waitForTimeout(800);
    if (!/1\.20\.1/.test(await page.locator('.mr-locked').textContent())) throw new Error('"Restablecer filtros" did not bring the profile filters back');
  }

  if (want('vanilla')) {
    // a vanilla profile: no mods or shaders to add
    await page.locator('.mr-navbtn[aria-label="Inicio"]').click();
    await page.locator('.mr-inst', { hasText: 'PVP' }).first().click();
    await page.waitForSelector('.mr-content');
    await cap('09a-vanilla-empty', 600);
    // the toolbar button (an empty profile also shows one in its empty state)
    await page.locator('.mr-btn', { hasText: 'Explorar contenido' }).first().click();
    await page.waitForSelector('.mr-tabs');
    const tabs = await page.locator('.mr-tab').allTextContents();
    console.log('vanilla add-content tabs:', tabs.join(' | '));
    if (tabs.some((x) => /^Mods|^Shaders/.test(x.trim()))) throw new Error('vanilla profile offers mods or shaders');
    await cap('09-vanilla-add', 900);
  }

  if (want('pages')) {
    await page.locator('.mr-navbtn[aria-label="Servidores"]').click();
    await cap('10-servers', 2000);
    await page.locator('.mr-navbtn[aria-label="Skins"]').click();
    await cap('11-skins', 2000);
    await page.locator('.mr-navbtn[aria-label="Capturas"]').click();
    await cap('12-screenshots', 1500);
  }

  if (want('settings')) {
    await page.locator('.mr-navbtn[aria-label="Ajustes"]').click();
    await page.waitForSelector('.mr-settings-window');
    await cap('13-settings', 900);
    await page.locator('.settings-item', { hasText: 'Temas' }).click();
    await page.waitForSelector('.lp-choices');
    await cap('13b-settings-themes', 700);
    await page.locator('.mr-settings-close').click();
    await page.waitForSelector('.mr-settings-window', { state: 'detached' });
  }

  if (want('socials')) {
    // the side column: Havikun's channels instead of the news, Linktree first
    await page.locator('.mr-navbtn[aria-label="Inicio"]').click();
    await page.waitForSelector('.mr-socials .mr-social');
    if (await page.locator('.mr-news, .mr-news-card').count()) throw new Error('the news section is still there');
    const names = await page.locator('.mr-social-name strong').allTextContents();
    console.log('socials:', names.join(' | '));
    if (names.map((n) => n.replace(/EN VIVO/, '').trim()).join(',') !== 'Linktree,YouTube,Twitch,Instagram,X,TikTok') throw new Error('unexpected channels');
    await page.waitForSelector('.mr-social-livedot', { timeout: 15000 }); // Twitch is live in the mock
    await page.locator('.mr-socials').scrollIntoViewIfNeeded();
    await cap('14a-socials', 400);
    const toggle = (name) => page.locator('.mr-social', { has: page.locator('.mr-social-name strong', { hasText: name }) }).locator('.mr-social-toggle').click();
    await toggle('Linktree');
    await page.waitForSelector('.mr-social-link');
    console.log('linktree:', (await page.locator('.mr-social-link span').allTextContents()).join(' | '));
    // a link to a project on Modrinth or CurseForge opens that project here, inside Havi Hub
    for (const [label, title] of [['Sodium (Modrinth)', 'Sodium'], ['Fabric API (CurseForge)', 'Fabric API']]) {
      await page.locator('.mr-social-link', { hasText: label }).click();
      await page.waitForSelector('.project-titles', { timeout: 15000 });
      const shown = await page.locator('.project-titles').innerText();
      if (!shown.includes(title)) throw new Error(`"${label}" should open ${title} here, got: ${shown.slice(0, 60)}`);
      console.log('linktree →', label, '→ project page:', shown.split('\n')[0]);
      await page.evaluate(() => document.querySelector('[aria-label="Inicio"]').click());
      await page.waitForSelector('.mr-social');
      if (!(await page.locator('.mr-social-link').count())) await toggle('Linktree');
      await page.waitForSelector('.mr-social-link');
    }
    await toggle('YouTube');
    await page.waitForSelector('.mr-social-clip');
    if (await page.locator('.mr-social-link').count()) throw new Error('only one channel is open at a time');
    console.log('youtube:', (await page.locator('.mr-social-clip-text').allTextContents()).map((x) => x.slice(0, 60)).join(' | '));
    await page.locator('.mr-social.open').scrollIntoViewIfNeeded();
    await cap('14b-socials-youtube', 700);
    await toggle('Twitch');
    await page.waitForSelector('.mr-social-live');
    console.log('twitch:', (await page.locator('.mr-social-live').textContent()).slice(0, 90), '|', await page.locator('.mr-social-clip').count(), 'past broadcasts');
    await page.locator('.mr-social.open').scrollIntoViewIfNeeded();
    await cap('14c-socials-twitch', 700);
    await toggle('Instagram');
    await page.waitForSelector('.mr-social-embed.ready', { timeout: 20000 });
    const guests = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => w.getType() === 'webview').map((w) => w.getURL()));
    console.log('instagram guest:', guests.join(', ').replace(socialOrigin, ''), '| asked:', embedsAsked.at(-1));
    if (guests.length !== 1 || !/instagram\.com%2Fhavikunn%2Fembed/.test(guests[0])) throw new Error('the Instagram page did not load as a guest');
    const width = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().find((w) => w.getType() === 'webview').executeJavaScript('innerWidth'));
    console.log('guest page width:', width);
    // a link inside the network's page (a post) opens in the default browser (here: only noted)
    await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getType() === 'webview').executeJavaScript("document.getElementById('post').click()", true));
    await page.waitForTimeout(600);
    const opened = await app.evaluate(() => global.__havihubOpened || []);
    console.log('opened outside:', opened.join(','));
    if (!opened.includes('https://www.instagram.com/p/abc123/')) throw new Error('a post link inside the page should open in the browser');
    if (width < 300 || width > 400) throw new Error('the guest page should get about 340 px to lay itself out');
    await page.locator('.mr-social.open').scrollIntoViewIfNeeded();
    await cap('14d-socials-instagram', 900);
    await toggle('Instagram');
    await page.waitForTimeout(500);
    const after = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => w.getType() === 'webview').length);
    if (after !== 0) throw new Error('a closed channel should free its guest page');
    // X limiting visitors: no raw "Rate limit exceeded". First its normal page
    // takes over by itself; if that is limited too, a clear note with ways out.
    const guestUrl = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => w.getType() === 'webview').map((w) => decodeURIComponent(w.getURL())).join(','));
    await toggle('X');
    await page.waitForSelector('.mr-social-embed.ready .mr-social-signin', { timeout: 30000 });
    console.log('x limited → normal page:', (await guestUrl()).replace(socialOrigin, ''), '| tries:', xLimited.asked);
    if (!/u=https:\/\/x\.com\/havikun/.test(await guestUrl())) throw new Error("X's normal page should have taken over");
    await page.locator('.mr-social.open').scrollIntoViewIfNeeded();
    await cap('14e-socials-x-fallback', 600);
    await toggle('X');
    xLimited.on = 'all';
    await toggle('X');
    await page.waitForSelector('.mr-social-limited', { timeout: 40000 });
    const note = await page.locator('.mr-social-limited').innerText();
    console.log('x fully limited:', note.replace(/\n+/g, ' | ').slice(0, 170));
    if (!/Reintentar/.test(note) || !/Iniciar sesión en X/.test(note)) throw new Error('the note should offer to retry and to sign in');
    await page.locator('.mr-social.open').scrollIntoViewIfNeeded();
    await cap('14f-socials-x-limited', 400);
    xLimited.on = false;
    await page.locator('.mr-social-limited button', { hasText: 'Reintentar' }).click();
    await page.waitForSelector('.mr-social-embed.ready', { timeout: 20000 });
    if (!/syndication\.twitter\.com/.test(await guestUrl())) throw new Error('retrying starts again from the embeddable page');
    await toggle('X');
  }

  if (want('account')) {
    await page.locator('.mr-navbtn[aria-label="Inicio"]').click();
    await page.locator('.mr-account-card').click();
    await cap('14-account-menu', 500);
    await page.keyboard.press('Escape');
  }

  if (want('switchback')) {
    // back to the CurseForge layout from Settings → Themes
    await page.locator('.mr-navbtn[aria-label="Ajustes"]').click();
    await page.locator('.settings-item', { hasText: 'Temas' }).click();
    await page.locator('.lp-choice', { hasText: 'Estilo CurseForge' }).click();
    await page.waitForTimeout(800);
    const c2 = config();
    console.log('switched back to', c2.layout, c2.themePreset);
    if (c2.layout !== 'curseforge' || c2.themePreset !== 'forge') throw new Error('switching back failed');
    await page.locator('.settings-close').click();
    await page.waitForSelector('.top-tabs', { timeout: 10000 });
    await cap('15-back-to-curseforge', 900);
  }
} catch (e) {
  console.error('FAILED:', e.message);
  await cap('zz-failure', 0);
  process.exitCode = 1;
} finally {
  if (errors.length) console.log('--- renderer errors ---\n' + [...new Set(errors)].join('\n'));
  await app.close();
  socialSite.close();
  socialSite.closeAllConnections();
  fs.rmSync(work, { recursive: true, force: true });
}
