// src/utils/query_commands.js
// Comandos de consulta directa que inician con '?'
// Se interceptan antes del clasificador y pasan el resultado a GPT para formatear.

const { getBalanceDue, getStockArticle, getTrackingPedido } = require('./crm');

/**
 * Formatea un folio al formato de 9 caracteres requerido por la API.
 * Ejemplo: "ABC123" → "ABC000123", "45" → "000000045"
 *
 * @param {string} folio
 * @returns {string}
 */
function formatearFolio(folio) {
  const str = folio.trim().toUpperCase();
  const match = str.match(/^([A-Z]*)(\d+)$/);
  if (!match) return str.padStart(9, '0');
  const letras = match[1];
  const numero = match[2];
  return letras + numero.padStart(9 - letras.length, '0');
}

/**
 * Registro de comandos de consulta.
 * Key: comando en minúsculas (con ?)
 * Value: { descripcion, parse(args) -> params|null, execute(params) -> Promise }
 *
 * parse() retorna null si faltan parámetros obligatorios.
 */
const REGISTRY = {
  '?saldo': {
    descripcion: 'Consulta el saldo pendiente del cliente',
    parse: () => ({}),
    execute: async () => getBalanceDue()
  },

  '?existencia': {
    descripcion: 'Consulta existencia de un artículo. Uso: ?existencia <articulo_id>',
    parse: (args) => {
      const articulo_id = args.trim();
      if (!articulo_id) return null;
      return { articulo_id };
    },
    execute: async ({ articulo_id }) => getStockArticle(articulo_id)
  },

  '?estatuspedido': {
    descripcion: 'Consulta el estado de un pedido. Uso: ?estatuspedido <folio>',
    parse: (args) => {
      const folio = args.trim();
      if (!folio) return null;
      return { folio: formatearFolio(folio) };
    },
    execute: async ({ folio }) => getTrackingPedido(folio)
  }
};

/**
 * Detecta si un mensaje es un comando de consulta (prefijo '?').
 *
 * @param {string} mensaje
 * @returns {{ config, args, cmd }|null}
 */
function detectarQueryComando(mensaje) {
  if (!mensaje || !mensaje.trim().startsWith('?')) return null;
  const parts = mensaje.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const config = REGISTRY[cmd];
  if (!config) return null;
  return { config, args: parts.slice(1).join(' '), cmd };
}

/**
 * Ejecuta un comando de consulta si el mensaje coincide.
 *
 * @param {string} mensaje
 * @returns {Promise<{ success, cmd, params, data, error }|null>} null si no es un comando reconocido
 */
async function ejecutarQueryComando(mensaje) {
  const detected = detectarQueryComando(mensaje);
  if (!detected) return null;

  const params = detected.config.parse(detected.args);
  if (params === null) {
    return {
      success: false,
      cmd: detected.cmd,
      params: null,
      data: null,
      error: `Faltan parámetros. Uso: ${detected.config.descripcion}`
    };
  }

  const resultado = await detected.config.execute(params);
  return {
    success: resultado.success,
    cmd: detected.cmd,
    params,
    data: resultado.data,
    error: resultado.success ? null : (resultado.message || 'Error al consultar la API')
  };
}

module.exports = { ejecutarQueryComando, detectarQueryComando, formatearFolio };
