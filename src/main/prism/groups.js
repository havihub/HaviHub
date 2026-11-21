// instgroups.json handling (same format Prism Launcher uses).
const path = require('node:path');
const fsp = require('node:fs/promises');
const { writeJson, exists, parseLenientJson } = require('../util/fsx');
const { UserError } = require('../../shared/usertext');

// Prism Launcher keeps instgroups.json inside the instances folder (so it is
// shared with Prism when both use the same folder). A copy left next to
// prismlauncher.cfg is read once and then moved.
async function groupsFile(ctx) {
  const { primaryInstanceDir } = await ctx.dirs();
  return path.join(primaryInstanceDir, 'instgroups.json');
}

function oldGroupsFile(ctx) {
  return ctx.groupsFile();
}

// Reads the groups file. A file that exists but can't be parsed (for example
// while Prism is writing it) throws instead of being treated as empty, so we
// never overwrite the user's groups with partial data.
async function loadGroups(ctx) {
  let file = await groupsFile(ctx);
  if (!(await exists(file)) && (await exists(oldGroupsFile(ctx)))) file = oldGroupsFile(ctx);
  let data = null;
  if (await exists(file)) {
    const text = await fsp.readFile(file, 'utf8');
    if (text.trim()) {
      try {
        data = parseLenientJson(text);
      } catch {
        const e = new UserError('No se pudo leer instgroups.json (¿Prism lo está guardando?). Intenta de nuevo en unos segundos.');
        e.code = 'GROUPS_UNREADABLE';
        throw e;
      }
    }
  }
  const map = new Map(); // instanceId -> group
  const hidden = new Set();
  const order = [];
  if (data && String(data.formatVersion) === '1' && data.groups && typeof data.groups === 'object') {
    for (const [name, g] of Object.entries(data.groups)) {
      if (!name || !g || !Array.isArray(g.instances)) continue;
      order.push(name);
      if (g.hidden) hidden.add(name);
      for (const id of g.instances) map.set(String(id), name);
    }
  }
  return { map, hidden, order, ungroupedHidden: Boolean(data && data.ungrouped && data.ungrouped.hidden) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries once (Prism may be mid-write); used before any change.
async function loadGroupsForWrite(ctx) {
  try {
    return await loadGroups(ctx);
  } catch (e) {
    if (e.code !== 'GROUPS_UNREADABLE') throw e;
    await sleep(400);
    return loadGroups(ctx);
  }
}

// For read-only views: an unreadable file just means "no groups" for now.
async function loadGroupsSafe(ctx) {
  try {
    return await loadGroupsForWrite(ctx);
  } catch {
    return { map: new Map(), hidden: new Set(), order: [], ungroupedHidden: false, unreadable: true };
  }
}

async function saveGroups(ctx, { map, hidden, ungroupedHidden }) {
  const groups = {};
  for (const [id, g] of map) {
    if (!g) continue;
    if (!groups[g]) groups[g] = { hidden: hidden.has(g), instances: [] };
    groups[g].instances.push(id);
  }
  const out = { formatVersion: '1', groups };
  if (ungroupedHidden) out.ungrouped = { hidden: true };
  const file = await groupsFile(ctx);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await writeJson(file, out, 4);
  const old = oldGroupsFile(ctx);
  if (path.resolve(old) !== path.resolve(file) && (await exists(old))) await fsp.rm(old, { force: true }).catch(() => {});
}

async function setInstanceGroup(ctx, id, group) {
  const g = await loadGroupsForWrite(ctx);
  if (group) g.map.set(id, group);
  else g.map.delete(id);
  await saveGroups(ctx, g);
}

async function renameGroup(ctx, from, to) {
  const g = await loadGroupsForWrite(ctx);
  for (const [id, name] of g.map) if (name === from) g.map.set(id, to);
  if (g.hidden.has(from)) {
    g.hidden.delete(from);
    g.hidden.add(to);
  }
  await saveGroups(ctx, g);
}

async function deleteGroup(ctx, name) {
  const g = await loadGroupsForWrite(ctx);
  for (const [id, n] of [...g.map]) if (n === name) g.map.delete(id);
  g.hidden.delete(name);
  await saveGroups(ctx, g);
}

async function removeInstance(ctx, id) {
  const g = await loadGroupsForWrite(ctx);
  if (g.map.delete(id)) await saveGroups(ctx, g);
}

module.exports = { loadGroups, loadGroupsSafe, loadGroupsForWrite, saveGroups, setInstanceGroup, renameGroup, deleteGroup, removeInstance, groupsFile };
