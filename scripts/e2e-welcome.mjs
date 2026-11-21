// The first start. A new installation gets the welcome, which covers the
// whole window (nothing of the app shows behind it) until there is an instance
// and the game's files to draw its title and grass block from.
//   A: bring the instances from a Prism Launcher that never ran the game; its
//      files have to be downloaded, Mojang is out of reach at first, then the
//      download is retried. Havikun's channels are set to load only when opened.
//   B: create an instance, with the game already installed; quitting halfway
//      picks up at the same step on the next start, and a later start has no welcome.
//   C: a later start that finds no game files: only the welcome's last step.
//   D: bring the instances from a Prism Launcher that has the game: its files
//      come along, so there is nothing to wait for.
//   E: an update from a version that never asked what the X does: no welcome,
//      only the question about the X, in its own dialog. And a new start of an
//      installation that already has instances: the welcome alone asks it (the
//      dialog doesn't open on top once the layout is chosen).
//   xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/e2e-welcome.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const { clientJar } = require('./mc-standins.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'havihub-welcome'));
fs.mkdirSync(out, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'havihub-welcome-'));
// a Prism Launcher that never ran the game (no client .jar among its files),
// and the same one after a game: the client .jar with stand-ins for the
// pictures Havi Hub draws from it (scripts/mc-standins.cjs)
const unplayed = path.join(work, 'PrismLauncher-unplayed');
execFileSync(process.execPath, [path.join(root, 'scripts/make-fixtures.mjs'), unplayed]);
const oldPrism = path.join(work, 'PrismLauncher');
fs.cpSync(unplayed, oldPrism, { recursive: true });
const gameJar = (dir) => path.join(dir, 'libraries', 'com', 'mojang', 'minecraft', '26.2', 'minecraft-26.2-client.jar');
fs.mkdirSync(path.dirname(gameJar(oldPrism)), { recursive: true });
fs.writeFileSync(gameJar(oldPrism), await clientJar());

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
};
const configOf = (userData) => JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));

async function launch(env) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(root, 'dist/main.js'), '--no-sandbox', '--lang=es-CL', '--force-device-scale-factor=1.25', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    // HAVIHUB_SOCIAL_ASK: the welcome asks about Havikun's channels (the other tests start answered)
    env: { ...process.env, HAVIHUB_MOCK_NET: path.join(root, 'scripts/mock-net.cjs'), HAVIHUB_PRISM_EXE: path.join(oldPrism, 'prismlauncher'), HAVIHUB_IMPORT_DIRS: '', HAVIHUB_SOCIAL_ASK: '1', ...env },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1536, 864);
    w.center();
  });
  const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`), clip: { x: 0, y: 0, width: 1536, height: 864 } });
  return { app, page, shot };
}

// Whether what the app has at that element's place is hidden under the welcome
async function covered(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(top && top.closest('.welcome'));
  }, selector);
}

// The game's pictures in the app: its title, and the grass block drawn from the game (150×150)
async function originals(page) {
  return page.evaluate(() => {
    const logo = document.querySelector('.mc-logo');
    const grass = document.querySelector('img.brand-minecraft');
    return {
      title: Boolean(logo && logo.naturalWidth > 0 && /^data:image\/png/.test(logo.src)),
      grass: Boolean(grass && grass.naturalWidth === 150 && grass.naturalHeight === 150 && /^data:image\/png/.test(grass.src)),
    };
  });
}

// ---------------------------------------------------------------- A
{
  const userData = path.join(work, 'A-userdata');
  const data = path.join(work, 'A-data');
  const down = path.join(work, 'A-mojang-down');
  fs.writeFileSync(down, '');
  const { app, page, shot } = await launch({ HAVIHUB_USER_DATA: userData, HAVIHUB_PRISM_DIR: data, HAVIHUB_IMPORT_DIRS: unplayed, HAVIHUB_MC_FETCH: '1', HAVIHUB_MOCK_MC_DOWN: down, HAVIHUB_MOCK_SLOW_MC: '5000' });
  try {
    await page.waitForSelector('.welcome-hello', { timeout: 30000 });
    await page.waitForTimeout(500);
    await shot('A1-hello');
    check('A: the welcome covers the window', await page.evaluate(() => {
      const r = document.querySelector('.welcome').getBoundingClientRect();
      return r.left === 0 && r.top === 0 && r.width === innerWidth && r.height === innerHeight && getComputedStyle(document.querySelector('.welcome')).backgroundColor !== 'rgba(0, 0, 0, 0)';
    }));
    check('A: the game title and the grass block behind it are hidden', (await covered(page, '.game-title')) !== false && (await covered(page, '.side-game')) !== false);
    check('A: the welcome has the window buttons', (await page.locator('.welcome-bar .tb-ctl').count()) === 3);
    await page.locator('.welcome .lp-go', { hasText: 'Empezar' }).click();
    await page.waitForSelector('.welcome-layout .lp-choice');
    await page.waitForTimeout(400);
    await shot('A2-layout');
    await page.locator('.lp-choice', { hasText: 'Estilo CurseForge' }).click();
    await page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    await page.waitForSelector('.welcome-close .cb-option');
    check('A: the layout is saved', configOf(userData).layout === 'curseforge');
    check('A: "Continuar" waits for an answer', await page.locator('.welcome .lp-go', { hasText: 'Continuar' }).isDisabled());
    await page.locator('.welcome .cb-option', { hasText: 'Dejarlo en la bandeja' }).click();
    await page.waitForTimeout(300);
    await shot('A3-close');
    await page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    // Havikun's channels: loading on their own comes chosen; here, only when opened
    await page.waitForSelector('.welcome-socials .cb-option');
    check('A: what the X does is saved', configOf(userData).closeToTray === true);
    check('A: the channels come set to load on their own', (await page.locator('.welcome-socials .cb-option[aria-checked="true"]', { hasText: 'Cargarlas solas' }).count()) === 1 && (await page.locator('.welcome-socials .cb-tag', { hasText: 'Recomendado' }).count()) === 1);
    check('A: "Continuar" ready without touching anything', !(await page.locator('.welcome .lp-go', { hasText: 'Continuar' }).isDisabled()));
    check('A: it says what turning it off does, and where the policy is', (await page.locator('.welcome-socials .cb-option', { hasText: 'Solo se desactiva la carga automática' }).count()) === 1 && (await page.locator('.welcome-socials .welcome-link', { hasText: 'Ver la política de privacidad' }).count()) === 1);
    await page.waitForTimeout(300);
    await shot('A3b-socials');
    await page.locator('.welcome .cb-option', { hasText: 'Solo cuando abra una' }).click();
    await page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    await page.waitForSelector('.welcome-instance .welcome-card');
    check('A: the channels load only when opened', configOf(userData).privacy.socialAutoload === false && configOf(userData).privacy.socialAsked === true);
    await page.locator('.welcome-card', { hasText: 'Encontramos 5 en Prism Launcher' }).waitFor();
    await page.waitForTimeout(300);
    await shot('A4-instance');
    check('A: still nothing of the app behind', (await covered(page, '.game-title')) === true && (await covered(page, '.side-game')) === true);
    // bring them from Prism Launcher (the dialog opens over the welcome)
    await page.locator('.welcome-card', { hasText: 'Traer mis instancias' }).click();
    await page.waitForSelector('.import-dialog .src-card');
    await page.waitForTimeout(500);
    await shot('A5-import');
    await page.locator('.import-dialog .modal-foot .btn-primary').click();
    await page.waitForSelector('.import-dialog .import-row', { timeout: 20000 });
    await page.waitForTimeout(800);
    check('A: every profile preselected', (await page.locator('.import-row.on').count()) === 5);
    await page.locator('.modal-foot .btn-primary').click();
    await page.waitForSelector('.import-dialog', { state: 'detached', timeout: 30000 });
    // the game's files: Mojang out of reach first
    await page.waitForSelector('.welcome-prepare');
    await page.waitForSelector('.welcome-error', { timeout: 20000 });
    await page.waitForTimeout(300);
    await shot('A6-prepare-failed');
    check('A: still covered while the files are missing', (await covered(page, '.game-title')) === true);
    fs.rmSync(down);
    await page.locator('.welcome .lp-go', { hasText: 'Reintentar' }).click();
    await page.waitForFunction(() => / de [\d,.]+ MB/.test((document.querySelector('.welcome-progress-text') || {}).textContent || ''), null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot('A7-prepare-progress');
    const share = await page.evaluate(() => parseFloat(document.querySelector('.welcome-prepare .progress-bar').style.width));
    check('A: the download shows how far it went', share > 0 && share < 100, `${share}%`);
    await page.waitForSelector('.welcome', { state: 'detached', timeout: 30000 });
    await page.waitForSelector('.group-card', { timeout: 10000 });
    await page.waitForTimeout(800);
    await shot('A8-after');
    const o = await originals(page);
    check('A: the app shows the game\'s title and grass block', o.title && o.grass, JSON.stringify(o));
    const cfg = configOf(userData);
    check('A: the welcome is done', cfg.welcomeDone === true && cfg.importPromptDone === true);
    const accounts = JSON.parse(fs.readFileSync(path.join(data, 'accounts.json'), 'utf8'));
    check('A: groups and the account came along', (await page.locator('.group-card').count()) === 2 && accounts.accounts.length === 1);
  } catch (e) {
    check(`A: ${e.message.split('\n')[0]}`, false);
    await shot('A-failure').catch(() => {});
  } finally {
    await app.close();
  }

  // ---------------------------------------------------------------- C (the same installation, its game files gone)
  fs.rmSync(path.join(userData, 'cache', 'mc'), { recursive: true, force: true });
  const c = await launch({ HAVIHUB_USER_DATA: userData, HAVIHUB_PRISM_DIR: data, HAVIHUB_MC_FETCH: '1', HAVIHUB_MOCK_SLOW_MC: '2500' });
  try {
    await c.page.waitForSelector('.welcome-prepare', { timeout: 30000 });
    await c.page.waitForTimeout(600);
    await c.shot('C1-prepare-only');
    check('C: only the last step, without the steps bar', (await c.page.locator('.welcome-steps').count()) === 0 && (await c.page.locator('.welcome-hello, .welcome-layout, .welcome-close, .welcome-socials, .welcome-instance').count()) === 0);
    check('C: the app behind is hidden', (await covered(c.page, '.game-title')) === true);
    await c.page.waitForSelector('.welcome', { state: 'detached', timeout: 30000 });
    await c.page.waitForTimeout(600);
    const o = await originals(c.page);
    check('C: then the game\'s title and grass block', o.title && o.grass, JSON.stringify(o));
  } catch (e) {
    check(`C: ${e.message.split('\n')[0]}`, false);
    await c.shot('C-failure').catch(() => {});
  } finally {
    await c.app.close();
  }
}

// ---------------------------------------------------------------- D
{
  const userData = path.join(work, 'D-userdata');
  const data = path.join(work, 'D-data');
  const { app, page, shot } = await launch({ HAVIHUB_USER_DATA: userData, HAVIHUB_PRISM_DIR: data, HAVIHUB_IMPORT_DIRS: oldPrism });
  try {
    await page.waitForSelector('.welcome-hello', { timeout: 30000 });
    await page.locator('.welcome .lp-go', { hasText: 'Empezar' }).click();
    await page.locator('.lp-choice', { hasText: 'Estilo CurseForge' }).click();
    await page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    await page.locator('.welcome .cb-option', { hasText: 'Cerrarlo del todo' }).click();
    await page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    await page.waitForSelector('.welcome-socials .cb-option');
    await page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    await page.evaluate(() => {
      window.__sawPrepare = false;
      new MutationObserver(() => {
        if (document.querySelector('.welcome-prepare')) window.__sawPrepare = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.locator('.welcome-card', { hasText: 'Traer mis instancias' }).click();
    await page.locator('.import-dialog .modal-foot .btn-primary').click();
    await page.waitForSelector('.import-dialog .import-row', { timeout: 20000 });
    await page.locator('.modal-foot .btn-primary').click();
    await page.waitForSelector('.welcome', { state: 'detached', timeout: 30000 });
    check('D: the game came with the instances, so no waiting step', !(await page.evaluate(() => window.__sawPrepare)));
    await page.waitForTimeout(600);
    const o = await originals(page);
    check('D: the game\'s title and grass block right away', o.title && o.grass, JSON.stringify(o));
  } catch (e) {
    check(`D: ${e.message.split('\n')[0]}`, false);
    await shot('D-failure').catch(() => {});
  } finally {
    await app.close();
  }
}

// ---------------------------------------------------------------- B
{
  const userData = path.join(work, 'B-userdata');
  const data = path.join(work, 'B-data');
  fs.mkdirSync(path.dirname(gameJar(data)), { recursive: true });
  fs.writeFileSync(gameJar(data), await clientJar());
  const env = { HAVIHUB_USER_DATA: userData, HAVIHUB_PRISM_DIR: data };
  let run = await launch(env);
  try {
    await run.page.waitForSelector('.welcome-hello', { timeout: 30000 });
    await run.page.locator('.welcome .lp-go', { hasText: 'Empezar' }).click();
    await run.page.locator('.lp-choice', { hasText: 'Estilo Modrinth' }).click();
    await run.page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    await run.page.waitForSelector('.welcome-close .cb-option');
    check('B: the Modrinth layout is saved', configOf(userData).layout === 'modrinth');
  } catch (e) {
    check(`B: ${e.message.split('\n')[0]}`, false);
    await run.shot('B-failure').catch(() => {});
  } finally {
    await run.app.close();
  }
  // quit halfway: the next start goes on from there
  run = await launch(env);
  try {
    await run.page.waitForSelector('.welcome-close .cb-option', { timeout: 30000 });
    check('B: the next start picks up at the same step', (await run.page.locator('.welcome-hello').count()) === 0);
    await run.page.waitForTimeout(400);
    await run.shot('B1-resumed');
    await run.page.locator('.welcome .cb-option', { hasText: 'Cerrarlo del todo' }).click();
    await run.page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    await run.page.waitForSelector('.welcome-socials .cb-option');
    await run.page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    await run.page.waitForSelector('.welcome-instance .welcome-card');
    check('B: the channels keep loading on their own', configOf(userData).privacy.socialAutoload === true && configOf(userData).privacy.socialAsked === true);
    check('B: with nothing found elsewhere, the general text', (await run.page.locator('.welcome-card', { hasText: 'Desde CurseForge, Modrinth o Prism Launcher' }).count()) === 1);
    check('B: the Modrinth layout behind is hidden too', (await covered(run.page, '.mr-titlebar')) === true);
    await run.page.evaluate(() => {
      window.__sawPrepare = false;
      new MutationObserver(() => {
        if (document.querySelector('.welcome-prepare')) window.__sawPrepare = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await run.page.locator('.welcome-card', { hasText: 'Crear una instancia' }).click();
    await run.page.waitForSelector('.version-row', { timeout: 15000 });
    await run.page.waitForTimeout(500);
    await run.shot('B2-create');
    await run.page.locator('.modal .btn-primary', { hasText: 'Crear' }).click();
    await run.page.waitForSelector('.welcome', { state: 'detached', timeout: 20000 });
    check('B: the game was already there, so no waiting step', !(await run.page.evaluate(() => window.__sawPrepare)));
    await run.page.waitForTimeout(1000);
    await run.shot('B3-after');
    check('B: the game\'s grass block in the app', (await run.page.evaluate(() => {
      const grass = document.querySelector('img.brand-minecraft');
      return !grass || (grass.naturalWidth === 150 && /^data:image\/png/.test(grass.src));
    })));
    const instances = fs.readdirSync(path.join(data, 'instances')).filter((d) => fs.existsSync(path.join(data, 'instances', d, 'instance.cfg')));
    check('B: the instance exists', instances.length === 1, instances.join(', '));
    const cfg = configOf(userData);
    check('B: the answers and the end are saved', cfg.closeToTray === false && cfg.layout === 'modrinth' && cfg.welcomeDone === true);
  } catch (e) {
    check(`B: ${e.message.split('\n')[0]}`, false);
    await run.shot('B-failure').catch(() => {});
  } finally {
    await run.app.close();
  }
  // a later start: no welcome at all
  run = await launch(env);
  try {
    await run.page.waitForSelector('.mr-titlebar', { timeout: 30000 });
    await run.page.waitForTimeout(2500);
    check('B: a later start has no welcome', (await run.page.locator('.welcome').count()) === 0);
  } catch (e) {
    check(`B: ${e.message.split('\n')[0]}`, false);
  } finally {
    await run.app.close();
  }
}

// ---------------------------------------------------------------- E
{
  const data = path.join(work, 'E-data');
  execFileSync(process.execPath, [path.join(root, 'scripts/make-fixtures.mjs'), data]);
  fs.mkdirSync(path.dirname(gameJar(data)), { recursive: true });
  fs.writeFileSync(gameJar(data), await clientJar());
  // an update: a layout chosen, but nothing said yet about the X
  const updated = path.join(work, 'E-updated');
  fs.mkdirSync(updated, { recursive: true });
  fs.writeFileSync(path.join(updated, 'config.json'), JSON.stringify({ layout: 'curseforge', importPromptDone: true, privacy: { socialAsked: true } }));
  let run = await launch({ HAVIHUB_USER_DATA: updated, HAVIHUB_PRISM_DIR: data });
  try {
    await run.page.waitForSelector('.close-behavior .cb-option', { timeout: 30000 });
    check('E: an update gets the question about the X in its dialog, without the welcome', (await run.page.locator('.welcome').count()) === 0);
    await run.page.locator('.close-behavior .cb-option', { hasText: 'Cerrarlo del todo' }).click();
    await run.page.locator('.close-behavior .btn-primary').click();
    await run.page.waitForSelector('.close-behavior', { state: 'detached' });
    // the dialog closes before the settings file is written: give it a moment
    for (let i = 0; i < 20 && (() => { try { return configOf(updated).closeToTray; } catch { return undefined; } })() !== false; i++) await run.page.waitForTimeout(150);
    check('E: and it is saved', configOf(updated).closeToTray === false);
  } catch (e) {
    check(`E: ${e.message.split('\n')[0]}`, false);
    await run.shot('E-failure').catch(() => {});
  } finally {
    await run.app.close();
  }
  // a new start over instances that are already there
  const fresh = path.join(work, 'E-fresh');
  run = await launch({ HAVIHUB_USER_DATA: fresh, HAVIHUB_PRISM_DIR: data });
  try {
    await run.page.waitForSelector('.welcome-hello', { timeout: 30000 });
    await run.page.locator('.welcome .lp-go', { hasText: 'Empezar' }).click();
    await run.page.locator('.lp-choice', { hasText: 'Estilo CurseForge' }).click();
    await run.page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    await run.page.waitForSelector('.welcome-close .cb-option');
    await run.page.waitForTimeout(1500);
    check('E: with instances already there, no dialog over the welcome', (await run.page.locator('.close-behavior').count()) === 0);
    await run.page.locator('.welcome .cb-option', { hasText: 'Dejarlo en la bandeja' }).click();
    await run.page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    await run.page.waitForSelector('.welcome-socials .cb-option');
    await run.page.locator('.welcome .lp-go', { hasText: 'Continuar' }).click();
    await run.page.waitForSelector('.welcome', { state: 'detached', timeout: 30000 });
    await run.page.waitForTimeout(1500);
    check('E: the welcome ends straight into the app (the instances were there)', (await run.page.locator('.close-behavior').count()) === 0 && configOf(fresh).closeToTray === true && configOf(fresh).welcomeDone === true);
  } catch (e) {
    check(`E: ${e.message.split('\n')[0]}`, false);
    await run.shot('E2-failure').catch(() => {});
  } finally {
    await run.app.close();
  }
}

console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
