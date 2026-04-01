// src/utils/imagen_service.js
// Procesamiento de imágenes y archivos Excel con listas de compras

const { buscarProductos, agregarVariosArticulosAlCarrito, crearNuevoCarritoConVariosArticulos } = require('./crm');
const XLSX = require('xlsx');
const https = require('https');
const http = require('http');

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
      if (noEncontrados.length > 0) {
        lineas.push('Los productos encontrados fueron agregados al carrito.');
        lineas.push('');
        lineas.push('¿Deseas agregar los productos no encontrados como nota al carrito? (sí/no)');
      } else {
        lineas.push('Productos agregados al carrito correctamente.');
      }
    } else {
      lineas.push('No fue posible agregar los productos al carrito: ' + (resultadoCarrito.message || 'error desconocido'));
    }
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

/**
 * Detecta si un attachment de Chatwoot es un archivo Excel o CSV.
 */
function esExcelAdjunto(attachment) {
  if (!attachment) return false;
  const contentType = (attachment.content_type || '').toLowerCase();
  const dataUrl = (attachment.data_url || attachment.file_url || '').toLowerCase();
  const excelTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv'
  ];
  if (excelTypes.includes(contentType)) return true;
  return /\.(xlsx|xls|csv)$/.test(dataUrl);
}

/**
 * Descarga un archivo desde una URL y retorna el buffer.
 */
function descargarArchivo(url) {
  return new Promise(function(resolve, reject) {
    const client = url.startsWith('https') ? https : http;
    client.get(url, function(res) {
      const chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() { resolve(Buffer.concat(chunks)); });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Normaliza el nombre de una columna para detectar clave, nombre o cantidad.
 */
function detectarTipoColumna(header) {
  const h = (header || '').toString().toLowerCase().trim();
  if (/^(clave|id|codigo|c[oó]digo|sku|art[ií]culo|articulo)$/.test(h)) return 'clave';
  if (/^(nombre|descripci[oó]n|descripcion|producto|name|desc)$/.test(h)) return 'nombre';
  if (/^(cantidad|qty|piezas|unidades|cant|q)$/.test(h)) return 'cantidad';
  return null;
}

/**
 * Extrae la lista de productos de un archivo Excel o CSV.
 * @param {string} fileUrl - URL del archivo
 * @returns {Promise<Array>} - Array de { clave, descripcion, cantidad }
 */
async function extraerListaDeExcel(fileUrl) {
  console.log('📊 Parseando Excel:', fileUrl);
  const buffer = await descargarArchivo(fileUrl);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) return [];

  // Detectar columnas por header
  const headers = rows[0];
  const colMap = { clave: -1, nombre: -1, cantidad: -1 };
  headers.forEach(function(h, i) {
    const tipo = detectarTipoColumna(h);
    if (tipo && colMap[tipo] === -1) colMap[tipo] = i;
  });

  console.log('📋 Mapa de columnas detectado:', colMap);

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const clave = colMap.clave >= 0 ? (row[colMap.clave] || '').toString().trim() : null;
    const nombre = colMap.nombre >= 0 ? (row[colMap.nombre] || '').toString().trim() : null;
    const cantRaw = colMap.cantidad >= 0 ? row[colMap.cantidad] : null;
    const cantidad = cantRaw ? parseInt(cantRaw, 10) || 1 : 1;

    // Ignorar filas vacías
    if (!clave && !nombre) continue;

    items.push({
      clave: clave || null,
      descripcion: nombre || null,
      cantidad
    });
  }

  console.log('📝 Items extraídos de Excel:', items.length);
  return items;
}

module.exports = {
  extraerListaDeImagen,
  extraerListaDeExcel,
  buscarItemsLista,
  agregarEncontradosAlCarrito,
  formatearRespuestaImagen,
  mensajePideCarrito,
  esImagenAdjunta,
  esExcelAdjunto
};
