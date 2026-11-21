// Shortcuts that open Havi Hub and start an instance ("--launch <id>"), and
// Havi Hub's own entry in the Linux application menu.
//   Windows: a .lnk on the desktop
//   Linux:   a .desktop file on the desktop and in ~/.local/share/applications
//   macOS:   a .command file on the desktop
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { safeName } = require('../util/fsx');
const { UserError } = require('../../shared/usertext');

// Havi Hub's name on Linux: its menu entry, its icon and its window class.
// The old name was "havi-hub"; what was left under that name is replaced when found.
const APP_ICON = 'havihub';
const LEGACY_ICON = 'havi-hub';
const APP_DESKTOP = `${APP_ICON}.desktop`;
const LEGACY_DESKTOP = `${LEGACY_ICON}.desktop`;

// Build a .ico that embeds a PNG image (supported since Windows Vista).
function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(w >= 256 ? 0 : w, 0);
  entry.writeUInt8(h >= 256 ? 0 : h, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

// One argument of a .desktop Exec line (Desktop Entry spec: quote with double
// quotes, backslash-escape " ` $ \ inside them, and double every %).
function desktopArg(s) {
  const v = String(s).replace(/%/g, '%%');
  if (!/[\s"'\\`$<>~|&;*?#()]/.test(v) && v !== '') return v;
  // shell-style escape inside the quotes, then the key-file escape (\\ for \)
  const quoted = v.replace(/([\\"`$])/g, '\\$1').replace(/\\/g, '\\\\');
  return `"${quoted}"`;
}

// A value of a .desktop key: one line, with \n \t \\ escaped.
function desktopValue(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '');
}

function desktopEntry({ name, comment, exec, icon, extra = [] }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${desktopValue(name)}`,
    `Comment=${desktopValue(comment)}`,
    `Exec=${exec}`,
    `Icon=${desktopValue(icon || 'applications-games')}`,
    'Terminal=false',
    'Categories=Game;',
    ...extra,
    '',
  ].join('\n');
}

// File managers only run desktop files the user marked as trusted (GNOME:
// metadata::trusted, Xfce: a checksum of the file). Best effort.
function markTrusted(file) {
  return new Promise((resolve) => {
    let sum = '';
    try {
      sum = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    } catch {
      /* ignore */
    }
    execFile('gio', ['set', file, 'metadata::trusted', 'true'], () => {
      if (!sum) return resolve();
      execFile('gio', ['set', '-t', 'string', file, 'metadata::xfce-exe-checksum', sum], () => resolve());
    });
  });
}

function refreshMenus(dir) {
  execFile('update-desktop-database', [dir], () => {});
}

function linuxAppsDir() {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'applications');
}

function linuxIconsDir() {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'icons', 'hicolor');
}

function slugOf(id) {
  const s = String(id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const h = crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 6);
  return `${s || 'instancia'}-${h}`;
}

async function createDesktopShortcut({ electron, exe, preArgs = [], instanceId, name, iconPng, instanceRoot, iconDir }) {
  const desktop = electron ? electron.app.getPath('desktop') : path.join(os.homedir(), 'Desktop');
  const label = safeName(name, 'Minecraft');
  const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
  const argString = [...preArgs.map(q), '--launch', q(instanceId)].join(' ');
  if (process.platform === 'win32') {
    let icon;
    if (iconPng) {
      icon = path.join(instanceRoot, 'icon.ico');
      await fsp.writeFile(icon, pngToIco(iconPng));
    }
    const file = path.join(desktop, `${label}.lnk`);
    const ok = electron.shell.writeShortcutLink(file, 'create', {
      target: exe,
      cwd: path.dirname(exe),
      args: argString,
      description: `Jugar ${name} (Havi Hub)`,
      ...(icon ? { icon, iconIndex: 0 } : {}),
    });
    if (!ok) throw new UserError('Windows no permitió crear el acceso directo');
    return { files: [file] };
  }
  if (process.platform === 'linux') {
    const slug = slugOf(instanceId);
    let icon = '';
    if (iconPng) {
      // kept outside the instance so the shortcut keeps its picture
      const dir = iconDir || path.join(linuxIconsDir(), '256x256', 'apps');
      await fsp.mkdir(dir, { recursive: true });
      icon = path.join(dir, `${APP_ICON}-${slug}.png`);
      await fsp.writeFile(icon, iconPng);
    }
    const exec = [exe, ...preArgs, '--launch', instanceId].map(desktopArg).join(' ');
    const content = desktopEntry({
      name,
      comment: `Jugar ${name} en Havi Hub`,
      exec,
      icon: icon || APP_ICON,
      extra: ['StartupNotify=true', `X-HaviHub-Instance=${desktopValue(instanceId)}`],
    });
    const files = [];
    await fsp.mkdir(desktop, { recursive: true });
    const onDesktop = path.join(desktop, `${label}.desktop`);
    await fsp.writeFile(onDesktop, content, { mode: 0o755 });
    await fsp.chmod(onDesktop, 0o755).catch(() => {});
    await markTrusted(onDesktop);
    files.push(onDesktop);
    const apps = linuxAppsDir();
    await fsp.mkdir(apps, { recursive: true });
    const inMenu = path.join(apps, `${APP_ICON}-${slug}.desktop`);
    await fsp.writeFile(inMenu, content, { mode: 0o755 });
    // the same profile's entry under the old name, so it isn't listed twice
    await fsp.rm(path.join(apps, `${LEGACY_ICON}-${slug}.desktop`), { force: true }).catch(() => {});
    refreshMenus(apps);
    files.push(inMenu);
    return { files };
  }
  if (process.platform === 'darwin') {
    const file = path.join(desktop, `${label}.command`);
    await fsp.writeFile(file, `#!/bin/sh\n${q(exe)} ${argString} &\n`, { mode: 0o755 });
    return { files: [file] };
  }
  throw new UserError('Plataforma no soportada');
}

// ---- Havi Hub in the Linux application menu (AppImage / unpacked builds)

function appDesktopEntry(exe, preArgs = []) {
  const exec = [exe, ...preArgs].map(desktopArg).join(' ');
  return desktopEntry({
    name: 'Havi Hub',
    comment: 'Launcher de Minecraft',
    exec: `${exec} %U`,
    icon: APP_ICON,
    extra: ['StartupNotify=true', `StartupWMClass=${APP_ICON}`, 'Keywords=minecraft;mods;modpack;launcher;curseforge;modrinth;', 'X-HaviHub=1'],
  });
}

// The menu entry with the old name (havi-hub.desktop) and its icon, if they are
// Havi Hub's own (a package's files are left to the package). True if removed.
async function removeLegacyUserEntry(apps) {
  const file = path.join(apps, LEGACY_DESKTOP);
  const text = await fsp.readFile(file, 'utf8').catch(() => '');
  if (!/^X-HaviHub=1$/m.test(text)) return false;
  await fsp.rm(file, { force: true }).catch(() => {});
  await fsp.rm(path.join(linuxIconsDir(), '512x512', 'apps', `${LEGACY_ICON}.png`), { force: true }).catch(() => {});
  return true;
}

// ~/.local/share/applications/havihub.desktop + its icon. Rewritten when the
// AppImage moved; returns what changed.
async function installUserMenuEntry({ exe, preArgs = [], iconPng }) {
  const apps = linuxAppsDir();
  const file = path.join(apps, APP_DESKTOP);
  const content = appDesktopEntry(exe, preArgs);
  const current = await fsp.readFile(file, 'utf8').catch(() => '');
  const iconFile = path.join(linuxIconsDir(), '512x512', 'apps', `${APP_ICON}.png`);
  let changed = await removeLegacyUserEntry(apps);
  if (iconPng) {
    const old = await fsp.readFile(iconFile).catch(() => null);
    if (!old || !old.equals(iconPng)) {
      await fsp.mkdir(path.dirname(iconFile), { recursive: true });
      await fsp.writeFile(iconFile, iconPng);
      changed = true;
    }
  }
  if (current !== content) {
    await fsp.mkdir(apps, { recursive: true });
    await fsp.writeFile(file, content, { mode: 0o755 });
    changed = true;
  }
  if (changed) {
    refreshMenus(apps);
    execFile('gtk-update-icon-cache', ['-f', '-t', linuxIconsDir()], () => {});
  }
  return { file, icon: iconFile, changed };
}

async function removeUserMenuEntry() {
  const apps = linuxAppsDir();
  await fsp.rm(path.join(apps, APP_DESKTOP), { force: true });
  await removeLegacyUserEntry(apps);
  refreshMenus(apps);
}

async function userMenuEntryState() {
  const file = path.join(linuxAppsDir(), APP_DESKTOP);
  const user = await fsp.readFile(file, 'utf8').catch(() => '');
  // an older package (or copy for every user) may still use the old name
  let systemFile = '';
  for (const name of [APP_DESKTOP, LEGACY_DESKTOP]) {
    const f = path.join('/usr/share/applications', name);
    if (!systemFile && (await fsp.readFile(f, 'utf8').catch(() => ''))) systemFile = f;
  }
  return { user: Boolean(user), userFile: file, system: Boolean(systemFile), systemFile: systemFile || path.join('/usr/share/applications', APP_DESKTOP) };
}

// For every user: copy the AppImage to /opt/havihub and add the menu entry
// to /usr/share/applications. Needs the administrator password (pkexec).
// A copy under the old name (/opt/havi-hub) is replaced.
function installSystemMenuEntry({ appImage, iconFile }) {
  const target = '/opt/havihub/HaviHub.AppImage';
  const legacyTarget = '/opt/havi-hub/HaviHub.AppImage';
  const legacyDesktop = `/usr/share/applications/${LEGACY_DESKTOP}`;
  const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const desktop = appDesktopEntry(target);
  const script = [
    'set -e',
    `if [ -f ${legacyDesktop} ] && grep -q ${sh(legacyTarget)} ${legacyDesktop}; then rm -f ${legacyDesktop} /usr/share/icons/hicolor/512x512/apps/${LEGACY_ICON}.png; fi`,
    `rm -f ${legacyTarget}`,
    'rmdir /opt/havi-hub 2>/dev/null || true',
    'mkdir -p /opt/havihub /usr/share/applications /usr/share/icons/hicolor/512x512/apps',
    `cp -f ${sh(appImage)} ${sh(target)}`,
    `chmod 755 ${sh(target)}`,
    iconFile ? `cp -f ${sh(iconFile)} /usr/share/icons/hicolor/512x512/apps/${APP_ICON}.png` : 'true',
    `printf '%s' ${sh(desktop)} > /usr/share/applications/${APP_DESKTOP}`,
    `chmod 644 /usr/share/applications/${APP_DESKTOP}`,
    'command -v update-desktop-database >/dev/null && update-desktop-database /usr/share/applications || true',
    'command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true',
  ].join('\n');
  return new Promise((resolve, reject) => {
    execFile('pkexec', ['sh', '-c', script], { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (!err) return resolve({ file: `/usr/share/applications/${APP_DESKTOP}`, exe: target });
      const msg = String(stderr || err.message || '');
      if (err.code === 126 || /dismissed|Not authorized|cancel/i.test(msg)) return reject(Object.assign(new UserError('Se canceló la contraseña de administrador.'), { code: 'CANCELLED' }));
      if (err.code === 'ENOENT') return reject(new UserError('Falta pkexec (polkit). Instala Havi Hub con el paquete .deb para que aparezca para todos los usuarios.'));
      return reject(new Error(msg.trim() || 'No se pudo instalar para todos los usuarios'));
    });
  });
}

// The program an Exec line starts (its first argument, unquoted)
function execProgram(exec) {
  const m = /^"((?:[^"\\]|\\.)*)"/.exec(exec);
  const raw = m ? m[1].replace(/\\\\/g, '\\').replace(/\\(.)/g, '$1') : exec.split(/\s+/)[0] || '';
  return raw.replace(/%%/g, '%');
}

// Linux: shortcuts of profiles (made by createDesktopShortcut) whose program no
// longer exists — the package moved to /opt/havihub, or the AppImage was
// replaced by a newer file — start this copy instead. Those that show Havi
// Hub's icon by its old name ("havi-hub") get the current one. Returns how
// many changed.
async function repairLinuxShortcuts({ dirs, exe, preArgs = [] }) {
  let fixed = 0;
  for (const dir of dirs) {
    const names = (await fsp.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.desktop'));
    for (const n of names) {
      const file = path.join(dir, n);
      const text = await fsp.readFile(file, 'utf8').catch(() => '');
      const id = /^X-HaviHub-Instance=(.*)$/m.exec(text);
      const exec = /^Exec=(.*)$/m.exec(text);
      if (!id || !exec) continue;
      let out = text.replace(new RegExp(`^Icon=${LEGACY_ICON}$`, 'm'), () => `Icon=${APP_ICON}`);
      const program = execProgram(exec[1]);
      if (program && !(await fsp.access(program).then(() => true, () => false))) {
        const instanceId = id[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
        const line = `Exec=${[exe, ...preArgs, '--launch', instanceId].map(desktopArg).join(' ')}`;
        out = out.replace(exec[0], () => line);
      }
      if (out === text) continue;
      try {
        await fsp.writeFile(file, out, { mode: 0o755 });
        fixed++;
      } catch {
        // read-only: left as it is
      }
    }
  }
  if (fixed) refreshMenus(linuxAppsDir());
  return fixed;
}

module.exports = {
  repairLinuxShortcuts,
  createDesktopShortcut,
  pngToIco,
  desktopArg,
  desktopEntry,
  installUserMenuEntry,
  removeUserMenuEntry,
  userMenuEntryState,
  installSystemMenuEntry,
  appDesktopEntry,
  slugOf,
};
