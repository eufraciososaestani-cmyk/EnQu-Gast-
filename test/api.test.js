// Pruebas de punta a punta de la API.
// Requiere el servidor corriendo: BASE=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
const suf = Date.now().toString(36);

class Cliente {
  constructor() { this.cookie = ''; }
  async req(method, path, body, { csrf = true } = {}) {
    const headers = { cookie: this.cookie };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (csrf && method !== 'GET') headers['x-atg'] = '1';
    const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : await r.text() };
  }
  get(p) { return this.req('GET', p); }
  post(p, b = {}) { return this.req('POST', p, b); }
  put(p, b = {}) { return this.req('PUT', p, b); }
  del(p) { return this.req('DELETE', p, {}); }
}

const admin = new Cliente(), ana = new Cliente(), beto = new Cliente();
const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const mes = hoy.slice(0, 7);
let cat, catIngreso, cuentaAna, movAna;

test('login de administrador', async () => {
  const r = await admin.post('/api/auth/login', ADMIN);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.usuario.rol, 'admin');
  assert.equal((await admin.post('/api/auth/login', { ...ADMIN, password: 'mala-clave-123' })).status, 401);
});

test('la cuenta principal arranca con su cuenta de efectivo y la sesión se renueva al abrir la app', async () => {
  const cuentas = (await admin.get('/api/catalogo')).data.cuentas;
  assert.ok(cuentas.some((c) => c.tipo === 'efectivo'));
  const r = await fetch(BASE + '/api/auth/yo', { headers: { cookie: admin.cookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie') || '', /atg_sesion=.+Max-Age=/);
  assert.equal((await new Cliente().get('/api/config/publica')).data.primer_uso, false);
});

test('el registro viene cerrado: solo se abre si el admin lo habilita', async () => {
  await admin.put('/api/admin/configuracion', { registro_abierto: false });
  assert.equal((await new Cliente().post('/api/auth/registro', { nombre: 'Z', email: `z0-${suf}@ej.com`, password: '12345678' })).status, 403);
  assert.equal((await admin.put('/api/admin/configuracion', { registro_abierto: true })).status, 200);
});

test('registro de dos usuarios con datos separados', async () => {
  let r = await ana.post('/api/auth/registro', { nombre: 'Ana', email: `ana-${suf}@ej.com`, password: 'claveAna123' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.usuario.rol, 'usuario');
  r = await beto.post('/api/auth/registro', { nombre: 'Beto', email: `beto-${suf}@ej.com`, password: 'claveBeto123' });
  assert.equal(r.status, 200);
  assert.equal((await beto.post('/api/auth/registro', { nombre: 'X', email: `ana-${suf}@ej.com`, password: '12345678' })).status, 409);
  assert.equal((await new Cliente().post('/api/auth/registro', { nombre: 'X', email: 'x@ej.com', password: 'corta' })).status, 400);
});

test('sin el encabezado de la app, las escrituras se rechazan (CSRF)', async () => {
  const r = await ana.req('POST', '/api/movimientos', { tipo: 'gasto', importe: 1 }, { csrf: false });
  assert.equal(r.status, 403);
});

test('catálogo: categorías globales, medios de pago y cuenta inicial', async () => {
  const r = await ana.get('/api/catalogo');
  assert.equal(r.status, 200);
  cat = r.data.categorias.find((c) => c.nombre === 'Combustible');
  catIngreso = r.data.categorias.find((c) => c.tipo === 'ingreso');
  assert.ok(cat && catIngreso);
  assert.ok(r.data.medios.length >= 3);
  assert.equal(r.data.cuentas.length, 1);
  cuentaAna = r.data.cuentas[0].id;
});

test('carga rápida de gastos e ingresos, y totales del mes', async () => {
  const medio = (await ana.get('/api/catalogo')).data.medios[0].id;
  let r = await ana.post('/api/movimientos', { tipo: 'gasto', importe: '15.000,50', categoria_id: cat.id, cuenta_id: cuentaAna, medio_pago_id: medio, fecha: hoy, nota: 'YPF' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  movAna = r.data.id;
  r = await ana.post('/api/movimientos', { tipo: 'ingreso', importe: 100000, categoria_id: catIngreso.id, cuenta_id: cuentaAna, fecha: hoy });
  assert.equal(r.status, 200);
  assert.equal((await ana.post('/api/movimientos', { tipo: 'gasto', importe: 0, categoria_id: cat.id })).status, 400);
  assert.equal((await ana.post('/api/movimientos', { tipo: 'gasto', importe: 10, categoria_id: catIngreso.id })).status, 400);

  const res = await ana.get('/api/resumen?mes=' + mes);
  assert.equal(res.data.gastos, 15000.5);
  assert.equal(res.data.ingresos, 100000);
  assert.equal(res.data.disponible, 84999.5);
  assert.equal(res.data.por_categoria[0].nombre, 'Combustible');
  assert.equal(res.data.historico.length, 6);
});

test('transferencias entre cuentas no cuentan como gasto', async () => {
  const banco = (await ana.post('/api/cuentas', { nombre: 'Banco', tipo: 'banco', saldo_inicial: 5000 })).data.id;
  const r = await ana.post('/api/movimientos', { tipo: 'transferencia', importe: 20000, cuenta_id: cuentaAna, cuenta_destino_id: banco, fecha: hoy });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cuentas = (await ana.get('/api/cuentas')).data;
  assert.equal(cuentas.find((c) => c.id === banco).saldo, 25000);
  assert.equal(cuentas.find((c) => c.id === cuentaAna).saldo, 64999.5);
  const res = await ana.get('/api/resumen?mes=' + mes);
  assert.equal(res.data.gastos, 15000.5);
  assert.equal(res.data.disponible, 89999.5);
});

test('cada usuario solo ve y modifica sus propios datos', async () => {
  const lista = await beto.get('/api/movimientos');
  assert.equal(lista.data.total, 0);
  assert.equal((await beto.put('/api/movimientos/' + movAna, { tipo: 'gasto', importe: 1, categoria_id: cat.id })).status, 404);
  assert.equal((await beto.del('/api/movimientos/' + movAna)).status, 404);
  // Beto no puede usar la cuenta de Ana
  assert.equal((await beto.post('/api/movimientos', { tipo: 'gasto', importe: 1, categoria_id: cat.id, cuenta_id: cuentaAna })).status, 400);
  // Ana sigue teniendo su gasto
  assert.equal((await ana.get('/api/movimientos?tipo=gasto')).data.total, 1);
});

test('búsqueda y filtros de movimientos, y exportación CSV', async () => {
  assert.equal((await ana.get('/api/movimientos?q=ypf')).data.total, 1);
  assert.equal((await ana.get('/api/movimientos?q=100%')).data.total, 0);
  assert.equal((await ana.get(`/api/movimientos?categoria=${cat.id}&desde=${mes}-01`)).data.total, 1);
  assert.equal((await ana.get('/api/movimientos?min=50000')).data.total, 1);
  const csv = await ana.get('/api/movimientos.csv');
  assert.match(csv.data, /Combustible/);
});

test('editar y eliminar un movimiento propio', async () => {
  let r = await ana.put('/api/movimientos/' + movAna, { tipo: 'gasto', importe: 16000, categoria_id: cat.id, cuenta_id: cuentaAna, fecha: hoy });
  assert.equal(r.status, 200);
  const otro = (await ana.post('/api/movimientos', { tipo: 'gasto', importe: 10, categoria_id: cat.id, fecha: hoy })).data.id;
  r = await ana.del('/api/movimientos/' + otro);
  assert.equal(r.status, 200);
  assert.equal((await ana.get('/api/resumen')).data.gastos, 16000);
});

test('presupuestos, objetivos de ahorro y gastos recurrentes', async () => {
  let r = await ana.put('/api/presupuestos', { categoria_id: cat.id, limite: 20000 });
  assert.equal(r.status, 200);
  const p = (await ana.get('/api/presupuestos')).data[0];
  assert.equal(p.gastado, 16000);

  const obj = (await ana.post('/api/objetivos', { nombre: 'Vacaciones', meta: 500000 })).data.id;
  await ana.post(`/api/objetivos/${obj}/aporte`, { importe: 30000 });
  assert.equal((await ana.get('/api/resumen')).data.ahorro, 30000);

  const servicios = (await ana.get('/api/catalogo')).data.categorias.find((c) => c.nombre === 'Servicios');
  const rec = (await ana.post('/api/recurrentes', { tipo: 'gasto', nombre: 'Internet', importe: 18000, dia: 10, categoria_id: servicios.id })).data.id;
  let lista = (await ana.get('/api/recurrentes')).data;
  assert.equal(lista[0].registrado_este_mes, false);
  r = await ana.post(`/api/recurrentes/${rec}/registrar`, {});
  assert.equal(r.status, 200);
  lista = (await ana.get('/api/recurrentes')).data;
  assert.equal(lista[0].registrado_este_mes, true);
});

test('categoría personal: solo la ve su dueño', async () => {
  const r = await ana.post('/api/categorias', { nombre: 'Mascota', tipo: 'gasto', icono: '🐶' });
  assert.equal(r.status, 200);
  const deBeto = (await beto.get('/api/catalogo')).data.categorias.map((c) => c.nombre);
  assert.ok(!deBeto.includes('Mascota'));
  assert.equal((await beto.post('/api/movimientos', { tipo: 'gasto', importe: 5, categoria_id: r.data.id })).status, 400);
});

test('el panel de administración está cerrado para usuarios comunes', async () => {
  for (const p of ['/api/admin/usuarios', '/api/admin/estadisticas', '/api/admin/configuracion', '/api/admin/auditoria']) {
    assert.equal((await ana.get(p)).status, 403, p);
  }
  assert.equal((await new Cliente().get('/api/admin/usuarios')).status, 401);
});

test('el administrador gestiona usuarios sin ver sus finanzas', async () => {
  const lista = (await admin.get('/api/admin/usuarios')).data;
  const a = lista.find((u) => u.email === `ana-${suf}@ej.com`);
  assert.ok(a);
  assert.ok(!('importe' in a) && !('saldo' in a));
  const est = (await admin.get('/api/admin/estadisticas')).data;
  assert.ok(est.usuarios >= 3 && est.movimientos >= 3);
});

test('admin crea un usuario con contraseña temporal que debe cambiar', async () => {
  const r = await admin.post('/api/admin/usuarios', { nombre: 'Carla', email: `carla-${suf}@ej.com` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const carla = new Cliente();
  assert.equal((await carla.post('/api/auth/login', { email: `carla-${suf}@ej.com`, password: r.data.password_temporal })).status, 200);
  assert.equal((await carla.get('/api/catalogo')).status, 403); // debe cambiarla antes
  assert.equal((await carla.post('/api/auth/password', { actual: r.data.password_temporal, nueva: 'nuevaClave123' })).status, 200);
  assert.equal((await carla.get('/api/catalogo')).status, 200);
});

test('recuperación de acceso: pedido y reseteo por el admin', async () => {
  assert.equal((await new Cliente().post('/api/auth/olvide', { email: `beto-${suf}@ej.com` })).status, 200);
  assert.equal((await new Cliente().post('/api/auth/olvide', { email: `noexiste-${suf}@ej.com` })).status, 200);
  let b = (await admin.get('/api/admin/usuarios')).data.find((u) => u.email === `beto-${suf}@ej.com`);
  assert.equal(b.pidio_recuperacion, true);
  const r = await admin.post(`/api/admin/usuarios/${b.id}/reset`);
  assert.equal(r.status, 200);
  assert.equal((await beto.get('/api/catalogo')).status, 401); // sesión vieja invalidada
  assert.equal((await beto.post('/api/auth/login', { email: `beto-${suf}@ej.com`, password: 'claveBeto123' })).status, 401);
  assert.equal((await beto.post('/api/auth/login', { email: `beto-${suf}@ej.com`, password: r.data.password_temporal })).status, 200);
  b = (await admin.get('/api/admin/usuarios')).data.find((u) => u.email === `beto-${suf}@ej.com`);
  assert.equal(b.pidio_recuperacion, false);
});

test('desactivar un usuario corta su acceso', async () => {
  const a = (await admin.get('/api/admin/usuarios')).data.find((u) => u.email === `ana-${suf}@ej.com`);
  assert.equal((await admin.put('/api/admin/usuarios/' + a.id, { activo: false })).status, 200);
  assert.equal((await ana.get('/api/resumen')).status, 401);
  assert.equal((await ana.post('/api/auth/login', { email: `ana-${suf}@ej.com`, password: 'claveAna123' })).status, 403);
  await admin.put('/api/admin/usuarios/' + a.id, { activo: true });
  assert.equal((await ana.post('/api/auth/login', { email: `ana-${suf}@ej.com`, password: 'claveAna123' })).status, 200);
});

test('el admin no puede quitarse a sí mismo el rol', async () => {
  const yo = (await admin.get('/api/auth/yo')).data.usuario;
  assert.equal((await admin.put('/api/admin/usuarios/' + yo.id, { rol: 'usuario' })).status, 400);
  assert.equal((await admin.put('/api/admin/usuarios/' + yo.id, { activo: false })).status, 400);
});

test('configuración editable: categorías globales y registro cerrado', async () => {
  const r = await admin.post('/api/admin/categorias', { nombre: `Vehículos ${suf}`, tipo: 'gasto', icono: '🚗', color: '#336699' });
  assert.equal(r.status, 200);
  assert.ok((await ana.get('/api/catalogo')).data.categorias.some((c) => c.nombre === `Vehículos ${suf}`));
  await admin.put('/api/admin/categorias/' + r.data.id, { nombre: `Vehículos ${suf}`, activa: false });
  assert.ok(!(await ana.get('/api/catalogo')).data.categorias.some((c) => c.nombre === `Vehículos ${suf}`));
  assert.equal((await admin.del('/api/admin/categorias/' + cat.id)).status, 409); // tiene movimientos

  await admin.put('/api/admin/configuracion', { registro_abierto: false });
  try {
    assert.equal((await new Cliente().post('/api/auth/registro', { nombre: 'Z', email: `z-${suf}@ej.com`, password: '12345678' })).status, 403);
  } finally { await admin.put('/api/admin/configuracion', { registro_abierto: false }); }

  const aud = (await admin.get('/api/admin/auditoria')).data;
  assert.ok(aud.some((a) => a.accion === 'configuracion'));
});
