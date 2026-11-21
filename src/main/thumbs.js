// Small JPEG previews of screenshots for the gallery, cached on disk by file
// path + date + size. Windows and macOS give us the system's own thumbnail
// (fast, off the main thread); elsewhere the image is decoded and scaled here,
// one at a time so a burst of requests never blocks the app for long.
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { UserError } = require('../shared/usertext');

class Thumbs {
  constructor(cacheDir, nativeImage) {
    this.dir = cacheDir;
    this.nativeImage = nativeImage;
    this.inflight = new Map();
    this.queue = Promise.resolve();
  }

  async get(file, width = 480) {
    const st = await fsp.stat(file);
    const key = crypto.createHash('sha1').update(`${file}|${Math.round(st.mtimeMs)}|${st.size}|${width}`).digest('hex');
    const out = path.join(this.dir, key.slice(0, 2), `${key}.jpg`);
    try {
      return await fsp.readFile(out);
    } catch {
      // not cached yet
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = this.make(file, out, width).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  // A smaller PNG of an instance's picture (transparency kept), no bigger than
  // `max` on its long side. Resolves to null when the file is already that
  // small or is not something we can scale (GIF, WebP…): serve it as it is.
  async scaled(file, max) {
    const st = await fsp.stat(file);
    const key = crypto.createHash('sha1').update(`${file}|${Math.round(st.mtimeMs)}|${st.size}|s${max}`).digest('hex');
    if (!this.asIs) this.asIs = new Set();
    if (this.asIs.has(key)) return null;
    const out = path.join(this.dir, key.slice(0, 2), `${key}.png`);
    try {
      return await fsp.readFile(out);
    } catch {
      // not cached yet
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const decode = () =>
      new Promise((resolve) =>
        setImmediate(() => {
          try {
            const full = this.nativeImage.createFromPath(file);
            if (full.isEmpty()) return resolve(null);
            const { width: w, height: h } = full.getSize();
            if (Math.max(w, h) <= max) return resolve(null);
            const small = w >= h ? full.resize({ width: max, quality: 'best' }) : full.resize({ height: max, quality: 'best' });
            resolve(small.isEmpty() ? null : small.toPNG());
          } catch {
            resolve(null);
          }
        }),
      );
    const job = (async () => {
      this.queue = this.queue.then(decode, decode);
      const buf = await this.queue;
      if (!buf) {
        if (this.asIs.size > 2000) this.asIs.clear();
        this.asIs.add(key);
        return null;
      }
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await fsp.writeFile(out, buf).catch(() => {});
      return buf;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  async make(file, out, width) {
    let img = null;
    if (process.platform === 'win32' || process.platform === 'darwin') {
      try {
        img = await this.nativeImage.createThumbnailFromPath(file, { width, height: Math.round((width * 9) / 16) });
      } catch {
        img = null;
      }
    }
    if (!img || img.isEmpty()) {
      const decode = () =>
        new Promise((resolve) =>
          setImmediate(() => {
            const full = this.nativeImage.createFromPath(file);
            if (full.isEmpty()) return resolve(null);
            const { width: w } = full.getSize();
            resolve(w > width ? full.resize({ width, quality: 'good' }) : full);
          }),
        );
      this.queue = this.queue.then(decode, decode);
      img = await this.queue;
    }
    if (!img || img.isEmpty()) throw new UserError('No se pudo leer la imagen');
    const buf = img.toJPEG(84);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, buf).catch(() => {});
    return buf;
  }
}

// Width and height from a PNG header (Minecraft saves its screenshots as PNG)
async function pngSize(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const b = Buffer.alloc(24);
    await fh.read(b, 0, 24, 0);
    if (b.readUInt32BE(0) !== 0x89504e47) return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

function thumbUrl(absPath, version) {
  return `havihub://thumb/${encodeURIComponent(absPath)}${version ? `?v=${Math.round(version)}` : ''}`;
}

module.exports = { Thumbs, pngSize, thumbUrl };
