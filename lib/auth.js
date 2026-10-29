'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const SECRET = process.env.SESSION_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    console.error('Falta SESSION_SECRET en producción.');
    process.exit(1);
  }
  return 'desarrollo-no-usar-en-produccion';
})();
const DURACION_MS = 1000 * 60 * 60 * 24 * 14; // 14 días

async function hashPassword(pass) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pass, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(pass, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(pass, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

function crearToken(usuario) {
  const payload = b64(JSON.stringify({ uid: usuario.id, v: usuario.token_version, exp: Date.now() + DURACION_MS }));
  return `${payload}.${sign(payload)}`;
}

function leerToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;
  const esperada = sign(payload);
  if (esperada.length !== firma.length || !crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(firma))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

function passwordTemporal() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of crypto.randomBytes(10)) s += abc[b % abc.length];
  return s.slice(0, 5) + '-' + s.slice(5);
}

module.exports = { hashPassword, verifyPassword, crearToken, leerToken, passwordTemporal, DURACION_MS };
