// daiko/src/utils/unidad_medida.js
// Detecta si el nombre de un producto ya trae su medida y, si no, completa el
// nombre con la unidad de venta del CRM (UNIDAD_VENTA).
//
// Motivo: hay productos cuyo nombre no dice en qué unidad se venden ("LOMO DE
// CERDO" se vende por kilo, "LAPIZ BICOLOR" por pieza). UNIDAD_VENTA sólo se usa
// cuando el nombre no trae medida: "CLORO CLORALEX 1.17 L" viene con PZ desde la
// API, y mostrar "1.17 L - PIEZA" no aportaría nada.
//
// Lista propia de unidades en vez de tokenizarDescripcion: su regex acepta número
// + cualquier palabra, y "LAPIZ #2 TRIANG" contaría como la medida "2 TRIANG".

// Marcas diacriticas combinantes (U+0300-U+036F), igual que en relevancia.js
const ACENTOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

// Sólo unidades que dicen cómo se vende el producto: "LIBRETA 40 HJ" o "FOCO 60 W"
// se venden por pieza, así que hojas, watts y similares no cuentan.
const UNIDADES = [
  { canon: 'KG', alias: ['KG', 'KGS', 'KILO', 'KILOS', 'KILOGRAMO', 'KILOGRAMOS'] },
  { canon: 'GR', alias: ['G', 'GR', 'GRS', 'GRAMO', 'GRAMOS'] },
  { canon: 'MG', alias: ['MG'] },
  { canon: 'LB', alias: ['LB', 'LBS', 'LIBRA', 'LIBRAS'] },
  { canon: 'OZ', alias: ['OZ', 'ONZA', 'ONZAS'] },
  { canon: 'LT', alias: ['L', 'LT', 'LTS', 'LITRO', 'LITROS'] },
  { canon: 'ML', alias: ['ML', 'MILILITRO', 'MILILITROS'] },
  { canon: 'GAL', alias: ['GAL', 'GALON', 'GALONES'] },
  { canon: 'MM', alias: ['MM', 'MILIMETRO', 'MILIMETROS'] },
  { canon: 'CM', alias: ['CM', 'CENTIMETRO', 'CENTIMETROS'] },
  { canon: 'M', alias: ['M', 'MT', 'MTS', 'METRO', 'METROS'] },
  { canon: 'PULGADAS', alias: ['PULG', 'PULGADA', 'PULGADAS', '"'] },
  { canon: 'PZ', alias: ['PZ', 'PZS', 'PZA', 'PZAS', 'PIEZA', 'PIEZAS'] }
];

const ALIAS_A_UNIDAD = new Map();
UNIDADES.forEach(function (u) {
  u.alias.forEach(function (a) { ALIAS_A_UNIDAD.set(a, u); });
});

// Los alias más largos primero para que "ML" no se quede en "M"
const ALIAS_REGEX = [...ALIAS_A_UNIDAD.keys()]
  .sort(function (a, b) { return b.length - a.length; })
  .join('|');

// Número + unidad. El número no debe venir pegado a otro código: "B20", "#2", "PS-20"
const REGEX_MEDIDA = new RegExp(
  '(?<![A-Z0-9.,/#-])(\\d+/\\d+|\\d+(?:[.,]\\d+)?)\\s*(' + ALIAS_REGEX + ')(?![A-Z0-9])'
);

// Unidad sin número ("QUESO POR KILO"). Sólo después de POR/X/AL o al final del
// nombre: "PIEZA DE POLLO" no dice la unidad, y una letra suelta como "PLAYERA M"
// es una talla, por eso se excluyen los alias de un carácter.
const ALIAS_SUELTOS = [...ALIAS_A_UNIDAD.keys()]
  .filter(function (a) { return a.length >= 2 && a !== '"'; })
  .join('|');
const REGEX_UNIDAD_SUELTA = new RegExp(
  '(?:^|\\s)(?:POR|X|AL)\\s+(?:' + ALIAS_SUELTOS + ')(?![A-Z0-9])|\\s(?:' + ALIAS_SUELTOS + ')[\\s.]*$'
);

// Cómo se muestra cada valor de UNIDAD_VENTA. Lo que no esté aquí se muestra tal cual.
const ETIQUETAS_UNIDAD = {
  KG: 'KILO', GR: 'GRAMO', LT: 'LITRO', ML: 'MILILITRO', M: 'METRO', PZ: 'PIEZA'
};

function normalizarBasico(s) {
  return String(s === undefined || s === null ? '' : s)
    .toUpperCase()
    .normalize('NFD')
    .replace(ACENTOS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Quita de un texto ya normalizado las medidas: en "2 aires de 5 KG" sólo queda el 2.
 */
function quitarMedidas(textoNormalizado) {
  return textoNormalizado.replace(new RegExp(REGEX_MEDIDA.source, 'g'), ' ');
}

/**
 * true si el nombre ya indica cómo se vende el producto.
 */
function nombreTraeUnidad(nombre) {
  const n = normalizarBasico(nombre);
  return REGEX_MEDIDA.test(n) || REGEX_UNIDAD_SUELTA.test(n);
}

/**
 * Traduce UNIDAD_VENTA a la etiqueta que ve el cliente: "Kilogramo" → "KILO", "PZ" → "PIEZA"
 */
function etiquetaUnidad(unidadVenta) {
  const n = normalizarBasico(unidadVenta);
  if (!n) return null;
  const unidad = ALIAS_A_UNIDAD.get(n);
  if (unidad && ETIQUETAS_UNIDAD[unidad.canon]) return ETIQUETAS_UNIDAD[unidad.canon];
  return n;
}

/**
 * Nombre para mostrar: agrega la unidad sólo si el nombre no la trae.
 *
 * @param {object} producto - {NOMBRE, UNIDAD_VENTA}
 * @returns {string}
 */
function nombreConUnidad(producto) {
  const nombre = String((producto && producto.NOMBRE) || '').trim();
  const etiqueta = etiquetaUnidad(producto && producto.UNIDAD_VENTA);
  if (!nombre || !etiqueta || nombreTraeUnidad(nombre)) return nombre;
  return nombre + ' - ' + etiqueta;
}

module.exports = {
  normalizarBasico,
  quitarMedidas,
  nombreConUnidad
};
