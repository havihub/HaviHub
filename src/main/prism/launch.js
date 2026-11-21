// Starting games through Havi Hub's private engine (an official Prism
// Launcher build, see engine.js):
//   engine --dir <data> --launch <id> [--server addr | --world folder] [--profile name] [--offline name]
// The engine shows no window of its own except a short progress dialog while
// it prepares the game files (styled with Havi Hub's colors).
const { spawn } = require('node:child_process');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { killTree } = require('../engine');
const { UserError } = require('../../shared/usertext');

class Launcher {
  constructor(ctxProvider, emit, { engine, prepare, gameDir, onEngineStart, ensureJava } = {}) {
    this.ensureJava = ensureJava || (async () => null);
    this.gameDir = gameDir || (async () => null);
    this.onEngineStart = onEngineStart || (() => {});
    this.ctxProvider = ctxProvider;
    this.emit = emit;
    this.engine = engine;
    this.prepare = prepare || (async () => {});
    this.running = new Map(); // instanceId -> { child, startedAt, stopped }
    this.starting = new Set();
  }

  anyEngineRunning() {
    for (const r of this.running.values()) if (r.child && r.child.exitCode === null) return true;
    return this.starting.size > 0;
  }

  async launch(id, { server, world, profile, offline, offlineName } = {}) {
    const ctx = this.ctxProvider();
    if (!ctx) throw Object.assign(new UserError('La carpeta de datos de Havi Hub no está disponible.'), { code: 'NO_DATA' });
    if (this.running.has(id) || this.starting.has(id)) return { already: true };
    this.starting.add(id);
    this.emit('instance:running', { id, running: true, preparing: true });
    let exe;
    try {
      exe = await this.engine.ensure();
      // the engine's settings and the Java its Minecraft needs (8, 17, 21…,
      // downloaded if missing) at the same time
      await Promise.all([this.prepare(), this.ensureJava(id)]);
    } catch (e) {
      this.starting.delete(id);
      this.emit('instance:running', { id, running: false, error: String(e.message || e) });
      throw e;
    }
    const args = ['--dir', ctx.dataDir, '--launch', id];
    if (server) args.push('--server', server);
    else if (world) args.push('--world', world);
    if (offline) args.push('--offline', offlineName || 'Player');
    else if (profile) args.push('--profile', profile);
    // detached: the game keeps running if Havi Hub is closed (on Windows a
    // non-detached child is killed together with its parent)
    const child = spawn(exe, args, {
      cwd: ctx.dataDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    try {
      this.onEngineStart(exe);
    } catch {
      /* only cosmetic */
    }
    const startedAt = Date.now();
    const entry = { child, startedAt, stopped: false, preparing: true };
    this.starting.delete(id);
    this.running.set(id, entry);
    // "Starting…" until the game itself writes its log
    this.emit('instance:running', { id, running: true, preparing: true, startedAt });
    this.watchGameStart(id, entry);
    child.on('error', (err) => {
      this.running.delete(id);
      this.emit('instance:running', { id, running: false, error: String(err.message || err) });
    });
    child.on('exit', (code) => {
      const quick = Date.now() - startedAt < 5000;
      // A quick exit with code 0: the request went to an engine that was
      // already running another game; follow that process instead.
      if (quick && code === 0) {
        const other = [...this.running.entries()].find(([oid, r]) => oid !== id && r.child && r.child.exitCode === null);
        if (other) {
          entry.child = other[1].child;
          other[1].child.once('exit', () => {
            this.running.delete(id);
            this.emit('instance:running', { id, running: false, code: 0 });
          });
          return;
        }
      }
      this.running.delete(id);
      const done = (end) =>
        this.emit('instance:running', { id, running: false, code, forwarded: quick && code === 0, crashed: end.kind === 'crash' || end.kind === 'failed', crash: end.kind === 'crash' ? { file: end.file } : null, failed: end.kind === 'failed', startedAt, endedAt: Date.now() });
      if (entry.stopped) done({ kind: 'stopped' });
      else this.howItEnded(id, entry, code).then(done, () => done({ kind: 'closed' }));
    });
    child.unref();
    return { pid: child.pid };
  }

  // How a game ended: 'crash' (with the file that tells why), 'failed' (it
  // never got to start), or 'closed' when the player closed it, normally or by
  // force. A crash leaves a crash report (Minecraft) or an hs_err_pid file
  // (Java itself); a game that dies with an error at the end of its log
  // counts too. A non-zero exit with a calm log is the player ending it.
  async howItEnded(id, entry, code) {
    const dir = await this.gameDir(id).catch(() => null);
    const since = entry.startedAt - 1000;
    if (dir) {
      const report = await newestFile(path.join(dir, 'crash-reports'), /\.txt$/i, since);
      if (report) return { kind: 'crash', file: `crash-reports/${report}` };
      const jvm = await newestFile(dir, /^hs_err_pid\d+\.log$/i, since);
      if (jvm) return { kind: 'crash', file: jvm };
    }
    if (code === 0 || code === null) return { kind: 'closed' };
    if (entry.preparing) return { kind: 'failed' };
    const lines = dir ? (await tailOf(path.join(dir, 'logs', 'latest.log'), 64 * 1024)).split(/\r?\n/).filter(Boolean) : [];
    if (lines.some((l) => /\bStopping!/.test(l))) return { kind: 'closed' };
    if (lines.slice(-25).some((l) => CRASH_LINE.test(l))) return { kind: 'crash', file: 'logs/latest.log' };
    return { kind: 'closed' };
  }

  watchGameStart(id, entry) {
    let timer = null;
    const started = () => {
      clearInterval(timer);
      if (!entry.preparing || this.running.get(id) !== entry) return;
      entry.preparing = false;
      this.emit('instance:running', { id, running: true, preparing: false, startedAt: entry.startedAt });
    };
    const check = async () => {
      if (this.running.get(id) !== entry || !entry.preparing) return clearInterval(timer);
      if (Date.now() - entry.startedAt > 4 * 60 * 1000) return started(); // very old versions have no latest.log
      const dir = await this.gameDir(id).catch(() => null);
      if (!dir) return undefined;
      const st = await fsp.stat(path.join(dir, 'logs', 'latest.log')).catch(() => null);
      if (st && st.mtimeMs > entry.startedAt - 500) started();
      return undefined;
    };
    timer = setInterval(check, 1500);
  }

  isRunning(id) {
    return this.running.has(id) || this.starting.has(id);
  }

  runningIds() {
    return [...new Set([...this.running.keys(), ...this.starting])];
  }

  stop(id) {
    const r = this.running.get(id);
    if (!r || !r.child) return false;
    r.stopped = true;
    killTree(r.child.pid);
    return true;
  }
}

// a line that tells the game stopped because of an error
const CRASH_LINE = /\/FATAL\]|Exception in thread|has crashed|Crash report|Caused by:|\bjava\.lang\.\w*(Error|Exception)\b/;

// the newest file in a folder that matches, changed after a moment
async function newestFile(dir, re, since) {
  let best = null;
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!re.test(name)) continue;
    const st = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (st && st.isFile() && st.mtimeMs >= since && (!best || st.mtimeMs > best.t)) best = { name, t: st.mtimeMs };
  }
  return best ? best.name : null;
}

// the last bytes of a text file
async function tailOf(file, bytes) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const { size } = await fh.stat();
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

module.exports = { Launcher, howItEndedForTests: { newestFile, tailOf, CRASH_LINE } };
