// Accounts from Prism's accounts.json, plus skin/cape changes through the
// Minecraft Services API using the token Prism already stored.
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { readJson, writeJson, parseLenientJson } = require('../util/fsx');
const http = require('../util/http');
const { UserError } = require('../../shared/usertext');

const MC_API = 'https://api.minecraftservices.com/minecraft/profile';

function tokenError() {
  const e = new UserError('La sesión de esta cuenta expiró. Juega una vez o renueva la sesión y vuelve a intentarlo.');
  e.code = 'TOKEN_EXPIRED';
  return e;
}

// Java's UUID.nameUUIDFromBytes("OfflinePlayer:" + name), as Minecraft and
// Prism compute it (32 hex digits, no dashes)
function offlineUuid(name) {
  const d = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  d[6] = (d[6] & 0x0f) | 0x30;
  d[8] = (d[8] & 0x3f) | 0x80;
  return d.toString('hex');
}

class Accounts {
  // opts.msaClientId(): the Microsoft app the engine signs in with now. The
  // engine renews a Microsoft account only with the app it signed in with
  // (its "msa-client-id"); any other account has to sign in again.
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.msaClientId = opts.msaClientId || (() => '');
  }

  async raw() {
    return readJson(this.ctx.accountsFile(), { formatVersion: 3, accounts: [] });
  }

  async list() {
    const data = await this.raw();
    const now = Date.now() / 1000;
    const clientId = String(this.msaClientId() || '').toLowerCase();
    return (data.accounts || []).map((a) => {
      const p = a.profile || {};
      const skin = p.skin || {};
      return {
        id: p.id || '',
        name: p.name || '(sin perfil)',
        type: a.type || 'MSA',
        active: Boolean(a.active),
        tokenValid: Boolean(a.ygg && a.ygg.token && (!a.ygg.exp || a.ygg.exp > now + 60)),
        needsLogin: (a.type || 'MSA') === 'MSA' && Boolean(clientId) && String(a['msa-client-id'] || '').toLowerCase() !== clientId,
        skin: {
          id: skin.id || '',
          url: skin.url || '',
          variant: (skin.variant || 'CLASSIC').toUpperCase(),
          data: skin.data ? `data:image/png;base64,${skin.data}` : null,
        },
        currentCape: p.cape || '',
        capes: (p.capes || []).map((c) => ({
          id: c.id,
          alias: c.alias || 'Cape',
          url: c.url || '',
          data: c.data ? `data:image/png;base64,${c.data}` : null,
        })),
      };
    });
  }

  // Strict read used before writing: never rewrite accounts.json from a
  // fallback/empty object (that would sign the user out of everything).
  async rawStrict() {
    const text = await fsp.readFile(this.ctx.accountsFile(), 'utf8');
    const data = parseLenientJson(text);
    if (!data || !Array.isArray(data.accounts)) throw new UserError('accounts.json tiene un formato inesperado; no se modificó.');
    return data;
  }

  async findRaw(profileId) {
    const data = await this.rawStrict();
    const acc = (data.accounts || []).find((a) => a.profile && a.profile.id === profileId);
    if (!acc) throw new UserError('Cuenta no encontrada');
    return { data, acc };
  }

  async setActive(profileId) {
    const data = await this.rawStrict();
    for (const a of data.accounts || []) {
      if (a.profile && a.profile.id === profileId) a.active = true;
      else delete a.active;
    }
    await writeJson(this.ctx.accountsFile(), data, 4);
  }

  // An offline account, like Prism's "Add offline account": only once a
  // Microsoft account that owns Minecraft is in Havi Hub.
  async addOffline(username) {
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new UserError('El nombre debe tener de 3 a 16 caracteres: letras, números o guion bajo.');
    let data;
    try {
      data = await this.rawStrict();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      data = { formatVersion: 3, accounts: [] };
    }
    const accounts = data.accounts || [];
    const premium = accounts.some((a) => (a.type || 'MSA') !== 'Offline' && a.profile && a.profile.id);
    if (!premium) throw Object.assign(new UserError('Primero agrega una cuenta de Microsoft que tenga Minecraft. Después puedes sumar cuentas offline.'), { code: 'NEEDS_PREMIUM' });
    if (accounts.some((a) => a.type === 'Offline' && a.profile && a.profile.name.toLowerCase() === name.toLowerCase())) throw new UserError('Ya tienes una cuenta offline llamada {name}.', { name });
    const account = {
      type: 'Offline',
      ygg: { iat: Math.floor(Date.now() / 1000), token: '0', extra: { userName: name, clientToken: crypto.randomUUID().replace(/-/g, '') } },
      profile: { id: offlineUuid(name), name, capes: [], skin: { id: '', url: '', variant: '' } },
    };
    data.formatVersion = data.formatVersion || 3;
    data.accounts = [...accounts, account];
    await writeJson(this.ctx.accountsFile(), data, 4);
    return { id: account.profile.id, name };
  }

  async remove(profileId) {
    const data = await this.rawStrict();
    data.accounts = (data.accounts || []).filter((a) => !(a.profile && a.profile.id === profileId));
    await writeJson(this.ctx.accountsFile(), data, 4);
  }

  async token(profileId) {
    const { acc } = await this.findRaw(profileId);
    if (acc.type === 'Offline') {
      const e = new UserError('Las cuentas offline no pueden cambiar la skin online.');
      e.code = 'OFFLINE';
      throw e;
    }
    const t = acc.ygg && acc.ygg.token;
    if (!t || (acc.ygg.exp && acc.ygg.exp < Date.now() / 1000 + 30)) throw tokenError();
    return t;
  }

  async authed(profileId, url, opts = {}) {
    const token = await this.token(profileId);
    const res = await http.request(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` }, retries: 0 });
    if (res.status === 401) throw tokenError();
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let msg = `Error ${res.status} del servidor de Minecraft`;
      try {
        const j = JSON.parse(body);
        msg = j.errorMessage || j.error || msg;
      } catch {
        /* keep msg */
      }
      throw new Error(msg);
    }
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  // Upload a skin PNG (Buffer) with the given variant ("classic" | "slim")
  async uploadSkin(profileId, png, variant) {
    // multipart/form-data built by hand (works the same with Electron's net.fetch and Node's fetch)
    const boundary = `----HaviHub${crypto.randomBytes(12).toString('hex')}`;
    const v = variant === 'slim' || variant === 'SLIM' ? 'slim' : 'classic';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="variant"\r\n\r\n${v}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="skin.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from(png),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const profile = await this.authed(profileId, `${MC_API}/skins`, { method: 'POST', body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
    return this.syncProfile(profileId, profile, png);
  }

  async setCape(profileId, capeId) {
    let profile;
    if (capeId) profile = await this.authed(profileId, `${MC_API}/capes/active`, { method: 'PUT', json: { capeId } });
    else profile = await this.authed(profileId, `${MC_API}/capes/active`, { method: 'DELETE' });
    return this.syncProfile(profileId, profile);
  }

  async refreshProfile(profileId) {
    const profile = await this.authed(profileId, MC_API, { method: 'GET' });
    return this.syncProfile(profileId, profile);
  }

  // Write the new skin/cape state back to accounts.json so Prism sees it too.
  async syncProfile(profileId, profile, skinPng) {
    if (!profile || !profile.id) return this.list();
    const { data, acc } = await this.findRaw(profileId);
    const p = acc.profile || (acc.profile = { id: profile.id, name: profile.name });
    const active = (profile.skins || []).find((s) => s.state === 'ACTIVE');
    if (active) {
      let skinData = skinPng ? Buffer.from(skinPng).toString('base64') : p.skin && p.skin.url === active.url ? p.skin.data : undefined;
      if (!skinData) {
        try {
          skinData = (await http.getBuffer(active.url.replace('http://', 'https://'))).toString('base64');
        } catch {
          /* leave without data */
        }
      }
      p.skin = { id: active.id, url: active.url, variant: active.variant || 'CLASSIC', ...(skinData ? { data: skinData } : {}) };
    }
    if (Array.isArray(profile.capes)) {
      const old = new Map((p.capes || []).map((c) => [c.id, c]));
      p.capes = profile.capes.map((c) => ({ id: c.id, url: c.url, alias: c.alias, ...(old.get(c.id) && old.get(c.id).data ? { data: old.get(c.id).data } : {}) }));
      const activeCape = profile.capes.find((c) => c.state === 'ACTIVE');
      if (activeCape) p.cape = activeCape.id;
      else delete p.cape;
    }
    await writeJson(this.ctx.accountsFile(), data, 4);
    return this.list();
  }
}

// Fetch any player's current skin (public Mojang API)
async function fetchPlayerSkin(username) {
  const prof = await http.getJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`);
  if (!prof || !prof.id) throw new UserError('Jugador no encontrado');
  const sess = await http.getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${prof.id}`);
  const prop = (sess.properties || []).find((p) => p.name === 'textures');
  if (!prop) throw new UserError('Este jugador no tiene skin');
  const tex = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'));
  const skin = tex.textures && tex.textures.SKIN;
  if (!skin) throw new UserError('Este jugador usa la skin por defecto');
  const png = await http.getBuffer(skin.url.replace('http://', 'https://'));
  return { name: prof.name, png, model: skin.metadata && skin.metadata.model === 'slim' ? 'SLIM' : 'CLASSIC' };
}

module.exports = { Accounts, fetchPlayerSkin, fsp, offlineUuid };
