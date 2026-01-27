// daiko/src/utils/productFormatter.js
// DOCUMENTO B v1.1 - FORMATO DE SALIDA
// Capa de presentación - Numeración OBLIGATORIA

/**
 * FORMATO OFICIAL DE IMPRESIÓN (Documento B v1.1)
 * 
 * N) ID: ARTICULO_ID - DESCRIPCION_COMPLETA_DEL_PRODUCTO
 * Precio: $PRECIO
 * 
 * Donde:
 * - N) es el número generado dinámicamente (inicia en 1)
 * - No se permiten otros símbolos
 * - No se permite omitir el número
 */

/**
 * Valida que un producto tenga los campos obligatorios para impresión
 * 
 * Campos requeridos:
 * - ARTICULO_ID (no null, no undefined, no vacío)
 * - PRECIO (no null, no undefined)
 * - NOMBRE/DESCRIPCION (no null, no undefined, no vacío)
 * 
 * @param {object} producto - Producto a validar
 * @returns {object} { esValido: boolean, razon?: string }
 */
function validarProductoParaImpresion(producto) {
  // Validar ARTICULO_ID
  if (producto.ARTICULO_ID === undefined || 
      producto.ARTICULO_ID === null || 
      producto.ARTICULO_ID === '') {
    return {
      esValido: false,
      razon: 'ARTICULO_ID faltante o inválido'
    };
  }
  
  // Validar PRECIO
  if (producto.PRECIO === undefined || producto.PRECIO === null) {
    return {
      esValido: false,
      razon: 'PRECIO faltante'
    };
  }
  
  // Validar NOMBRE/DESCRIPCION
  const descripcion = producto.NOMBRE || producto.DESCRIPCION || producto.descripcion;
  if (!descripcion || descripcion.trim() === '') {
    return {
      esValido: false,
      razon: 'DESCRIPCION faltante o vacía'
    };
  }
  
  return { esValido: true };
}

/**
 * Formatea un producto individual según Documento B v1.1
 * 
 * FORMATO EXACTO:
 * N) ID: ARTICULO_ID - DESCRIPCION_COMPLETA_DEL_PRODUCTO
 * Precio: $PRECIO
 * 
 * @param {object} producto - Producto a formatear
 * @param {number} numero - Número de orden (1, 2, 3...)
 * @returns {string|null} Texto formateado o null si no es válido
 */
function formatearProducto(producto, numero) {
  // Validar producto
  const validacion = validarProductoParaImpresion(producto);
  
  if (!validacion.esValido) {
    console.warn(`⚠️ [FORMATTER] Producto no imprimible: ${validacion.razon}`, {
      ARTICULO_ID: producto.ARTICULO_ID,
      tiene_precio: producto.PRECIO !== undefined
    });
    return null;
  }
  
  // Obtener descripción
  const descripcion = producto.NOMBRE || producto.DESCRIPCION || producto.descripcion;
  
  // Formatear precio
  const precio = typeof producto.PRECIO === 'number' 
    ? producto.PRECIO.toFixed(2) 
    : producto.PRECIO;
  
  // Construir formato exacto según Documento B v1.1
  // N) ID: ARTICULO_ID - DESCRIPCION_COMPLETA_DEL_PRODUCTO
  // Precio: $PRECIO
  return `${numero}) ID: ${producto.ARTICULO_ID} - ${descripcion}\nPrecio: $${precio}`;
}

/**
 * Formatea una lista de productos con numeración obligatoria
 * 
 * REGLAS (Documento B v1.1):
 * - Numeración inicia SIEMPRE en 1
 * - Numeración es consecutiva
 * - Numeración se reinicia en cada respuesta
 * - Si un producto no es válido, se omite (no rompe numeración)
 * - Si ningún producto es válido, retorna null
 * 
 * @param {Array} productos - Lista de productos a formatear
 * @param {object} opciones - Opciones de formateo
 * @param {number} opciones.inicioNumeracion - Número inicial (default: 1)
 * @param {number} opciones.limite - Límite de productos a formatear (default: 6)
 * @returns {object} { exito: boolean, textoFormateado?: string, productosFormateados: number, productosOmitidos: number }
 */
function formatearListaProductos(productos, opciones = {}) {
  const {
    inicioNumeracion = 1,
    limite = 6
  } = opciones;
  
  console.log(`📋 [FORMATTER] Formateando lista de ${productos?.length || 0} productos`);
  console.log(`   Inicio numeración: ${inicioNumeracion}`);
  console.log(`   Límite: ${limite}`);
  
  // Validar entrada
  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    console.warn('⚠️ [FORMATTER] Lista de productos vacía o inválida');
    return {
      exito: false,
      textoFormateado: null,
      productosFormateados: 0,
      productosOmitidos: 0,
      razon: 'Lista de productos vacía'
    };
  }
  
  const lineasFormateadas = [];
  let numeroActual = inicioNumeracion;
  let omitidos = 0;
  
  // Procesar cada producto (hasta el límite)
  const productosAProcesar = productos.slice(0, limite);
  
  for (const producto of productosAProcesar) {
    const lineaFormateada = formatearProducto(producto, numeroActual);
    
    if (lineaFormateada) {
      lineasFormateadas.push(lineaFormateada);
      numeroActual++;
    } else {
      omitidos++;
    }
  }
  
  // Validación de lista completa (Documento B v1.1)
  // Si no hay productos imprimibles, no se imprime salida
  if (lineasFormateadas.length === 0) {
    console.warn('⚠️ [FORMATTER] Ningún producto válido para imprimir');
    return {
      exito: false,
      textoFormateado: null,
      productosFormateados: 0,
      productosOmitidos: omitidos,
      razon: 'Ningún producto cumple requisitos de impresión'
    };
  }
  
  // Unir líneas con doble salto de línea para separación visual
  const textoFinal = lineasFormateadas.join('\n\n');
  
  console.log(`✅ [FORMATTER] Formateados: ${lineasFormateadas.length}, Omitidos: ${omitidos}`);
  
  return {
    exito: true,
    textoFormateado: textoFinal,
    productosFormateados: lineasFormateadas.length,
    productosOmitidos: omitidos,
    ultimoNumero: numeroActual - 1
  };
}

/**
 * Formatea productos para respuesta del asistente
 * Incluye el texto formateado y metadata para el LLM
 * 
 * @param {Array} productos - Lista de productos
 * @param {object} contexto - Contexto adicional
 * @param {number} contexto.paginaActual - Página actual
 * @param {number} contexto.totalDisponibles - Total de productos disponibles
 * @returns {object} Objeto con texto formateado y metadata
 */
function prepararRespuestaProductos(productos, contexto = {}) {
  const {
    paginaActual = 1,
    totalDisponibles = 0
  } = contexto;
  
  console.log(`\n📦 ========== FORMATTER: PREPARAR RESPUESTA ==========`);
  console.log(`   Página: ${paginaActual}`);
  console.log(`   Productos recibidos: ${productos?.length || 0}`);
  console.log(`   Total disponibles: ${totalDisponibles}`);
  
  // Formatear lista
  const resultado = formatearListaProductos(productos, {
    inicioNumeracion: 1,  // SIEMPRE inicia en 1 para cada respuesta
    limite: 6
  });
  
  if (!resultado.exito) {
    console.log(`❌ [FORMATTER] No se pudo formatear lista`);
    console.log(`   ================================================\n`);
    return {
      exito: false,
      mensaje: resultado.razon,
      hayMasProductos: false
    };
  }
  
  // Determinar si hay más productos
  const hayMas = totalDisponibles > (paginaActual * 6);
  
  console.log(`✅ [FORMATTER] Lista formateada correctamente`);
  console.log(`   Productos mostrados: ${resultado.productosFormateados}`);
  console.log(`   Hay más productos: ${hayMas}`);
  console.log(`   ================================================\n`);
  
  return {
    exito: true,
    textoFormateado: resultado.textoFormateado,
    productosFormateados: resultado.productosFormateados,
    productosOmitidos: resultado.productosOmitidos,
    hayMasProductos: hayMas,
    paginaActual: paginaActual,
    totalDisponibles: totalDisponibles
  };
}

module.exports = {
  validarProductoParaImpresion,
  formatearProducto,
  formatearListaProductos,
  prepararRespuestaProductos
};