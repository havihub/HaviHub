// Skin library stored in Prism's skins folder (shared with Prism's own
// "Manage skins" dialog): <data>/skins/*.png + index.json
const fsp = require('node:fs/promises');
const path = require('node:path');
const { writeJson, listDir, statSafe, safeName, exists, parseLenientJson } = require('../util/fsx');
const { fileUrl } = require('../urls');
const { UserError } = require('../../shared/usertext');

function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

class Skins {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async dir() {
    return (await this.ctx.dirs()).skinsDir;
  }

  async readIndex({ strict = false } = {}) {
    const file = path.join(await this.dir(), 'index.json');
    if (!(await exists(file))) return [];
    try {
      const data = parseLenientJson(await fsp.readFile(file, 'utf8'));
      return Array.isArray(data.skins) ? data.skins : [];
    } catch (e) {
      if (strict) throw new UserError('No se pudo leer skins/index.json; no se modificó.');
      return [];
    }
  }

  async writeIndex(skins) {
    const dir = await this.dir();
    await fsp.mkdir(dir, { recursive: true });
    await writeJson(path.join(dir, 'index.json'), { skins }, 4);
  }

  async list() {
    const dir = await this.dir();
    const index = await this.readIndex();
    const byName = new Map(index.map((s) => [s.name, s]));
    const out = [];
    for (const ent of await listDir(dir)) {
      if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.png')) continue;
      const name = ent.name.slice(0, -4);
      const full = path.join(dir, ent.name);
      const st = await statSafe(full);
      const meta = byName.get(name) || {};
      out.push({
        name,
        file: full,
        url: fileUrl(full, st ? st.mtimeMs : 0),
        model: (meta.model || 'CLASSIC').toUpperCase(),
        capeId: meta.capeId || '',
        remoteUrl: meta.url || '',
        mtime: st ? st.mtimeMs : 0,
      });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  }

  async add(png, { name, model = 'CLASSIC', capeId = '', url = '' } = {}) {
    const buf = Buffer.from(png);
    const size = pngSize(buf);
    if (!size || size.width !== 64 || (size.height !== 64 && size.height !== 32)) {
      const e = new UserError('La imagen no es una skin válida (debe ser PNG de 64×64 o 64×32).');
      e.code = 'INVALID_SKIN';
      throw e;
    }
    const dir = await this.dir();
    await fsp.mkdir(dir, { recursive: true });
    let base = safeName(name || 'skin', 'skin');
    let n = 1;
    let candidate = base;
    while (await exists(path.join(dir, `${candidate}.png`))) candidate = `${base} (${++n})`;
    await fsp.writeFile(path.join(dir, `${candidate}.png`), buf);
    const index = (await this.readIndex({ strict: true })).filter((s) => s.name !== candidate);
    index.push({ name: candidate, capeId, url, model: model.toUpperCase() });
    await this.writeIndex(index);
    return candidate;
  }

  async update(name, patch) {
    const index = await this.readIndex({ strict: true });
    let entry = index.find((s) => s.name === name);
    if (!entry) {
      entry = { name, capeId: '', url: '', model: 'CLASSIC' };
      index.push(entry);
    }
    if (patch.model) entry.model = patch.model.toUpperCase();
    if (patch.capeId !== undefined) entry.capeId = patch.capeId || '';
    if (patch.url !== undefined) entry.url = patch.url || '';
    if (patch.newName && patch.newName !== name) {
      const dir = await this.dir();
      const newName = safeName(patch.newName, 'skin');
      if (await exists(path.join(dir, `${newName}.png`))) throw new UserError('Ya existe una skin con ese nombre');
      await fsp.rename(path.join(dir, `${name}.png`), path.join(dir, `${newName}.png`));
      entry.name = newName;
    }
    await this.writeIndex(index);
  }

  async remove(name) {
    const dir = await this.dir();
    await fsp.rm(path.join(dir, `${name}.png`), { force: true });
    await this.writeIndex((await this.readIndex({ strict: true })).filter((s) => s.name !== name));
  }

  async read(name) {
    return fsp.readFile(path.join(await this.dir(), `${name}.png`));
  }

  // The library skin that looks exactly like this picture (the same pixels:
  // Mojang may hand back an uploaded skin saved another way), or null.
  // `decode` turns a PNG into { width, height, data }.
  async findSame(png, decode, remoteUrl = '') {
    const index = await this.readIndex();
    if (remoteUrl) {
      const byUrl = index.find((s) => s.url && s.url === remoteUrl);
      if (byUrl && (await exists(path.join(await this.dir(), `${byUrl.name}.png`)))) return byUrl.name;
    }
    const want = decode(Buffer.from(png));
    if (!want) return null;
    for (const s of await this.list()) {
      const buf = await fsp.readFile(s.file).catch(() => null);
      const got = buf && decode(buf);
      if (got && got.width === want.width && got.height === want.height && Buffer.compare(got.data, want.data) === 0) return s.name;
    }
    return null;
  }
}

module.exports = { Skins, pngSize };
