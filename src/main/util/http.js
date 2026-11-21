// HTTP helpers. Uses Electron's net.fetch when available (respects the system
// proxy), falling back to Node's global fetch (tests / CLI scripts).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { currentSignal, throwIfCancelled, cancelledError } = require('./cancel');
const { UserError } = require('../../shared/usertext');

// eslint-disable-next-line no-undef
const USER_AGENT = `HaviHub/${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'} (Minecraft launcher)`;

let fetchImpl = null;
function getFetch() {
  if (fetchImpl) return fetchImpl;
  try {
    const electron = require('electron');
    if (electron && typeof electron === 'object' && electron.net && typeof electron.net.fetch === 'function') {
      fetchImpl = electron.net.fetch.bind(electron.net);
      return fetchImpl;
    }
  } catch {
    /* not in electron */
  }
  fetchImpl = globalThis.fetch.bind(globalThis);
  return fetchImpl;
}

// For tests
let customFetch = false;
function setFetch(fn) {
  fetchImpl = fn;
  customFetch = Boolean(fn);
}

// One request that does not follow a redirect: a 3xx comes back as it is,
// with its Location. Electron's net.fetch cannot do this (with
// redirect: 'manual' it fails with "Redirect was cancelled"), so in Electron
// it goes through net.request, which reports each redirect and lets it be
// stopped there.
function fetchNoRedirect(url, { method, headers, body, signal }) {
  let net = null;
  try {
    const electron = customFetch ? null : require('electron');
    if (electron && typeof electron === 'object' && electron.net && typeof electron.net.request === 'function') net = electron.net;
  } catch {
    /* not in electron */
  }
  if (!net) return getFetch()(url, { method, headers, body, signal, redirect: 'manual' });
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method, redirect: 'manual' });
    for (const [k, v] of Object.entries(headers || {})) req.setHeader(k, v);
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      req.abort();
      settle(reject, Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('redirect', (status, _method, location) => {
      settle(resolve, new Response(null, { status, headers: { location } }));
      req.abort();
    });
    req.on('response', (res) => {
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers || {})) for (const x of [].concat(v)) h.append(k, String(x));
      const empty = method === 'HEAD' || [204, 205, 304].includes(res.statusCode);
      settle(resolve, new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, headers: h }));
    });
    req.on('error', (e) => settle(reject, e));
    if (body !== undefined && body !== null) req.write(body);
    req.end();
  });
}

// Rules for particular servers: extra headers (CurseForge's file servers ask
// for the API key since July 2026) and a clearer error for a refused request.
//   { headers(url) → object | null, explain(status, url) → Error | null }
let hostRules = { headers: () => null, explain: () => null };
function setHostRules(rules) {
  hostRules = { headers: (rules && rules.headers) || (() => null), explain: (rules && rules.explain) || (() => null) };
}
function extraHeaders(url) {
  try {
    return hostRules.headers(url) || null;
  } catch {
    return null;
  }
}

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} - ${url}`);
    this.status = status;
    this.url = url;
    this.body = body;
    this.code = 'HTTP_' + status;
  }
}

async function request(url, { method = 'GET', headers = {}, body, json, timeout = 30000, retries = 2, signal, redirect } = {}) {
  // requests made by a task stop when the task is cancelled
  const stop = signal || currentSignal();
  if (stop && stop.aborted) throw cancelledError();
  const h = { 'User-Agent': USER_AGENT, ...headers };
  let payload = body;
  if (json !== undefined) {
    payload = JSON.stringify(json);
    h['Content-Type'] = 'application/json';
  }
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const onStop = () => ctrl.abort();
    if (stop) stop.addEventListener('abort', onStop, { once: true });
    try {
      let res;
      const extra = redirect ? null : extraHeaders(url);
      if (redirect === 'manual') res = await fetchNoRedirect(url, { method, headers: h, body: payload, signal: ctrl.signal });
      else if (!extra) res = await getFetch()(url, { method, headers: h, body: payload, signal: ctrl.signal, ...(redirect ? { redirect } : {}) });
      else {
        // A request that carries a server's own headers follows redirects itself,
        // so that those headers reach that server and no other.
        let at = url;
        for (let hop = 0; ; hop++) {
          res = await fetchNoRedirect(at, { method, headers: { ...h, ...(extraHeaders(at) || {}) }, body: payload, signal: ctrl.signal });
          const to = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
          if (!to) break;
          if (hop >= 8) throw new HttpError(res.status, url, 'too many redirects');
          at = new URL(to, at).toString();
        }
      }
      clearTimeout(timer);
      if (stop) stop.removeEventListener('abort', onStop);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(res.status, url, await res.text().catch(() => ''));
        if (attempt < retries) {
          const wait = Number(res.headers.get('retry-after')) * 1000 || 800 * (attempt + 1);
          await new Promise((r) => setTimeout(r, Math.min(wait, 5000)));
          continue;
        }
        throw lastErr;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      if (stop) stop.removeEventListener('abort', onStop);
      if (stop && stop.aborted) throw cancelledError();
      lastErr = e;
      if (e instanceof HttpError) throw e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
    }
  }
  const err = new UserError('No se pudo conectar: {url} ({reason})', { url, reason: lastErr && lastErr.message });
  err.code = 'NETWORK';
  throw err;
}

async function getJson(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
  return res.json();
}

async function postJson(url, json, opts = {}) {
  const res = await request(url, { ...opts, method: opts.method || 'POST', json });
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function getBuffer(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) throw new HttpError(res.status, url);
  return Buffer.from(await res.arrayBuffer());
}

// Download to a file with progress and optional hash verification.
async function download(url, dest, { onProgress, hash, hashAlgo = 'sha1', headers, signal: own } = {}) {
  const signal = own || currentSignal();
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  // a file that is already on this computer (platforms/blocked.js): copied, with the same hash check
  if (/^file:/i.test(url)) {
    const src = fileURLToPath(url);
    if (hash) {
      const hasher = crypto.createHash(hashAlgo);
      await pipeline(fs.createReadStream(src), hasher);
      if (hasher.digest('hex').toLowerCase() !== String(hash).toLowerCase()) throw new UserError('El archivo no coincide con su hash ({file})', { file: path.basename(dest) }, { code: 'HASH_MISMATCH' });
    }
    await fsp.rm(dest, { force: true });
    await fsp.copyFile(src, dest);
    const { size } = await fsp.stat(dest);
    if (onProgress) onProgress(size, size);
    return { size };
  }
  const res = await request(url, { headers, timeout: 120000, signal });
  if (!res.ok) throw hostRules.explain(res.status, url) || new HttpError(res.status, url);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = `${dest}.part`;
  const hasher = hash ? crypto.createHash(hashAlgo) : null;
  let received = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    if (hasher) hasher.update(chunk);
    if (onProgress) onProgress(received, total);
  });
  if (signal) signal.addEventListener('abort', () => body.destroy(cancelledError()), { once: true });
  try {
    await pipeline(body, fs.createWriteStream(tmp));
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    if (signal && signal.aborted) throw cancelledError();
    throw e;
  }
  if (hasher) {
    const got = hasher.digest('hex');
    if (got.toLowerCase() !== String(hash).toLowerCase()) {
      await fsp.rm(tmp, { force: true });
      const err = new UserError('El archivo descargado no coincide con su hash ({file})', { file: path.basename(dest) });
      err.code = 'HASH_MISMATCH';
      throw err;
    }
  }
  await fsp.rm(dest, { force: true });
  await fsp.rename(tmp, dest);
  return { size: received };
}

// Run async jobs with a concurrency limit.
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      throwIfCancelled();
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = { request, getJson, postJson, getBuffer, download, pool, HttpError, USER_AGENT, setFetch, setHostRules };
