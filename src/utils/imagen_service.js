// src/utils/imagen_service.js
// Procesamiento de imágenes y archivos Excel con listas de compras

const { buscarProductos, agregarVariosArticulosAlCarrito, crearNuevoCarritoConVariosArticulos } = require('./crm');
const { resolverCanonico } = require('./canonicalizacion_service');
const { ordenarPorRelevancia } = require('./relevancia');
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

const PROMPT_EXTRACCION = `Eres un extractor de términos de búsqueda para un catálogo de papelería y abarrotes.

Recibes un JSON array de descripciones de productos escritas en lenguaje natural
(vienen de una lista de compras). Para CADA una devuelve:
- sustantivo: el PRODUCTO base. UNA sola palabra, en SINGULAR, sin marca, sin medida,
  sin color y sin adjetivos. Es lo que el producto ES, no cómo es.
- filtros: { marca, tipo, medida, caracteristicas } — arrays de strings en MAYÚSCULAS,
  vacíos si no aplica.

Reglas:
- Ignora cantidades y numeración ("2 cuadernos" → sustantivo "cuaderno").
- El texto entre paréntesis suele ser una aclaración del cliente: ignóralo salvo que
  contenga una característica real del producto.
- Si no logras identificar un producto, usa sustantivo: null.
- Responde ÚNICAMENTE con un JSON array válido, sin markdown, del MISMO tamaño y en el
  MISMO orden que la entrada.

Ejemplo de entrada:
["Pegamento en barra","Tijeras punta roma","2 Cuadernos de raya cosido color azul","Hojas blancas"]

Ejemplo de salida:
[{"sustantivo":"pegamento","filtros":{"marca":[],"tipo":["BARRA"],"medida":[],"caracteristicas":[]}},
{"sustantivo":"tijera","filtros":{"marca":[],"tipo":["PUNTA ROMA"],"medida":[],"caracteristicas":[]}},
{"sustantivo":"cuaderno","filtros":{"marca":[],"tipo":["COSIDO"],"medida":[],"caracteristicas":["RAYA","AZUL"]}},
{"sustantivo":"hoja","filtros":{"marca":[],"tipo":[],"medida":[],"caracteristicas":["BLANCA"]}}]`;

function filtrosVaciosNuevos() {
  return { marca: [], medida: [], caracteristicas: [], tipo: [], compatibilidad: [] };
}

function normalizarFiltrosExtraidos(filtros) {
  const base = filtrosVaciosNuevos();
  if (!filtros || typeof filtros !== 'object') return base;
  ['marca', 'medida', 'caracteristicas', 'tipo', 'compatibilidad'].forEach(function (campo) {
    const valores = filtros[campo];
    if (Array.isArray(valores)) {
      base[campo] = valores
        .filter(function (v) { return typeof v === 'string' && v.trim(); })
        .map(function (v) { return v.trim().toUpperCase(); });
    }
  });
  return base;
}

/**
 * Extrae sustantivo + filtros de una lista de descripciones en UNA sola llamada.
 *
 * Por qué existe: el CRM compara `lower(A.NOMBRE) SIMILAR TO 'texto%'`, así que mandar
 * la descripción completa ("Pegamento en barra") no encuentra nada -- el catálogo dice
 * "PEGAMENTO BARRA 21 GR PRITT". El flujo de texto normal ya parte la frase en
 * sustantivo + filtros vía GPT; aquí se hace lo mismo para imagen y Excel.
 *
 * Fail-open: si la extracción falla, se devuelve null por ítem y el llamador usa la
 * descripción cruda (comportamiento anterior).
 *
 * @param {Array<string>} descripciones
 * @param {object} openai - Instancia de OpenAI ya inicializada
 * @returns {Promise<Array<{sustantivo: string|null, filtros: object}|null>>}
 */
async function extraerTerminosBusqueda(descripciones, openai) {
  const vacio = descripciones.map(function () { return null; });
  if (!openai || descripciones.length === 0) return vacio;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: PROMPT_EXTRACCION },
        { role: 'user', content: JSON.stringify(descripciones) }
      ],
      max_tokens: 2000,
      temperature: 0
    });

    const raw = response.choices[0].message.content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Respuesta no es un array');
    if (parsed.length !== descripciones.length) {
      throw new Error(`Tamaño no coincide: esperaba ${descripciones.length}, llegaron ${parsed.length}`);
    }

    return parsed.map(function (e) {
      const sustantivo = (e && typeof e.sustantivo === 'string' && e.sustantivo.trim())
        ? e.sustantivo.trim()
        : null;
      return { sustantivo: sustantivo, filtros: normalizarFiltrosExtraidos(e && e.filtros) };
    });
  } catch (error) {
    console.error('❌ Extracción de términos falló (fail-open, se usará la descripción cruda):', error.message);
    return vacio;
  }
}

/**
 * Canoniza el sustantivo ya extraído (plural→singular y sinónimos de BD).
 * Sólo tiene sentido sobre un token suelto: `normalizarSingular` trata el string
 * completo como una palabra, así que aplicarlo a una frase la deja peor
 * ("Hojas blancas" → "hojas blanca").
 */
async function canonizarSustantivo(sustantivo, accountId) {
  if (!sustantivo) return sustantivo;
  try {
    const canon = await Promise.race([
      resolverCanonico(sustantivo, accountId),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('Timeout canonizacion')); }, 2000);
      })
    ]);
    if (canon && canon.token_final && canon.token_final !== sustantivo) {
      console.log(`🔄 Canonización: "${sustantivo}" → "${canon.token_final}"`);
      return canon.token_final;
    }
  } catch (error) {
    console.warn(`⚠️ Canonización falló (fail-open): ${error.message}`);
  }
  return sustantivo;
}

/**
 * Busca cada ítem de la lista en el catálogo.
 * Usada por el flujo de imagen y el de Excel.
 *
 * @param {Array} items - [{ clave, descripcion, cantidad }]
 * @param {object} openai - Instancia de OpenAI (opcional; sin ella se omite la extracción)
 * @param {number} accountId - Para la canonización por cuenta
 * @returns {Promise<{ encontrados, noEncontrados }>}
 */
async function buscarItemsLista(items, openai, accountId) {
  const encontrados = [];
  const noEncontrados = [];

  // Extracción en lote: una sola llamada para toda la lista, no una por ítem
  const descripciones = items.map(function (i) { return i.descripcion || ''; });
  const terminos = await extraerTerminosBusqueda(descripciones, openai);

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    try {
      let resultado;
      let sustantivoUsado = null;
      let filtrosUsados = filtrosVaciosNuevos();

      if (item.clave) {
        console.log('🔑 Buscando por clave:', item.clave);
        resultado = await buscarProductos(null, null, null, null, 1, 10, filtrosVaciosNuevos(), item.clave);
      }

      const claveSinResultado = !resultado || !resultado.success || !resultado.data || resultado.data.length === 0;

      if (claveSinResultado && item.descripcion) {
        if (item.clave) console.log('🔍 Clave no encontrada, intentando por descripción');

        const extraido = terminos[idx];
        if (extraido && extraido.sustantivo) {
          sustantivoUsado = await canonizarSustantivo(extraido.sustantivo, accountId);
          filtrosUsados = extraido.filtros;
        } else {
          // Fail-open: sin extracción se conserva el comportamiento anterior
          sustantivoUsado = item.descripcion;
        }

        console.log(`🔍 Buscando: "${item.descripcion}" → query="${sustantivoUsado}" filtros=${JSON.stringify(filtrosUsados)}`);
        resultado = await buscarProductos(sustantivoUsado, null, null, null, 1, 100, filtrosUsados);
      }

      if (resultado && resultado.success && resultado.data && resultado.data.length > 0) {
        // Elegir por relevancia, no el primero alfabético
        const ordenados = ordenarPorRelevancia(resultado.data, sustantivoUsado, filtrosUsados);
        const mejor = ordenados[0];
        encontrados.push({ itemOriginal: item, producto: mejor });
        console.log('✅ Encontrado:', item.descripcion || item.clave, '→', mejor.NOMBRE);
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
  return /\.(xlsx|xls|csv)/i.test(dataUrl);
}

/**
 * Detecta si un attachment de Chatwoot es un audio (mensaje de voz).
 */
function esAudioAdjunto(attachment) {
  if (!attachment) return false;
  const fileType = (attachment.file_type || '').toLowerCase();
  const contentType = (attachment.content_type || '').toLowerCase();
  const dataUrl = (attachment.data_url || attachment.file_url || '').toLowerCase();
  if (fileType === 'audio' || contentType.startsWith('audio/')) return true;
  return /\.(ogg|mp3|m4a|wav|webm|oga|opus)(\?|$)/i.test(dataUrl);
}

/**
 * Descarga un archivo desde una URL siguiendo redirects y retorna el buffer.
 */
function descargarArchivo(url, maxRedirects) {
  maxRedirects = maxRedirects === undefined ? 5 : maxRedirects;
  return new Promise(function(resolve, reject) {
    const client = url.startsWith('https') ? https : http;
    client.get(url, function(res) {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
        if (maxRedirects === 0) return reject(new Error('Demasiados redirects'));
        return resolve(descargarArchivo(res.headers.location, maxRedirects - 1));
      }
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
  if (/^clave|^(id|codigo|c[oó]digo|sku|art[ií]culo|articulo)$/.test(h)) return 'clave';
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
  extraerTerminosBusqueda,
  buscarItemsLista,
  agregarEncontradosAlCarrito,
  formatearRespuestaImagen,
  mensajePideCarrito,
  esImagenAdjunta,
  esExcelAdjunto,
  esAudioAdjunto,
  descargarArchivo
};
