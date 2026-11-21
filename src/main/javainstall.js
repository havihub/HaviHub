// Java for each profile: which major version its Minecraft needs and, when
// none is installed, Eclipse Temurin (Adoptium's official builds) downloaded
// into Havi Hub's own folder with a progress bar, checked against the
// SHA-256 Adoptium publishes, and assigned to the profile.
//
// Layout: <dir>/temurin-<major>/   extracted JRE (bin/java, bin/javaw.exe)
const path = require('node:path');
const fsp = require('node:fs/promises');
const http = require('./util/http');
const { extractPrefix } = require('./util/zip');
const { extractTarGz } = require('./util/tar');
const { exists, listDir } = require('./util/fsx');
const { UserError, tr } = require('../shared/usertext');
const { findJavas, majorOf } = require('./java');

const API = 'https://api.adoptium.net/v3';

// Minecraft version -> Java major it runs on (Mojang's own runtimes)
function requiredJavaMajor(mcVersion) {
  const v = String(mcVersion || '').trim();
  if (!v) return 0;
  // weekly snapshots: 24w14a and later need 21; 21w19a..24w13 need 17
  const snap = /^(\d{2})w(\d{2})[a-z]$/i.exec(v);
  if (snap) {
    const y = Number(snap[1]);
    const w = Number(snap[2]);
    if (y > 24 || (y === 24 && w >= 14)) return 21;
    if (y > 21 || (y === 21 && w >= 19)) return 17;
    return 8;
  }
  const rel = /^1\.(\d+)(?:\.(\d+))?/.exec(v);
  if (rel) {
    const minor = Number(rel[1]);
    const patch = Number(rel[2] || 0);
    if (minor <= 16) return 8;
    if (minor === 20 && patch >= 5) return 21;
    if (minor >= 21) return 21;
    return 17; // 1.17 - 1.20.4
  }
  // year-based versions (26.1 and later) need Java 25
  const year = /^(\d{2})\.\d+/.exec(v);
  if (year && Number(year[1]) >= 26) return 25;
  return 0;
}

function adoptiumOs(platform = process.platform) {
  return { win32: 'windows', darwin: 'mac', linux: 'linux' }[platform] || '';
}
function adoptiumArch(arch = process.arch) {
  return { x64: 'x64', arm64: 'aarch64', ia32: 'x32' }[arch] || '';
}

function javaBin(home, platform = process.platform) {
  return path.join(home, 'bin', platform === 'win32' ? 'javaw.exe' : 'java');
}

// The JRE's home inside an extracted archive (one wrapping folder; on macOS
// inside Contents/Home)
async function findHome(dir, depth = 3) {
  if (await exists(javaBin(dir))) return dir;
  const mac = path.join(dir, 'Contents', 'Home');
  if (await exists(javaBin(mac))) return mac;
  if (depth <= 0) return null;
  for (const ent of await listDir(dir)) {
    if (!ent.isDirectory()) continue;
    const r = await findHome(path.join(dir, ent.name), depth - 1);
    if (r) return r;
  }
  return null;
}

class JavaInstaller {
  constructor({ dir, tasks, prismJavaDir }) {
    this.dir = dir;
    this.tasks = tasks;
    this.prismJavaDir = prismJavaDir || (async () => null);
    this.installing = new Map(); // major -> promise
  }

  homeFor(major) {
    return path.join(this.dir, `temurin-${major}`);
  }

  // A Java of that major already on this computer (Havi Hub's own first)
  async installed(major) {
    if (!this.found) this.found = new Map();
    const known = this.found.get(major);
    if (known && (await exists(known))) return known;
    const java = await this.lookup(major);
    if (java) this.found.set(major, java);
    return java;
  }

  async lookup(major) {
    const own = await findHome(this.homeFor(major)).catch(() => null);
    if (own) return javaBin(own);
    const all = await findJavas(await this.prismJavaDir()).catch(() => []);
    const hit = all.find((j) => j.major === major);
    return hit ? hit.path : null;
  }

  async latestAsset(major) {
    const os = adoptiumOs();
    const tries = [adoptiumArch()];
    if (os === 'mac' && tries[0] === 'aarch64') tries.push('x64'); // Java 8 has no Apple silicon build: Rosetta
    for (const arch of tries) {
      if (!os || !arch) break;
      for (const image of ['jre', 'jdk']) {
        const url = `${API}/assets/latest/${major}/hotspot?architecture=${arch}&image_type=${image}&os=${os}&vendor=eclipse`;
        const list = await http.getJson(url, { timeout: 20000, retries: 1 }).catch(() => []);
        const pkg = Array.isArray(list) && list[0] && list[0].binary && list[0].binary.package;
        if (pkg && pkg.link && /\.(zip|tar\.gz)$/i.test(pkg.name || pkg.link)) return { name: pkg.name || path.basename(pkg.link), url: pkg.link, sha256: pkg.checksum || '', size: pkg.size || 0, version: (list[0].version && list[0].version.semver) || String(major) };
      }
    }
    return null;
  }

  // Downloads Temurin <major>; returns the path of its java(w) program.
  install(major) {
    if (this.installing.has(major)) return this.installing.get(major);
    const p = this.tasks
      .run(`Java ${major} (Eclipse Temurin)`, { kind: 'java' }, async (task) => {
        task.progress(0, tr('Buscando la versión oficial…'));
        const asset = await this.latestAsset(major);
        if (!asset) throw new UserError('Adoptium no tiene Java {major} para este sistema.', { major });
        const archive = path.join(this.dir, 'downloads', asset.name);
        await http.download(asset.url, archive, {
          hash: asset.sha256 || undefined,
          hashAlgo: 'sha256',
          onProgress: (got, total) => task.progress(total ? (got / total) * 0.9 : 0, total ? `${Math.round(got / 1048576)} / ${Math.round(total / 1048576)} MB` : ''),
        });
        task.progress(0.92, tr('Descomprimiendo…'));
        const target = this.homeFor(major);
        const tmp = `${target}.partial`;
        await fsp.rm(tmp, { recursive: true, force: true });
        await fsp.mkdir(tmp, { recursive: true });
        if (/\.tar\.gz$/i.test(asset.name)) await extractTarGz(archive, tmp);
        else await extractPrefix(archive, '', tmp);
        const home = await findHome(tmp);
        if (!home) throw new UserError('El archivo descargado no contiene Java.');
        if (process.platform !== 'win32') await fsp.chmod(javaBin(home), 0o755).catch(() => {});
        await fsp.rm(target, { recursive: true, force: true });
        await fsp.rename(home, target);
        await fsp.rm(tmp, { recursive: true, force: true });
        await fsp.rm(archive, { force: true });
        return javaBin(target);
      })
      .finally(() => this.installing.delete(major));
    this.installing.set(major, p);
    return p;
  }

  // Before starting a profile: the Java it needs, installed if missing, and
  // set on the profile (unless the user chose a Java for it).
  async ensureFor(cfg, mcVersion) {
    const major = requiredJavaMajor(mcVersion);
    if (!major) return null;
    if (cfg.get('OverrideJavaLocation', false) === true || String(cfg.get('OverrideJavaLocation', '')) === 'true') {
      const chosen = cfg.get('JavaPath', '');
      if (chosen && (await exists(chosen))) return null;
    }
    let java = await this.installed(major);
    if (!java) java = await this.install(major);
    const current = cfg.get('JavaPath', '');
    if (current !== java) {
      cfg.set('OverrideJavaLocation', true);
      cfg.set('JavaPath', java);
      cfg.set('AutomaticJava', false);
      await cfg.save();
    }
    return { major, java };
  }
}

module.exports = { JavaInstaller, requiredJavaMajor, adoptiumOs, adoptiumArch, findHome, majorOf };
