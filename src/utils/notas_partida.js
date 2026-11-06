// daiko/src/utils/notas_partida.js
// Observaciones por partida del carrito (OBSERVACIONES en getCart, "observaciones" en
// cada producto al enviar). Aquí se arma el texto; la presentación y el estado que eligió
// el cliente los pone el código, nunca GPT.
//
// Cómo se comporta el CRM (claudedev/api_daiko_observaciones_partida.md):
//  - add de un artículo que ya está en el carrito suma unidades y concatena la nota
//    nueva con \r\n, sin cantidades: "Cuartos\r\nKileado" para 5 unidades no dice
//    cuántas van de cada una. Por eso esos casos se mandan como update con el detalle.
//  - update exige unidades; sin "observaciones" conserva la nota guardada.
//  - createCart con un artículo repetido crea dos partidas y luego add/update/remove
//    solo tocan la primera: nunca se mandan repetidos.

const { normalizarBasico } = require('./unidad_medida');

const SEPARADOR = '\r\n';
const MIN_COINCIDENCIA = 0.7;  // Palabras de la instrucción que deben salir de lo que escribió el cliente

function limpiar(texto) {
  return typeof texto === 'string' ? texto.trim() : '';
}

/**
 * Une la elección del cliente ("Medio kilo. Congelado") con sus instrucciones
 * ("Bolsas bien cerradas"). No repite lo que ya dice la elección.
 */
function unirNota(eleccion, instrucciones) {
  const a = limpiar(eleccion);
  const b = limpiar(instrucciones);
  if (!b || normalizarBasico(a).includes(normalizarBasico(b))) return a;
  if (!a) return b;
  return `${a}. ${b}`;
}

// "2 Cuartos\r\n3 Kileado": cada renglón ya dice para cuántas unidades es
function yaDetallada(nota) {
  return nota.split(/\r?\n/).every(function (r) { return /^\d+(\.\d+)?\s/.test(r.trim()); });
}

/**
 * Nota para una partida que ya existe en el carrito y recibe más unidades con otra nota.
 *
 * @param {object} partida  - Partida de getCart ({UNIDADES, OBSERVACIONES})
 * @param {number} unidades - Unidades nuevas
 * @param {string} nota     - Nota de las unidades nuevas
 */
function combinarConPartida(partida, unidades, nota) {
  const previa = limpiar(partida.OBSERVACIONES);
  let detalle;
  if (!previa) detalle = `${partida.UNIDADES} sin presentación indicada`;
  else if (yaDetallada(previa)) detalle = previa;
  else detalle = `${partida.UNIDADES} ${previa.split(/\r?\n/).join('. ')}`;
  return `${detalle}${SEPARADOR}${unidades} ${nota}`;
}

/**
 * Junta los artículos repetidos de una lista antes de mandarla a createCart.
 *
 * @param {Array} productos - [{articulo_id, unidades, observaciones?}]
 */
function juntarRepetidos(productos) {
  const porId = new Map();
  (productos || []).forEach(function (p) {
    const id = String(p.articulo_id);
    const nota = limpiar(p.observaciones);
    if (!porId.has(id)) {
      porId.set(id, { articulo_id: p.articulo_id, unidades: Number(p.unidades) || 1, renglones: [{ unidades: Number(p.unidades) || 1, nota }] });
      return;
    }
    const item = porId.get(id);
    item.unidades += Number(p.unidades) || 1;
    item.renglones.push({ unidades: Number(p.unidades) || 1, nota });
  });

  return [...porId.values()].map(function (item) {
    const conNota = item.renglones.filter(function (r) { return r.nota; });
    let observaciones = '';
    if (item.renglones.length === 1) observaciones = item.renglones[0].nota;
    else if (conNota.length > 0) {
      observaciones = item.renglones
        .map(function (r) { return `${r.unidades} ${r.nota || 'sin presentación indicada'}`; })
        .join(SEPARADOR);
    }
    const resultado = { articulo_id: item.articulo_id, unidades: item.unidades };
    if (observaciones) resultado.observaciones = observaciones;
    return resultado;
  });
}

/**
 * Las instrucciones especiales las redacta GPT: sólo se aceptan si salen de lo que
 * escribió el cliente. Evita que invente notas o que ponga ahí la presentación.
 *
 * @param {string}   texto         - Lo que GPT quiere guardar
 * @param {string[]} textosCliente - Mensajes recientes del cliente
 * @returns {string} El texto, o '' si no se reconoce como del cliente
 */
function instruccionDelCliente(texto, textosCliente) {
  const instruccion = limpiar(texto);
  if (!instruccion) return '';

  const palabras = function (s) { return normalizarBasico(s).replace(/[^A-Z0-9Ñ ]/g, ' ').split(/\s+/).filter(function (p) { return p.length >= 3; }); };
  const propias = palabras(instruccion);
  if (propias.length === 0) return '';

  const delCliente = new Set(palabras((textosCliente || []).join(' ')));
  const encontradas = propias.filter(function (p) { return delCliente.has(p); }).length;
  if (encontradas / propias.length < MIN_COINCIDENCIA) {
    console.warn(`📝 Instrucción descartada: no sale de lo que escribió el cliente: "${instruccion}"`);
    return '';
  }
  return instruccion;
}

module.exports = {
  unirNota,
  combinarConPartida,
  juntarRepetidos,
  instruccionDelCliente
};
