// src/utils/imagen_service.js
// Procesamiento de imágenes con listas de compras via GPT-4o Vision

const { buscarProductos, agregarVariosArticulosAlCarrito, crearNuevoCarritoConVariosArticulos } = require('./crm');

const PROMPT_OCR = `Eres un asistente OCR especializado en listas de compras.
Analiza la imagen y extrae todos los productos listados.
Para cada producto devuelve un objeto con:
- clave: código o ID del producto si es visible (string o null si no hay)
- descripcion: nombre o descripción del producto (string)
- cantidad: cantidad solicitada (número, 1 si no se especifica)

Responde ÚNICAMENTE con un JSON array válido, sin texto adicional, sin markdown.
Ejemplo: [{"clave":"ABC123","descripcion":"Azúcar morena","cantidad":2},{"clave":null,"descripcion":"Leche entera","cantidad":1}]`;

/**
 * Extrae la lista de productos de una imagen usando GPT-4o Vision.
 * @param {string} imageUrl - URL pública de la imagen
 * @param {object} openai - Instancia de OpenAI ya inicializada
 * @returns {Promise<Array>} - Array de { clave, descripcion, cantidad }
 */
async function extraerListaDeImagen(imageUrl, openai) {
  console.log('🖼️  OCR imagen:', imageUrl);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: PROMPT_OCR }
        ]
      }
    ],
    max_tokens: 1000,
    temperature: 0
  });

  const raw = response.choices[0].message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  console.log('📝 OCR resultado raw:', raw);

  try {
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error('Respuesta no es un array');
    return items;
  } catch (e) {
    console.error('❌ Error parseando OCR:', e.message, 'Raw:', raw);
    return [];
  }
}

/**
 * Busca cada ítem de la lista en el catálogo.
 * @param {Array} items - [{ clave, descripcion, cantidad }]
 * @returns {Promise<{ encontrados, noEncontrados }>}
 */
async function buscarItemsLista(items) {
  const encontrados = [];
  const noEncontrados = [];
  const filtrosVacios = { marca: [], medida: [], caracteristicas: [], tipo: [], compatibilidad: [] };

  for (const item of items) {
    try {
      let resultado;
      if (item.clave) {
        console.log('🔑 Buscando por clave:', item.clave);
        resultado = await buscarProductos(null, null, null, null, 1, 10, filtrosVacios, item.clave);
      } else {
        console.log('🔍 Buscando por descripción:', item.descripcion);
        resultado = await buscarProductos(item.descripcion, null, null, null, 1, 10, filtrosVacios);
      }

      if (resultado && resultado.success && resultado.data && resultado.data.length > 0) {
        encontrados.push({ itemOriginal: item, producto: resultado.data[0] });
        console.log('✅ Encontrado:', item.descripcion || item.clave, '→', resultado.data[0].NOMBRE);
      } else {
        noEncontrados.push(item);
        console.log('❌ No encontrado:', item.descripcion || item.clave);
      }
    } catch (error) {
      console.error('❌ Error buscando', item.descripcion || item.clave, ':', error.message);
      noEncontrados.push(item);
    }
  }

  return { encontrados, noEncontrados };
}

/**
 * Agrega los productos encontrados al carrito (nuevo o existente).
 * Solo llamar cuando noEncontrados.length === 0.
 * @param {Array} encontrados - [{ itemOriginal, producto }]
 * @param {string|null} carritoId - ID del carrito activo o null
 * @returns {Promise<object>}
 */
async function agregarEncontradosAlCarrito(encontrados, carritoId) {
  const productos = encontrados.map(function(e) {
    return {
      articulo_id: e.producto.ARTICULO_ID,
      unidades: e.itemOriginal.cantidad || 1
    };
  });

  if (carritoId) {
    console.log('🛒 Agregando', productos.length, 'productos al carrito existente', carritoId);
    return agregarVariosArticulosAlCarrito(carritoId, productos);
  } else {
    console.log('🛒 Creando nuevo carrito con', productos.length, 'productos');
    return crearNuevoCarritoConVariosArticulos(productos);
  }
}

/**
 * Formatea la respuesta final para el usuario.
 * @param {Array} encontrados
 * @param {Array} noEncontrados
 * @param {object|null} resultadoCarrito - null si no se intentó agregar al carrito
 * @param {boolean} pediaCarrito - si el mensaje original pedía agregar al carrito
 */
function formatearRespuestaImagen(encontrados, noEncontrados, resultadoCarrito, pediaCarrito) {
  const lineas = [];

  if (encontrados.length > 0) {
    lineas.push('Productos encontrados:');
    encontrados.forEach(function(e, i) {
      const nombre = e.producto.NOMBRE || e.producto.DESCRIPCION || 'Sin nombre';
      const precio = e.producto.PRECIO !== undefined && e.producto.PRECIO !== null
        ? ' | Precio: $' + e.producto.PRECIO
        : '';
      const cantidad = e.itemOriginal.cantidad || 1;
      lineas.push((i + 1) + ') ID: ' + e.producto.ARTICULO_ID + ' - ' + nombre + precio + ' | Cant: ' + cantidad);
    });
  }

  if (noEncontrados.length > 0) {
    lineas.push('');
    lineas.push('Productos no encontrados:');
    noEncontrados.forEach(function(item, i) {
      const desc = item.clave
        ? (item.clave + (item.descripcion ? ' - ' + item.descripcion : ''))
        : item.descripcion;
      lineas.push((i + 1) + ') ' + desc);
    });
  }

  if (resultadoCarrito) {
    lineas.push('');
    if (resultadoCarrito.success) {
      lineas.push('Productos agregados al carrito correctamente.');
    } else {
      lineas.push('No fue posible agregar los productos al carrito: ' + (resultadoCarrito.message || 'error desconocido'));
    }
  } else if (pediaCarrito && noEncontrados.length > 0) {
    lineas.push('');
    lineas.push('No se agregó ningún producto al carrito porque algunos artículos no fueron encontrados.');
    lineas.push('¿Deseas continuar solo con los productos encontrados, o prefieres que busquemos los faltantes primero?');
  } else if (!pediaCarrito && encontrados.length > 0) {
    lineas.push('');
    lineas.push('¿Deseas agregar estos productos al carrito?');
  }

  return lineas.join('\n');
}

/**
 * Detecta si el mensaje de texto acompañante pide agregar al carrito.
 */
function mensajePideCarrito(texto) {
  if (!texto) return false;
  return /agrega|agreg|carrito|añade|a[ñn]ade|ponme|ponlos|s[uú]belos/i.test(texto);
}

/**
 * Detecta si un attachment de Chatwoot es una imagen.
 */
function esImagenAdjunta(attachment) {
  if (!attachment) return false;
  const fileType = attachment.file_type || '';
  const contentType = attachment.content_type || '';
  return fileType === 'image' || contentType.startsWith('image/');
}

module.exports = {
  extraerListaDeImagen,
  buscarItemsLista,
  agregarEncontradosAlCarrito,
  formatearRespuestaImagen,
  mensajePideCarrito,
  esImagenAdjunta
};
