// daiko/src/utils/product_formatter.js
// CAPA DE PRESENTACIÓN - FORMATO DE SALIDA
// Implementa Documento B v1.1 - NUMERACIÓN OBLIGATORIA

/**
 * Valida que un producto tenga los campos mínimos requeridos para ser impreso
 * 
 * CRITERIOS DE VALIDACIÓN:
 * - Debe tener ARTICULO_ID (no undefined, null o vacío)
 * - Debe tener NOMBRE/DESCRIPCION
 * - Debe tener PRECIO (puede ser 0)
 * 
 * @param {object} producto - Objeto producto
 * @returns {boolean} true si el producto es válido para impresión
 */
function validarProductoParaImpresion(producto) {
  // Validar ARTICULO_ID
  if (producto.ARTICULO_ID === undefined || 
      producto.ARTICULO_ID === null || 
      producto.ARTICULO_ID === '') {
    console.warn(`⚠️ Producto sin ARTICULO_ID válido:`, producto);
    return false;
  }

  // Validar NOMBRE/DESCRIPCION
  const nombre = producto.NOMBRE || producto.DESCRIPCION || '';
  if (!nombre || nombre.trim() === '') {
    console.warn(`⚠️ Producto ${producto.ARTICULO_ID} sin NOMBRE válido`);
    return false;
  }

  // Validar PRECIO (puede ser 0, pero debe existir)
  if (producto.PRECIO === undefined || producto.PRECIO === null) {
    console.warn(`⚠️ Producto ${producto.ARTICULO_ID} sin PRECIO válido`);
    return false;
  }

  return true;
}

/**
 * Formatea un solo producto según el estándar Documento B v1.1
 * 
 * FORMATO EXACTO:
 * N) ID: ARTICULO_ID - DESCRIPCION_COMPLETA_DEL_PRODUCTO
 * Precio: $PRECIO
 * 
 * @param {object} producto - Objeto producto
 * @param {number} numero - Número de secuencia (inicia en 1)
 * @returns {string} Producto formateado o null si inválido
 */
function formatearProducto(producto, numero) {
  // Validación previa
  if (!validarProductoParaImpresion(producto)) {
    return null;
  }

  // Extraer campos
  const articuloId = producto.ARTICULO_ID;
  const nombre = producto.NOMBRE || producto.DESCRIPCION;
  const precio = producto.PRECIO;

  // Formatear precio
  const precioFormateado = typeof precio === 'number' 
    ? `$${precio.toFixed(2)}` 
    : `$${precio}`;

  // Construir bloque según formato exacto
  const bloque = `${numero}) ID: ${articuloId} - ${nombre}\nPrecio: ${precioFormateado}`;

  return bloque;
}

/**
 * Formatea una lista de productos con numeración obligatoria
 * 
 * REGLAS:
 * - La numeración SIEMPRE inicia en 1
 * - La numeración es consecutiva
 * - Los productos inválidos se omiten (no se cuentan)
 * - Si NO hay productos válidos, retorna null
 * 
 * @param {Array} productos - Array de productos
 * @returns {object} { productos_formateados, total_validos, total_invalidos }
 */
function formatearListaProductos(productos) {
  if (!Array.isArray(productos) || productos.length === 0) {
    console.log(`ℹ️ No hay productos para formatear`);
    return {
      productos_formateados: null,
      total_validos: 0,
      total_invalidos: 0,
      bloques: []
    };
  }

  console.log(`\n📋 ========================================`);
  console.log(`   FORMATEANDO LISTA DE PRODUCTOS`);
  console.log(`   Total recibidos: ${productos.length}`);
  console.log(`   ========================================\n`);

  const bloques = [];
  let numeroActual = 1;
  let totalInvalidos = 0;

  for (const producto of productos) {
    const bloqueFormateado = formatearProducto(producto, numeroActual);
    
    if (bloqueFormateado) {
      bloques.push(bloqueFormateado);
      numeroActual++;
      console.log(`✅ Producto ${numeroActual - 1} formateado: ID ${producto.ARTICULO_ID}`);
    } else {
      totalInvalidos++;
      console.log(`❌ Producto omitido por validación fallida`);
    }
  }

  const totalValidos = bloques.length;

  console.log(`\n📊 RESUMEN DE FORMATEO:`);
  console.log(`   Productos válidos: ${totalValidos}`);
  console.log(`   Productos inválidos: ${totalInvalidos}`);
  console.log(`   ========================================\n`);

  // Si no hay productos válidos, retornar null
  if (totalValidos === 0) {
    return {
      productos_formateados: null,
      total_validos: 0,
      total_invalidos: totalInvalidos,
      bloques: []
    };
  }

  // Unir bloques con doble salto de línea
  const textoFinal = bloques.join('\n\n');

  return {
    productos_formateados: textoFinal,
    total_validos: totalValidos,
    total_invalidos: totalInvalidos,
    bloques: bloques
  };
}

/**
 * Procesa una respuesta que contiene productos y aplica formateo obligatorio
 * 
 * FLUJO:
 * 1. Detecta si la respuesta contiene productos (data array)
 * 2. Valida y formatea productos
 * 3. Si no hay productos válidos, delega al motor conversacional
 * 4. Si hay productos válidos, construye respuesta formateada
 * 
 * @param {object} resultadoFuncion - Resultado de executeFunctionCall
 * @param {string} textoLLM - Texto generado por el LLM (opcional)
 * @returns {object} { response, productos_formateados, success }
 */
function procesarRespuestaConProductos(resultadoFuncion, textoLLM = '') {
  // Verificar si hay productos en el resultado
  if (!resultadoFuncion.data || !Array.isArray(resultadoFuncion.data)) {
    console.log(`ℹ️ No hay array de productos en resultado`);
    return {
      response: textoLLM || resultadoFuncion.message || '',
      productos_formateados: false,
      success: true
    };
  }

  console.log(`🔍 Detectados ${resultadoFuncion.data.length} productos en resultado`);

  // Formatear productos
  const formateo = formatearListaProductos(resultadoFuncion.data);

  // Si NO hay productos válidos, delegar al motor conversacional
  if (!formateo.productos_formateados) {
    console.log(`⚠️ No hay productos válidos para mostrar, delegando a motor conversacional`);
    return {
      response: textoLLM || resultadoFuncion.message || 'No encontré productos con información completa para mostrar.',
      productos_formateados: false,
      success: true,
      total_invalidos: formateo.total_invalidos
    };
  }

  // Construir respuesta con productos formateados
  let respuestaFinal = '';

  // Agregar texto del LLM si existe (introducción)
  if (textoLLM && textoLLM.trim() !== '') {
    respuestaFinal += textoLLM.trim() + '\n\n';
  }

  // Agregar productos formateados
  respuestaFinal += formateo.productos_formateados;

  // Agregar información adicional si existe
  if (resultadoFuncion.total_disponibles) {
    respuestaFinal += `\n\n📊 Total de productos disponibles: ${resultadoFuncion.total_disponibles}`;
  }

  console.log(`✅ Respuesta con ${formateo.total_validos} productos formateados`);

  return {
    response: respuestaFinal,
    productos_formateados: true,
    total_validos: formateo.total_validos,
    total_invalidos: formateo.total_invalidos,
    success: true
  };
}

module.exports = {
  validarProductoParaImpresion,
  formatearProducto,
  formatearListaProductos,
  procesarRespuestaConProductos
};