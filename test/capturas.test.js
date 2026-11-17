// Lectura de capturas con un servicio de Claude falso (no gasta crédito).
// Arrancá el servidor apuntando al falso y sin ANTHROPIC_API_KEY:
//   ANTHROPIC_BASE_URL=http://localhost:4010 ... npm start
//   BASE=... ADMIN_EMAIL=... ADMIN_PASSWORD=... CLAUDE_FALSO_PUERTO=4010 npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const BASE = process.env.BASE || 'http://localhost:3000';
const PUERTO = Number(process.env.CLAUDE_FALSO_PUERTO);
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
const CLAVE = 'sk-ant-api03-clave-de-prueba-0123456789';
const opciones = { skip: !PUERTO && 'definí CLAUDE_FALSO_PUERTO para probar la lectura de capturas' };

let pedidos = [];
let falso;
test.before(async () => {
  if (!PUERTO) return;
  falso = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      const responder = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
      const clave = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (clave !== CLAVE) return responder(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
      if (req.method === 'GET' && req.url.startsWith('/v1/models/')) return responder(200, { type: 'model', id: req.url.split('/').pop(), display_name: 'Claude', created_at: '2026-01-01T00:00:00Z' });
      const pedido = JSON.parse(cuerpo);
      pedidos.push({ pedido, headers: req.headers });
      const contexto = pedido.messages[0].content.find((b) => b.type === 'text').text;
      const idCat = (nombre) => Number(new RegExp(`(\\d+): ${nombre}`).exec(contexto)[1]);
      const base = { categoria_nueva: '', icono: '', medio_pago_id: 0, cuenta_id: 0 };
      const salida = {
        movimientos: [
          { ...base, tipo: 'gasto', importe: 15000.5, moneda: 'ARS', fecha: '2026-10-28', descripcion: 'Carrefour', categoria_id: idCat('Supermercado') },
          { ...base, tipo: 'gasto', importe: 4500, moneda: 'ARS', fecha: '2026-10-29', descripcion: 'Uber a Palermo', categoria_id: idCat('Transporte'), categoria_nueva: 'uber', icono: '🚗' },
          { ...base, tipo: 'ingreso', importe: 250000, moneda: 'ARS', fecha: '', descripcion: 'Transferencia de Juan', categoria_id: idCat('Combustible'), medio_pago_id: 3, cuenta_id: 99999 },
          { ...base, tipo: 'gasto', importe: -0, moneda: 'ARS', fecha: '2026-10-28', descripcion: 'basura', categoria_id: 1 },
        ],
        aviso: '',
      };
      responder(200, {
        id: 'msg_prueba', type: 'message', role: 'assistant', model: pedido.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(salida) }], usage: { input_tokens: 10, output_tokens: 10 },
      });
    });
  });
  await new Promise((ok) => falso.listen(PUERTO, ok));
});
test.after(() => falso && falso.close());

async function cliente() {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json', 'x-atg': '1' }, body: body && JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, data: await r.json() };
  };
  return { req };
}

test('el admin activa la lectura con su clave y una captura se convierte en movimientos', opciones, async () => {
  const admin = await cliente();
  assert.equal((await admin.req('POST', '/api/auth/login', ADMIN)).status, 200);
  assert.equal((await admin.req('PUT', '/api/admin/configuracion', { anthropic_api_key: 'sk-ant-api03-clave-mala-0123456789abcdef' })).status, 503);
  let r = await admin.req('PUT', '/api/admin/configuracion', { anthropic_api_key: CLAVE });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.lectura_capturas, true);
  assert.ok(!('anthropic_api_key' in r.data));
  assert.equal((await admin.req('GET', '/api/capturas/estado')).data.activa, true);

  // La captura se lee y se guarda sola; lo que la persona aclara viaja a Claude
  pedidos = [];
  r = await admin.req('POST', '/api/capturas/leer', { imagen: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', aclaracion: 'Uber' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const { pedido, headers } = pedidos[0];
  assert.equal(pedido.model, 'claude-opus-5-5');
  assert.equal(pedido.fallbacks, 'default');
  assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(pedido.output_config.format.type, 'json_schema');
  assert.equal(pedido.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.match(pedido.messages[0].content[1].text, /aclaró de qué es: «Uber»/);

  assert.equal(r.data.guardados.length, 3); // el importe en cero se descarta
  assert.deepEqual(r.data.categorias_nuevas, ['Uber']);
  assert.equal(r.data.repetidos.length, 0);
  const porNota = (lista, nota) => lista.find((m) => m.nota === nota);
  const super_ = porNota(r.data.guardados, 'Carrefour');
  assert.equal(super_.importe, 15000.5);
  assert.equal(super_.fecha, '2026-10-28');
  assert.equal(super_.categoria, 'Supermercado');
  assert.equal(super_.cuenta, 'Efectivo'); // se elige la cuenta de efectivo
  const uber = porNota(r.data.guardados, 'Uber a Palermo');
  assert.equal(uber.categoria, 'Uber'); // sección nueva, con su ícono
  assert.equal(uber.categoria_icono, '🚗');
  const ingreso = porNota(r.data.guardados, 'Transferencia de Juan');
  assert.equal(ingreso.medio_pago_id, null); // los ingresos no llevan medio de pago
  assert.notEqual(ingreso.categoria, 'Combustible'); // una categoría de gasto no sirve para un ingreso
  assert.match(ingreso.fecha, /^\d{4}-\d{2}-\d{2}$/); // sin fecha, se usa la de hoy
  assert.equal(ingreso.cuenta, 'Efectivo'); // una cuenta ajena no se acepta
  const ids = r.data.guardados.map((m) => m.id);
  assert.equal((await admin.req('GET', '/api/movimientos?ids=' + ids.join(','))).data.total, 3);

  // La misma captura otra vez: no se guarda nada, todo vuelve como repetido y la sección Uber no se duplica
  r = await admin.req('POST', '/api/capturas/leer', { imagen: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' });
  assert.equal(r.data.guardados.length, 0);
  assert.equal(r.data.repetidos.length, 3);
  assert.deepEqual(r.data.categorias_nuevas, []);
  assert.equal(porNota(r.data.repetidos, 'Uber a Palermo').categoria_id, uber.categoria_id);
  const cat = (await admin.req('GET', '/api/catalogo')).data.categorias;
  assert.equal(cat.filter((c) => c.nombre === 'Uber').length, 1);
  r = await admin.req('POST', '/api/movimientos/lote', { movimientos: [porNota(r.data.repetidos, 'Carrefour')] }); // "Cargar igual"
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ids.length, 1);

  // Un resumen en PDF viaja como documento, no como imagen
  pedidos = [];
  r = await admin.req('POST', '/api/capturas/leer', { imagen: 'data:application/pdf;base64,JVBERi0xLjQK' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(pedidos[0].pedido.messages[0].content[0].source, { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' });
  assert.equal(pedidos[0].pedido.messages[0].content[0].type, 'document');
  assert.equal((await admin.req('POST', '/api/capturas/leer', { imagen: 'data:text/plain;base64,aG9sYQ==' })).status, 400);

  r = await admin.req('PUT', '/api/admin/configuracion', { anthropic_api_key: '' });
  assert.equal(r.data.lectura_capturas, false);
});
