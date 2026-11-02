'use strict';
// Lectura de fotos y capturas de comprobantes con Claude: devuelve los movimientos de dinero que aparecen.
const Anthropic = require('@anthropic-ai/sdk');
const { HttpError } = require('./http');

const MODELO = 'claude-opus-5-5';

const INSTRUCCIONES = `Leés fotos y capturas de pantalla de comprobantes de una persona de Argentina (tickets, facturas, transferencias, Mercado Pago, home banking, resúmenes de tarjeta) y devolvés los movimientos de dinero que aparecen, para cargarlos en su app de gastos.

- Un movimiento por operación. Un ticket con varios productos es un solo gasto por el total. Un resumen o listado con varias operaciones lleva uno por cada operación.
- tipo: "gasto" si la persona pagó o le debitaron plata; "ingreso" si la recibió (transferencia recibida, sueldo, cobro).
- importe: número positivo con punto decimal. En Argentina "$ 15.000,50" es 15000.50. Si hay subtotal y total, usá el total.
- moneda: código de 3 letras: ARS si dice $ o pesos, USD si dice US$, U$S o dólares.
- fecha: AAAA-MM-DD. Si falta el año, usá el más reciente que no sea posterior a la fecha de hoy. Si no figura ninguna fecha, dejala vacía.
- descripcion: corta, quién cobró o pagó y por qué (por ejemplo: "Carrefour", "Transferencia a Juan Pérez", "Netflix").
- categoria_id: la categoría de la lista que mejor encaje, del mismo tipo que el movimiento.
- medio_pago_id: el medio de pago de la lista si se puede deducir; si no, 0. En los ingresos, 0.
- cuenta_id: la cuenta de la lista solo si la captura deja claro de cuál salió o a cuál entró la plata (por ejemplo, una captura de Mercado Pago y la persona tiene una cuenta llamada Mercado Pago); si no, 0.
- No inventes datos. Si la imagen no muestra movimientos de dinero, devolvé la lista vacía y contá en aviso qué se ve. Si una parte no se lee bien, cargá lo que sí se lee y mencionalo en aviso. Si todo se leyó bien, aviso queda vacío.`;

const ESQUEMA = {
  type: 'object',
  properties: {
    movimientos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['gasto', 'ingreso'] },
          importe: { type: 'number' },
          moneda: { type: 'string' },
          fecha: { type: 'string' },
          descripcion: { type: 'string' },
          categoria_id: { type: 'integer' },
          medio_pago_id: { type: 'integer' },
          cuenta_id: { type: 'integer' },
        },
        required: ['tipo', 'importe', 'moneda', 'fecha', 'descripcion', 'categoria_id', 'medio_pago_id', 'cuenta_id'],
        additionalProperties: false,
      },
    },
    aviso: { type: 'string' },
  },
  required: ['movimientos', 'aviso'],
  additionalProperties: false,
};

function contexto({ categorias, medios, cuentas, hoy }) {
  const cat = (tipo) => categorias.filter((c) => c.tipo === tipo)
    .map((c) => `${c.id}: ${c.nombre}${c.padre ? ` (dentro de ${c.padre})` : ''}`).join('; ');
  return [
    `Fecha de hoy: ${hoy}`,
    `Categorías de gastos: ${cat('gasto')}`,
    `Categorías de ingresos: ${cat('ingreso')}`,
    `Medios de pago: ${medios.map((m) => `${m.id}: ${m.nombre}`).join('; ')}`,
    `Cuentas: ${cuentas.length ? cuentas.map((c) => `${c.id}: ${c.nombre} (${c.tipo}, ${c.moneda})`).join('; ') : 'ninguna'}`,
  ].join('\n');
}

// Traduce los errores del servicio a mensajes para la persona que usa la app
function errorLectura(e) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(503, 'La clave de Claude no es válida o no tiene permisos. El administrador la puede cambiar en Administración → Ajustes.');
  }
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, 'Se están leyendo muchas capturas a la vez. Esperá un minuto y probá de nuevo.');
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit|billing|balance/i.test(e.message)) return new HttpError(503, 'La cuenta de Claude no tiene saldo. El administrador tiene que cargar crédito en console.anthropic.com.');
    return new HttpError(400, 'No se pudo leer esa imagen. Probá con otra captura o una foto más nítida.');
  }
  if (e instanceof Anthropic.APIConnectionError) return new HttpError(503, 'No se pudo conectar con el servicio de lectura. Probá de nuevo en un rato.');
  if (e instanceof Anthropic.APIError) return new HttpError(503, 'El servicio de lectura no respondió bien. Probá de nuevo en un rato.');
  return e;
}

async function leerCaptura({ apiKey, mediaType, imagen, ...datos }) {
  const cliente = new Anthropic({ apiKey, timeout: 120e3, maxRetries: 1 });
  let resp;
  try {
    resp = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // si el modelo rechaza la imagen por error, la reintenta con el modelo de respaldo
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
      system: INSTRUCCIONES,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imagen } },
          { type: 'text', text: contexto(datos) },
        ],
      }],
    });
  } catch (e) { throw errorLectura(e); }

  const texto = resp.content.find((b) => b.type === 'text');
  if (resp.stop_reason !== 'end_turn' || !texto) return { movimientos: [], aviso: 'No se pudo leer esta imagen. Probá con otra captura.' };
  try { return JSON.parse(texto.text); } catch { return { movimientos: [], aviso: 'No se pudo leer esta imagen. Probá con otra captura.' }; }
}

// Comprueba una clave antes de guardarla (consultar el modelo no tiene costo)
async function probarClave(apiKey) {
  try { await new Anthropic({ apiKey, timeout: 20e3, maxRetries: 1 }).models.retrieve(MODELO); }
  catch (e) { throw errorLectura(e); }
}

module.exports = { leerCaptura, probarClave };
