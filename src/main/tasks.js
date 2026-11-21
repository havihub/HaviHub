// Background task tracking (downloads, installs, exports) with progress events
// that the renderer shows in the downloads panel. Tasks can be cancelled:
// their downloads and copies stop (see util/cancel.js) and the cleanup
// functions they registered undo what was left half done.
const { runInTask, cancelledError } = require('./util/cancel');
const { plain, textOf, tr } = require('../shared/usertext');

// title, detail and error are kept as Spanish text (as always) and as the
// template the interface translates (titleText, detailText, errorText; see
// shared/usertext.js)
function setText(t, field, value) {
  t[field] = value === null ? null : plain(value);
  t[`${field}Text`] = value === null || value === undefined || value === '' ? null : textOf(value);
}

let nextId = 1;

// waits for `promise` at most `ms`; the timer never outlives the wait
function within(promise, ms) {
  let timer;
  const limit = new Promise((r) => {
    timer = setTimeout(r, ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

class TaskManager {
  constructor(emit) {
    this.emit = emit;
    this.tasks = new Map();
    this.control = new Map(); // id -> { controller, cleanups, settled }
    this.timer = null;
  }

  // cancelable: false for work that must not stop half way (moving folders)
  create(title, { kind = 'generic', instanceId = null, cancelable = true } = {}) {
    const id = nextId++;
    const t = { id, title: '', kind, instanceId, progress: 0, status: 'running', detail: '', startedAt: Date.now(), error: null, cancelable };
    setText(t, 'title', title);
    setText(t, 'detail', '');
    setText(t, 'error', null);
    const controller = new AbortController();
    const ctl = { controller, cleanups: [], settled: null };
    let settle;
    ctl.settled = new Promise((r) => {
      settle = r;
    });
    this.tasks.set(id, t);
    this.control.set(id, ctl);
    this.flush();
    const finish = () => {
      settle();
      this.control.delete(id);
    };
    const api = {
      id,
      signal: controller.signal,
      cancelled: () => controller.signal.aborted,
      check: () => {
        if (controller.signal.aborted) throw cancelledError();
      },
      // undo half-done work if the task is cancelled
      onCancel: (fn) => ctl.cleanups.push(fn),
      set: (patch) => {
        const p = { ...patch };
        for (const f of ['title', 'detail']) {
          if (f in p) {
            setText(t, f, p[f]);
            delete p[f];
          }
        }
        Object.assign(t, p);
        this.schedule();
      },
      progress: (p, detail) => {
        t.progress = Math.max(0, Math.min(1, p));
        if (detail !== undefined) setText(t, 'detail', detail);
        this.schedule();
      },
      done: (detail) => {
        if (t.status !== 'running') return finish();
        t.status = 'done';
        t.progress = 1;
        if (detail !== undefined) setText(t, 'detail', detail);
        t.finishedAt = Date.now();
        this.flush();
        this.cleanup();
        return finish();
      },
      fail: (err) => {
        if (t.status === 'running') {
          const cancelled = controller.signal.aborted || (err && err.code === 'CANCELLED');
          t.status = cancelled ? 'cancelled' : 'error';
          setText(t, 'error', cancelled ? null : err && err.message ? err : String(err));
          if (cancelled) setText(t, 'detail', tr('Cancelado'));
          t.finishedAt = Date.now();
          this.flush();
          this.cleanup();
        }
        return finish();
      },
    };
    return api;
  }

  async run(title, opts, fn) {
    const task = this.create(title, opts);
    try {
      const res = await runInTask(task, () => fn(task));
      if (task.cancelled()) throw cancelledError();
      task.done();
      return res;
    } catch (e) {
      const err = task.cancelled() ? cancelledError() : e;
      task.fail(err);
      throw err;
    }
  }

  list() {
    return [...this.tasks.values()].sort((a, b) => b.id - a.id);
  }

  running() {
    return this.list().filter((t) => t.status === 'running');
  }

  // Stop one task: its downloads end now, then its cleanups run.
  async cancel(id) {
    const t = this.tasks.get(id);
    const ctl = this.control.get(id);
    if (!t || !ctl || t.status !== 'running' || !t.cancelable) return false;
    ctl.controller.abort();
    t.status = 'cancelled';
    setText(t, 'detail', tr('Cancelado'));
    t.finishedAt = Date.now();
    this.flush();
    // wait a little for the work to notice, then undo what it left
    await within(ctl.settled, 3000);
    for (const fn of ctl.cleanups.reverse()) {
      try {
        await fn();
      } catch {
        /* best effort */
      }
    }
    return true;
  }

  async cancelAll() {
    const ids = this.running()
      .filter((t) => t.cancelable)
      .map((t) => t.id);
    await Promise.all(ids.map((id) => this.cancel(id)));
    return ids.length;
  }

  // Resolves when the tasks that can't be cancelled have finished.
  async waitForUncancelable(timeoutMs = 10 * 60 * 1000) {
    const waits = this.running()
      .filter((t) => !t.cancelable)
      .map((t) => (this.control.get(t.id) || {}).settled)
      .filter(Boolean);
    if (!waits.length) return;
    await within(Promise.all(waits), timeoutMs);
  }

  clearFinished() {
    for (const [id, t] of this.tasks) if (t.status !== 'running') this.tasks.delete(id);
    this.flush();
  }

  cleanup() {
    // keep the last 30 finished tasks
    const finished = this.list().filter((t) => t.status !== 'running');
    for (const t of finished.slice(30)) this.tasks.delete(t.id);
  }

  schedule() {
    if (this.timer) return;
    // four times a second: each update redraws the page's task list and bars
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 250);
  }

  flush() {
    this.emit('tasks:update', this.list());
  }
}

module.exports = { TaskManager };
