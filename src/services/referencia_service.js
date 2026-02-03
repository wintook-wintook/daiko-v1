// src/services/referencia_service.js
// FASE 1 - Servicio de Resolución de Referencias
// Versión: 1.0

/**
 * Servicio para resolver referencias textuales a productos
 *
 * Convierte expresiones como "el primero", "el segundo", "el último"
 * a IDs de productos reales basándose en la lista de productos mostrados.
 */

/**
 * Mapeo de palabras de referencia a índices
 */
const REFERENCIAS_A_INDICE = {
  // Ordinales en español
  'primero': 0,
  'primer': 0,
  'primera': 0,
  'segundo': 1,
  'segunda': 1,
  'tercero': 2,
  'tercer': 2,
  'tercera': 2,
  'cuarto': 3,
  'cuarta': 3,
  'quinto': 4,
  'quinta': 4,
  'sexto': 5,
  'sexta': 5,

  // Números escritos
  'uno': 0,
  'una': 0,
  'dos': 1,
  'tres': 2,
  'cuatro': 3,
  'cinco': 4,
  'seis': 5,

  // Especiales
  'ultimo': -1,
  'última': -1,
  'último': -1,
  'penultimo': -2,
  'penúltimo': -2,
  'antepenultimo': -3,
  'antepenúltimo': -3
};

/**
 * Resuelve una referencia textual a un producto
 *
 * @param {string|number} referencia - "primero", "segundo", "último", o número
 * @param {array} productosMostrados - Lista de productos mostrados al usuario
 * @returns {object|null} - Producto encontrado o null
 */
function resolverReferencia(referencia, productosMostrados) {
  console.log(`\n🔗 Resolviendo referencia: "${referencia}"`);

  // Validar que hay productos
  if (!productosMostrados || productosMostrados.length === 0) {
    console.log(`   ⚠️ No hay productos mostrados para resolver referencia`);
    return null;
  }

  // Si ya es un índice numérico del clasificador
  if (typeof referencia === 'number') {
    return resolverPorIndice(referencia, productosMostrados);
  }

  // Normalizar la referencia
  const refNormalizada = String(referencia)
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');  // Quitar acentos

  // Intentar como palabra ordinal
  if (REFERENCIAS_A_INDICE.hasOwnProperty(refNormalizada)) {
    const idx = REFERENCIAS_A_INDICE[refNormalizada];
    return resolverPorIndice(idx, productosMostrados);
  }

  // Intentar como número directo ("1", "2", "3")
  const num = parseInt(refNormalizada);
  if (!isNaN(num)) {
    // El usuario dice "1" pensando en el primero (índice 0)
    return resolverPorIndice(num - 1, productosMostrados);
  }

  console.log(`   ⚠️ No se pudo interpretar la referencia: "${referencia}"`);
  return null;
}

/**
 * Resuelve un índice a un producto
 *
 * @param {number} idx - Índice (puede ser negativo para contar desde el final)
 * @param {array} productos - Lista de productos
 * @returns {object|null} - Producto o null
 */
function resolverPorIndice(idx, productos) {
  const longitud = productos.length;

  // Manejar índices negativos (desde el final)
  if (idx < 0) {
    idx = longitud + idx;
  }

  // Validar rango
  if (idx < 0 || idx >= longitud) {
    console.log(`   ⚠️ Índice ${idx} fuera de rango [0-${longitud - 1}]`);
    return null;
  }

  const producto = productos[idx];
  console.log(`   ✅ Referencia resuelta → Índice: ${idx}, ID: ${producto.ARTICULO_ID}`);
  console.log(`      Producto: ${(producto.NOMBRE || producto.DESCRIPCION || '').substring(0, 50)}...`);

  return {
    ...producto,
    _indice_resuelto: idx,
    _referencia_original: idx
  };
}

/**
 * Resuelve múltiples referencias
 *
 * @param {array} referencias - Lista de referencias a resolver
 * @param {array} productosMostrados - Lista de productos
 * @returns {array} - Lista de productos resueltos (sin nulls)
 */
function resolverMultiplesReferencias(referencias, productosMostrados) {
  const resultados = [];

  for (const ref of referencias) {
    const producto = resolverReferencia(ref, productosMostrados);
    if (producto) {
      resultados.push(producto);
    }
  }

  console.log(`   📦 Resueltas ${resultados.length}/${referencias.length} referencias`);
  return resultados;
}

/**
 * Extrae referencias y cantidades de un texto
 *
 * Ejemplos:
 * - "agrégame 2 del primero" → [{ referencia: "primero", cantidad: 2 }]
 * - "ponme el primero y el tercero" → [{ referencia: "primero", cantidad: 1 }, { referencia: "tercero", cantidad: 1 }]
 * - "quiero 3 del 1 y 2 del 4" → [{ referencia: "1", cantidad: 3 }, { referencia: "4", cantidad: 2 }]
 *
 * @param {string} texto - Mensaje del usuario
 * @returns {array} - Lista de { referencia, cantidad }
 */
function extraerReferenciasConCantidad(texto) {
  const resultados = [];
  const textoLower = texto.toLowerCase();

  // Patrón 1: "X del primero/segundo/etc" o "X del 1/2/etc"
  const patron1 = /(\d+)\s+del?\s+(primero|segundo|tercero|cuarto|quinto|sexto|último|\d+)/gi;
  let match;

  while ((match = patron1.exec(textoLower)) !== null) {
    resultados.push({
      cantidad: parseInt(match[1]),
      referencia: match[2],
      tipo: 'cantidad_explicita'
    });
  }

  // Patrón 2: "el primero/segundo" sin cantidad
  if (resultados.length === 0) {
    const patron2 = /(?:el|la)\s+(primero|primera|segundo|segunda|tercero|tercera|cuarto|cuarta|quinto|quinta|sexto|sexta|último|última)/gi;

    while ((match = patron2.exec(textoLower)) !== null) {
      resultados.push({
        cantidad: 1,
        referencia: match[1],
        tipo: 'sin_cantidad'
      });
    }
  }

  // Patrón 3: "agrégalo", "ponlo", "lo quiero" (implícito: primero, cantidad 1)
  if (resultados.length === 0) {
    if (/(?:agr[eé]galo|ponlo|lo\s*quiero|dame\s*ese|ese)/i.test(textoLower)) {
      resultados.push({
        cantidad: 1,
        referencia: 'primero',
        tipo: 'implicito'
      });
    }
  }

  // Patrón 4: "ponme X" sin referencia (implícito: primero)
  if (resultados.length === 0) {
    const patron4 = /(?:ponme|dame|quiero)\s+(\d+)/i;
    match = patron4.exec(textoLower);
    if (match) {
      resultados.push({
        cantidad: parseInt(match[1]),
        referencia: 'primero',
        tipo: 'cantidad_sin_referencia'
      });
    }
  }

  // Patrón 5: referencias múltiples con "y"
  // "el primero y el tercero"
  if (resultados.length === 0) {
    const patron5 = /(primero|segundo|tercero|cuarto|quinto|sexto)\s+y\s+(?:el\s+)?(primero|segundo|tercero|cuarto|quinto|sexto)/gi;
    match = patron5.exec(textoLower);
    if (match) {
      resultados.push(
        { cantidad: 1, referencia: match[1], tipo: 'multiple' },
        { cantidad: 1, referencia: match[2], tipo: 'multiple' }
      );
    }
  }

  console.log(`\n📋 Referencias extraídas de: "${texto}"`);
  console.log(`   Resultados: ${JSON.stringify(resultados)}`);

  return resultados;
}

/**
 * Procesa parámetros del clasificador y resuelve las referencias
 *
 * @param {object} parametros - Parámetros del clasificador
 * @param {array} productosMostrados - Lista de productos
 * @returns {object} - Parámetros con referencias resueltas
 */
function resolverParametrosClasificador(parametros, productosMostrados) {
  const resultado = { ...parametros };

  // Si tiene referencia_idx directamente
  if (typeof parametros.referencia_idx === 'number') {
    const producto = resolverPorIndice(parametros.referencia_idx, productosMostrados);
    if (producto) {
      resultado.articulo_id = producto.ARTICULO_ID;
      resultado.producto_resuelto = producto;
    }
  }
  // Si tiene referencia textual
  else if (parametros.referencia) {
    const producto = resolverReferencia(parametros.referencia, productosMostrados);
    if (producto) {
      resultado.articulo_id = producto.ARTICULO_ID;
      resultado.producto_resuelto = producto;
      resultado.referencia_idx = producto._indice_resuelto;
    }
  }

  // Asegurar cantidad por defecto
  if (!resultado.cantidad || resultado.cantidad < 1) {
    resultado.cantidad = 1;
  }

  return resultado;
}

/**
 * Valida si una referencia puede ser resuelta
 *
 * @param {string|number} referencia - Referencia a validar
 * @param {array} productosMostrados - Lista de productos
 * @returns {boolean} - true si puede ser resuelta
 */
function puedeResolverReferencia(referencia, productosMostrados) {
  return resolverReferencia(referencia, productosMostrados) !== null;
}

module.exports = {
  resolverReferencia,
  resolverMultiplesReferencias,
  extraerReferenciasConCantidad,
  resolverParametrosClasificador,
  puedeResolverReferencia,
  resolverPorIndice,
  REFERENCIAS_A_INDICE
};
