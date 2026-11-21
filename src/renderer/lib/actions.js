// Instance actions shared by the library cards, context menus and the instance page.
import BlockedFilesDialog from '../dialogs/BlockedFilesDialog.jsx';
import { call } from './api.js';
import { t, tm } from './i18n.js';
import ImageDialog from '../dialogs/ImageDialog.jsx';
import IconEditorDialog from '../dialogs/IconEditorDialog.jsx';
import { instanceRecipe } from '../components/InstanceImage.jsx';
import { iconPng, recipeKey, parseRecipe, defaultRecipe } from './instance-icons.js';
import ProfileOptionsDialog from '../dialogs/ProfileOptionsDialog.jsx';
import { CloneDialog, ShareDialog, MoveGroupDialog, InstallResultDialog } from '../dialogs/InstanceDialogs.jsx';
import LaunchSettingsDialog from '../dialogs/LaunchSettingsDialog.jsx';

// Upload a picture of the user's as the instance image (kept at full size).
export async function changeImage(app, inst) {
  const r = await app.openDialog(ImageDialog, { current: inst.icon });
  if (!r) return;
  try {
    if (r.reset) await call('instances.resetImage', inst.id);
    else await call('instances.setImage', inst.id, r.png);
    await app.refreshInstances();
  } catch (e) {
    app.showError(e);
  }
}

// The picture on a group's card: an icon made in the editor or a picture of
// the user's, the same choices a profile has.
export async function editGroupImage(app, name) {
  const current = (app.groupImages || {})[name];
  const r = await app.openDialog(IconEditorDialog, { current: parseRecipe(current && current.recipe) || defaultRecipe(name), allowUpload: true });
  try {
    if (r && r.upload) {
      const p = await app.openDialog(ImageDialog, { current: current && current.url, allowReset: Boolean(current) });
      if (!p) return;
      if (p.reset) await call('instances.resetGroupImage', name);
      else await call('instances.setGroupImage', name, p.png);
    } else if (r && r.recipe) {
      await call('instances.setGroupImage', name, await iconPng(r.recipe), { recipe: recipeKey(r.recipe) });
    } else return;
    await app.refreshInstances();
  } catch (e) {
    app.showError(e);
  }
}

export async function resetGroupImage(app, name) {
  try {
    await call('instances.resetGroupImage', name);
    await app.refreshInstances();
  } catch (e) {
    app.showError(e);
  }
}

// "Cambiar ícono": the icon editor (background + symbol), which also leads to
// uploading a picture of your own.
export async function editIcon(app, inst) {
  const r = await app.openDialog(IconEditorDialog, { current: instanceRecipe(inst), allowUpload: true });
  if (r && r.upload) return changeImage(app, inst);
  if (!r || !r.recipe) return;
  try {
    await call('instances.setImage', inst.id, await iconPng(r.recipe), { recipe: recipeKey(r.recipe) });
    await app.refreshInstances();
  } catch (e) {
    app.showError(e);
  }
}

export async function cloneInstance(app, inst) {
  const id = await app.openDialog(CloneDialog, { instance: inst });
  if (id) {
    await app.refreshInstances();
    app.navigate({ page: 'instance', id, tab: 'content', sub: 'mods' });
  }
}

export async function shareInstance(app, inst) {
  await app.openDialog(ShareDialog, { instance: inst });
}

export async function moveToGroup(app, inst) {
  const g = await app.openDialog(MoveGroupDialog, { instance: inst });
  if (g !== null && g !== undefined) await app.refreshInstances();
}

export async function moveManyToGroup(app, list) {
  const g = await app.openDialog(MoveGroupDialog, { instances: list });
  if (g !== null && g !== undefined) await app.refreshInstances();
  return g !== null && g !== undefined;
}

export async function deleteMany(app, list) {
  const ok = await app.confirm({
    title: t('Eliminar perfiles'),
    message: t('¿Eliminar {n} perfiles? Se moverán a la papelera junto con sus mundos, mods y capturas.', { n: list.length }),
    confirmLabel: t('Eliminar'),
    danger: true,
  });
  if (!ok) return false;
  for (const inst of list) {
    try {
      await call('instances.remove', inst.id);
    } catch (e) {
      app.showError(e);
    }
  }
  await app.refreshInstances();
  app.toast(t('Perfiles eliminados'), { type: 'success' });
  return true;
}

export async function profileOptions(app, inst, section) {
  const changed = await app.openDialog(ProfileOptionsDialog, { instance: inst, initialSection: section });
  if (changed) await app.refreshInstances();
}

export async function deleteInstance(app, inst) {
  const ok = await app.confirm({
    title: t('Eliminar perfil'),
    message:
      t('¿Eliminar "{name}"? Se moverá a la papelera junto con sus mundos, mods y capturas.', { name: inst.name }) +
      (app.appState && app.appState.sharing && app.appState.sharing.active ? `\n\n${t('Compartes los perfiles con Prism Launcher, así que también desaparecerá de ahí.')}` : ''),
    confirmLabel: t('Eliminar'),
    danger: true,
  });
  if (!ok) return false;
  try {
    await call('instances.remove', inst.id);
    await app.refreshInstances();
    app.toast(t('Perfil eliminado'), { type: 'success' });
    if (app.route.page === 'instance') app.navigate({ page: 'library' }, { replace: true });
    return true;
  } catch (e) {
    app.showError(e);
    return false;
  }
}

export async function repairInstance(app, inst) {
  try {
    app.toast(t('Reparando {name}…', { name: inst.name }));
    const r = await call('instances.repair', inst.id);
    const lines = [];
    lines.push(t('{n} archivos verificados correctamente.', { n: r.ok }));
    if (r.redownloaded.length) lines.push(t('Se volvieron a descargar: {list}', { list: r.redownloaded.join(', ') }));
    if (r.removedMetadata.length) lines.push(t('Metadatos huérfanos eliminados: {list}', { list: r.removedMetadata.join(', ') }));
    if (r.problems.length) lines.push(t('Problemas: {list}', { list: r.problems.map((p) => (typeof p === 'string' ? p : `${p.file}: ${tm(p.error)}`)).join('; ') }));
    lines.push(t('Las librerías nativas se regenerarán al iniciar.'));
    await app.confirm({ title: t('Perfil reparado'), message: lines.join('\n\n'), confirmLabel: t('Listo'), cancelLabel: t('Cerrar'), icon: 'wrench' });
    app.bumpContent();
  } catch (e) {
    app.showError(e);
  }
}

export async function createShortcut(app, inst) {
  try {
    const r = await call('instances.shortcut', inst.id);
    const files = (r && r.files) || [];
    const menu = files.length > 1;
    app.toast(menu ? t('Lo encuentras en el escritorio y en el menú de aplicaciones. Al abrirlo, Havi Hub inicia {name}.', { name: inst.name }) : t('Al abrirlo, Havi Hub inicia {name}.', { name: inst.name }), {
      type: 'success',
      title: t('Acceso directo creado'),
    });
  } catch (e) {
    app.showError(e);
  }
}

export async function createLogsZip(app, inst) {
  try {
    await call('logs.zip', inst.id);
  } catch (e) {
    app.showError(e);
  }
}

export async function showInstallResult(app, result, title) {
  if (!result) return;
  // files that only CurseForge's own page may hand out: fetched from there
  // right now, and installed (dialogs/BlockedFilesDialog.jsx)
  const auto = (result.blocked || []).filter((b) => b.key && b.resume);
  if (auto.length) {
    const r = (await app.openDialog(BlockedFilesDialog, { entries: auto })) || { done: [] };
    const got = new Set(r.done.map((e) => e.key));
    result = {
      ...result,
      skipped: result.skipped || [],
      blocked: result.blocked.filter((b) => !got.has(b.key)),
      installed: [...(result.installed || []), ...r.done.map((e) => ({ title: e.title, fileName: e.fileName, version: '', isDep: false }))],
    };
  }
  const onlyOk = !result.blocked.length && !result.failed.length && !result.skipped.length;
  if (onlyOk && result.installed.length) {
    const deps = result.installed.filter((i) => i.isDep).length;
    app.toast(deps ? t('Instalado {name} (+{n} dependencias)', { name: result.installed[0].title, n: deps }) : t('Instalado {name}', { name: result.installed.map((i) => i.title).join(', ') }), { type: 'success' });
    return;
  }
  await app.openDialog(InstallResultDialog, { result, title });
}

// Import a modpack or an exported instance (.mrpack / .zip) chosen by the
// person. A Prism instance that would run something on this computer when it
// starts is shown first (LaunchSettingsDialog). Returns the result, or null.
export async function importArchive(app, opts = {}) {
  let r = await call('instances.import', opts);
  if (r && r.confirm === 'launchSettings') {
    const choice = await app.openDialog(LaunchSettingsDialog, { file: r.path.split(/[\\/]/).pop(), settings: r.settings });
    if (!choice) return null;
    r = await call('instances.import', { ...opts, path: r.path, launchSettings: choice });
  }
  if (r) await app.refreshInstances();
  return r;
}
