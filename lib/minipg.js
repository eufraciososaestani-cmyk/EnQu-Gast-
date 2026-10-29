// Cliente PostgreSQL mínimo (protocolo v3) sin dependencias.
// Se usa solo si el paquete "pg" no está instalado. Expone la misma
// interfaz básica que pg.Pool: query(text, params) -> { rows, rowCount }.
'use strict';
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

function parseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname || 'localhost',
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    ssl: /sslmode=(require|verify)/.test(u.search),
  };
}

// Conversión de tipos compatible con los valores por defecto de "pg"
function convert(oid, text) {
  if (text === null) return null;
  switch (oid) {
    case 16: return text === 't';
    case 21: case 23: case 26: case 700: case 701: return Number(text);
    case 114: case 3802: return JSON.parse(text);
    default: return text;
  }
}

class Connection {
  constructor(cfg) { this.cfg = cfg; this.buf = Buffer.alloc(0); this.waiters = []; this.queue = Promise.resolve(); }

  async connect() {
    const { host, port } = this.cfg;
    let sock = net.connect(port, host);
    await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
    if (this.cfg.ssl) {
      const req = Buffer.alloc(8); req.writeInt32BE(8, 0); req.writeInt32BE(80877103, 4);
      sock.write(req);
      const answer = await new Promise((res) => sock.once('data', res));
      if (answer[0] !== 0x53) throw new Error('El servidor no acepta SSL');
      sock = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false });
      await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
    }
    this.sock = sock;
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
    sock.on('error', (e) => { this.dead = e; this.waiters.splice(0).forEach((w) => w.rej(e)); });
    sock.on('close', () => { this.dead = this.dead || new Error('Conexión cerrada'); this.waiters.splice(0).forEach((w) => w.rej(this.dead)); });

    const params = `user\0${this.cfg.user}\0database\0${this.cfg.database}\0client_encoding\0UTF8\0\0`;
    const body = Buffer.concat([int32(196608), Buffer.from(params)]);
    sock.write(Buffer.concat([int32(body.length + 4), body]));
    await this.authenticate();
  }

  pump() {
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) return;
      const msg = { type: String.fromCharCode(this.buf[0]), body: this.buf.subarray(5, len + 1) };
      this.buf = this.buf.subarray(len + 1);
      const w = this.waiters.shift();
      if (w) w.res(msg); else (this.pending = this.pending || []).push(msg);
    }
  }

  next() {
    if (this.pending && this.pending.length) return Promise.resolve(this.pending.shift());
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((res, rej) => this.waiters.push({ res, rej }));
  }

  send(type, body) {
    const head = Buffer.alloc(5); head.write(type, 0); head.writeInt32BE(body.length + 4, 1);
    this.sock.write(Buffer.concat([head, body]));
  }

  async authenticate() {
    let scram;
    for (;;) {
      const m = await this.next();
      if (m.type === 'E') throw pgError(m.body);
      if (m.type === 'R') {
        const code = m.body.readInt32BE(0);
        if (code === 0) continue;
        if (code === 3) { this.send('p', cstr(this.cfg.password)); continue; }
        if (code === 5) {
          const salt = m.body.subarray(4, 8);
          const inner = md5(this.cfg.password + this.cfg.user);
          this.send('p', cstr('md5' + md5(Buffer.concat([Buffer.from(inner), salt]))));
          continue;
        }
        if (code === 10) {
          const nonce = crypto.randomBytes(18).toString('base64');
          scram = { nonce, first: `n=*,r=${nonce}` };
          const payload = Buffer.from('n,,' + scram.first);
          this.send('p', Buffer.concat([cstr('SCRAM-SHA-256'), int32(payload.length), payload]));
          continue;
        }
        if (code === 11) {
          const server = m.body.subarray(4).toString();
          const attrs = Object.fromEntries(server.split(',').map((p) => [p[0], p.slice(2)]));
          const salted = crypto.pbkdf2Sync(this.cfg.password, Buffer.from(attrs.s, 'base64'), Number(attrs.i), 32, 'sha256');
          const clientKey = hmac(salted, 'Client Key');
          const storedKey = crypto.createHash('sha256').update(clientKey).digest();
          const without = `c=biws,r=${attrs.r}`;
          const authMsg = `${scram.first},${server},${without}`;
          const sig = hmac(storedKey, authMsg);
          const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i])).toString('base64');
          this.send('p', Buffer.from(`${without},p=${proof}`));
          continue;
        }
        if (code === 12) continue;
        throw new Error('Método de autenticación no soportado: ' + code);
      }
      if (m.type === 'Z') return;
    }
  }

  query(text, params = []) {
    const run = async () => {
      const values = params.map((v) => (v === null || v === undefined ? null
        : typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v)
        : v instanceof Date ? v.toISOString() : String(v)));
      this.send('P', Buffer.concat([cstr(''), cstr(text), int16(0)]));
      const parts = [cstr(''), cstr(''), int16(0), int16(values.length)];
      for (const v of values) {
        if (v === null) parts.push(int32(-1));
        else { const b = Buffer.from(v); parts.push(int32(b.length), b); }
      }
      parts.push(int16(0));
      this.send('B', Buffer.concat(parts));
      this.send('D', Buffer.concat([Buffer.from('P'), cstr('')]));
      this.send('E', Buffer.concat([cstr(''), int32(0)]));
      this.send('S', Buffer.alloc(0));
      let fields = [], rows = [], rowCount = 0, error = null;
      for (;;) {
        const m = await this.next();
        if (m.type === 'T') {
          const n = m.body.readInt16BE(0); let o = 2; fields = [];
          for (let i = 0; i < n; i++) {
            const end = m.body.indexOf(0, o); const name = m.body.toString('utf8', o, end); o = end + 1;
            const oid = m.body.readInt32BE(o + 6); o += 18; fields.push({ name, oid });
          }
        } else if (m.type === 'D') {
          const n = m.body.readInt16BE(0); let o = 2; const row = {};
          for (let i = 0; i < n; i++) {
            const len = m.body.readInt32BE(o); o += 4;
            const val = len === -1 ? null : m.body.toString('utf8', o, o + len); if (len > 0) o += len;
            row[fields[i].name] = convert(fields[i].oid, val);
          }
          rows.push(row);
        } else if (m.type === 'C') {
          const tag = m.body.toString('utf8', 0, m.body.length - 1).split(' ');
          rowCount = Number(tag[tag.length - 1]) || 0;
        } else if (m.type === 'E') { error = pgError(m.body); }
        else if (m.type === 'Z') break;
      }
      if (error) throw error;
      return { rows, rowCount };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}

class Pool {
  constructor({ connectionString, max = 5 }) { this.cfg = parseUrl(connectionString); this.max = max; this.idle = []; this.count = 0; this.waiting = []; }
  async acquire() {
    if (this.idle.length) return this.idle.pop();
    if (this.count < this.max) { this.count++; const c = new Connection(this.cfg); try { await c.connect(); } catch (e) { this.count--; throw e; } return c; }
    return new Promise((res) => this.waiting.push(res));
  }
  release(c) {
    if (c.dead) { this.count--; return; }
    const w = this.waiting.shift(); if (w) w(c); else this.idle.push(c);
  }
  async query(text, params) {
    const c = await this.acquire();
    try { return await c.query(text, params); } finally { this.release(c); }
  }
  async connect() {
    const c = await this.acquire();
    return { query: (t, p) => c.query(t, p), release: () => this.release(c) };
  }
  async end() { this.idle.forEach((c) => c.sock.end()); this.idle = []; }
}

function pgError(body) {
  const f = {}; let o = 0;
  while (body[o]) { const k = String.fromCharCode(body[o]); const end = body.indexOf(0, o + 1); f[k] = body.toString('utf8', o + 1, end); o = end + 1; }
  const e = new Error(f.M); e.code = f.C; e.detail = f.D; e.constraint = f.n; return e;
}
const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const int16 = (n) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const cstr = (s) => Buffer.from(s + '\0');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();

module.exports = { Pool };
