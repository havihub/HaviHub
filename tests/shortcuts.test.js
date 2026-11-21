// Linux: profile shortcuts keep working when the program they start moved
// (the package now installs to /opt/havihub; an AppImage carries its version in its name)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { repairLinuxShortcuts, desktopEntry, desktopArg } = require('../src/main/prism/shortcuts');

// .desktop files only exist on Linux, and their paths are written as on Linux
const linuxOnly = { skip: process.platform !== 'linux' };

test('a profile shortcut whose program is gone is pointed to this copy; working ones and foreign files stay', linuxOnly, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'havihub-sc-'));
  const exe = path.join(dir, 'opt', 'havihub', 'havihub');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  const other = path.join(dir, 'Other Copy.AppImage');
  fs.writeFileSync(other, '');
  const entry = (program, id) =>
    desktopEntry({ name: 'Vanilla', comment: 'Jugar', exec: [program, '--launch', id].map(desktopArg).join(' '), icon: '/home/u/.local/share/icons/hicolor/256x256/apps/havihub-vanilla.png', extra: ['StartupNotify=true', `X-HaviHub-Instance=${id}`] });
  const gone = path.join(dir, 'gone.desktop');
  const works = path.join(dir, 'works.desktop');
  const foreign = path.join(dir, 'foreign.desktop');
  fs.writeFileSync(gone, entry('/opt/havi-hub/havi-hub', 'Mi Perfil 1'));
  fs.writeFileSync(works, entry(other, 'p2'));
  fs.writeFileSync(foreign, '[Desktop Entry]\nType=Application\nName=X\nExec="/opt/Havi Hub/havi-hub" --launch p3\n');
  const before = { works: fs.readFileSync(works, 'utf8'), foreign: fs.readFileSync(foreign, 'utf8') };
  assert.equal(await repairLinuxShortcuts({ dirs: [dir, path.join(dir, 'missing')], exe, preArgs: [] }), 1);
  const out = fs.readFileSync(gone, 'utf8');
  assert.match(out, new RegExp(`^Exec=${exe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --launch "Mi Perfil 1"$`, 'm'));
  assert.match(out, /^X-HaviHub-Instance=Mi Perfil 1$/m);
  assert.match(out, /^Name=Vanilla$/m);
  assert.equal(fs.readFileSync(works, 'utf8'), before.works);
  assert.equal(fs.readFileSync(foreign, 'utf8'), before.foreign);
  assert.equal(await repairLinuxShortcuts({ dirs: [dir], exe, preArgs: [] }), 0);
});

test('a profile shortcut that shows Havi Hub\'s icon by its old name gets the current one', linuxOnly, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'havihub-sc-icon-'));
  const exe = path.join(dir, 'havihub');
  fs.writeFileSync(exe, '');
  const file = path.join(dir, 'p.desktop');
  fs.writeFileSync(file, desktopEntry({ name: 'P', comment: 'Jugar', exec: [exe, '--launch', 'p'].map(desktopArg).join(' '), icon: 'havi-hub', extra: [`X-HaviHub-Instance=p`] }));
  assert.equal(await repairLinuxShortcuts({ dirs: [dir], exe, preArgs: [] }), 1);
  const out = fs.readFileSync(file, 'utf8');
  assert.match(out, /^Icon=havihub$/m);
  assert.match(out, new RegExp(`^Exec=${exe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --launch p$`, 'm'), 'a program that still exists is kept');
  assert.equal(await repairLinuxShortcuts({ dirs: [dir], exe, preArgs: [] }), 0);
});
