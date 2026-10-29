// Primer uso: con la base vacía, la primera cuenta que se crea es la principal (admin).
// Requiere un servidor aparte con una base recién creada y sin ADMIN_PASSWORD:
//   BASE_VACIA=http://localhost:3001 ADMIN_EMAIL_VACIA=yo@correo.com npm test
// (ADMIN_EMAIL_VACIA es el ADMIN_EMAIL con el que se arrancó ese servidor, si se usó.)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.BASE_VACIA;
const RESERVADO = process.env.ADMIN_EMAIL_VACIA || `yo-${Date.now().toString(36)}@ej.com`;
const opciones = { skip: !BASE && 'definí BASE_VACIA para probar el primer uso' };

async function req(method, path, body, cookie = '') {
  const r = await fetch(BASE + path, {
    method, headers: { 'content-type': 'application/json', 'x-atg': '1', cookie }, body: body && JSON.stringify(body),
  });
  return { status: r.status, data: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

test('la primera cuenta es la principal y después el registro queda cerrado', opciones, async () => {
  assert.equal((await req('GET', '/api/config/publica')).data.primer_uso, true);
  if (process.env.ADMIN_EMAIL_VACIA) {
    const otro = await req('POST', '/api/auth/registro', { nombre: 'Intruso', email: 'otro@ej.com', password: 'claveOtro123' });
    assert.equal(otro.status, 403);
  }
  // Dos pedidos a la vez: solo uno puede quedarse con la cuenta principal
  const [a, b] = await Promise.all([
    req('POST', '/api/auth/registro', { nombre: 'Yo', email: RESERVADO, password: 'claveMia123' }),
    req('POST', '/api/auth/registro', { nombre: 'Yo bis', email: RESERVADO, password: 'claveMia123' }),
  ]);
  const ok = [a, b].filter((r) => r.status === 200);
  assert.equal(ok.length, 1, JSON.stringify([a.data, b.data]));
  assert.equal(ok[0].data.usuario.rol, 'admin');

  const cat = await req('GET', '/api/catalogo', undefined, ok[0].cookie);
  assert.equal(cat.data.cuentas.length, 1);
  assert.equal((await req('GET', '/api/config/publica')).data.primer_uso, false);
  const tarde = await req('POST', '/api/auth/registro', { nombre: 'Tarde', email: 'tarde@ej.com', password: 'claveTarde123' });
  assert.equal(tarde.status, 403);
});
