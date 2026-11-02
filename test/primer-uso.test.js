// Base nueva: cualquiera puede crearse su cuenta, y la de ADMIN_EMAIL queda como administrador.
// Requiere un servidor aparte con una base recién creada, con ADMIN_EMAIL y sin ADMIN_PASSWORD:
//   BASE_VACIA=http://localhost:3001 ADMIN_EMAIL_VACIA=yo@correo.com npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.BASE_VACIA;
const RESERVADO = process.env.ADMIN_EMAIL_VACIA;
const suf = Date.now().toString(36);
const opciones = { skip: !(BASE && RESERVADO) && 'definí BASE_VACIA y ADMIN_EMAIL_VACIA para probar una base nueva' };

async function req(method, path, body, cookie = '') {
  const r = await fetch(BASE + path, {
    method, headers: { 'content-type': 'application/json', 'x-atg': '1', cookie }, body: body && JSON.stringify(body),
  });
  return { status: r.status, data: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

test('base nueva: cada persona crea su cuenta y la de ADMIN_EMAIL es la de administrador', opciones, async () => {
  const pub = (await req('GET', '/api/config/publica')).data;
  assert.equal(pub.primer_uso, true);
  assert.equal(pub.registro_abierto, true);

  // Otra persona llega primero: entra como usuario común, no como administrador
  const otra = await req('POST', '/api/auth/registro', { nombre: 'Otra', email: `otra-${suf}@ej.com`, password: 'claveOtra123' });
  assert.equal(otra.status, 200, JSON.stringify(otra.data));
  assert.equal(otra.data.usuario.rol, 'usuario');
  assert.equal((await req('GET', '/api/admin/usuarios', undefined, otra.cookie)).status, 403);

  // Dos pedidos a la vez con el correo reservado: solo uno se crea, y es administrador
  const [a, b] = await Promise.all([
    req('POST', '/api/auth/registro', { nombre: 'Yo', email: RESERVADO, password: 'claveMia123' }),
    req('POST', '/api/auth/registro', { nombre: 'Yo bis', email: RESERVADO, password: 'claveMia123' }),
  ]);
  const ok = [a, b].filter((r) => r.status === 200);
  assert.equal(ok.length, 1, JSON.stringify([a.data, b.data]));
  assert.equal(ok[0].data.usuario.rol, 'admin');
  assert.equal((await req('GET', '/api/catalogo', undefined, ok[0].cookie)).data.cuentas.length, 1);

  // Más personas pueden seguir creándose su cuenta, cada una con sus datos
  const tercera = await req('POST', '/api/auth/registro', { nombre: 'Tercera', email: `tercera-${suf}@ej.com`, password: 'claveTercera123' });
  assert.equal(tercera.data.usuario.rol, 'usuario');
  assert.equal((await req('GET', '/api/config/publica')).data.primer_uso, false);
});
