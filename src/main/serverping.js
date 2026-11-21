// Pings a Minecraft server from this computer (Server List Ping, the same as
// the game's multiplayer screen): latency, players and version. Looks up the
// _minecraft._tcp SRV record when the address has no port.
const net = require('node:net');
const dns = require('node:dns').promises;
const { UserError } = require('../shared/usertext');

function varint(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

function readVarint(buf, offset) {
  let n = 0;
  let shift = 0;
  let i = offset;
  for (;;) {
    if (i >= buf.length) return null;
    const b = buf[i++];
    n |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
    if (shift > 35) throw new Error('bad varint');
  }
  return { value: n, size: i - offset };
}

const packet = (id, ...parts) => {
  const body = Buffer.concat([varint(id), ...parts]);
  return Buffer.concat([varint(body.length), body]);
};
const str = (s) => {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(b.length), b]);
};

function parseAddress(address) {
  const a = String(address || '').trim();
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(a) || /^([^:]+)(?::(\d+))?$/.exec(a);
  if (!m) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : null };
}

async function resolve(address) {
  const p = parseAddress(address);
  if (!p) throw new UserError('Dirección no válida');
  if (p.port || net.isIP(p.host)) return { host: p.host, port: p.port || 25565 };
  try {
    const srv = await dns.resolveSrv(`_minecraft._tcp.${p.host}`);
    if (srv && srv.length) return { host: srv[0].name, port: srv[0].port };
  } catch {
    // no SRV record
  }
  return { host: p.host, port: 25565 };
}

// motd as plain text (the status JSON uses chat components)
function chatText(c) {
  if (!c) return '';
  if (typeof c === 'string') return c.replace(/§./g, '');
  let s = c.text || '';
  for (const x of c.extra || []) s += chatText(x);
  return s.replace(/§./g, '');
}

async function ping(address, { timeout = 3500 } = {}) {
  const { host, port } = await resolve(address);
  return new Promise((resolveP, reject) => {
    const sock = net.createConnection({ host, port });
    let buf = Buffer.alloc(0);
    let status = null;
    let sentAt = 0;
    let askedAt = 0;
    let statusRtt = 0;
    let finished = false;
    const result = (latency) => {
      const players = status.players || {};
      return {
        latency: Math.max(1, latency),
        online: Number(players.online) || 0,
        max: Number(players.max) || 0,
        version: (status.version && status.version.name) || '',
        protocol: (status.version && status.version.protocol) || 0,
        motd: chatText(status.description),
        favicon: typeof status.favicon === 'string' && status.favicon.startsWith('data:image/') ? status.favicon : null,
      };
    };
    const done = (err, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      sock.destroy();
      if (err) reject(err);
      else resolveP(value);
    };
    // some servers answer the status but never the ping: their status time counts
    const timer = setTimeout(() => (status ? done(null, result(statusRtt)) : done(new UserError('Sin respuesta'))), timeout);
    sock.on('error', (e) => (status ? done(null, result(statusRtt)) : done(e)));
    sock.on('close', () => (status ? done(null, result(statusRtt)) : done(new UserError('Conexión cerrada'))));
    sock.on('connect', () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      askedAt = Date.now();
      sock.write(packet(0x00, varint(767), str(host), portBuf, varint(1)));
      sock.write(packet(0x00));
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len.size + len.value) return;
        const body = buf.subarray(len.size, len.size + len.value);
        buf = buf.subarray(len.size + len.value);
        const id = readVarint(body, 0);
        if (!status && id.value === 0x00) {
          const slen = readVarint(body, id.size);
          const json = body.subarray(id.size + slen.size, id.size + slen.size + slen.value).toString('utf8');
          try {
            status = JSON.parse(json);
          } catch {
            return done(new UserError('Respuesta no válida'));
          }
          statusRtt = Date.now() - askedAt;
          const payload = Buffer.alloc(8);
          payload.writeBigInt64BE(BigInt(Date.now()));
          sentAt = Date.now();
          sock.write(packet(0x01, payload));
        } else if (status && id.value === 0x01) {
          return done(null, result(Date.now() - sentAt));
        }
      }
    });
  });
}

module.exports = { ping, parseAddress, resolve, chatText };
