// Stopping a task from anywhere in its work: the task manager runs each task
// inside an async context, so downloads, copies and loops started by that task
// can see whether it was cancelled without passing a signal around.
const { AsyncLocalStorage } = require('node:async_hooks');
const { UserError } = require('../../shared/usertext');

const als = new AsyncLocalStorage();

function cancelledError() {
  const e = new UserError('Cancelado');
  e.code = 'CANCELLED';
  return e;
}

function runInTask(task, fn) {
  return als.run(task, fn);
}

function currentSignal() {
  const t = als.getStore();
  return t && t.signal ? t.signal : null;
}

function throwIfCancelled() {
  const s = currentSignal();
  if (s && s.aborted) throw cancelledError();
}

module.exports = { runInTask, currentSignal, throwIfCancelled, cancelledError };
