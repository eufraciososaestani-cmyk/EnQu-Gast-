-- Esquema de EnQuéGasté. Se ejecuta en cada arranque; es idempotente.

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'usuario' CHECK (rol IN ('admin','usuario')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  moneda TEXT NOT NULL DEFAULT 'ARS',
  debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE,
  token_version INT NOT NULL DEFAULT 0,
  ultimo_acceso TIMESTAMPTZ,
  creado TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS monedas (
  codigo TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  simbolo TEXT NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS medios_pago (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  icono TEXT NOT NULL DEFAULT '💳',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  orden INT NOT NULL DEFAULT 0
);

-- usuario_id NULL = categoría global (la administra el admin)
CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
  padre_id INT REFERENCES categorias(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('gasto','ingreso')),
  icono TEXT NOT NULL DEFAULT '🏷️',
  color TEXT NOT NULL DEFAULT '#7a8b84',
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  orden INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cuentas (
  id SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('efectivo','banco','billetera','tarjeta','inversion')),
  moneda TEXT NOT NULL DEFAULT 'ARS',
  saldo_inicial NUMERIC(14,2) NOT NULL DEFAULT 0,
  dia_cierre INT,
  dia_vencimiento INT,
  archivada BOOLEAN NOT NULL DEFAULT FALSE,
  creado TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movimientos (
  id SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('gasto','ingreso','transferencia')),
  importe NUMERIC(14,2) NOT NULL CHECK (importe > 0),
  fecha DATE NOT NULL,
  categoria_id INT REFERENCES categorias(id) ON DELETE SET NULL,
  cuenta_id INT REFERENCES cuentas(id) ON DELETE SET NULL,
  cuenta_destino_id INT REFERENCES cuentas(id) ON DELETE SET NULL,
  medio_pago_id INT REFERENCES medios_pago(id) ON DELETE SET NULL,
  nota TEXT NOT NULL DEFAULT '',
  recurrente_id INT,
  creado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movimientos_usuario_fecha ON movimientos (usuario_id, fecha DESC);

CREATE TABLE IF NOT EXISTS recurrentes (
  id SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('gasto','ingreso')),
  nombre TEXT NOT NULL,
  importe NUMERIC(14,2) NOT NULL CHECK (importe > 0),
  dia INT NOT NULL CHECK (dia BETWEEN 1 AND 31),
  categoria_id INT REFERENCES categorias(id) ON DELETE SET NULL,
  cuenta_id INT REFERENCES cuentas(id) ON DELETE SET NULL,
  medio_pago_id INT REFERENCES medios_pago(id) ON DELETE SET NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS presupuestos (
  id SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  categoria_id INT NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  limite NUMERIC(14,2) NOT NULL CHECK (limite > 0),
  UNIQUE (usuario_id, categoria_id)
);

CREATE TABLE IF NOT EXISTS objetivos (
  id SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  meta NUMERIC(14,2) NOT NULL CHECK (meta > 0),
  ahorrado NUMERIC(14,2) NOT NULL DEFAULT 0,
  fecha_limite DATE,
  icono TEXT NOT NULL DEFAULT '🎯',
  creado TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auditoria (
  id SERIAL PRIMARY KEY,
  usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
  accion TEXT NOT NULL,
  detalle TEXT NOT NULL DEFAULT '',
  ip TEXT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now()
);
