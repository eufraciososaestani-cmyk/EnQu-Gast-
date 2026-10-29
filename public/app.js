/* EnQuéGasté — interfaz web (sin dependencias) */
'use strict';

// ======================= utilidades =======================
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v === null || v === undefined || v === false ? '' : esc(v));
function h(strings, ...vals) { return raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ''), '')); }
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const hoyISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };
const mesISO = () => hoyISO().slice(0, 7);

const S = { usuario: null, catalogo: null, mes: mesISO(), moneda: null, publica: {} };

function dinero(n, moneda) {
  moneda = moneda || S.moneda || (S.usuario && S.usuario.moneda) || 'ARS';
  const dec = Math.abs(n % 1) > 0.001 ? 2 : 0;
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda, minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
  } catch { return `${moneda} ${Number(n).toLocaleString('es-AR')}`; }
}
function simbolo(moneda) {
  const m = S.catalogo && S.catalogo.monedas.find((x) => x.codigo === moneda);
  return m ? m.simbolo : '$';
}
function parseImporte(s) {
  s = String(s).replace(/[\s$]/g, '');
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+\.\d{1,2}$/.test(s)) return Number(s);
  return Number(s.replace(/\./g, ''));
}
function nombreMes(mes, corto) {
  const [y, m] = mes.split('-').map(Number);
  if (corto) return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'short' }).replace('.', '');
  const n = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long' });
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${y}`;
}
function moverMes(mes, d) {
  const [y, m] = mes.split('-').map(Number);
  const f = new Date(y, m - 1 + d, 1);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
}
function fechaLarga(f) {
  if (f === hoyISO()) return 'Hoy';
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  if (f === new Date(ayer - ayer.getTimezoneOffset() * 60e3).toISOString().slice(0, 10)) return 'Ayer';
  const [y, m, d] = f.split('-').map(Number);
  const op = { weekday: 'long', day: 'numeric', month: 'long' };
  if (y !== new Date().getFullYear()) op.year = 'numeric';
  const t = new Date(y, m - 1, d).toLocaleDateString('es-AR', op);
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function fechaCorta(f) {
  const [y, m, d] = f.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

// ======================= API =======================
async function api(method, url, body) {
  const opts = { method, headers: { 'x-atg': '1' }, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opts); } catch { throw Object.assign(new Error('Sin conexión. Revisá tu internet y probá de nuevo.'), { sinConexion: true }); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith('/api/auth/')) { S.usuario = null; mostrarAcceso('login', data.error); throw new Error(data.error); }
  if (r.status === 403 && data.error && data.error.includes('contraseña temporal')) { mostrarAcceso('cambiar'); throw new Error(data.error); }
  if (!r.ok) throw new Error(data.error || 'Ocurrió un error.');
  return data;
}
const GET = (u) => api('GET', u);
const POST = (u, b = {}) => api('POST', u, b);
const PUT = (u, b = {}) => api('PUT', u, b);
const DEL = (u) => api('DELETE', u);

let avisoTimer;
function aviso(msg, error = false) {
  const el = $('#avisos');
  el.innerHTML = h`<div class="aviso ${error ? 'error' : ''}" role="${error ? 'alert' : 'status'}">${msg}</div>`.s;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.innerHTML = ''; }, error ? 5000 : 2600);
}

async function cargarCatalogo() {
  S.catalogo = await GET('/api/catalogo');
  return S.catalogo;
}
const cat = (id) => S.catalogo.categorias.find((c) => c.id === id);
const categoriasDe = (tipo) => S.catalogo.categorias.filter((c) => c.tipo === tipo);
const cuentasActivas = () => S.catalogo.cuentas.filter((c) => !c.archivada);

// ======================= marca =======================
const LOGO = (t = 36) => raw(`<svg width="${t}" height="${t}" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#10302f"/><circle cx="32" cy="34" r="17" fill="#e2b13c"/><circle cx="32" cy="34" r="12" fill="none" stroke="#b98a1c" stroke-width="2.5"/><path d="M24 37l6-7 5 4 6-8" fill="none" stroke="#10302f" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 26h3.5v3.5" fill="none" stroke="#10302f" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`);

// ======================= acceso =======================
function mostrarAcceso(modo = 'login', mensaje = '') {
  cerrarModal();
  const raiz = $('#raiz');
  const eslogan = S.publica.eslogan || 'Controlá tus gastos. Organizá tu dinero. Ahorrá más.';
  if (modo === 'login' && S.publica.primer_uso) modo = 'primera';
  let form;
  if (modo === 'primera') {
    form = h`<form id="f-acceso" novalidate>
      <h2 style="margin-bottom:8px">Creá tu cuenta</h2>
      <p style="color:var(--gris);margin-bottom:16px">Es la primera vez que se abre EnQuéGasté. Esta va a ser tu cuenta principal, con acceso a todo.</p>
      <label class="campo"><span>Nombre</span><input type="text" name="nombre" autocomplete="name" required maxlength="80"></label>
      <label class="campo"><span>Correo electrónico</span><input type="email" name="email" autocomplete="email" required></label>
      <label class="campo"><span>Contraseña</span><input type="password" name="password" autocomplete="new-password" required minlength="8"><small>Mínimo 8 caracteres.</small></label>
      <p class="error-form" id="err" hidden></p>
      <button class="btn primario bloque">Crear cuenta y empezar</button>
    </form>`;
  } else if (modo === 'login') {
    form = h`<form id="f-acceso" novalidate>
      <h2 style="margin-bottom:16px">Ingresá a tu cuenta</h2>
      ${mensaje ? h`<p class="error-form">${mensaje}</p>` : ''}
      <label class="campo"><span>Correo electrónico</span><input type="email" name="email" autocomplete="email" required></label>
      <label class="campo"><span>Contraseña</span><input type="password" name="password" autocomplete="current-password" required></label>
      <p class="error-form" id="err" hidden></p>
      <button class="btn primario bloque">Ingresar</button>
    </form>`;
  } else if (modo === 'registro') {
    form = h`<form id="f-acceso" novalidate>
      <h2 style="margin-bottom:16px">Creá tu cuenta</h2>
      <label class="campo"><span>Nombre</span><input type="text" name="nombre" autocomplete="name" required maxlength="80"></label>
      <label class="campo"><span>Correo electrónico</span><input type="email" name="email" autocomplete="email" required></label>
      <label class="campo"><span>Contraseña</span><input type="password" name="password" autocomplete="new-password" required minlength="8"><small>Mínimo 8 caracteres.</small></label>
      <p class="error-form" id="err" hidden></p>
      <button class="btn primario bloque">Crear cuenta</button>
    </form>`;
  } else if (modo === 'olvide') {
    form = h`<form id="f-acceso" novalidate>
      <h2 style="margin-bottom:8px">Recuperar el acceso</h2>
      <p style="color:var(--gris);margin-bottom:16px">Dejá tu correo. El administrador recibe el pedido y te da una contraseña temporal para volver a entrar.</p>
      <label class="campo"><span>Correo electrónico</span><input type="email" name="email" autocomplete="email" required></label>
      <p class="error-form" id="err" hidden></p>
      <button class="btn primario bloque">Enviar pedido</button>
    </form>`;
  } else {
    form = h`<form id="f-acceso" novalidate>
      <h2 style="margin-bottom:8px">Elegí una contraseña nueva</h2>
      <p style="color:var(--gris);margin-bottom:16px">Estás usando una contraseña temporal. Cambiala para seguir.</p>
      <label class="campo"><span>Contraseña temporal</span><input type="password" name="actual" autocomplete="current-password" required></label>
      <label class="campo"><span>Contraseña nueva</span><input type="password" name="nueva" autocomplete="new-password" required minlength="8"><small>Mínimo 8 caracteres.</small></label>
      <p class="error-form" id="err" hidden></p>
      <button class="btn primario bloque">Guardar contraseña</button>
    </form>`;
  }
  const enlaces = modo === 'login'
    ? h`<button type="button" data-modo="olvide">Olvidé mi contraseña</button>${S.publica.registro_abierto ? h` · <button type="button" data-modo="registro">Crear una cuenta</button>` : ''}`
    : modo === 'cambiar' ? h`<button type="button" id="salir-acceso">Salir</button>`
      : modo === 'primera' ? ''
        : h`<button type="button" data-modo="login">Ya tengo cuenta</button>`;

  raiz.innerHTML = h`<main class="acceso"><div class="acceso-caja">
    <div class="acceso-marca">${LOGO(56)}<h1>EnQuéGasté</h1><p>${eslogan}</p></div>
    <div class="panel">${form}</div>
    <div class="enlaces">${enlaces}</div>
  </div></main>`.s;

  $$('[data-modo]').forEach((b) => b.addEventListener('click', () => mostrarAcceso(b.dataset.modo)));
  const salir = $('#salir-acceso'); if (salir) salir.addEventListener('click', cerrarSesion);
  const f = $('#f-acceso');
  f.querySelector('input').focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(f));
    const btn = f.querySelector('button.primario'); btn.disabled = true;
    const err = $('#err', f); err.hidden = true;
    try {
      if (modo === 'olvide') {
        await POST('/api/auth/olvide', datos);
        f.innerHTML = h`<h2 style="margin-bottom:8px">Pedido enviado</h2><p style="color:var(--gris)">Si el correo está registrado, el administrador verá tu pedido y te va a pasar una contraseña temporal.</p>`.s;
        return;
      }
      const url = { login: '/api/auth/login', registro: '/api/auth/registro', primera: '/api/auth/registro', cambiar: '/api/auth/password' }[modo];
      const r = await POST(url, datos);
      S.usuario = r.usuario;
      S.publica.primer_uso = false;
      if (S.usuario.debe_cambiar_password) return mostrarAcceso('cambiar');
      await iniciarApp();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false; btn.disabled = false;
    }
  });
}

async function cerrarSesion() {
  await POST('/api/auth/logout').catch(() => {});
  S.usuario = null; S.catalogo = null;
  location.hash = '';
  mostrarAcceso('login');
}

// ======================= estructura =======================
const RUTAS = [
  { id: 'inicio', nombre: 'Inicio', ico: '🏠' },
  { id: 'movimientos', nombre: 'Movimientos', ico: '💸' },
  { id: 'cuentas', nombre: 'Cuentas y tarjetas', corto: 'Cuentas', ico: '🏦' },
  { id: 'estadisticas', nombre: 'Estadísticas', ico: '📊' },
  { id: 'presupuestos', nombre: 'Presupuestos y ahorro', corto: 'Presupuestos', ico: '🎯' },
  { id: 'calendario', nombre: 'Vencimientos', ico: '📅' },
  { id: 'configuracion', nombre: 'Configuración', ico: '⚙️' },
  { id: 'admin', nombre: 'Administración', ico: '👥', admin: true },
];
const rutaActual = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'inicio');

function marco(contenido) {
  const actual = rutaActual();
  const rutas = RUTAS.filter((r) => !r.admin || S.usuario.rol === 'admin');
  const nav = (r) => h`<a class="nav-item" href="#/${r.id}" ${actual === r.id ? raw('aria-current="page"') : ''}><span class="ico" aria-hidden="true">${r.ico}</span>${r.nombre}</a>`;
  const tab = (r) => h`<a href="#/${r.id}" ${actual === r.id ? raw('aria-current="page"') : ''}><span class="ico" aria-hidden="true">${r.ico}</span>${r.corto || r.nombre}</a>`;
  const enMas = !['inicio', 'movimientos', 'presupuestos'].includes(actual);
  return h`<div class="app">
    <nav class="lateral" aria-label="Secciones">
      <div class="marca">${LOGO(34)}EnQuéGasté</div>
      <button class="btn moneda boton-agregar-lateral" data-agregar="gasto">+ Agregar gasto</button>
      ${rutas.filter((r) => !r.admin && r.id !== 'configuracion').map(nav)}
      <div class="nav-sep"></div>
      ${rutas.filter((r) => r.admin || r.id === 'configuracion').map(nav)}
      <div class="pie">${S.usuario.nombre}<br><button class="btn chico" id="salir" style="margin-top:8px">Salir</button></div>
    </nav>
    <main class="principal" id="vista">${contenido}</main>
    <nav class="barra-inferior" aria-label="Secciones">
      ${tab(RUTAS[0])}${tab(RUTAS[1])}
      <button class="moneda-btn" data-agregar="gasto" aria-label="Agregar gasto">+</button>
      ${tab(RUTAS[4])}
      <button class="tab" id="tab-mas" ${enMas ? raw('aria-current="page"') : ''}><span class="ico" aria-hidden="true">☰</span>Más</button>
    </nav>
  </div>`;
}

function cabecera(titulo, extra = '') {
  return h`<header class="cabecera"><h1>${titulo}</h1>${extra}</header>`;
}
function selectorMes() {
  return h`<div class="selector-mes"><button type="button" data-mes="-1" aria-label="Mes anterior">‹</button><span>${nombreMes(S.mes)}</span><button type="button" data-mes="1" aria-label="Mes siguiente">›</button></div>`;
}

const VISTAS = {};
async function navegar() {
  if (!S.usuario) return;
  let ruta = rutaActual();
  if (!VISTAS[ruta] || (ruta === 'admin' && S.usuario.rol !== 'admin')) { ruta = 'inicio'; }
  const raiz = $('#raiz');
  if (!$('#vista')) {
    raiz.innerHTML = marco(raw('<p class="cargando">Cargando…</p>')).s;
  } else {
    raiz.innerHTML = marco(raw($('#vista').innerHTML)).s; // actualiza la navegación sin parpadeo
  }
  enlazarMarco();
  const vista = $('#vista');
  try {
    await VISTAS[ruta](vista);
  } catch (e) {
    if (S.usuario) vista.innerHTML = h`<div class="panel vacio"><p>${e.message}</p><button class="btn" id="reintentar">Reintentar</button></div>`.s;
    const b = $('#reintentar'); if (b) b.addEventListener('click', navegar);
  }
  enlazarComunes(vista);
}
function recargar() { navegar(); }

function enlazarMarco() {
  $$('[data-agregar]').forEach((b) => b.addEventListener('click', () => formMovimiento(null, b.dataset.agregar)));
  const s = $('#salir'); if (s) s.addEventListener('click', cerrarSesion);
  const mas = $('#tab-mas');
  if (mas) mas.addEventListener('click', () => {
    const rutas = RUTAS.filter((r) => !r.admin || S.usuario.rol === 'admin');
    abrirModal('Más secciones', h`<div class="menu-mas">
      ${rutas.map((r) => h`<a class="nav-item" href="#/${r.id}" data-cerrar><span class="ico" aria-hidden="true">${r.ico}</span>${r.nombre}</a>`)}
      <div class="nav-sep"></div>
      <button class="nav-item" style="border:0;background:none;cursor:pointer" id="salir2"><span class="ico">🚪</span>Salir (${S.usuario.nombre})</button>
    </div>`, (m) => {
      $$('[data-cerrar]', m).forEach((a) => a.addEventListener('click', cerrarModal));
      $('#salir2', m).addEventListener('click', cerrarSesion);
    });
  });
}
function enlazarComunes(el) {
  $$('[data-mes]', el).forEach((b) => b.addEventListener('click', () => { S.mes = moverMes(S.mes, Number(b.dataset.mes)); recargar(); }));
  $$('[data-mov]', el).forEach((b) => b.addEventListener('click', () => abrirMovimiento(Number(b.dataset.mov))));
  $$('[data-moneda-sel]', el).forEach((s) => s.addEventListener('change', () => { S.moneda = s.value; recargar(); }));
}

// ======================= modales =======================
let alCerrar = null;
function abrirModal(titulo, cuerpo, onMount, cerrable = true) {
  const cont = $('#modales');
  cont.innerHTML = h`<div class="fondo-modal" id="fondo-modal"><div class="hoja-modal" role="dialog" aria-modal="true" aria-labelledby="titulo-modal">
    <div class="tirador"></div>
    <div class="cab-modal"><h2 id="titulo-modal">${titulo}</h2>${cerrable ? h`<button class="btn-icono" id="cerrar-modal" aria-label="Cerrar">✕</button>` : ''}</div>
    ${cuerpo}
  </div></div>`.s;
  const fondo = $('#fondo-modal');
  const previo = document.activeElement;
  alCerrar = () => { if (previo && previo.focus) previo.focus(); };
  if (cerrable) {
    $('#cerrar-modal').addEventListener('click', cerrarModal);
    fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrarModal(); });
  }
  if (onMount) onMount(fondo);
  const primero = fondo.querySelector('[autofocus]') || fondo.querySelector('input, select, button:not(#cerrar-modal)');
  if (primero) setTimeout(() => primero.focus(), 30);
}
function cerrarModal() {
  $('#modales').innerHTML = '';
  if (alCerrar) { const f = alCerrar; alCerrar = null; f(); }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#fondo-modal')) cerrarModal(); });

function confirmar(titulo, texto, accion = 'Eliminar') {
  return new Promise((resolve) => {
    abrirModal(titulo, h`<p style="margin-bottom:18px">${texto}</p>
      <div class="fila"><button class="btn" id="no">Cancelar</button><button class="btn primario" id="si">${accion}</button></div>`, (m) => {
      $('#no', m).addEventListener('click', () => { cerrarModal(); resolve(false); });
      $('#si', m).addEventListener('click', () => { cerrarModal(); resolve(true); });
    });
  });
}

// Formulario genérico: envía y muestra errores dentro del modal
function enviarForm(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit], button.primario');
    let err = form.querySelector('.error-form');
    if (!err) { err = document.createElement('p'); err.className = 'error-form'; btn.before(err); }
    err.hidden = true;
    if (btn) btn.disabled = true;
    try { await fn(Object.fromEntries(new FormData(form))); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { if (btn) btn.disabled = false; }
  });
}

// ======================= carga rápida de movimientos =======================
function chipsCategorias(tipo, sel) {
  const lista = categoriasDe(tipo);
  const padres = lista.filter((c) => !c.padre_id || !lista.some((p) => p.id === c.padre_id));
  const hijas = (p) => lista.filter((c) => c.padre_id === p.id);
  const chip = (c, sub) => h`<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${c.id === sel}">
    <span class="e" aria-hidden="true">${c.icono}</span>${sub ? h`<span style="opacity:.7;font-size:.7rem">${sub}</span>` : ''}${c.nombre}</button>`;
  return padres.flatMap((p) => [chip(p), ...hijas(p).map((s) => chip(s, p.nombre))]);
}

function formMovimiento(mov, tipoInicial = 'gasto') {
  if (!S.catalogo) return;
  const st = {
    tipo: mov ? mov.tipo : tipoInicial,
    categoria_id: mov ? mov.categoria_id : null,
    medio_pago_id: mov ? mov.medio_pago_id : null,
  };
  const cuentas = cuentasActivas();
  const cuentaDef = mov ? mov.cuenta_id : (cuentas.find((c) => c.tipo === 'efectivo') || cuentas[0] || {}).id;
  const opcionesCuenta = (sel, vacio) => h`${vacio ? h`<option value="">${vacio}</option>` : ''}${S.catalogo.cuentas.filter((c) => !c.archivada || c.id === sel).map((c) => h`<option value="${c.id}" ${c.id === sel ? raw('selected') : ''}>${c.nombre} (${c.moneda})</option>`)}`;
  const monedaCuenta = (id) => { const c = S.catalogo.cuentas.find((x) => x.id === Number(id)); return c ? c.moneda : S.usuario.moneda; };
  const titulo = mov ? 'Editar movimiento' : 'Nuevo movimiento';

  abrirModal(titulo, h`<form id="f-mov" novalidate>
    <div class="segmentos" role="group" aria-label="Tipo de movimiento">
      <button type="button" data-t="gasto">Gasto</button><button type="button" data-t="ingreso">Ingreso</button><button type="button" data-t="transferencia">Transferencia</button>
    </div>
    <label class="importe-grande" id="caja-importe"><span class="simbolo" id="simb">$</span>
      <span class="oculto-visual">Importe</span>
      <input name="importe" inputmode="decimal" autocomplete="off" placeholder="0" value="${mov ? String(mov.importe).replace('.', ',') : ''}" autofocus>
    </label>
    <div id="bloque-cat"><div class="chips" id="chips-cat"></div></div>
    <div id="bloque-medio"><div class="chips-linea" id="chips-medio" aria-label="Medio de pago">
      ${S.catalogo.medios.map((m) => h`<button type="button" class="chip" data-medio="${m.id}"><span class="e" aria-hidden="true">${m.icono}</span>${m.nombre}</button>`)}
    </div></div>
    <div class="fila">
      <label class="campo"><span id="lbl-cuenta">Cuenta</span><select name="cuenta_id" id="sel-cuenta">${opcionesCuenta(cuentaDef, 'Sin cuenta')}</select></label>
      <label class="campo" id="campo-destino"><span>Hacia</span><select name="cuenta_destino_id">${opcionesCuenta(mov ? mov.cuenta_destino_id : null, 'Elegí la cuenta')}</select></label>
    </div>
    <details class="mas-opciones" ${mov && (mov.nota || mov.fecha !== hoyISO()) ? raw('open') : ''}>
      <summary>Fecha y nota</summary>
      <div class="fila">
        <label class="campo"><span>Fecha</span><input type="date" name="fecha" value="${mov ? mov.fecha : hoyISO()}" required></label>
        <label class="campo"><span>Nota</span><input type="text" name="nota" maxlength="300" value="${mov ? mov.nota : ''}" placeholder="Opcional"></label>
      </div>
    </details>
    <p class="error-form" hidden></p>
    <div class="fila">
      ${mov ? h`<button type="button" class="btn peligro" id="borrar-mov">Eliminar</button>` : ''}
      <button type="submit" class="btn primario">${mov ? 'Guardar cambios' : 'Guardar'}</button>
    </div>
  </form>`, (m) => {
    const f = $('#f-mov', m);
    const pintar = () => {
      $$('.segmentos button', f).forEach((b) => b.setAttribute('aria-pressed', b.dataset.t === st.tipo));
      $('#caja-importe', f).className = 'importe-grande ' + st.tipo;
      const esT = st.tipo === 'transferencia';
      $('#bloque-cat', f).hidden = esT;
      $('#bloque-medio', f).hidden = st.tipo !== 'gasto';
      $('#campo-destino', f).hidden = !esT;
      $('#lbl-cuenta', f).textContent = esT ? 'Desde' : 'Cuenta';
      $('#chips-cat', f).innerHTML = esT ? '' : val(chipsCategorias(st.tipo, st.categoria_id));
      $$('[data-cat]', f).forEach((b) => b.addEventListener('click', () => {
        st.categoria_id = Number(b.dataset.cat);
        $$('[data-cat]', f).forEach((x) => x.setAttribute('aria-pressed', x === b));
      }));
      $$('[data-medio]', f).forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.medio) === st.medio_pago_id));
      $('#simb', f).textContent = simbolo(monedaCuenta($('#sel-cuenta', f).value));
    };
    $$('.segmentos button', f).forEach((b) => b.addEventListener('click', () => {
      if (st.tipo !== b.dataset.t) st.categoria_id = null;
      st.tipo = b.dataset.t; pintar();
    }));
    $$('[data-medio]', f).forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.medio);
      st.medio_pago_id = st.medio_pago_id === id ? null : id; pintar();
    }));
    $('#sel-cuenta', f).addEventListener('change', pintar);
    pintar();
    if (mov) $('#borrar-mov', f).addEventListener('click', async () => {
      if (!(await confirmar('Eliminar movimiento', 'Este movimiento se borra definitivamente.'))) return;
      try { await DEL('/api/movimientos/' + mov.id); aviso('Movimiento eliminado'); await cargarCatalogo(); recargar(); } catch (e) { aviso(e.message, true); }
    });
    enviarForm(f, async (d) => {
      const importe = parseImporte(d.importe);
      if (!importe || importe <= 0) throw new Error('Ingresá el importe.');
      if (st.tipo !== 'transferencia' && !st.categoria_id) throw new Error('Elegí una categoría.');
      const body = {
        tipo: st.tipo, importe, fecha: d.fecha || hoyISO(), nota: d.nota || '',
        categoria_id: st.tipo === 'transferencia' ? null : st.categoria_id,
        medio_pago_id: st.tipo === 'gasto' ? st.medio_pago_id : null,
        cuenta_id: d.cuenta_id || null, cuenta_destino_id: st.tipo === 'transferencia' ? d.cuenta_destino_id || null : null,
      };
      if (mov) await PUT('/api/movimientos/' + mov.id, body); else await POST('/api/movimientos', body);
      cerrarModal();
      aviso(mov ? 'Cambios guardados' : st.tipo === 'gasto' ? 'Gasto guardado' : st.tipo === 'ingreso' ? 'Ingreso guardado' : 'Transferencia guardada');
      await cargarCatalogo(); recargar();
    });
  });
}

let cacheMovs = new Map();
function abrirMovimiento(id) {
  const m = cacheMovs.get(id);
  if (m) formMovimiento(m);
}

function filaMovimiento(m) {
  cacheMovs.set(m.id, m);
  const esT = m.tipo === 'transferencia';
  const titulo = esT ? 'Transferencia' : (m.categoria || 'Sin categoría');
  const detalle = esT ? `${m.cuenta || '?'} → ${m.cuenta_destino || '?'}` : [...new Set([m.nota, m.cuenta, m.medio_pago].filter(Boolean))].join(' · ');
  const signo = m.tipo === 'gasto' ? '−' : m.tipo === 'ingreso' ? '+' : '';
  const color = esT ? 'var(--linea)' : (m.categoria_color || '#7a8b84');
  return h`<button class="mov" data-mov="${m.id}">
    <span class="avatar" style="background:${color}22" aria-hidden="true">${esT ? '🔁' : m.categoria_icono || '🏷️'}</span>
    <span class="det"><b>${titulo}</b><span>${detalle || fechaCorta(m.fecha)}</span></span>
    <span class="imp ${m.tipo}">${signo}${dinero(m.importe, m.moneda)}</span>
  </button>`;
}
function listaPorDia(items) {
  const grupos = [];
  for (const m of items) {
    const g = grupos[grupos.length - 1];
    if (g && g.fecha === m.fecha) g.items.push(m); else grupos.push({ fecha: m.fecha, items: [m] });
  }
  return h`<ul class="lista-mov">${grupos.map((g) => h`<li><div class="dia-cab">${fechaLarga(g.fecha)}</div>${g.items.map(filaMovimiento)}</li>`)}</ul>`;
}

// ======================= gráficos =======================
function barrasCategorias(lista, total) {
  if (!lista.length) return h`<p class="vacio">Todavía no hay gastos este mes.</p>`;
  const max = lista[0].total;
  return h`<div class="barras-cat">${lista.map((c) => h`<div class="barra-cat">
    <div class="cab"><span>${c.icono} ${c.nombre}</span><span>${dinero(c.total)}<span class="pct">${Math.round((c.total / total) * 100)}%</span></span></div>
    <div class="pista"><i style="width:${Math.max(2, (c.total / max) * 100)}%;background:${c.color}"></i></div>
  </div>`)}</div>`;
}
function graficoHistorico(datos) {
  const W = 560, H = 190, base = 160, top = 14;
  const max = Math.max(1, ...datos.flatMap((d) => [d.ingresos, d.gastos]));
  const paso = W / datos.length, ancho = Math.min(22, paso / 3.2);
  const y = (v) => base - ((base - top) * v) / max;
  const barras = datos.map((d, i) => {
    const x = i * paso + paso / 2;
    return `<rect x="${x - ancho - 2}" y="${y(d.ingresos)}" width="${ancho}" height="${base - y(d.ingresos)}" rx="4" fill="var(--ingreso)"><title>Ingresos ${esc(dinero(d.ingresos))}</title></rect>
      <rect x="${x + 2}" y="${y(d.gastos)}" width="${ancho}" height="${base - y(d.gastos)}" rx="4" fill="var(--gasto)"><title>Gastos ${esc(dinero(d.gastos))}</title></rect>
      <text x="${x}" y="${base + 20}" text-anchor="middle">${esc(nombreMes(d.mes, true))}</text>`;
  }).join('');
  return h`<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos y gastos de los últimos 6 meses">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="var(--linea)"/>${raw(barras)}</svg>
    <div class="leyenda"><span><i style="background:var(--ingreso)"></i>Ingresos</span><span><i style="background:var(--gasto)"></i>Gastos</span></div>`;
}
function barraPresupuesto(p) {
  const pct = p.gastado / p.limite;
  const exc = pct > 1;
  const resto = p.limite - p.gastado;
  return h`<div class="barra-cat ${exc ? 'excedido' : ''}">
    <div class="cab"><span>${p.icono} ${p.nombre}</span><span>${dinero(p.gastado)} <span class="pct">de ${dinero(p.limite)}</span></span></div>
    <div class="pista"><i style="width:${Math.min(100, pct * 100)}%;background:${pct > 0.85 ? 'var(--moneda)' : 'var(--ingreso)'}"></i></div>
    <div class="resto">${exc ? `Te pasaste por ${dinero(-resto)}` : `Te quedan ${dinero(resto)}`}</div>
  </div>`;
}

// ======================= vistas =======================
VISTAS.inicio = async (el) => {
  const q = new URLSearchParams({ mes: S.mes }); if (S.moneda) q.set('moneda', S.moneda);
  const r = await GET('/api/resumen?' + q);
  S.moneda = r.moneda;
  const total = r.ingresos + r.gastos;
  const pend = r.recurrentes.filter((x) => x.activo && !x.registrado_este_mes);
  const nombre = S.usuario.nombre.split(' ')[0];
  el.innerHTML = h`
    ${cabecera(`Hola, ${nombre}`, h`<div class="controles">
      ${r.monedas.length > 1 ? h`<select data-moneda-sel aria-label="Moneda">${r.monedas.map((m) => h`<option ${m === r.moneda ? raw('selected') : ''}>${m}</option>`)}</select>` : ''}
      ${selectorMes()}</div>`)}
    <section class="saldo-hero">
      <p class="rotulo">Saldo disponible en tus cuentas</p>
      <p class="cifra ${r.disponible < 0 ? 'neg' : ''}">${dinero(r.disponible)}</p>
      <div class="mes-flujo">
        <div><span>Ingresos de ${nombreMes(r.mes, true)}</span><b>${dinero(r.ingresos)}</b></div>
        <div><span>Gastos de ${nombreMes(r.mes, true)}</span><b>${dinero(r.gastos)}</b></div>
      </div>
      <div class="flujo-barra" aria-hidden="true">${total ? h`<i style="width:${(r.ingresos / total) * 100}%;background:#5fd19b"></i><i style="width:${(r.gastos / total) * 100}%;background:#ff8a94"></i>` : ''}</div>
      <p class="nota-hero">${total === 0 ? 'Cargá tu primer movimiento para ver el resumen del mes.'
        : r.balance_mes >= 0 ? `Este mes te sobran ${dinero(r.balance_mes)}.` : `Este mes gastaste ${dinero(-r.balance_mes)} más de lo que ingresó.`}</p>
    </section>
    <div class="atajos">
      <button class="btn moneda" data-agregar="gasto">+ Agregar gasto</button>
      <button class="btn" data-agregar="ingreso">+ Agregar ingreso</button>
      <a class="btn" href="#/movimientos">Ver movimientos</a>
      <a class="btn" href="#/estadisticas">Ver estadísticas</a>
    </div>
    <div class="rejilla dos">
      <section class="panel"><div class="panel-cab"><h2>Gastos por categoría</h2></div>${barrasCategorias(r.por_categoria, r.gastos)}</section>
      <section class="panel">
        <div class="panel-cab"><h2>Últimos movimientos</h2><a href="#/movimientos">Ver todos</a></div>
        ${r.ultimos.length ? listaPorDia(r.ultimos) : h`<div class="vacio"><p>Acá vas a ver lo último que cargaste.</p><button class="btn moneda" data-agregar="gasto">+ Agregar gasto</button></div>`}
      </section>
      <section class="panel">
        <div class="panel-cab"><h2>Presupuestos del mes</h2><a href="#/presupuestos">Administrar</a></div>
        ${r.presupuestos.length ? h`<div class="barras-cat">${r.presupuestos.map(barraPresupuesto)}</div>` : h`<p class="vacio">Poné un límite por categoría y seguí cuánto te queda.</p>`}
      </section>
      <section class="panel">
        <div class="panel-cab"><h2>Ahorro y vencimientos</h2><a href="#/calendario">Ver vencimientos</a></div>
        <div class="mini-datos" style="margin-bottom:14px">
          <div><span>Ahorro acumulado</span><b>${dinero(r.ahorro)}</b></div>
          <div><span>Deuda en tarjetas</span><b>${dinero(Math.abs(r.deuda_tarjetas))}</b></div>
        </div>
        ${pend.length ? h`<ul class="lista-mov">${pend.slice(0, 4).map((x) => h`<li><div class="mov" style="cursor:default">
          <span class="avatar" style="background:${x.color || '#7a8b84'}22">${x.icono || '📅'}</span>
          <span class="det"><b>${x.nombre}</b><span>${x.vencido ? 'Vencido el ' : 'Vence el '}${fechaCorta(x.vence)}</span></span>
          <span class="imp ${x.tipo}">${dinero(x.importe)}</span></div></li>`)}</ul>`
        : h`<p class="vacio" style="padding:10px">No tenés pagos pendientes este mes.</p>`}
      </section>
    </div>`.s;
  $$('[data-agregar]', el).forEach((b) => b.addEventListener('click', () => formMovimiento(null, b.dataset.agregar)));
};

// ---------- movimientos ----------
const filtrosMov = { q: '', tipo: '', categoria: '', cuenta: '' };
VISTAS.movimientos = async (el) => {
  const { mes } = S;
  const [y, m] = mes.split('-').map(Number);
  const desde = `${mes}-01`, hasta = `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const params = new URLSearchParams({ desde, hasta, limit: 300 });
  for (const [k, v] of Object.entries(filtrosMov)) if (v) params.set(k, v);
  const r = await GET('/api/movimientos?' + params);
  const sel = (v, x) => (String(v) === String(x) ? raw('selected') : '');
  el.innerHTML = h`
    ${cabecera('Movimientos', selectorMes())}
    <section class="panel">
      <form class="filtros" id="f-filtros" role="search">
        <input type="search" name="q" placeholder="Buscar por nota o categoría" value="${filtrosMov.q}" class="ancho" aria-label="Buscar">
        <select name="tipo" aria-label="Tipo"><option value="">Todos los tipos</option>
          <option value="gasto" ${sel(filtrosMov.tipo, 'gasto')}>Gastos</option><option value="ingreso" ${sel(filtrosMov.tipo, 'ingreso')}>Ingresos</option><option value="transferencia" ${sel(filtrosMov.tipo, 'transferencia')}>Transferencias</option></select>
        <select name="categoria" aria-label="Categoría"><option value="">Todas las categorías</option>
          ${S.catalogo.categorias.map((c) => h`<option value="${c.id}" ${sel(filtrosMov.categoria, c.id)}>${c.icono} ${c.nombre}</option>`)}</select>
        <select name="cuenta" aria-label="Cuenta"><option value="">Todas las cuentas</option>
          ${S.catalogo.cuentas.map((c) => h`<option value="${c.id}" ${sel(filtrosMov.cuenta, c.id)}>${c.nombre}</option>`)}</select>
      </form>
      <div class="totales-filtro">
        <span>${r.total} movimiento${r.total === 1 ? '' : 's'}</span>
        <span>Ingresos <b>${dinero(r.ingresos)}</b></span><span>Gastos <b>${dinero(r.gastos)}</b></span>
        <a href="/api/movimientos.csv?${params}" download style="margin-left:auto;font-weight:700">Descargar CSV</a>
      </div>
      ${r.items.length ? listaPorDia(r.items) : h`<div class="vacio"><p>${Object.values(filtrosMov).some(Boolean) ? 'No hay movimientos que coincidan con la búsqueda.' : `No hay movimientos en ${nombreMes(mes)}.`}</p><button class="btn moneda" data-agregar="gasto">+ Agregar gasto</button></div>`}
    </section>`.s;
  const f = $('#f-filtros', el);
  let t;
  const aplicar = () => { Object.assign(filtrosMov, Object.fromEntries(new FormData(f))); recargar(); };
  f.addEventListener('change', aplicar);
  f.addEventListener('submit', (e) => { e.preventDefault(); aplicar(); });
  $('[name=q]', f).addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { aplicar(); setTimeout(() => { const i = $('[name=q]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 80); }, 450); });
  $$('[data-agregar]', el).forEach((b) => b.addEventListener('click', () => formMovimiento(null, b.dataset.agregar)));
};

// ---------- cuentas ----------
const TIPOS_CUENTA = { efectivo: '💵 Efectivo', banco: '🏦 Cuenta bancaria', billetera: '📱 Billetera virtual', tarjeta: '💳 Tarjeta de crédito', inversion: '📈 Inversión' };
VISTAS.cuentas = async (el) => {
  await cargarCatalogo();
  const cuentas = S.catalogo.cuentas;
  const tarjeta = (c) => h`<button class="cuenta ${c.tipo === 'tarjeta' ? 'tarjeta' : ''} ${c.archivada ? 'archivada' : ''}" data-cuenta="${c.id}">
    <span class="tipo">${TIPOS_CUENTA[c.tipo]}${c.archivada ? ' · archivada' : ''}</span>
    <b>${c.nombre}</b>
    <span class="saldo">${dinero(c.saldo, c.moneda)}</span>
    ${c.tipo === 'tarjeta' && (c.dia_cierre || c.dia_vencimiento) ? h`<span class="tipo">${c.dia_cierre ? `Cierra el ${c.dia_cierre}` : ''}${c.dia_cierre && c.dia_vencimiento ? ' · ' : ''}${c.dia_vencimiento ? `Vence el ${c.dia_vencimiento}` : ''}</span>` : ''}
  </button>`;
  const normales = cuentas.filter((c) => c.tipo !== 'tarjeta');
  const tarjetas = cuentas.filter((c) => c.tipo === 'tarjeta');
  el.innerHTML = h`
    ${cabecera('Cuentas y tarjetas', h`<button class="btn primario" id="nueva-cuenta">+ Nueva cuenta</button>`)}
    <h2 style="margin:4px 0 12px">Cuentas</h2>
    <div class="tarjetas">${normales.length ? normales.map(tarjeta) : h`<p class="vacio">Sin cuentas todavía.</p>`}</div>
    <h2 style="margin:26px 0 6px">Tarjetas de crédito</h2>
    <p style="color:var(--gris);margin-bottom:12px;font-size:.9rem">Los gastos con tarjeta suman deuda. Para pagar el resumen, registrá una transferencia desde tu cuenta bancaria hacia la tarjeta.</p>
    <div class="tarjetas">${tarjetas.length ? tarjetas.map(tarjeta) : h`<p class="vacio">No cargaste tarjetas.</p>`}</div>`.s;
  $('#nueva-cuenta', el).addEventListener('click', () => formCuenta());
  $$('[data-cuenta]', el).forEach((b) => b.addEventListener('click', () => formCuenta(cuentas.find((c) => c.id === Number(b.dataset.cuenta)))));
};
function formCuenta(c) {
  const sel = (a, b) => (a === b ? raw('selected') : '');
  abrirModal(c ? 'Editar cuenta' : 'Nueva cuenta', h`<form id="f-cuenta" novalidate>
    <label class="campo"><span>Nombre</span><input type="text" name="nombre" maxlength="40" required value="${c ? c.nombre : ''}" placeholder="Ej.: Banco Nación, Mercado Pago"></label>
    <div class="fila">
      <label class="campo"><span>Tipo</span><select name="tipo" id="tipo-cuenta">${Object.entries(TIPOS_CUENTA).map(([k, v]) => h`<option value="${k}" ${sel(c && c.tipo, k)}>${v}</option>`)}</select></label>
      <label class="campo"><span>Moneda</span><select name="moneda">${S.catalogo.monedas.map((m) => h`<option value="${m.codigo}" ${sel(c ? c.moneda : S.usuario.moneda, m.codigo)}>${m.codigo}</option>`)}</select></label>
    </div>
    <label class="campo"><span>Saldo inicial</span><input type="text" inputmode="decimal" name="saldo_inicial" value="${c ? String(c.saldo_inicial).replace('.', ',') : '0'}"><small>Lo que tenía la cuenta antes de empezar a registrar. En tarjetas, la deuda va en negativo.</small></label>
    <div class="fila" id="dias-tarjeta">
      <label class="campo"><span>Día de cierre</span><input type="number" min="1" max="31" name="dia_cierre" value="${c && c.dia_cierre ? c.dia_cierre : ''}"></label>
      <label class="campo"><span>Día de vencimiento</span><input type="number" min="1" max="31" name="dia_vencimiento" value="${c && c.dia_vencimiento ? c.dia_vencimiento : ''}"></label>
    </div>
    ${c ? h`<label class="check"><input type="checkbox" name="archivada" ${c.archivada ? raw('checked') : ''}> Archivada (no aparece al cargar movimientos)</label>` : ''}
    <div class="fila">${c ? h`<button type="button" class="btn peligro" id="borrar">Eliminar</button>` : ''}<button type="submit" class="btn primario">Guardar</button></div>
  </form>`, (m) => {
    const f = $('#f-cuenta', m);
    const ver = () => { $('#dias-tarjeta', f).hidden = $('#tipo-cuenta', f).value !== 'tarjeta'; };
    $('#tipo-cuenta', f).addEventListener('change', ver); ver();
    if (c) $('#borrar', f).addEventListener('click', async () => {
      if (!(await confirmar('Eliminar cuenta', `¿Eliminar "${c.nombre}"? Solo se puede si no tiene movimientos.`))) return;
      try { await DEL('/api/cuentas/' + c.id); aviso('Cuenta eliminada'); recargar(); } catch (e) { aviso(e.message, true); }
    });
    enviarForm(f, async (d) => {
      const body = { ...d, saldo_inicial: d.saldo_inicial ? (d.saldo_inicial.trim().startsWith('-') ? -parseImporte(d.saldo_inicial.replace('-', '')) : parseImporte(d.saldo_inicial)) : 0, archivada: !!d.archivada };
      if (Number.isNaN(body.saldo_inicial)) throw new Error('Revisá el saldo inicial.');
      if (c) await PUT('/api/cuentas/' + c.id, body); else await POST('/api/cuentas', body);
      cerrarModal(); aviso('Cuenta guardada'); recargar();
    });
  });
}

// ---------- estadísticas ----------
VISTAS.estadisticas = async (el) => {
  const q = new URLSearchParams({ mes: S.mes }); if (S.moneda) q.set('moneda', S.moneda);
  const r = await GET('/api/resumen?' + q);
  const meses = r.historico.filter((x) => x.ingresos || x.gastos);
  const prom = meses.length ? meses.reduce((s, x) => s + x.gastos, 0) / meses.length : 0;
  const [y, m] = r.mes.split('-').map(Number);
  const dias = r.mes === mesISO() ? new Date().getDate() : new Date(y, m, 0).getDate();
  const tasa = r.ingresos ? Math.round(((r.ingresos - r.gastos) / r.ingresos) * 100) : null;
  el.innerHTML = h`
    ${cabecera('Estadísticas', selectorMes())}
    <div class="kpis">
      <div class="kpi"><b>${dinero(r.gastos)}</b><span>Gastos del mes</span></div>
      <div class="kpi"><b>${dinero(r.gastos / dias)}</b><span>Gasto promedio por día</span></div>
      <div class="kpi"><b>${dinero(prom)}</b><span>Promedio mensual (6 meses)</span></div>
      <div class="kpi"><b>${tasa === null ? '—' : tasa + '%'}</b><span>De tus ingresos que te quedó</span></div>
    </div>
    <div class="rejilla dos">
      <section class="panel"><div class="panel-cab"><h2>Últimos 6 meses</h2></div>${graficoHistorico(r.historico)}</section>
      <section class="panel"><div class="panel-cab"><h2>En qué se fue la plata</h2></div>${barrasCategorias(r.por_categoria, r.gastos)}</section>
    </div>`.s;
};

// ---------- presupuestos y objetivos ----------
VISTAS.presupuestos = async (el) => {
  const [pres, objs] = await Promise.all([GET('/api/presupuestos?mes=' + S.mes), GET('/api/objetivos')]);
  const anillo = (o) => {
    const p = Math.min(1, o.ahorrado / o.meta), R = 26, C = 2 * Math.PI * R;
    return raw(`<svg width="68" height="68" viewBox="0 0 68 68" aria-hidden="true"><circle cx="34" cy="34" r="${R}" fill="none" stroke="var(--linea)" stroke-width="8"/>
      <circle cx="34" cy="34" r="${R}" fill="none" stroke="var(--moneda)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C * p} ${C}" transform="rotate(-90 34 34)"/>
      <text x="34" y="39" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">${Math.round(p * 100)}%</text></svg>`);
  };
  el.innerHTML = h`
    ${cabecera('Presupuestos y ahorro', selectorMes())}
    <div class="rejilla dos">
      <section class="panel">
        <div class="panel-cab"><h2>Límites por categoría</h2><button class="btn chico" id="nuevo-pres">+ Agregar</button></div>
        ${pres.length ? h`<div class="barras-cat">${pres.map((p) => h`<div data-pres="${p.id}" style="cursor:pointer">${barraPresupuesto(p)}</div>`)}</div>`
          : h`<p class="vacio">Definí cuánto querés gastar como máximo por mes en cada categoría.</p>`}
      </section>
      <section class="panel">
        <div class="panel-cab"><h2>Objetivos de ahorro</h2><button class="btn chico" id="nuevo-obj">+ Agregar</button></div>
        ${objs.length ? objs.map((o) => h`<div class="objetivo" style="padding:10px 0;border-bottom:1px solid var(--linea)">
          <div class="anillo">${anillo(o)}<div style="flex:1;min-width:0">
            <b>${o.icono} ${o.nombre}</b>
            <p style="font-size:.9rem;color:var(--gris)">${dinero(o.ahorrado)} de ${dinero(o.meta)}${o.fecha_limite ? ` · para el ${fechaCorta(o.fecha_limite)}` : ''}</p>
            <div class="fila compacta" style="margin-top:8px;gap:6px"><button class="btn chico moneda" data-aporte="${o.id}">+ Sumar</button><button class="btn chico" data-retiro="${o.id}">Retirar</button><button class="btn chico" data-obj="${o.id}">Editar</button></div>
          </div></div></div>`)
          : h`<p class="vacio">Creá una meta (vacaciones, fondo de emergencia, un auto) y registrá lo que vas guardando.</p>`}
      </section>
    </div>`.s;
  $('#nuevo-pres', el).addEventListener('click', () => formPresupuesto());
  $$('[data-pres]', el).forEach((b) => b.addEventListener('click', () => formPresupuesto(pres.find((p) => p.id === Number(b.dataset.pres)))));
  $('#nuevo-obj', el).addEventListener('click', () => formObjetivo());
  $$('[data-obj]', el).forEach((b) => b.addEventListener('click', () => formObjetivo(objs.find((o) => o.id === Number(b.dataset.obj)))));
  $$('[data-aporte],[data-retiro]', el).forEach((b) => b.addEventListener('click', () => {
    const retiro = 'retiro' in b.dataset;
    const o = objs.find((x) => x.id === Number(b.dataset.aporte || b.dataset.retiro));
    abrirModal(retiro ? `Retirar de ${o.nombre}` : `Sumar a ${o.nombre}`, h`<form id="f-ap" novalidate>
      <label class="importe-grande ${retiro ? 'gasto' : 'ingreso'}"><span class="simbolo">$</span><input name="importe" inputmode="decimal" placeholder="0" autofocus aria-label="Importe"></label>
      <button type="submit" class="btn primario bloque">${retiro ? 'Retirar' : 'Sumar al ahorro'}</button></form>`, (m) => {
      enviarForm($('#f-ap', m), async (d) => {
        const imp = parseImporte(d.importe);
        if (!imp || imp <= 0) throw new Error('Ingresá el importe.');
        await POST(`/api/objetivos/${o.id}/aporte`, { importe: retiro ? -imp : imp });
        cerrarModal(); aviso(retiro ? 'Retiro registrado' : 'Ahorro sumado'); recargar();
      });
    });
  }));
};
function formPresupuesto(p) {
  const cats = categoriasDe('gasto').filter((c) => !c.padre_id);
  abrirModal(p ? 'Editar presupuesto' : 'Nuevo presupuesto', h`<form id="f-pres" novalidate>
    <label class="campo"><span>Categoría</span><select name="categoria_id" ${p ? raw('disabled') : ''}>${cats.map((c) => h`<option value="${c.id}" ${p && p.categoria_id === c.id ? raw('selected') : ''}>${c.icono} ${c.nombre}</option>`)}</select></label>
    <label class="campo"><span>Límite mensual</span><input type="text" inputmode="decimal" name="limite" required value="${p ? String(p.limite).replace('.', ',') : ''}"></label>
    <div class="fila">${p ? h`<button type="button" class="btn peligro" id="borrar">Quitar</button>` : ''}<button type="submit" class="btn primario">Guardar</button></div>
  </form>`, (m) => {
    const f = $('#f-pres', m);
    if (p) $('#borrar', f).addEventListener('click', async () => { await DEL('/api/presupuestos/' + p.id); cerrarModal(); aviso('Presupuesto quitado'); recargar(); });
    enviarForm(f, async (d) => {
      await PUT('/api/presupuestos', { categoria_id: p ? p.categoria_id : Number(d.categoria_id), limite: parseImporte(d.limite) });
      cerrarModal(); aviso('Presupuesto guardado'); recargar();
    });
  });
}
function formObjetivo(o) {
  abrirModal(o ? 'Editar objetivo' : 'Nuevo objetivo', h`<form id="f-obj" novalidate>
    <div class="fila"><label class="campo" style="flex:0 0 80px"><span>Ícono</span><input type="text" name="icono" maxlength="4" value="${o ? o.icono : '🎯'}"></label>
    <label class="campo"><span>Nombre</span><input type="text" name="nombre" maxlength="60" required value="${o ? o.nombre : ''}" placeholder="Ej.: Vacaciones"></label></div>
    <div class="fila"><label class="campo"><span>Meta</span><input type="text" inputmode="decimal" name="meta" required value="${o ? String(o.meta).replace('.', ',') : ''}"></label>
    <label class="campo"><span>Fecha objetivo</span><input type="date" name="fecha_limite" value="${o && o.fecha_limite ? o.fecha_limite : ''}"></label></div>
    <div class="fila">${o ? h`<button type="button" class="btn peligro" id="borrar">Eliminar</button>` : ''}<button type="submit" class="btn primario">Guardar</button></div>
  </form>`, (m) => {
    const f = $('#f-obj', m);
    if (o) $('#borrar', f).addEventListener('click', async () => {
      if (!(await confirmar('Eliminar objetivo', `¿Eliminar "${o.nombre}"?`))) return;
      await DEL('/api/objetivos/' + o.id); aviso('Objetivo eliminado'); recargar();
    });
    enviarForm(f, async (d) => {
      const body = { ...d, meta: parseImporte(d.meta), fecha_limite: d.fecha_limite || null };
      if (o) await PUT('/api/objetivos/' + o.id, body); else await POST('/api/objetivos', body);
      cerrarModal(); aviso('Objetivo guardado'); recargar();
    });
  });
}

// ---------- vencimientos / recurrentes ----------
VISTAS.calendario = async (el) => {
  const lista = await GET('/api/recurrentes');
  const estado = (x) => (!x.activo ? h`<span class="etiqueta off">Pausado</span>` : x.registrado_este_mes ? h`<span class="etiqueta">Registrado</span>` : x.vencido ? h`<span class="etiqueta alerta">Vencido</span>` : h`<span class="etiqueta">Pendiente</span>`);
  el.innerHTML = h`
    ${cabecera('Vencimientos', h`<button class="btn primario" id="nuevo-rec">+ Nuevo</button>`)}
    <p style="color:var(--gris);margin-bottom:14px;max-width:62ch">Cargá tus pagos y cobros fijos (alquiler, internet, sueldo). Cada mes aparecen acá y en el inicio; con un toque quedan registrados como movimiento.</p>
    <section class="panel">
      ${lista.length ? h`<ul class="lista-mov">${lista.map((x) => h`<li><div class="mov" style="grid-template-columns:40px 1fr auto;cursor:default">
        <span class="avatar" style="background:${x.color || '#7a8b84'}22">${x.icono || '📅'}</span>
        <span class="det"><b>${x.nombre}</b><span>Día ${x.dia} de cada mes · ${dinero(x.importe)}</span><span style="margin-top:4px">${estado(x)}</span></span>
        <span style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          ${x.activo && !x.registrado_este_mes ? h`<button class="btn chico moneda" data-registrar="${x.id}">${x.tipo === 'gasto' ? 'Pagado' : 'Cobrado'}</button>` : ''}
          <button class="btn-icono" data-rec="${x.id}" aria-label="Editar ${x.nombre}">✎</button>
        </span></div></li>`)}</ul>`
        : h`<div class="vacio"><p>Sin vencimientos cargados.</p></div>`}
    </section>`.s;
  $('#nuevo-rec', el).addEventListener('click', () => formRecurrente());
  $$('[data-rec]', el).forEach((b) => b.addEventListener('click', () => formRecurrente(lista.find((x) => x.id === Number(b.dataset.rec)))));
  $$('[data-registrar]', el).forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await POST(`/api/recurrentes/${b.dataset.registrar}/registrar`, {}); aviso('Movimiento registrado'); await cargarCatalogo(); recargar(); }
    catch (e) { aviso(e.message, true); b.disabled = false; }
  }));
};
function formRecurrente(x) {
  const st = { tipo: x ? x.tipo : 'gasto' };
  const opts = () => categoriasDe(st.tipo).map((c) => h`<option value="${c.id}" ${x && x.categoria_id === c.id ? raw('selected') : ''}>${c.icono} ${c.nombre}</option>`);
  abrirModal(x ? 'Editar vencimiento' : 'Nuevo vencimiento', h`<form id="f-rec" novalidate>
    <div class="segmentos" style="margin-bottom:14px"><button type="button" data-t="gasto">Pago</button><button type="button" data-t="ingreso">Cobro</button></div>
    <label class="campo"><span>Nombre</span><input type="text" name="nombre" maxlength="60" required value="${x ? x.nombre : ''}" placeholder="Ej.: Alquiler"></label>
    <div class="fila"><label class="campo"><span>Importe</span><input type="text" inputmode="decimal" name="importe" required value="${x ? String(x.importe).replace('.', ',') : ''}"></label>
    <label class="campo"><span>Día del mes</span><input type="number" min="1" max="31" name="dia" required value="${x ? x.dia : ''}"></label></div>
    <div class="fila"><label class="campo"><span>Categoría</span><select name="categoria_id" id="rec-cat">${opts()}</select></label>
    <label class="campo"><span>Cuenta</span><select name="cuenta_id"><option value="">Sin cuenta</option>${cuentasActivas().map((c) => h`<option value="${c.id}" ${x && x.cuenta_id === c.id ? raw('selected') : ''}>${c.nombre}</option>`)}</select></label></div>
    ${x ? h`<label class="check"><input type="checkbox" name="activo" ${x.activo ? raw('checked') : ''}> Activo</label>` : ''}
    <div class="fila">${x ? h`<button type="button" class="btn peligro" id="borrar">Eliminar</button>` : ''}<button type="submit" class="btn primario">Guardar</button></div>
  </form>`, (m) => {
    const f = $('#f-rec', m);
    const pintar = () => { $$('.segmentos button', f).forEach((b) => b.setAttribute('aria-pressed', b.dataset.t === st.tipo)); $('#rec-cat', f).innerHTML = val(opts()); };
    $$('.segmentos button', f).forEach((b) => b.addEventListener('click', () => { st.tipo = b.dataset.t; pintar(); }));
    pintar();
    if (x) $('#borrar', f).addEventListener('click', async () => {
      if (!(await confirmar('Eliminar vencimiento', `¿Eliminar "${x.nombre}"? Los movimientos ya registrados se conservan.`))) return;
      await DEL('/api/recurrentes/' + x.id); aviso('Vencimiento eliminado'); recargar();
    });
    enviarForm(f, async (d) => {
      const body = { ...d, tipo: st.tipo, importe: parseImporte(d.importe), activo: x ? !!d.activo : true };
      if (x) await PUT('/api/recurrentes/' + x.id, body); else await POST('/api/recurrentes', body);
      cerrarModal(); aviso('Vencimiento guardado'); recargar();
    });
  });
}

// ---------- configuración personal ----------
VISTAS.configuracion = async (el) => {
  await cargarCatalogo();
  const propias = S.catalogo.categorias.filter((c) => c.propia);
  el.innerHTML = h`
    ${cabecera('Configuración')}
    <div class="rejilla dos">
      <section class="panel"><div class="panel-cab"><h2>Tu perfil</h2></div>
        <form id="f-perfil" novalidate>
          <label class="campo"><span>Nombre</span><input type="text" name="nombre" maxlength="80" value="${S.usuario.nombre}" required></label>
          <label class="campo"><span>Correo</span><input type="email" value="${S.usuario.email}" disabled><small>Para cambiarlo, pedíselo al administrador.</small></label>
          <label class="campo"><span>Moneda principal</span><select name="moneda">${S.catalogo.monedas.map((m) => h`<option value="${m.codigo}" ${m.codigo === S.usuario.moneda ? raw('selected') : ''}>${m.codigo} — ${m.nombre}</option>`)}</select></label>
          <button type="submit" class="btn primario">Guardar perfil</button>
        </form>
      </section>
      <section class="panel"><div class="panel-cab"><h2>Contraseña</h2></div>
        <form id="f-pass" novalidate>
          <label class="campo"><span>Contraseña actual</span><input type="password" name="actual" autocomplete="current-password" required></label>
          <label class="campo"><span>Contraseña nueva</span><input type="password" name="nueva" autocomplete="new-password" required minlength="8"><small>Al cambiarla se cierran tus otras sesiones.</small></label>
          <button type="submit" class="btn primario">Cambiar contraseña</button>
        </form>
      </section>
      <section class="panel"><div class="panel-cab"><h2>Mis categorías</h2><button class="btn chico" id="nueva-cat">+ Agregar</button></div>
        <p style="color:var(--gris);font-size:.9rem;margin-bottom:10px">Además de las categorías generales, podés crear las tuyas. Solo las ves vos.</p>
        ${propias.length ? h`<ul class="lista-mov">${propias.map((c) => h`<li><button class="mov" data-cat-propia="${c.id}" style="grid-template-columns:40px 1fr auto">
          <span class="avatar" style="background:${c.color}22">${c.icono}</span><span class="det"><b>${c.nombre}</b><span>${c.tipo === 'gasto' ? 'Gasto' : 'Ingreso'}</span></span><span>✎</span></button></li>`)}</ul>`
          : h`<p class="vacio">No creaste categorías propias.</p>`}
      </section>
    </div>`.s;
  enviarForm($('#f-perfil', el), async (d) => { const r = await PUT('/api/perfil', d); S.usuario = r.usuario; S.moneda = null; aviso('Perfil guardado'); recargar(); });
  enviarForm($('#f-pass', el), async (d) => { const r = await POST('/api/auth/password', d); S.usuario = r.usuario; $('#f-pass').reset(); aviso('Contraseña cambiada'); });
  $('#nueva-cat', el).addEventListener('click', () => formCategoria('/api/categorias'));
  $$('[data-cat-propia]', el).forEach((b) => b.addEventListener('click', () => formCategoria('/api/categorias', propias.find((c) => c.id === Number(b.dataset.catPropia)))));
};

function formCategoria(baseUrl, c, padres = []) {
  const admin = baseUrl.includes('admin');
  abrirModal(c ? 'Editar categoría' : 'Nueva categoría', h`<form id="f-cat" novalidate>
    <div class="fila"><label class="campo" style="flex:0 0 80px"><span>Ícono</span><input type="text" name="icono" maxlength="4" value="${c ? c.icono : '🏷️'}"></label>
    <label class="campo"><span>Nombre</span><input type="text" name="nombre" maxlength="40" required value="${c ? c.nombre : ''}"></label>
    <label class="campo" style="flex:0 0 80px"><span>Color</span><input type="color" name="color" value="${c ? c.color : '#3f8f6b'}" style="width:100%;height:46px;border:1px solid var(--linea);border-radius:9px;padding:4px"></label></div>
    ${c ? '' : h`<div class="fila"><label class="campo"><span>Tipo</span><select name="tipo" id="cat-tipo"><option value="gasto">Gasto</option><option value="ingreso">Ingreso</option></select></label>
      ${admin ? h`<label class="campo"><span>Dentro de (opcional)</span><select name="padre_id" id="cat-padre"></select><small>Para crear una subcategoría.</small></label>` : ''}</div>`}
    ${admin && c ? h`<label class="check"><input type="checkbox" name="activa" ${c.activa ? raw('checked') : ''}> Activa (visible para todos)</label>` : ''}
    <div class="fila">${c ? h`<button type="button" class="btn peligro" id="borrar">Eliminar</button>` : ''}<button type="submit" class="btn primario">Guardar</button></div>
  </form>`, (m) => {
    const f = $('#f-cat', m);
    const padre = $('#cat-padre', f);
    if (padre) {
      const pintar = () => { padre.innerHTML = val(h`<option value="">— Categoría principal —</option>${padres.filter((p) => p.tipo === $('#cat-tipo', f).value && !p.padre_id).map((p) => h`<option value="${p.id}">${p.icono} ${p.nombre}</option>`)}`); };
      $('#cat-tipo', f).addEventListener('change', pintar); pintar();
    }
    if (c) $('#borrar', f).addEventListener('click', async () => {
      if (!(await confirmar('Eliminar categoría', `¿Eliminar "${c.nombre}"?`))) return;
      try { await DEL(`${baseUrl}/${c.id}`); aviso('Categoría eliminada'); await cargarCatalogo(); recargar(); } catch (e) { aviso(e.message, true); }
    });
    enviarForm(f, async (d) => {
      const body = { ...d, activa: admin && c ? !!d.activa : true };
      if (c) await PUT(`${baseUrl}/${c.id}`, body); else await POST(baseUrl, body);
      cerrarModal(); aviso('Categoría guardada'); await cargarCatalogo(); recargar();
    });
  });
}

// ---------- administración ----------
let pestanaAdmin = 'usuarios';
VISTAS.admin = async (el) => {
  const tabs = [['usuarios', 'Usuarios'], ['categorias', 'Categorías'], ['medios', 'Medios de pago'], ['monedas', 'Monedas'], ['ajustes', 'Ajustes'], ['auditoria', 'Registro de acciones']];
  const est = await GET('/api/admin/estadisticas');
  let cuerpo;
  if (pestanaAdmin === 'usuarios') {
    const us = await GET('/api/admin/usuarios');
    cuerpo = h`<div class="panel-cab"><h2>Usuarios</h2><button class="btn primario chico" id="nuevo-usuario">+ Crear usuario</button></div>
      <p style="color:var(--gris);font-size:.9rem;margin-bottom:10px">Por privacidad, desde acá no se ven los movimientos ni los saldos de cada persona.</p>
      <div class="tabla-scroll"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead><tbody>
      ${us.map((u) => h`<tr><td><b>${u.nombre}</b>${u.pidio_recuperacion ? h` <span class="etiqueta alerta">Pidió recuperar acceso</span>` : ''}</td><td>${u.email}</td>
        <td>${u.rol === 'admin' ? h`<span class="etiqueta admin">Admin</span>` : 'Usuario'}</td>
        <td>${u.activo ? (u.debe_cambiar_password ? 'Clave temporal' : 'Activo') : h`<span class="etiqueta off">Desactivado</span>`}</td>
        <td>${u.ultimo_acceso || 'Nunca'}</td>
        <td class="acciones"><button class="btn chico" data-editar-usuario="${u.id}">Editar</button> <button class="btn chico" data-reset="${u.id}">Nueva clave</button></td></tr>`)}
      </tbody></table></div>`;
    S._usuarios = us;
  } else if (pestanaAdmin === 'categorias') {
    const cats = await GET('/api/admin/categorias');
    S._cats = cats;
    const fila = (c) => h`<tr><td>${c.padre_id ? '↳ ' : ''}${c.icono} <b>${c.nombre}</b></td><td>${c.tipo === 'gasto' ? 'Gasto' : 'Ingreso'}</td><td>${c.usos}</td>
      <td>${c.activa ? 'Visible' : h`<span class="etiqueta off">Oculta</span>`}</td><td class="acciones"><button class="btn chico" data-cat-global="${c.id}">Editar</button></td></tr>`;
    const ordenadas = cats.filter((c) => !c.padre_id).flatMap((p) => [p, ...cats.filter((c) => c.padre_id === p.id)]);
    cuerpo = h`<div class="panel-cab"><h2>Categorías generales</h2><button class="btn primario chico" id="nueva-cat-global">+ Crear categoría</button></div>
      <p style="color:var(--gris);font-size:.9rem;margin-bottom:10px">Las ven todos los usuarios. Si una categoría ya tiene movimientos, ocultala en lugar de eliminarla.</p>
      <div class="tabla-scroll"><table><thead><tr><th>Categoría</th><th>Tipo</th><th>Usos</th><th>Estado</th><th></th></tr></thead><tbody>${ordenadas.map(fila)}</tbody></table></div>`;
  } else if (pestanaAdmin === 'medios') {
    const ms = await GET('/api/admin/medios');
    S._medios = ms;
    cuerpo = h`<div class="panel-cab"><h2>Medios de pago</h2><button class="btn primario chico" id="nuevo-medio">+ Agregar</button></div>
      <div class="tabla-scroll"><table><tbody>${ms.map((m) => h`<tr><td>${m.icono} <b>${m.nombre}</b></td><td>${m.activo ? 'Visible' : h`<span class="etiqueta off">Oculto</span>`}</td><td class="acciones"><button class="btn chico" data-medio-ed="${m.id}">Editar</button></td></tr>`)}</tbody></table></div>`;
  } else if (pestanaAdmin === 'monedas') {
    const mo = await GET('/api/admin/monedas');
    S._monedas = mo;
    cuerpo = h`<div class="panel-cab"><h2>Monedas</h2><button class="btn primario chico" id="nueva-moneda">+ Agregar</button></div>
      <div class="tabla-scroll"><table><tbody>${mo.map((m) => h`<tr><td><b>${m.codigo}</b></td><td>${m.nombre}</td><td>${m.simbolo}</td><td>${m.activa ? 'Activa' : h`<span class="etiqueta off">Inactiva</span>`}</td><td class="acciones"><button class="btn chico" data-moneda-ed="${m.codigo}">Editar</button></td></tr>`)}</tbody></table></div>`;
  } else if (pestanaAdmin === 'ajustes') {
    const c = await GET('/api/admin/configuracion');
    cuerpo = h`<div class="panel-cab"><h2>Ajustes de la plataforma</h2></div>
      <form id="f-ajustes" novalidate style="max-width:520px">
        <label class="check"><input type="checkbox" name="registro_abierto" ${c.registro_abierto ? raw('checked') : ''}> Cualquier persona puede crear su cuenta</label>
        <p style="color:var(--gris);font-size:.88rem;margin:-8px 0 14px">Si lo desactivás, solo vos podés crear usuarios desde este panel.</p>
        <label class="campo"><span>Frase de bienvenida</span><input type="text" name="eslogan" maxlength="120" value="${c.eslogan}"></label>
        <label class="campo"><span>Moneda para cuentas nuevas</span><select name="moneda_predeterminada">${S.catalogo.monedas.map((m) => h`<option ${m.codigo === c.moneda_predeterminada ? raw('selected') : ''}>${m.codigo}</option>`)}</select></label>
        <button type="submit" class="btn primario">Guardar ajustes</button>
      </form>`;
  } else {
    const a = await GET('/api/admin/auditoria');
    const nombres = { registro: 'Registro', registro_principal: 'Creó la cuenta principal', crear_usuario: 'Creó usuario', editar_usuario: 'Editó usuario', reset_password: 'Generó clave temporal', eliminar_usuario: 'Eliminó usuario',
      solicitud_recuperacion: 'Pidió recuperar acceso', cambio_password: 'Cambió su contraseña', configuracion: 'Cambió ajustes', crear_categoria: 'Creó categoría',
      editar_categoria: 'Editó categoría', eliminar_categoria: 'Eliminó categoría', crear_medio_pago: 'Creó medio de pago', editar_medio_pago: 'Editó medio de pago', guardar_moneda: 'Guardó moneda' };
    cuerpo = h`<div class="panel-cab"><h2>Registro de acciones</h2></div>
      <div class="tabla-scroll"><table><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>
      ${a.map((x) => h`<tr><td style="white-space:nowrap">${x.fecha}</td><td>${x.usuario || '—'}</td><td>${nombres[x.accion] || x.accion}</td><td style="color:var(--gris)">${x.detalle}</td></tr>`)}
      </tbody></table></div>`;
  }
  el.innerHTML = h`
    ${cabecera('Administración')}
    <div class="kpis">
      <div class="kpi"><b>${est.usuarios}</b><span>Usuarios (${est.activos} activos)</span></div>
      <div class="kpi"><b>${est.activos_7d}</b><span>Entraron en los últimos 7 días</span></div>
      <div class="kpi"><b>${est.nuevos_30d}</b><span>Nuevos en 30 días</span></div>
      <div class="kpi"><b>${est.movimientos_30d.toLocaleString('es-AR')}</b><span>Movimientos cargados en 30 días</span></div>
    </div>
    <div class="pestanas" role="tablist">${tabs.map(([k, n]) => h`<button role="tab" data-pestana="${k}" aria-selected="${k === pestanaAdmin}">${n}</button>`)}</div>
    <section class="panel">${cuerpo}</section>`.s;

  $$('[data-pestana]', el).forEach((b) => b.addEventListener('click', () => { pestanaAdmin = b.dataset.pestana; recargar(); }));
  const on = (sel, fn) => $$(sel, el).forEach((b) => b.addEventListener('click', () => fn(b)));
  on('#nuevo-usuario', () => formUsuario());
  on('[data-editar-usuario]', (b) => formUsuario(S._usuarios.find((u) => u.id === Number(b.dataset.editarUsuario))));
  on('[data-reset]', async (b) => {
    const u = S._usuarios.find((x) => x.id === Number(b.dataset.reset));
    if (!(await confirmar('Generar clave temporal', `Se genera una contraseña temporal para ${u.nombre}. La actual deja de funcionar y se cierran sus sesiones.`, 'Generar'))) return;
    try { const r = await POST(`/api/admin/usuarios/${u.id}/reset`); mostrarClave(u.nombre, u.email, r.password_temporal); } catch (e) { aviso(e.message, true); }
  });
  on('#nueva-cat-global', () => formCategoria('/api/admin/categorias', null, S._cats));
  on('[data-cat-global]', (b) => formCategoria('/api/admin/categorias', S._cats.find((c) => c.id === Number(b.dataset.catGlobal))));
  on('#nuevo-medio', () => formSimple('medio'));
  on('[data-medio-ed]', (b) => formSimple('medio', S._medios.find((m) => m.id === Number(b.dataset.medioEd))));
  on('#nueva-moneda', () => formSimple('moneda'));
  on('[data-moneda-ed]', (b) => formSimple('moneda', S._monedas.find((m) => m.codigo === b.dataset.monedaEd)));
  const fa = $('#f-ajustes', el);
  if (fa) enviarForm(fa, async (d) => {
    await PUT('/api/admin/configuracion', { ...d, registro_abierto: !!d.registro_abierto });
    S.publica = await GET('/api/config/publica'); aviso('Ajustes guardados');
  });
};
function mostrarClave(nombre, email, clave) {
  abrirModal('Contraseña temporal', h`<p>Pasale estos datos a <b>${nombre}</b>. Al ingresar, va a tener que elegir una contraseña nueva.</p>
    <p style="margin-top:12px;color:var(--gris)">Usuario: ${email}</p>
    <div class="clave-temporal">${clave}</div>
    <p style="color:var(--gris);font-size:.88rem;margin-bottom:14px">Esta clave no se vuelve a mostrar.</p>
    <div class="fila"><button class="btn" id="copiar">Copiar</button><button class="btn primario" id="listo">Listo</button></div>`, (m) => {
    $('#copiar', m).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(`Usuario: ${email}\nContraseña temporal: ${clave}`); aviso('Copiado'); } catch { aviso('No se pudo copiar', true); }
    });
    $('#listo', m).addEventListener('click', () => { cerrarModal(); recargar(); });
  }, false);
}
function formUsuario(u) {
  const yo = u && u.id === S.usuario.id;
  abrirModal(u ? 'Editar usuario' : 'Crear usuario', h`<form id="f-usuario" novalidate>
    <label class="campo"><span>Nombre</span><input type="text" name="nombre" maxlength="80" required value="${u ? u.nombre : ''}"></label>
    <label class="campo"><span>Correo electrónico</span><input type="email" name="email" required value="${u ? u.email : ''}"></label>
    <label class="campo"><span>Rol</span><select name="rol" ${yo ? raw('disabled') : ''}><option value="usuario">Usuario</option><option value="admin" ${u && u.rol === 'admin' ? raw('selected') : ''}>Administrador</option></select>
      <small>El administrador gestiona usuarios y configuración. No ve las finanzas de los demás.</small></label>
    ${u && !yo ? h`<label class="check"><input type="checkbox" name="activo" ${u.activo ? raw('checked') : ''}> Cuenta activa</label>` : ''}
    ${u ? '' : h`<p style="color:var(--gris);font-size:.9rem;margin-bottom:14px">Se genera una contraseña temporal que la persona cambia en su primer ingreso.</p>`}
    <div class="fila">${u && !yo ? h`<button type="button" class="btn peligro" id="borrar">Eliminar</button>` : ''}<button type="submit" class="btn primario">${u ? 'Guardar' : 'Crear usuario'}</button></div>
  </form>`, (m) => {
    const f = $('#f-usuario', m);
    if (u && !yo) $('#borrar', f).addEventListener('click', () => {
      abrirModal('Eliminar usuario', h`<form id="f-del" novalidate><p style="margin-bottom:12px">Se borra la cuenta de <b>${u.nombre}</b> con todos sus movimientos, cuentas y objetivos. No se puede deshacer.</p>
        <label class="campo"><span>Escribí ${u.email} para confirmar</span><input type="text" name="confirmar" autocomplete="off" required></label>
        <button type="submit" class="btn primario bloque" style="background:var(--gasto);border-color:var(--gasto)">Eliminar definitivamente</button></form>`, (m2) => {
        enviarForm($('#f-del', m2), async (d) => {
          await DEL(`/api/admin/usuarios/${u.id}?confirmar=${encodeURIComponent(d.confirmar.trim().toLowerCase())}`);
          cerrarModal(); aviso('Usuario eliminado'); recargar();
        });
      });
    });
    enviarForm(f, async (d) => {
      if (u) {
        await PUT('/api/admin/usuarios/' + u.id, { nombre: d.nombre, email: d.email, rol: yo ? u.rol : d.rol, activo: yo ? true : !!d.activo });
        cerrarModal(); aviso('Usuario guardado'); recargar();
      } else {
        const r = await POST('/api/admin/usuarios', d);
        mostrarClave(d.nombre, d.email.trim().toLowerCase(), r.password_temporal);
      }
    });
  });
}
function formSimple(tipo, x) {
  const esMoneda = tipo === 'moneda';
  abrirModal(x ? 'Editar' : esMoneda ? 'Nueva moneda' : 'Nuevo medio de pago', h`<form id="f-simple" novalidate>
    ${esMoneda ? h`<div class="fila"><label class="campo"><span>Código</span><input type="text" name="codigo" maxlength="3" required value="${x ? x.codigo : ''}" ${x ? raw('readonly') : ''} placeholder="EUR"></label>
      <label class="campo"><span>Símbolo</span><input type="text" name="simbolo" maxlength="5" required value="${x ? x.simbolo : ''}" placeholder="€"></label></div>
      <label class="campo"><span>Nombre</span><input type="text" name="nombre" maxlength="40" required value="${x ? x.nombre : ''}" placeholder="Euro"></label>`
    : h`<div class="fila"><label class="campo" style="flex:0 0 80px"><span>Ícono</span><input type="text" name="icono" maxlength="4" value="${x ? x.icono : '💳'}"></label>
      <label class="campo"><span>Nombre</span><input type="text" name="nombre" maxlength="40" required value="${x ? x.nombre : ''}"></label></div>`}
    ${x ? h`<label class="check"><input type="checkbox" name="activo" ${(esMoneda ? x.activa : x.activo) ? raw('checked') : ''}> Visible para los usuarios</label>` : ''}
    <button type="submit" class="btn primario bloque">Guardar</button>
  </form>`, (m) => {
    enviarForm($('#f-simple', m), async (d) => {
      const activo = x ? !!d.activo : true;
      if (esMoneda) await POST('/api/admin/monedas', { ...d, codigo: x ? x.codigo : d.codigo, activa: activo });
      else if (x) await PUT('/api/admin/medios/' + x.id, { ...d, activo });
      else await POST('/api/admin/medios', d);
      cerrarModal(); aviso('Guardado'); await cargarCatalogo(); recargar();
    });
  });
}

// ======================= arranque =======================
async function iniciarApp() {
  await cargarCatalogo();
  S.moneda = null;
  // Accesos directos del ícono instalado ("Agregar gasto"): llegan como /?agregar=gasto
  const agregar = new URLSearchParams(location.search).get('agregar');
  history.replaceState(null, '', location.pathname + (location.hash || '#/inicio'));
  $('#raiz').innerHTML = '';
  await navegar();
  if (agregar === 'gasto' || agregar === 'ingreso') formMovimiento(null, agregar);
}
window.addEventListener('hashchange', () => { cerrarModal(); navegar(); window.scrollTo(0, 0); });

function sinConexion() {
  $('#raiz').innerHTML = h`<main class="acceso"><div class="acceso-caja">
    <div class="acceso-marca">${LOGO(56)}<h1>EnQuéGasté</h1></div>
    <div class="panel vacio"><p>Sin conexión. Revisá tu internet y probá de nuevo.</p><button class="btn primario" id="reintentar">Reintentar</button></div>
  </div></main>`.s;
  $('#reintentar').addEventListener('click', () => location.reload());
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

(async function arranque() {
  S.publica = await GET('/api/config/publica').catch(() => ({}));
  try {
    const r = await api('GET', '/api/auth/yo');
    S.usuario = r.usuario;
    if (S.usuario.debe_cambiar_password) return mostrarAcceso('cambiar');
    await iniciarApp();
  } catch (e) {
    if (e.sinConexion) sinConexion();
    else if (!S.usuario) mostrarAcceso('login');
  }
})();
