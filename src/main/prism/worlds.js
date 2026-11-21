// Worlds (saves/*/level.dat) and servers (servers.dat).
const fsp = require('node:fs/promises');
const path = require('node:path');
const nbt = require('../util/nbt');
const { listDir, statSafe, exists, safeName, uniqueDirName, copyDir } = require('../util/fsx');
const { fileUrl } = require('../urls');
const { gameDirOf } = require('./instances');
const zip = require('../util/zip');
const { UserError } = require('../../shared/usertext');

const GAME_MODES = ['survival', 'creative', 'adventure', 'spectator'];

async function readLevel(worldDir) {
  const file = path.join(worldDir, 'level.dat');
  const buf = await fsp.readFile(file);
  const root = nbt.simplify(nbt.parse(buf).value);
  const data = root.Data || root.data || {};
  return {
    levelName: data.LevelName || path.basename(worldDir),
    gameMode: GAME_MODES[Number(data.GameType)] || 'survival',
    hardcore: Boolean(data.hardcore),
    lastPlayed: Number(data.LastPlayed) || 0,
    version: (data.Version && data.Version.Name) || '',
    seed: data.WorldGenSettings && data.WorldGenSettings.seed !== undefined ? String(data.WorldGenSettings.seed) : data.RandomSeed !== undefined ? String(data.RandomSeed) : '',
    cheats: Boolean(data.allowCommands),
  };
}

class Worlds {
  constructor(instances) {
    this.instances = instances;
  }

  async savesDir(id) {
    return path.join(gameDirOf(await this.instances.locate(id)), 'saves');
  }

  async list(id) {
    const saves = await this.savesDir(id);
    const out = [];
    for (const ent of await listDir(saves)) {
      if (!ent.isDirectory()) continue;
      const dir = path.join(saves, ent.name);
      if (!(await exists(path.join(dir, 'level.dat')))) continue;
      let lvl;
      try {
        lvl = await readLevel(dir);
      } catch {
        lvl = { levelName: ent.name, gameMode: 'survival', lastPlayed: 0, broken: true };
      }
      const icon = await statSafe(path.join(dir, 'icon.png'));
      const st = await statSafe(path.join(dir, 'level.dat'));
      out.push({
        folder: ent.name,
        path: dir,
        ...lvl,
        lastPlayed: lvl.lastPlayed || (st ? st.mtimeMs : 0),
        icon: icon ? fileUrl(path.join(dir, 'icon.png'), icon.mtimeMs) : null,
      });
    }
    out.sort((a, b) => b.lastPlayed - a.lastPlayed);
    return out;
  }

  async remove(id, folder, trashFn) {
    const dir = path.join(await this.savesDir(id), folder);
    if (trashFn) await trashFn(dir).catch(() => fsp.rm(dir, { recursive: true, force: true }));
    else await fsp.rm(dir, { recursive: true, force: true });
  }

  async duplicate(id, folder) {
    const saves = await this.savesDir(id);
    const dest = await uniqueDirName(saves, `${folder} - copia`);
    await copyDir(path.join(saves, folder), path.join(saves, dest), (p) => !p.endsWith('session.lock'));
    return dest;
  }

  async backup(id, folder) {
    const root = await this.instances.locate(id);
    const saves = await this.savesDir(id);
    const backups = path.join(gameDirOf(root), 'backups');
    await fsp.mkdir(backups, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const dest = path.join(backups, `${safeName(folder)}_${stamp}.zip`);
    const items = await zip.collectFiles(path.join(saves, folder), `${folder}/`, (rel) => rel === 'session.lock');
    await zip.writeZip(dest, items);
    return dest;
  }

  // Before updating mods or a modpack: all of saves/ in one zip, keeping the
  // last `keep` of these per profile.
  async backupAll(id, { keep = 3 } = {}) {
    const root = await this.instances.locate(id);
    const saves = await this.savesDir(id);
    const items = await zip.collectFiles(saves, 'saves/', (rel) => rel === 'session.lock' || rel.endsWith('/session.lock')).catch(() => []);
    if (!items.some((it) => !it.dir)) return null;
    const backups = path.join(gameDirOf(root), 'backups');
    await fsp.mkdir(backups, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..*$/, '');
    const dest = path.join(backups, `havihub-saves_${stamp}.zip`);
    await zip.writeZip(`${dest}.part`, items);
    await fsp.rename(`${dest}.part`, dest);
    const old = (await fsp.readdir(backups)).filter((n) => /^havihub-saves_.*\.zip$/.test(n)).sort().reverse();
    for (const n of old.slice(keep)) await fsp.rm(path.join(backups, n), { force: true });
    return dest;
  }

  async importZip(id, zipPath) {
    const saves = await this.savesDir(id);
    await fsp.mkdir(saves, { recursive: true });
    const names = await zip.listEntries(zipPath);
    const levelEntry = names.find((n) => /(^|\/)level\.dat$/.test(n));
    if (!levelEntry) throw new UserError('El zip no contiene un mundo (falta level.dat)');
    const prefix = levelEntry.slice(0, levelEntry.length - 'level.dat'.length);
    const base = prefix ? prefix.replace(/\/$/, '').split('/').pop() : path.basename(zipPath, '.zip');
    const dest = await uniqueDirName(saves, safeName(base, 'world'));
    await zip.extractPrefix(zipPath, prefix, path.join(saves, dest));
    return dest;
  }

  // ---- servers.dat ----
  async serversFile(id) {
    return path.join(gameDirOf(await this.instances.locate(id)), 'servers.dat');
  }

  async readServersTyped(id) {
    const file = await this.serversFile(id);
    if (!(await exists(file))) return { name: '', value: { servers: nbt.tag.list(nbt.T.Compound, []) } };
    const parsed = nbt.parse(await fsp.readFile(file));
    if (!parsed.value.servers) parsed.value.servers = nbt.tag.list(nbt.T.Compound, []);
    return parsed;
  }

  async listServers(id) {
    let typed;
    try {
      typed = await this.readServersTyped(id);
    } catch {
      return [];
    }
    const items = typed.value.servers.v.items || [];
    return items.map((c, index) => {
      const s = nbt.simplify(c);
      return {
        index,
        name: s.name || s.ip || 'Minecraft Server',
        ip: s.ip || '',
        icon: s.icon ? `data:image/png;base64,${s.icon}` : null,
        hidden: Boolean(s.hidden),
        acceptTextures: s.acceptTextures,
      };
    });
  }

  async writeServers(id, typed) {
    const file = await this.serversFile(id);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, nbt.serialize(typed));
  }

  async addServer(id, { name, ip }) {
    const typed = await this.readServersTyped(id);
    typed.value.servers.v.et = nbt.T.Compound;
    typed.value.servers.v.items.push({ name: nbt.tag.string(name || ip), ip: nbt.tag.string(ip) });
    await this.writeServers(id, typed);
  }

  async editServer(id, index, { name, ip }) {
    const typed = await this.readServersTyped(id);
    const item = typed.value.servers.v.items[index];
    if (!item) throw new UserError('Servidor no encontrado');
    if (name !== undefined) item.name = nbt.tag.string(name);
    if (ip !== undefined) item.ip = nbt.tag.string(ip);
    await this.writeServers(id, typed);
  }

  async removeServer(id, index) {
    const typed = await this.readServersTyped(id);
    typed.value.servers.v.items.splice(index, 1);
    await this.writeServers(id, typed);
  }
}

module.exports = { Worlds, readLevel };
