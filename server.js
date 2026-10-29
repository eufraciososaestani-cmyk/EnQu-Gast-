'use strict';
// EnQuéGasté — servidor web
const http = require('http');
const path = require('path');
const { parseCookies, readBody, serveStatic, HttpError } = require('./lib/http');
const db = require('./lib/db');
const { router } = require('./lib/api');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const PROD = process.env.NODE_ENV === 'production';

function seguridad(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  seguridad(res);
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/salud') return json(res, 200, { ok: true });

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método no permitido' });
    if (!serveStatic(PUBLIC, req, res, pathname)) json(res, 404, { error: 'No encontrado' });
    return;
  }

  const ctx = {
    req, res, pathname, params: {}, query: Object.fromEntries(url.searchParams), body: {},
    cookies: parseCookies(req.headers.cookie),
    ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
  };

  try {
    const found = router.match(req.method, pathname);
    if (!found) throw new HttpError(404, 'Ruta no encontrada');
    ctx.params = found.params;

    if (req.method !== 'GET') {
      // Protección CSRF: las escrituras deben venir de la propia app (JSON + encabezado propio)
      if (req.headers['x-atg'] !== '1') throw new HttpError(403, 'Solicitud no permitida');
      ctx.body = await readBody(req);
      if (typeof ctx.body !== 'object' || Array.isArray(ctx.body) || ctx.body === null) throw new HttpError(400, 'Formato inválido');
    }

    let result;
    for (const h of found.route.handlers) result = await h(ctx);
    if (!res.headersSent) json(res, 200, result ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    if (e && e.code === '23505') return json(res, 409, { error: 'Ese registro ya existe.' });
    if (e && e.code === '23503') return json(res, 409, { error: 'El registro está relacionado con otros datos.' });
    console.error(new Date().toISOString(), req.method, pathname, e);
    if (!res.headersSent) json(res, 500, { error: 'Ocurrió un error inesperado. Probá de nuevo.' });
  }
});

db.migrate()
  .then(() => server.listen(PORT, () => console.log(`EnQuéGasté escuchando en el puerto ${PORT}`)))
  .catch((e) => { console.error('No se pudo preparar la base de datos:', e); process.exit(1); });

module.exports = server;
