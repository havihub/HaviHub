// Game logs (logs/*.log, *.log.gz, crash-reports, Java's hs_err_pid reports)
// with live tail of latest.log.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { listDir, statSafe } = require('../util/fsx');
const { gameDirOf } = require('./instances');
const zip = require('../util/zip');
const http = require('../util/http');
const { fileUrl } = require('../urls');
const { UserError } = require('../../shared/usertext');

const MAX_BYTES = 6 * 1024 * 1024;

class Logs {
  constructor(instances, emit) {
    this.instances = instances;
    this.emit = emit;
    this.watchers = new Map(); // id -> { watcher, offset, file }
  }

  async list(id) {
    const game = gameDirOf(await this.instances.locate(id));
    const out = [];
    for (const [dir, kind] of [
      ['logs', 'log'],
      ['crash-reports', 'crash'],
    ]) {
      for (const ent of await listDir(path.join(game, dir))) {
        if (!ent.isFile() || !/\.(log|log\.gz|txt)$/i.test(ent.name)) continue;
        const full = path.join(game, dir, ent.name);
        const st = await statSafe(full);
        out.push({ name: ent.name, path: full, kind, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0, rel: `${dir}/${ent.name}` });
      }
    }
    // Java's own report when the game itself crashes (in the game folder)
    for (const ent of await listDir(game)) {
      if (!ent.isFile() || !/^hs_err_pid\d+\.log$/i.test(ent.name)) continue;
      const full = path.join(game, ent.name);
      const st = await statSafe(full);
      out.push({ name: ent.name, path: full, kind: 'crash', size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0, rel: ent.name });
    }
    out.sort((a, b) => {
      if (a.name === 'latest.log') return -1;
      if (b.name === 'latest.log') return 1;
      return b.mtime - a.mtime;
    });
    return out;
  }

  async read(id, rel) {
    const game = gameDirOf(await this.instances.locate(id));
    const file = path.resolve(game, rel || 'logs/latest.log');
    if (!file.startsWith(path.resolve(game))) throw new UserError('Ruta inválida');
    const st = await statSafe(file);
    if (!st) return { text: '', truncated: false, size: 0, path: file };
    let buf;
    if (file.endsWith('.gz')) {
      buf = zlib.gunzipSync(await fsp.readFile(file));
    } else if (st.size > MAX_BYTES) {
      const fh = await fsp.open(file, 'r');
      buf = Buffer.alloc(MAX_BYTES);
      await fh.read(buf, 0, MAX_BYTES, st.size - MAX_BYTES);
      await fh.close();
    } else {
      buf = await fsp.readFile(file);
    }
    const truncated = buf.length > MAX_BYTES || st.size > MAX_BYTES;
    if (buf.length > MAX_BYTES) buf = buf.subarray(buf.length - MAX_BYTES);
    return { text: buf.toString('utf8'), truncated, size: st.size, path: file };
  }

  // Live tail of latest.log while the game is running
  async watch(id) {
    this.unwatch(id);
    const game = gameDirOf(await this.instances.locate(id));
    const file = path.join(game, 'logs', 'latest.log');
    const st = await statSafe(file);
    const state = { offset: st ? st.size : 0, file, timer: null };
    const poll = async () => {
      const s = await statSafe(file);
      if (!s) return;
      if (s.size < state.offset) {
        state.offset = 0;
        this.emit('logs:reset', { id });
      }
      if (s.size > state.offset) {
        const len = Math.min(s.size - state.offset, MAX_BYTES);
        const fh = await fsp.open(file, 'r');
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, s.size - len);
        await fh.close();
        state.offset = s.size;
        this.emit('logs:append', { id, text: buf.toString('utf8') });
      }
    };
    state.timer = setInterval(() => poll().catch(() => {}), 1000);
    this.watchers.set(id, state);
  }

  unwatch(id) {
    const w = this.watchers.get(id);
    if (w) clearInterval(w.timer);
    this.watchers.delete(id);
  }

  async createZip(id) {
    const root = await this.instances.locate(id);
    const game = gameDirOf(root);
    const items = [];
    for (const dir of ['logs', 'crash-reports']) {
      items.push(...(await zip.collectFiles(path.join(game, dir), `${dir}/`)));
    }
    const dest = path.join(root, 'logs.zip');
    await zip.writeZip(dest, items);
    return dest;
  }

  // Upload to mclo.gs (the default paste service in Prism Launcher)
  async upload(text) {
    const body = new URLSearchParams({ content: text.slice(-10 * 1024 * 1024) });
    const res = await http.request('https://api.mclo.gs/1/log', {
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'No se pudo subir el log');
    return j.url;
  }
}

const { pngSize, thumbUrl } = require('../thumbs');

class Screenshots {
  constructor(instances) {
    this.instances = instances;
  }

  async dir(id) {
    return path.join(gameDirOf(await this.instances.locate(id)), 'screenshots');
  }

  async list(id) {
    const dir = await this.dir(id);
    const out = [];
    for (const ent of await listDir(dir)) {
      if (!ent.isFile() || !/\.(png|jpe?g)$/i.test(ent.name)) continue;
      const full = path.join(dir, ent.name);
      const st = await statSafe(full);
      const dim = /\.png$/i.test(ent.name) ? await pngSize(full) : null;
      out.push({ name: ent.name, path: full, url: fileUrl(full, st ? st.mtimeMs : 0), thumb: thumbUrl(full, st ? st.mtimeMs : 0), mtime: st ? st.mtimeMs : 0, size: st ? st.size : 0, width: dim ? dim.w : 0, height: dim ? dim.h : 0 });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  }

  // Every screenshot of every instance, newest first
  async listAll() {
    const { instances: insts } = await this.instances.list();
    const out = [];
    await Promise.all(
      insts.map(async (inst) => {
        if (inst.broken || !inst.root) return;
        const dir = path.join(inst.gameDir || gameDirOf(inst.root), 'screenshots');
        for (const ent of await listDir(dir)) {
          if (!ent.isFile() || !/\.(png|jpe?g)$/i.test(ent.name)) continue;
          const full = path.join(dir, ent.name);
          const st = await statSafe(full);
          if (!st) continue;
          const dim = /\.png$/i.test(ent.name) ? await pngSize(full) : null;
          out.push({
            key: `${inst.id}/${ent.name}`,
            instanceId: inst.id,
            name: ent.name,
            path: full,
            url: fileUrl(full, st.mtimeMs),
            thumb: thumbUrl(full, st.mtimeMs),
            mtime: st.mtimeMs,
            size: st.size,
            width: dim ? dim.w : 0,
            height: dim ? dim.h : 0,
          });
        }
      }),
    );
    out.sort((a, b) => b.mtime - a.mtime || (a.key < b.key ? -1 : 1));
    return out;
  }

  async remove(id, name, trashFn) {
    const full = path.join(await this.dir(id), path.basename(name));
    if (trashFn) await trashFn(full).catch(() => fsp.rm(full, { force: true }));
    else await fsp.rm(full, { force: true });
  }
}

module.exports = { Logs, Screenshots, fs };
