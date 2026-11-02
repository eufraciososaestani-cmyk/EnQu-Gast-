'use strict';
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./auth');

let Pool;
try { ({ Pool } = require('pg')); } catch { ({ Pool } = require('./minipg')); }

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta la variable DATABASE_URL (cadena de conexión de PostgreSQL).');
  process.exit(1);
}
const usaSSL = process.env.DATABASE_SSL === 'true' || /sslmode=require/.test(url);
const pool = new Pool({ connectionString: url, max: 10, ...(usaSSL ? { ssl: { rejectUnauthorized: false } } : {}) });

const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
const all = async (text, params) => (await pool.query(text, params)).rows;

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

const CATEGORIAS = [
  ['gasto', 'Supermercado', '🛒', '#3f8f6b'], ['gasto', 'Combustible', '⛽', '#c4682d'],
  ['gasto', 'Vivienda', '🏠', '#6a5acd'], ['gasto', 'Servicios', '💡', '#d4a017'],
  ['gasto', 'Transporte', '🚌', '#2f7fb8'], ['gasto', 'Salud', '🩺', '#c0485a'],
  ['gasto', 'Comidas afuera', '🍽️', '#e07a5f'], ['gasto', 'Educación', '📚', '#5b7553'],
  ['gasto', 'Ocio', '🎬', '#9b5de5'], ['gasto', 'Ropa', '👕', '#8d6e63'],
  ['gasto', 'Impuestos', '🧾', '#607d8b'], ['gasto', 'Otros gastos', '📦', '#7a8b84'],
  ['ingreso', 'Sueldo', '💼', '#1f7a55'], ['ingreso', 'Honorarios', '🤝', '#2e9e6e'],
  ['ingreso', 'Ventas', '🏷️', '#47b38a'], ['ingreso', 'Otros ingresos', '💵', '#6cc4a1'],
];
const MEDIOS = [['Efectivo', '💵'], ['Débito', '💳'], ['Crédito', '💳'], ['Transferencia', '🏦'], ['Billetera virtual', '📱']];
const MONEDAS = [['ARS', 'Peso argentino', '$'], ['USD', 'Dólar estadounidense', 'US$']];
// Registro abierto: cada persona se crea su propia cuenta. El administrador puede cerrarlo desde Ajustes.
const CONFIG = {
  registro_abierto: true,
  moneda_predeterminada: 'ARS',
  eslogan: 'Controlá tus gastos. Organizá tu dinero. Ahorrá más.',
};

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').replace(/--.*$/gm, '');
  for (const s of sql.split(';')) if (s.trim()) await q(s);

  for (const [k, v] of Object.entries(CONFIG)) {
    await q('INSERT INTO configuracion (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO NOTHING', [k, JSON.stringify(v)]);
  }
  if (!(await one('SELECT 1 AS x FROM monedas LIMIT 1'))) {
    for (const [c, n, s] of MONEDAS) await q('INSERT INTO monedas (codigo, nombre, simbolo) VALUES ($1,$2,$3)', [c, n, s]);
  }
  if (!(await one('SELECT 1 AS x FROM medios_pago LIMIT 1'))) {
    for (const [i, [n, ic]] of MEDIOS.entries()) await q('INSERT INTO medios_pago (nombre, icono, orden) VALUES ($1,$2,$3)', [n, ic, i]);
  }
  if (!(await one('SELECT 1 AS x FROM categorias WHERE usuario_id IS NULL LIMIT 1'))) {
    for (const [i, [t, n, ic, co]] of CATEGORIAS.entries()) {
      await q('INSERT INTO categorias (tipo, nombre, icono, color, orden) VALUES ($1,$2,$3,$4,$5)', [t, n, ic, co, i]);
    }
  }

  // Administrador inicial desde variables de entorno
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || '';
  if (email && pass && !(await one('SELECT id FROM usuarios WHERE email = $1', [email]))) {
    const u = await one(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, 'admin') RETURNING id, moneda`,
      [process.env.ADMIN_NOMBRE || 'Administrador', email, await hashPassword(pass)]);
    await crearCuentaInicial(u);
    console.log(`Administrador inicial creado: ${email}`);
  }
}

async function crearCuentaInicial(u, cliente = pool) {
  await cliente.query(`INSERT INTO cuentas (usuario_id, nombre, tipo, moneda) VALUES ($1, 'Efectivo', 'efectivo', $2)`, [u.id, u.moneda]);
}

module.exports = { pool, q, one, all, tx, migrate, crearCuentaInicial };
