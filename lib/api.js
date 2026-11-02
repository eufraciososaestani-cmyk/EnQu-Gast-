'use strict';
const { Router, HttpError } = require('./http');
const { q, one, all, tx, crearCuentaInicial } = require('./db');
const auth = require('./auth');

const r = new Router();
const COOKIE = 'atg_sesion';

// ---------- utilidades de validación ----------
const fail = (msg, status = 400) => { throw new HttpError(status, msg); };
function texto(v, campo, { min = 1, max = 120, opcional = false } = {}) {
  if ((v === undefined || v === null || v === '') && opcional) return null;
  const s = String(v ?? '').trim();
  if (s.length < min) fail(`Completá ${campo}.`);
  if (s.length > max) fail(`${campo} es demasiado largo.`);
  return s;
}
function importe(v, campo = 'el importe') {
  const n = typeof v === 'number' ? v : parseImporte(String(v ?? ''));
  if (!Number.isFinite(n) || n <= 0) fail(`Ingresá ${campo} mayor a cero.`);
  if (n > 999999999999) fail(`${campo} es demasiado grande.`);
  return Math.round(n * 100) / 100;
}
// Acepta "15000", "15.000", "15.000,50", "15000,5" y "15000.50"
function parseImporte(s) {
  s = s.replace(/[\s$]/g, '');
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+\.\d{1,2}$/.test(s)) return Number(s);
  return Number(s.replace(/\./g, ''));
}
function numero(v, { opcional = false } = {}) {
  if ((v === undefined || v === null || v === '') && opcional) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) fail('Número inválido.');
  return n;
}
function id(v, opcional = true) {
  if ((v === undefined || v === null || v === '') && opcional) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail('Identificador inválido.');
  return n;
}
function fecha(v, opcional = false) {
  if (!v && opcional) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) || isNaN(Date.parse(v))) fail('Fecha inválida.');
  return v;
}
function email(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 160) fail('Ingresá un correo electrónico válido.');
  return s;
}
function password(v) {
  const s = String(v || '');
  if (s.length < 8) fail('La contraseña debe tener al menos 8 caracteres.');
  if (s.length > 200) fail('La contraseña es demasiado larga.');
  return s;
}
const color = (v) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : '#7a8b84');
const icono = (v, def) => (v ? String(v).slice(0, 8) : def);
const enumv = (v, opciones, campo) => (opciones.includes(v) ? v : fail(`${campo} inválido.`));
const mesActual = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
function rangoMes(mes) {
  if (!/^\d{4}-\d{2}$/.test(mes || '')) mes = mesActual();
  const [y, m] = mes.split('-').map(Number);
  const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { mes, desde: `${mes}-01`, hasta: fin };
}

async function auditar(ctx, accion, detalle = '') {
  await q('INSERT INTO auditoria (usuario_id, accion, detalle, ip) VALUES ($1,$2,$3,$4)',
    [ctx.user ? ctx.user.id : null, accion, detalle.slice(0, 500), ctx.ip]);
}

// ---------- sesión ----------
function setSesion(ctx, usuario) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  ctx.res.setHeader('Set-Cookie',
    `${COOKIE}=${auth.crearToken(usuario)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${auth.DURACION_MS / 1000}${secure}`);
}
function borrarSesion(ctx) {
  ctx.res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

async function cargarUsuario(ctx) {
  const data = auth.leerToken(ctx.cookies[COOKIE]);
  if (!data) return null;
  const u = await one(`SELECT id, nombre, email, rol, activo, moneda, debe_cambiar_password, token_version,
    ultimo_acceso FROM usuarios WHERE id = $1`, [data.uid]);
  if (!u || !u.activo || u.token_version !== data.v) return null;
  return u;
}

async function requiereSesion(ctx) {
  ctx.user = await cargarUsuario(ctx);
  if (!ctx.user) fail('Tu sesión expiró. Volvé a ingresar.', 401);
  const libres = ['/api/auth/password', '/api/auth/yo', '/api/auth/logout'];
  if (ctx.user.debe_cambiar_password && !libres.includes(ctx.pathname)) fail('Tenés que cambiar tu contraseña temporal.', 403);
}
async function requiereAdmin(ctx) {
  await requiereSesion(ctx);
  if (ctx.user.rol !== 'admin') fail('No tenés permisos para esta sección.', 403);
}

// Límite simple de intentos (memoria del proceso)
const intentos = new Map();
function limitar(clave, max = 10, ventanaMs = 15 * 60e3) {
  const ahora = Date.now();
  const lista = (intentos.get(clave) || []).filter((t) => ahora - t < ventanaMs);
  if (lista.length >= max) fail('Demasiados intentos. Esperá unos minutos y probá de nuevo.', 429);
  lista.push(ahora); intentos.set(clave, lista);
}
setInterval(() => { const a = Date.now(); for (const [k, v] of intentos) if (v.every((t) => a - t > 15 * 60e3)) intentos.delete(k); }, 60e3).unref();

const config = async () => Object.fromEntries((await all('SELECT clave, valor FROM configuracion')).map((c) => [c.clave, c.valor]));
const publicoUsuario = (u) => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, moneda: u.moneda, debe_cambiar_password: u.debe_cambiar_password });

// ======================= AUTENTICACIÓN =======================
const hayUsuarios = async () => !!(await one('SELECT 1 AS x FROM usuarios LIMIT 1'));

r.get('/api/config/publica', async () => {
  const c = await config();
  return { registro_abierto: c.registro_abierto, eslogan: c.eslogan, primer_uso: !(await hayUsuarios()) };
});

// Cada persona se crea su propia cuenta. La cuenta de administrador es la de ADMIN_EMAIL
// (o, si no está definido, la primera que se crea); puede crearse aunque el registro esté cerrado.
r.post('/api/auth/registro', async (ctx) => {
  limitar('registro:' + ctx.ip, 10, 60 * 60e3);
  const c = await config();
  const nombre = texto(ctx.body.nombre, 'tu nombre', { max: 80 });
  const mail = email(ctx.body.email);
  const hash = await auth.hashPassword(password(ctx.body.password));
  const u = await tx(async (cli) => {
    await cli.query('SELECT pg_advisory_xact_lock(4242)'); // dos registros a la vez no pueden quedarse ambos con el rol de admin
    const primero = !(await cli.query('SELECT 1 AS x FROM usuarios LIMIT 1')).rows.length;
    const hayAdmin = !!(await cli.query(`SELECT 1 AS x FROM usuarios WHERE rol = 'admin' LIMIT 1`)).rows.length;
    const reservado = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const esAdmin = !hayAdmin && (reservado ? mail === reservado : primero);
    if (!esAdmin && !c.registro_abierto) fail('El registro está cerrado. Pedile una cuenta al administrador.', 403);
    if ((await cli.query('SELECT 1 AS x FROM usuarios WHERE email = $1', [mail])).rows.length) fail('Ya existe una cuenta con ese correo.', 409);
    const nuevo = (await cli.query(`INSERT INTO usuarios (nombre, email, password_hash, moneda, rol) VALUES ($1,$2,$3,$4,$5)
      RETURNING id, nombre, email, rol, moneda, debe_cambiar_password, token_version`,
    [nombre, mail, hash, c.moneda_predeterminada || 'ARS', esAdmin ? 'admin' : 'usuario'])).rows[0];
    await crearCuentaInicial(nuevo, cli);
    return nuevo;
  });
  ctx.user = u; await auditar(ctx, u.rol === 'admin' ? 'registro_principal' : 'registro', mail);
  setSesion(ctx, u);
  return { usuario: publicoUsuario(u) };
});

r.post('/api/auth/login', async (ctx) => {
  const mail = String(ctx.body.email || '').trim().toLowerCase();
  limitar('login:' + ctx.ip + ':' + mail);
  const u = await one('SELECT * FROM usuarios WHERE email = $1', [mail]);
  const ok = u && (await auth.verifyPassword(String(ctx.body.password || ''), u.password_hash));
  if (!ok) fail('Correo o contraseña incorrectos.', 401);
  if (!u.activo) fail('Tu cuenta está desactivada. Contactá al administrador.', 403);
  await q('UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1', [u.id]);
  setSesion(ctx, u);
  return { usuario: publicoUsuario(u) };
});

r.post('/api/auth/logout', async (ctx) => { borrarSesion(ctx); return { ok: true }; });

r.post('/api/auth/olvide', async (ctx) => {
  limitar('olvide:' + ctx.ip, 5, 60 * 60e3);
  const mail = email(ctx.body.email);
  const u = await one('SELECT id FROM usuarios WHERE email = $1 AND activo', [mail]);
  if (u) await q(`INSERT INTO auditoria (usuario_id, accion, detalle, ip) VALUES ($1, 'solicitud_recuperacion', $2, $3)`, [u.id, mail, ctx.ip]);
  // Misma respuesta exista o no la cuenta, para no revelar qué correos están registrados.
  return { ok: true };
});

// La app consulta esto cada vez que se abre: renueva la sesión para que no haya que volver a ingresar mientras se use.
r.get('/api/auth/yo', requiereSesion, async (ctx) => {
  setSesion(ctx, ctx.user);
  return { usuario: publicoUsuario(ctx.user) };
});

r.post('/api/auth/password', requiereSesion, async (ctx) => {
  const u = await one('SELECT * FROM usuarios WHERE id = $1', [ctx.user.id]);
  if (!(await auth.verifyPassword(String(ctx.body.actual || ''), u.password_hash))) fail('La contraseña actual no es correcta.');
  const nueva = password(ctx.body.nueva);
  const act = await one(`UPDATE usuarios SET password_hash = $1, debe_cambiar_password = FALSE, token_version = token_version + 1
    WHERE id = $2 RETURNING *`, [await auth.hashPassword(nueva), u.id]);
  await auditar(ctx, 'cambio_password');
  setSesion(ctx, act); // cierra las demás sesiones y mantiene esta
  return { usuario: publicoUsuario(act) };
});

r.put('/api/perfil', requiereSesion, async (ctx) => {
  const nombre = texto(ctx.body.nombre, 'tu nombre', { max: 80 });
  const moneda = ctx.body.moneda || ctx.user.moneda;
  if (!(await one('SELECT 1 AS x FROM monedas WHERE codigo = $1 AND activa', [moneda]))) fail('Moneda inválida.');
  const u = await one('UPDATE usuarios SET nombre = $1, moneda = $2 WHERE id = $3 RETURNING *', [nombre, moneda, ctx.user.id]);
  return { usuario: publicoUsuario(u) };
});

// ======================= CATÁLOGO =======================
async function saldosCuentas(uid) {
  return all(`
    SELECT c.id, c.nombre, c.tipo, c.moneda, c.saldo_inicial::float8 AS saldo_inicial, c.dia_cierre, c.dia_vencimiento, c.archivada,
      (c.saldo_inicial + COALESCE((
        SELECT SUM(CASE
          WHEN m.tipo = 'ingreso' AND m.cuenta_id = c.id THEN m.importe
          WHEN m.tipo = 'gasto' AND m.cuenta_id = c.id THEN -m.importe
          WHEN m.tipo = 'transferencia' AND m.cuenta_id = c.id THEN -m.importe
          WHEN m.tipo = 'transferencia' AND m.cuenta_destino_id = c.id THEN m.importe
          ELSE 0 END)
        FROM movimientos m WHERE m.usuario_id = c.usuario_id AND (m.cuenta_id = c.id OR m.cuenta_destino_id = c.id)
      ), 0))::float8 AS saldo
    FROM cuentas c WHERE c.usuario_id = $1 ORDER BY c.archivada, c.id`, [uid]);
}

r.get('/api/catalogo', requiereSesion, async (ctx) => {
  const [categorias, medios, monedas, cuentas] = await Promise.all([
    all(`SELECT id, padre_id, nombre, tipo, icono, color, (usuario_id IS NOT NULL) AS propia FROM categorias
         WHERE activa AND (usuario_id IS NULL OR usuario_id = $1) ORDER BY orden, nombre`, [ctx.user.id]),
    all('SELECT id, nombre, icono FROM medios_pago WHERE activo ORDER BY orden, nombre'),
    all('SELECT codigo, nombre, simbolo FROM monedas WHERE activa ORDER BY codigo'),
    saldosCuentas(ctx.user.id),
  ]);
  return { categorias, medios, monedas, cuentas };
});

// Categorías personales del usuario
r.post('/api/categorias', requiereSesion, async (ctx) => {
  const b = ctx.body;
  const padre = id(b.padre_id);
  if (padre) await categoriaVisible(ctx.user.id, padre);
  return one(`INSERT INTO categorias (usuario_id, padre_id, nombre, tipo, icono, color) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [ctx.user.id, padre, texto(b.nombre, 'el nombre', { max: 40 }), enumv(b.tipo, ['gasto', 'ingreso'], 'Tipo'), icono(b.icono, '🏷️'), color(b.color)]);
});
r.put('/api/categorias/:id', requiereSesion, async (ctx) => {
  const b = ctx.body;
  const res = await q(`UPDATE categorias SET nombre = $1, icono = $2, color = $3 WHERE id = $4 AND usuario_id = $5`,
    [texto(b.nombre, 'el nombre', { max: 40 }), icono(b.icono, '🏷️'), color(b.color), id(ctx.params.id), ctx.user.id]);
  if (!res.rowCount) fail('Categoría no encontrada.', 404);
  return { ok: true };
});
r.del('/api/categorias/:id', requiereSesion, async (ctx) => {
  const res = await q('DELETE FROM categorias WHERE id = $1 AND usuario_id = $2', [id(ctx.params.id), ctx.user.id]);
  if (!res.rowCount) fail('Categoría no encontrada.', 404);
  return { ok: true };
});

async function categoriaVisible(uid, cid, tipo) {
  if (!cid) return null;
  const c = await one('SELECT id, tipo FROM categorias WHERE id = $1 AND (usuario_id IS NULL OR usuario_id = $2)', [cid, uid]);
  if (!c) fail('Categoría inválida.');
  if (tipo && c.tipo !== tipo) fail(`Esa categoría no es de ${tipo === 'gasto' ? 'gastos' : 'ingresos'}.`);
  return cid;
}
async function cuentaPropia(uid, cid) {
  if (!cid) return null;
  if (!(await one('SELECT 1 AS x FROM cuentas WHERE id = $1 AND usuario_id = $2', [cid, uid]))) fail('Cuenta inválida.');
  return cid;
}
async function medioValido(mid) {
  if (!mid) return null;
  if (!(await one('SELECT 1 AS x FROM medios_pago WHERE id = $1', [mid]))) fail('Medio de pago inválido.');
  return mid;
}

// ======================= CUENTAS =======================
const TIPOS_CUENTA = ['efectivo', 'banco', 'billetera', 'tarjeta', 'inversion'];
async function datosCuenta(ctx) {
  const b = ctx.body;
  const moneda = b.moneda || ctx.user.moneda;
  if (!(await one('SELECT 1 AS x FROM monedas WHERE codigo = $1', [moneda]))) fail('Moneda inválida.');
  const dia = (v) => { const n = numero(v, { opcional: true }); if (n !== null && (n < 1 || n > 31)) fail('Día inválido.'); return n; };
  return [texto(b.nombre, 'el nombre', { max: 40 }), enumv(b.tipo, TIPOS_CUENTA, 'Tipo de cuenta'), moneda,
    numero(b.saldo_inicial ?? 0), dia(b.dia_cierre), dia(b.dia_vencimiento)];
}
r.get('/api/cuentas', requiereSesion, async (ctx) => saldosCuentas(ctx.user.id));
r.post('/api/cuentas', requiereSesion, async (ctx) => one(
  `INSERT INTO cuentas (usuario_id, nombre, tipo, moneda, saldo_inicial, dia_cierre, dia_vencimiento) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
  [ctx.user.id, ...(await datosCuenta(ctx))]));
r.put('/api/cuentas/:id', requiereSesion, async (ctx) => {
  const res = await q(`UPDATE cuentas SET nombre=$1, tipo=$2, moneda=$3, saldo_inicial=$4, dia_cierre=$5, dia_vencimiento=$6, archivada=$7
    WHERE id=$8 AND usuario_id=$9`, [...(await datosCuenta(ctx)), !!ctx.body.archivada, id(ctx.params.id), ctx.user.id]);
  if (!res.rowCount) fail('Cuenta no encontrada.', 404);
  return { ok: true };
});
r.del('/api/cuentas/:id', requiereSesion, async (ctx) => {
  const cid = id(ctx.params.id);
  const usada = await one('SELECT 1 AS x FROM movimientos WHERE usuario_id = $1 AND (cuenta_id = $2 OR cuenta_destino_id = $2) LIMIT 1', [ctx.user.id, cid]);
  if (usada) fail('La cuenta tiene movimientos. Podés archivarla en lugar de eliminarla.', 409);
  const res = await q('DELETE FROM cuentas WHERE id = $1 AND usuario_id = $2', [cid, ctx.user.id]);
  if (!res.rowCount) fail('Cuenta no encontrada.', 404);
  return { ok: true };
});

// ======================= MOVIMIENTOS =======================
async function datosMovimiento(ctx) {
  const b = ctx.body; const uid = ctx.user.id;
  const tipo = enumv(b.tipo, ['gasto', 'ingreso', 'transferencia'], 'Tipo de movimiento');
  const imp = importe(b.importe);
  const f = fecha(b.fecha || new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10));
  const cuenta = await cuentaPropia(uid, id(b.cuenta_id));
  let destino = null, categoria = null;
  if (tipo === 'transferencia') {
    if (!cuenta) fail('Elegí la cuenta de origen.');
    destino = await cuentaPropia(uid, id(b.cuenta_destino_id));
    if (!destino) fail('Elegí la cuenta de destino.');
    if (destino === cuenta) fail('El origen y el destino deben ser distintos.');
  } else {
    categoria = await categoriaVisible(uid, id(b.categoria_id), tipo);
    if (!categoria) fail('Elegí una categoría.');
  }
  const medio = tipo === 'gasto' ? await medioValido(id(b.medio_pago_id)) : null;
  const nota = texto(b.nota, 'la nota', { max: 300, opcional: true }) || '';
  return [tipo, imp, f, categoria, cuenta, destino, medio, nota];
}

const SELECT_MOV = `SELECT m.id, m.tipo, m.importe::float8 AS importe, to_char(m.fecha, 'YYYY-MM-DD') AS fecha, m.nota,
  m.categoria_id, m.cuenta_id, m.cuenta_destino_id, m.medio_pago_id,
  c.nombre AS categoria, c.icono AS categoria_icono, c.color AS categoria_color,
  cu.nombre AS cuenta, cd.nombre AS cuenta_destino, mp.nombre AS medio_pago, COALESCE(cu.moneda, u.moneda) AS moneda
  FROM movimientos m
  JOIN usuarios u ON u.id = m.usuario_id
  LEFT JOIN categorias c ON c.id = m.categoria_id
  LEFT JOIN cuentas cu ON cu.id = m.cuenta_id
  LEFT JOIN cuentas cd ON cd.id = m.cuenta_destino_id
  LEFT JOIN medios_pago mp ON mp.id = m.medio_pago_id`;

function filtrosMovimientos(ctx) {
  const f = ctx.query; const where = ['m.usuario_id = $1']; const p = [ctx.user.id];
  const add = (sql, v) => { p.push(v); where.push(sql.replaceAll('?', '$' + p.length)); };
  if (f.desde) add('m.fecha >= ?', fecha(f.desde));
  if (f.hasta) add('m.fecha <= ?', fecha(f.hasta));
  if (f.tipo) add('m.tipo = ?', enumv(f.tipo, ['gasto', 'ingreso', 'transferencia'], 'Tipo'));
  if (f.categoria) add('(m.categoria_id = ? OR c.padre_id = ?)', id(f.categoria));
  if (f.cuenta) add('(m.cuenta_id = ? OR m.cuenta_destino_id = ?)', id(f.cuenta));
  if (f.q) add('(m.nota ILIKE ? OR c.nombre ILIKE ?)', '%' + String(f.q).slice(0, 60).replace(/[%_\\]/g, '\\$&') + '%');
  if (f.min) add('m.importe >= ?', numero(f.min));
  if (f.max) add('m.importe <= ?', numero(f.max));
  return { where: where.join(' AND '), p };
}

r.get('/api/movimientos', requiereSesion, async (ctx) => {
  const { where, p } = filtrosMovimientos(ctx);
  const limit = Math.min(Number(ctx.query.limit) || 50, 500);
  const offset = Math.max(Number(ctx.query.offset) || 0, 0);
  const [items, tot] = await Promise.all([
    all(`${SELECT_MOV} WHERE ${where} ORDER BY m.fecha DESC, m.id DESC LIMIT ${limit} OFFSET ${offset}`, p),
    one(`SELECT COUNT(*)::int AS n,
      COALESCE(SUM(CASE WHEN m.tipo='ingreso' THEN m.importe END),0)::float8 AS ingresos,
      COALESCE(SUM(CASE WHEN m.tipo='gasto' THEN m.importe END),0)::float8 AS gastos
      FROM movimientos m LEFT JOIN categorias c ON c.id = m.categoria_id WHERE ${where}`, p),
  ]);
  return { items, total: tot.n, ingresos: tot.ingresos, gastos: tot.gastos };
});

r.get('/api/movimientos.csv', requiereSesion, async (ctx) => {
  const { where, p } = filtrosMovimientos(ctx);
  const rows = await all(`${SELECT_MOV} WHERE ${where} ORDER BY m.fecha DESC, m.id DESC LIMIT 20000`, p);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = ['Fecha;Tipo;Importe;Moneda;Categoría;Cuenta;Cuenta destino;Medio de pago;Nota'];
  for (const m of rows) lineas.push([m.fecha, m.tipo, String(m.importe).replace('.', ','), m.moneda, m.categoria, m.cuenta, m.cuenta_destino, m.medio_pago, m.nota].map(esc).join(';'));
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="movimientos.csv"' });
  ctx.res.end('﻿' + lineas.join('\r\n'));
  return undefined;
});

r.post('/api/movimientos', requiereSesion, async (ctx) => one(
  `INSERT INTO movimientos (usuario_id, tipo, importe, fecha, categoria_id, cuenta_id, cuenta_destino_id, medio_pago_id, nota)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [ctx.user.id, ...(await datosMovimiento(ctx))]));

r.put('/api/movimientos/:id', requiereSesion, async (ctx) => {
  const res = await q(`UPDATE movimientos SET tipo=$1, importe=$2, fecha=$3, categoria_id=$4, cuenta_id=$5, cuenta_destino_id=$6,
    medio_pago_id=$7, nota=$8 WHERE id=$9 AND usuario_id=$10`, [...(await datosMovimiento(ctx)), id(ctx.params.id), ctx.user.id]);
  if (!res.rowCount) fail('Movimiento no encontrado.', 404);
  return { ok: true };
});
r.del('/api/movimientos/:id', requiereSesion, async (ctx) => {
  const res = await q('DELETE FROM movimientos WHERE id = $1 AND usuario_id = $2', [id(ctx.params.id), ctx.user.id]);
  if (!res.rowCount) fail('Movimiento no encontrado.', 404);
  return { ok: true };
});

// ======================= RESUMEN / ESTADÍSTICAS =======================
r.get('/api/resumen', requiereSesion, async (ctx) => {
  const uid = ctx.user.id;
  const { mes, desde, hasta } = rangoMes(ctx.query.mes);
  const moneda = ctx.query.moneda || ctx.user.moneda;
  const filtroMoneda = `COALESCE((SELECT moneda FROM cuentas WHERE id = m.cuenta_id), $4) = $4`;
  const base = [uid, desde, hasta, moneda];

  const [tot, porCategoria, cuentas, objetivos, presupuestos, ultimos, recurrentes] = await Promise.all([
    one(`SELECT COALESCE(SUM(CASE WHEN tipo='ingreso' THEN importe END),0)::float8 AS ingresos,
                COALESCE(SUM(CASE WHEN tipo='gasto' THEN importe END),0)::float8 AS gastos
         FROM movimientos m WHERE usuario_id=$1 AND fecha BETWEEN $2 AND $3 AND ${filtroMoneda}`, base),
    all(`SELECT COALESCE(p.id, c.id) AS id, COALESCE(p.nombre, c.nombre, 'Sin categoría') AS nombre,
                COALESCE(p.icono, c.icono, '📦') AS icono, COALESCE(p.color, c.color, '#7a8b84') AS color, SUM(m.importe)::float8 AS total
         FROM movimientos m LEFT JOIN categorias c ON c.id = m.categoria_id LEFT JOIN categorias p ON p.id = c.padre_id
         WHERE m.usuario_id=$1 AND m.tipo='gasto' AND m.fecha BETWEEN $2 AND $3 AND ${filtroMoneda}
         GROUP BY 1,2,3,4 ORDER BY total DESC`, base),
    saldosCuentas(uid),
    one(`SELECT COALESCE(SUM(ahorrado),0)::float8 AS ahorrado, COALESCE(SUM(meta),0)::float8 AS meta FROM objetivos WHERE usuario_id=$1`, [uid]),
    presupuestosDelMes(uid, desde, hasta),
    all(`${SELECT_MOV} WHERE m.usuario_id=$1 ORDER BY m.fecha DESC, m.id DESC LIMIT 8`, [uid]),
    proximosRecurrentes(uid),
  ]);

  const historico = await all(`
    WITH meses AS (SELECT generate_series(date_trunc('month', $2::date) - interval '5 months', date_trunc('month', $2::date), interval '1 month')::date AS inicio)
    SELECT to_char(meses.inicio, 'YYYY-MM') AS mes,
      COALESCE(SUM(CASE WHEN m.tipo='ingreso' THEN m.importe END),0)::float8 AS ingresos,
      COALESCE(SUM(CASE WHEN m.tipo='gasto' THEN m.importe END),0)::float8 AS gastos
    FROM meses LEFT JOIN movimientos m ON m.usuario_id=$1 AND date_trunc('month', m.fecha) = meses.inicio
      AND COALESCE((SELECT moneda FROM cuentas WHERE id = m.cuenta_id), $3) = $3
    GROUP BY meses.inicio ORDER BY meses.inicio`, [uid, desde, moneda]);

  const activas = cuentas.filter((c) => !c.archivada && c.moneda === moneda);
  const monedasUsadas = [...new Set(cuentas.filter((c) => !c.archivada).map((c) => c.moneda).concat(ctx.user.moneda))];
  return {
    mes, moneda, monedas: monedasUsadas,
    ingresos: tot.ingresos, gastos: tot.gastos, balance_mes: tot.ingresos - tot.gastos,
    disponible: activas.filter((c) => c.tipo !== 'tarjeta').reduce((s, c) => s + c.saldo, 0),
    deuda_tarjetas: activas.filter((c) => c.tipo === 'tarjeta').reduce((s, c) => s + Math.min(c.saldo, 0), 0),
    ahorro: objetivos.ahorrado, meta_ahorro: objetivos.meta,
    por_categoria: porCategoria, historico, presupuestos, ultimos, recurrentes,
  };
});

async function presupuestosDelMes(uid, desde, hasta) {
  return all(`SELECT p.id, p.categoria_id, p.limite::float8 AS limite, c.nombre, c.icono, c.color,
      COALESCE((SELECT SUM(m.importe) FROM movimientos m LEFT JOIN categorias mc ON mc.id = m.categoria_id
        WHERE m.usuario_id = p.usuario_id AND m.tipo = 'gasto' AND m.fecha BETWEEN $2 AND $3
        AND (m.categoria_id = p.categoria_id OR mc.padre_id = p.categoria_id)), 0)::float8 AS gastado
    FROM presupuestos p JOIN categorias c ON c.id = p.categoria_id WHERE p.usuario_id = $1 ORDER BY c.nombre`, [uid, desde, hasta]);
}

// ======================= PRESUPUESTOS =======================
r.get('/api/presupuestos', requiereSesion, async (ctx) => {
  const { desde, hasta } = rangoMes(ctx.query.mes);
  return presupuestosDelMes(ctx.user.id, desde, hasta);
});
r.put('/api/presupuestos', requiereSesion, async (ctx) => {
  const cat = await categoriaVisible(ctx.user.id, id(ctx.body.categoria_id, false), 'gasto');
  return one(`INSERT INTO presupuestos (usuario_id, categoria_id, limite) VALUES ($1,$2,$3)
    ON CONFLICT (usuario_id, categoria_id) DO UPDATE SET limite = EXCLUDED.limite RETURNING id`,
  [ctx.user.id, cat, importe(ctx.body.limite, 'el límite')]);
});
r.del('/api/presupuestos/:id', requiereSesion, async (ctx) => {
  await q('DELETE FROM presupuestos WHERE id = $1 AND usuario_id = $2', [id(ctx.params.id), ctx.user.id]);
  return { ok: true };
});

// ======================= OBJETIVOS DE AHORRO =======================
const SELECT_OBJ = `SELECT id, nombre, meta::float8 AS meta, ahorrado::float8 AS ahorrado, to_char(fecha_limite, 'YYYY-MM-DD') AS fecha_limite, icono FROM objetivos`;
r.get('/api/objetivos', requiereSesion, async (ctx) => all(`${SELECT_OBJ} WHERE usuario_id = $1 ORDER BY id`, [ctx.user.id]));
r.post('/api/objetivos', requiereSesion, async (ctx) => one(
  'INSERT INTO objetivos (usuario_id, nombre, meta, fecha_limite, icono) VALUES ($1,$2,$3,$4,$5) RETURNING id',
  [ctx.user.id, texto(ctx.body.nombre, 'el nombre', { max: 60 }), importe(ctx.body.meta, 'la meta'), fecha(ctx.body.fecha_limite, true), icono(ctx.body.icono, '🎯')]));
r.put('/api/objetivos/:id', requiereSesion, async (ctx) => {
  const res = await q('UPDATE objetivos SET nombre=$1, meta=$2, fecha_limite=$3, icono=$4 WHERE id=$5 AND usuario_id=$6',
    [texto(ctx.body.nombre, 'el nombre', { max: 60 }), importe(ctx.body.meta, 'la meta'), fecha(ctx.body.fecha_limite, true), icono(ctx.body.icono, '🎯'), id(ctx.params.id), ctx.user.id]);
  if (!res.rowCount) fail('Objetivo no encontrado.', 404);
  return { ok: true };
});
r.post('/api/objetivos/:id/aporte', requiereSesion, async (ctx) => {
  const monto = numero(ctx.body.importe);
  if (!monto) fail('Ingresá un importe.');
  const o = await one(`UPDATE objetivos SET ahorrado = GREATEST(ahorrado + $1, 0) WHERE id = $2 AND usuario_id = $3 RETURNING id`,
    [monto, id(ctx.params.id), ctx.user.id]);
  if (!o) fail('Objetivo no encontrado.', 404);
  return { ok: true };
});
r.del('/api/objetivos/:id', requiereSesion, async (ctx) => {
  await q('DELETE FROM objetivos WHERE id = $1 AND usuario_id = $2', [id(ctx.params.id), ctx.user.id]);
  return { ok: true };
});

// ======================= RECURRENTES (vencimientos) =======================
async function proximosRecurrentes(uid) {
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const lista = await all(`SELECT r.id, r.tipo, r.nombre, r.importe::float8 AS importe, r.dia, r.categoria_id, r.cuenta_id, r.medio_pago_id, r.activo,
      c.icono, c.color,
      (SELECT to_char(MAX(fecha), 'YYYY-MM-DD') FROM movimientos m WHERE m.recurrente_id = r.id) AS ultimo_registro
    FROM recurrentes r LEFT JOIN categorias c ON c.id = r.categoria_id WHERE r.usuario_id = $1 ORDER BY r.dia`, [uid]);
  const mes = hoy.slice(0, 7);
  for (const it of lista) {
    const [y, m] = mes.split('-').map(Number);
    const ult = new Date(Date.UTC(y, m, 0)).getUTCDate();
    it.vence = `${mes}-${String(Math.min(it.dia, ult)).padStart(2, '0')}`;
    it.registrado_este_mes = !!(it.ultimo_registro && it.ultimo_registro.slice(0, 7) === mes);
    it.vencido = !it.registrado_este_mes && it.vence < hoy;
  }
  return lista;
}
async function datosRecurrente(ctx) {
  const b = ctx.body; const uid = ctx.user.id;
  const tipo = enumv(b.tipo, ['gasto', 'ingreso'], 'Tipo');
  const dia = numero(b.dia); if (!Number.isInteger(dia) || dia < 1 || dia > 31) fail('El día debe estar entre 1 y 31.');
  const cat = await categoriaVisible(uid, id(b.categoria_id), tipo);
  if (!cat) fail('Elegí una categoría.');
  return [tipo, texto(b.nombre, 'el nombre', { max: 60 }), importe(b.importe), dia, cat,
    await cuentaPropia(uid, id(b.cuenta_id)), tipo === 'gasto' ? await medioValido(id(b.medio_pago_id)) : null, b.activo !== false];
}
r.get('/api/recurrentes', requiereSesion, async (ctx) => proximosRecurrentes(ctx.user.id));
r.post('/api/recurrentes', requiereSesion, async (ctx) => one(
  `INSERT INTO recurrentes (tipo, nombre, importe, dia, categoria_id, cuenta_id, medio_pago_id, activo, usuario_id)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [...(await datosRecurrente(ctx)), ctx.user.id]));
r.put('/api/recurrentes/:id', requiereSesion, async (ctx) => {
  const res = await q(`UPDATE recurrentes SET tipo=$1, nombre=$2, importe=$3, dia=$4, categoria_id=$5, cuenta_id=$6, medio_pago_id=$7, activo=$8
    WHERE usuario_id=$9 AND id=$10`, [...(await datosRecurrente(ctx)), ctx.user.id, id(ctx.params.id)]);
  if (!res.rowCount) fail('No encontrado.', 404);
  return { ok: true };
});
r.del('/api/recurrentes/:id', requiereSesion, async (ctx) => {
  await q('DELETE FROM recurrentes WHERE id = $1 AND usuario_id = $2', [id(ctx.params.id), ctx.user.id]);
  return { ok: true };
});
r.post('/api/recurrentes/:id/registrar', requiereSesion, async (ctx) => {
  const rec = await one('SELECT * FROM recurrentes WHERE id = $1 AND usuario_id = $2', [id(ctx.params.id), ctx.user.id]);
  if (!rec) fail('No encontrado.', 404);
  const f = fecha(ctx.body.fecha || new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10));
  const imp = ctx.body.importe ? importe(ctx.body.importe) : rec.importe;
  return one(`INSERT INTO movimientos (usuario_id, tipo, importe, fecha, categoria_id, cuenta_id, medio_pago_id, nota, recurrente_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
  [ctx.user.id, rec.tipo, imp, f, rec.categoria_id, rec.cuenta_id, rec.medio_pago_id, rec.nombre, rec.id]);
});

// ======================= ADMINISTRACIÓN =======================
r.get('/api/admin/estadisticas', requiereAdmin, async () => one(`SELECT
  (SELECT COUNT(*) FROM usuarios)::int AS usuarios,
  (SELECT COUNT(*) FROM usuarios WHERE activo)::int AS activos,
  (SELECT COUNT(*) FROM usuarios WHERE rol = 'admin')::int AS admins,
  (SELECT COUNT(*) FROM usuarios WHERE creado > now() - interval '30 days')::int AS nuevos_30d,
  (SELECT COUNT(*) FROM usuarios WHERE ultimo_acceso > now() - interval '7 days')::int AS activos_7d,
  (SELECT COUNT(*) FROM movimientos)::int AS movimientos,
  (SELECT COUNT(*) FROM movimientos WHERE creado > now() - interval '30 days')::int AS movimientos_30d,
  (SELECT COUNT(*) FROM categorias WHERE usuario_id IS NULL)::int AS categorias_globales`));

// El listado de usuarios NO incluye información financiera.
r.get('/api/admin/usuarios', requiereAdmin, async () => all(`SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.debe_cambiar_password,
    to_char(u.creado, 'YYYY-MM-DD') AS creado, to_char(u.ultimo_acceso AT TIME ZONE 'America/Argentina/Cordoba', 'YYYY-MM-DD HH24:MI') AS ultimo_acceso,
    EXISTS (SELECT 1 FROM auditoria a WHERE a.usuario_id = u.id AND a.accion = 'solicitud_recuperacion'
      AND a.fecha > COALESCE((SELECT MAX(fecha) FROM auditoria b WHERE b.detalle LIKE 'usuario ' || u.id || ' %' AND b.accion = 'reset_password'), 'epoch')
      AND a.fecha > now() - interval '7 days') AS pidio_recuperacion
  FROM usuarios u ORDER BY u.creado DESC`));

async function quedaOtroAdmin(exceptoId) {
  return !!(await one(`SELECT 1 AS x FROM usuarios WHERE rol = 'admin' AND activo AND id <> $1`, [exceptoId]));
}

r.post('/api/admin/usuarios', requiereAdmin, async (ctx) => {
  const nombre = texto(ctx.body.nombre, 'el nombre', { max: 80 });
  const mail = email(ctx.body.email);
  const rol = enumv(ctx.body.rol || 'usuario', ['admin', 'usuario'], 'Rol');
  if (await one('SELECT 1 AS x FROM usuarios WHERE email = $1', [mail])) fail('Ya existe una cuenta con ese correo.', 409);
  const temporal = auth.passwordTemporal();
  const c = await config();
  const u = await one(`INSERT INTO usuarios (nombre, email, password_hash, rol, moneda, debe_cambiar_password)
    VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id, moneda`, [nombre, mail, await auth.hashPassword(temporal), rol, c.moneda_predeterminada || 'ARS']);
  await crearCuentaInicial(u);
  await auditar(ctx, 'crear_usuario', `usuario ${u.id} ${mail} (${rol})`);
  return { id: u.id, password_temporal: temporal };
});

r.put('/api/admin/usuarios/:id', requiereAdmin, async (ctx) => {
  const uid = id(ctx.params.id);
  const actual = await one('SELECT * FROM usuarios WHERE id = $1', [uid]);
  if (!actual) fail('Usuario no encontrado.', 404);
  const nombre = texto(ctx.body.nombre ?? actual.nombre, 'el nombre', { max: 80 });
  const mail = ctx.body.email ? email(ctx.body.email) : actual.email;
  const rol = enumv(ctx.body.rol ?? actual.rol, ['admin', 'usuario'], 'Rol');
  const activo = ctx.body.activo ?? actual.activo;
  if (uid === ctx.user.id && (rol !== 'admin' || !activo)) fail('No podés quitarte el rol de administrador ni desactivar tu propia cuenta.');
  if (actual.rol === 'admin' && (rol !== 'admin' || !activo) && !(await quedaOtroAdmin(uid))) fail('Tiene que quedar al menos un administrador activo.');
  if (mail !== actual.email && await one('SELECT 1 AS x FROM usuarios WHERE email = $1', [mail])) fail('Ese correo ya está en uso.', 409);
  // Desactivar o cambiar el rol invalida las sesiones abiertas de ese usuario
  const invalida = (rol !== actual.rol || !activo) ? 1 : 0;
  await q(`UPDATE usuarios SET nombre=$1, email=$2, rol=$3, activo=$4, token_version = token_version + $5 WHERE id=$6`,
    [nombre, mail, rol, !!activo, invalida, uid]);
  const cambios = [];
  if (rol !== actual.rol) cambios.push(`rol ${actual.rol}→${rol}`);
  if (!!activo !== actual.activo) cambios.push(activo ? 'activado' : 'desactivado');
  if (mail !== actual.email) cambios.push(`email ${actual.email}→${mail}`);
  if (nombre !== actual.nombre) cambios.push('nombre');
  await auditar(ctx, 'editar_usuario', `usuario ${uid} ${mail}: ${cambios.join(', ') || 'sin cambios'}`);
  return { ok: true };
});

r.post('/api/admin/usuarios/:id/reset', requiereAdmin, async (ctx) => {
  const uid = id(ctx.params.id);
  const temporal = auth.passwordTemporal();
  const u = await one(`UPDATE usuarios SET password_hash = $1, debe_cambiar_password = TRUE, token_version = token_version + 1
    WHERE id = $2 RETURNING email`, [await auth.hashPassword(temporal), uid]);
  if (!u) fail('Usuario no encontrado.', 404);
  await auditar(ctx, 'reset_password', `usuario ${uid} ${u.email}`);
  return { password_temporal: temporal };
});

r.del('/api/admin/usuarios/:id', requiereAdmin, async (ctx) => {
  const uid = id(ctx.params.id);
  if (uid === ctx.user.id) fail('No podés eliminar tu propia cuenta.');
  const u = await one('SELECT email, rol FROM usuarios WHERE id = $1', [uid]);
  if (!u) fail('Usuario no encontrado.', 404);
  if (u.rol === 'admin' && !(await quedaOtroAdmin(uid))) fail('Tiene que quedar al menos un administrador activo.');
  if (String(ctx.query.confirmar || '').toLowerCase() !== u.email) fail('Para eliminar, confirmá escribiendo el correo del usuario.');
  await q('DELETE FROM usuarios WHERE id = $1', [uid]);
  await auditar(ctx, 'eliminar_usuario', `usuario ${uid} ${u.email}`);
  return { ok: true };
});

// Categorías globales
r.get('/api/admin/categorias', requiereAdmin, async () => all(`SELECT c.id, c.padre_id, c.nombre, c.tipo, c.icono, c.color, c.activa, c.orden,
  (SELECT COUNT(*) FROM movimientos m WHERE m.categoria_id = c.id)::int AS usos FROM categorias c WHERE usuario_id IS NULL ORDER BY tipo DESC, orden, nombre`));
r.post('/api/admin/categorias', requiereAdmin, async (ctx) => {
  const b = ctx.body;
  const padre = id(b.padre_id);
  const tipo = enumv(b.tipo, ['gasto', 'ingreso'], 'Tipo');
  if (padre && !(await one('SELECT 1 AS x FROM categorias WHERE id = $1 AND usuario_id IS NULL AND tipo = $2 AND padre_id IS NULL', [padre, tipo]))) fail('Categoría padre inválida.');
  const c = await one(`INSERT INTO categorias (padre_id, nombre, tipo, icono, color, orden) VALUES ($1,$2,$3,$4,$5,
    COALESCE((SELECT MAX(orden)+1 FROM categorias WHERE usuario_id IS NULL), 0)) RETURNING id`,
  [padre, texto(b.nombre, 'el nombre', { max: 40 }), tipo, icono(b.icono, '🏷️'), color(b.color)]);
  await auditar(ctx, 'crear_categoria', `${b.nombre} (${tipo})`);
  return c;
});
r.put('/api/admin/categorias/:id', requiereAdmin, async (ctx) => {
  const b = ctx.body;
  const res = await q(`UPDATE categorias SET nombre=$1, icono=$2, color=$3, activa=$4, orden=COALESCE($5, orden) WHERE id=$6 AND usuario_id IS NULL`,
    [texto(b.nombre, 'el nombre', { max: 40 }), icono(b.icono, '🏷️'), color(b.color), b.activa !== false, numero(b.orden, { opcional: true }), id(ctx.params.id)]);
  if (!res.rowCount) fail('Categoría no encontrada.', 404);
  await auditar(ctx, 'editar_categoria', `${ctx.params.id} ${b.nombre}`);
  return { ok: true };
});
r.del('/api/admin/categorias/:id', requiereAdmin, async (ctx) => {
  const cid = id(ctx.params.id);
  const usos = await one('SELECT COUNT(*)::int AS n FROM movimientos WHERE categoria_id = $1', [cid]);
  if (usos.n) fail(`La categoría se usa en ${usos.n} movimientos. Desactivala en lugar de eliminarla.`, 409);
  const res = await q('DELETE FROM categorias WHERE id = $1 AND usuario_id IS NULL', [cid]);
  if (!res.rowCount) fail('Categoría no encontrada.', 404);
  await auditar(ctx, 'eliminar_categoria', String(cid));
  return { ok: true };
});

// Medios de pago
r.get('/api/admin/medios', requiereAdmin, async () => all('SELECT id, nombre, icono, activo, orden FROM medios_pago ORDER BY orden, nombre'));
r.post('/api/admin/medios', requiereAdmin, async (ctx) => {
  const m = await one(`INSERT INTO medios_pago (nombre, icono, orden) VALUES ($1,$2, COALESCE((SELECT MAX(orden)+1 FROM medios_pago),0)) RETURNING id`,
    [texto(ctx.body.nombre, 'el nombre', { max: 40 }), icono(ctx.body.icono, '💳')]);
  await auditar(ctx, 'crear_medio_pago', ctx.body.nombre);
  return m;
});
r.put('/api/admin/medios/:id', requiereAdmin, async (ctx) => {
  await q('UPDATE medios_pago SET nombre=$1, icono=$2, activo=$3 WHERE id=$4',
    [texto(ctx.body.nombre, 'el nombre', { max: 40 }), icono(ctx.body.icono, '💳'), ctx.body.activo !== false, id(ctx.params.id)]);
  await auditar(ctx, 'editar_medio_pago', `${ctx.params.id} ${ctx.body.nombre}`);
  return { ok: true };
});

// Monedas
r.get('/api/admin/monedas', requiereAdmin, async () => all('SELECT codigo, nombre, simbolo, activa FROM monedas ORDER BY codigo'));
r.post('/api/admin/monedas', requiereAdmin, async (ctx) => {
  const codigo = String(ctx.body.codigo || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(codigo)) fail('El código debe tener 3 letras (por ejemplo, EUR).');
  await q(`INSERT INTO monedas (codigo, nombre, simbolo, activa) VALUES ($1,$2,$3,$4)
    ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, simbolo = EXCLUDED.simbolo, activa = EXCLUDED.activa`,
  [codigo, texto(ctx.body.nombre, 'el nombre', { max: 40 }), texto(ctx.body.simbolo, 'el símbolo', { max: 5 }), ctx.body.activa !== false]);
  await auditar(ctx, 'guardar_moneda', codigo);
  return { ok: true };
});

// Configuración general
r.get('/api/admin/configuracion', requiereAdmin, async () => config());
r.put('/api/admin/configuracion', requiereAdmin, async (ctx) => {
  const b = ctx.body; const cambios = {};
  if ('registro_abierto' in b) cambios.registro_abierto = !!b.registro_abierto;
  if ('eslogan' in b) cambios.eslogan = texto(b.eslogan, 'el eslogan', { max: 120 });
  if ('moneda_predeterminada' in b) {
    if (!(await one('SELECT 1 AS x FROM monedas WHERE codigo = $1 AND activa', [b.moneda_predeterminada]))) fail('Moneda inválida.');
    cambios.moneda_predeterminada = b.moneda_predeterminada;
  }
  await tx(async (c) => {
    for (const [k, v] of Object.entries(cambios)) {
      await c.query('INSERT INTO configuracion (clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor', [k, JSON.stringify(v)]);
    }
  });
  await auditar(ctx, 'configuracion', JSON.stringify(cambios));
  return config();
});

r.get('/api/admin/auditoria', requiereAdmin, async () => all(`SELECT a.id, a.accion, a.detalle, a.ip,
  to_char(a.fecha AT TIME ZONE 'America/Argentina/Cordoba', 'YYYY-MM-DD HH24:MI') AS fecha, u.nombre AS usuario
  FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id DESC LIMIT 200`));

module.exports = { router: r, HttpError };
