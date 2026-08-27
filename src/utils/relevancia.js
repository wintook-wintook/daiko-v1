// daiko/src/utils/relevancia.js
// Ordena los resultados de búsqueda por qué tanto coincide cada producto con lo
// que pidió el cliente.
//
// Motivo: el CRM devuelve los productos en orden alfabético (ORDER BY A.nombre) y
// su WHERE es `(nombre_match OR etiqueta_match)`. Ese OR es a propósito -- amplía
// el recall trayendo productos cuya etiqueta coincide aunque el nombre no --, pero
// hace que al buscar "libreta" salgan primero BLOCK y CUADERNO sólo por el
// alfabeto. La precisión se recupera aquí, sin tocar el SQL ni perder recall.
//
// El sustantivo pesa más que los filtros a propósito: si pesaran igual, un
// "BLOCK CANARIO ... BLANCO" le ganaría posición a una "LIBRETA UNIVERSITARIA"
// por coincidir en la característica BLANCO.

const PESO_SUSTANTIVO        = 100;  // el producto en sí (query)
const PESO_SUSTANTIVO_INICIO = 50;   // bonus si el nombre ARRANCA con el sustantivo
const PESO_FILTRO            = 10;   // cada término de marca/tipo/medida/característica

// Marcas diacriticas combinantes (U+0300-U+036F). Se arma con fromCharCode para
// no dejar caracteres invisibles en el fuente.
const ACENTOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

function normalizarTexto(s) {
  return String(s === undefined || s === null ? '' : s)
    .toUpperCase()
    .normalize('NFD')
    .replace(ACENTOS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Coincide al inicio de palabra: "LIBRETA" engancha "LIBRETAS" pero no "SOBRELIBRETA"
function contieneTermino(nombreNormalizado, termino) {
  const t = normalizarTexto(termino);
  if (!t) return false;
  return new RegExp('\\b' + escaparRegex(t)).test(nombreNormalizado);
}

/**
 * Reúne en una sola lista los términos de todos los filtros.
 */
function terminosDeFiltros(filtros) {
  const campos = ['marca', 'tipo', 'medida', 'caracteristicas', 'compatibilidad'];
  const terminos = [];
  campos.forEach(function (campo) {
    const valores = (filtros && Array.isArray(filtros[campo])) ? filtros[campo] : [];
    valores.forEach(function (v) {
      const t = normalizarTexto(v);
      if (t) terminos.push(t);
    });
  });
  return terminos;
}

/**
 * Puntúa un nombre de producto contra el sustantivo y los términos de filtro.
 */
function calcularRelevancia(nombre, sustantivo, terminosFiltro) {
  const n = normalizarTexto(nombre);
  let score = 0;

  const s = normalizarTexto(sustantivo);
  if (s) {
    // El prompt pide un solo sustantivo en query, pero si llegan varias palabras
    // se da crédito proporcional a cuántas coinciden.
    const tokens = s.split(' ').filter(Boolean);
    let encontrados = 0;
    tokens.forEach(function (t) {
      if (contieneTermino(n, t)) encontrados++;
    });
    if (encontrados > 0) {
      score += PESO_SUSTANTIVO * (encontrados / tokens.length);
      if (n.indexOf(tokens[0]) === 0) score += PESO_SUSTANTIVO_INICIO;
    }
  }

  (terminosFiltro || []).forEach(function (t) {
    if (contieneTermino(n, t)) score += PESO_FILTRO;
  });

  return score;
}

/**
 * Devuelve los productos ordenados por relevancia (mayor primero).
 * Empates conservan el orden original (alfabético del CRM).
 *
 * @param {Array}  productos  - [{ARTICULO_ID, NOMBRE, PRECIO}]
 * @param {string} sustantivo - query canonizado ("libreta")
 * @param {object} filtros    - filtrosNormalizados
 * @returns {Array} nueva lista ordenada
 */
function ordenarPorRelevancia(productos, sustantivo, filtros) {
  if (!Array.isArray(productos) || productos.length === 0) return productos;

  const terminosFiltro = terminosDeFiltros(filtros);

  const conScore = productos.map(function (p, idx) {
    return { p: p, idx: idx, score: calcularRelevancia(p && p.NOMBRE, sustantivo, terminosFiltro) };
  });

  conScore.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx;  // empate: respetar orden original
  });

  return conScore.map(function (e) { return e.p; });
}

module.exports = {
  ordenarPorRelevancia,
  calcularRelevancia,
  terminosDeFiltros,
  normalizarTexto
};
