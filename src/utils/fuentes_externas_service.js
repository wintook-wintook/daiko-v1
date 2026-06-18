// src/utils/fuentes_externas_service.js
// MODO_REFACCIONES - Búsqueda de número de parte en fuentes externas autorizadas
// V1: validado con Apymsa; Rolcar agregado tras confirmar resultados reales.
//
// Diseño en 2 pasos para evitar que el modelo invente un número de parte:
//   Paso A: búsqueda real (Responses API + tool web_search, texto libre).
//           Aquí SÍ vienen citas (url_citation) -> evidencia de navegación real.
//   Paso B: extracción a JSON estructurado (chat.completions, sin tools).
//           Se exige que la url_fuente devuelta sea EXACTAMENTE una de las
//           citas reales obtenidas en el Paso A; si no coincide, se descarta.

const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_APIKEY });

// Orden = prioridad de consulta. Para activar Rolcar/Morsa más adelante basta
// con agregar la entrada aquí (o migrar esta lista a una tabla administrable).
const FUENTES_AUTORIZADAS = [
  { nombre: 'Apymsa', dominio: 'apymsa.com.mx', activo: true },
  { nombre: 'Rolcar', dominio: 'rolcar.com', activo: true }
];

const SCHEMA_EXTRACCION = {
  type: 'object',
  properties: {
    resultado: { type: 'string', enum: ['ENCONTRADO_EN_FUENTE', 'NO_ENCONTRADO_EN_FUENTE'] },
    numero_parte: { type: ['string', 'null'] },
    marca: { type: ['string', 'null'] },
    url_fuente: { type: ['string', 'null'] },
    referencias: { type: 'array', items: { type: 'string' } }
  },
  required: ['resultado', 'numero_parte', 'marca', 'url_fuente', 'referencias'],
  additionalProperties: false
};

function describirVehiculo(vehiculo) {
  if (!vehiculo) return '';
  return [vehiculo.marca, vehiculo.modelo, vehiculo.anio, vehiculo.motor]
    .filter(Boolean)
    .join(' ');
}

/**
 * PASO A: búsqueda real en un dominio autorizado vía web_search.
 * Devuelve el texto de respuesta y las URLs citadas que pertenecen a ese dominio.
 */
async function buscarConWebSearch(producto, vehiculo, fuente) {
  const descripcionVehiculo = describirVehiculo(vehiculo);

  const input = `Busca exclusivamente en el sitio ${fuente.dominio} (usa site:${fuente.dominio} en tu búsqueda) ` +
    `una refacción para: "${producto}"` +
    (descripcionVehiculo ? ` aplicable a: ${descripcionVehiculo}.` : '.') +
    ' Estas páginas de producto suelen mostrar un "Código" propio del catálogo del sitio (la clave interna que ' +
    'ellos usan para identificar el producto) Y, por separado, varias referencias cruzadas de fabricante ' +
    '(por ejemplo Hitachi, Bosch, Lester, WAI, número OEM del fabricante del vehículo, etc.). ' +
    'Necesito específicamente el "Código" propio del sitio — indícalo de forma explícita y por separado, ' +
    'por ejemplo: "Código del sitio: XXXXXXX". Después, lista aparte cualquier referencia cruzada de fabricante ' +
    'que encuentres, dejando claro que NO son el código del sitio. ' +
    'No uses información de otros sitios ni de tu conocimiento general. ' +
    'Si no encuentras una página de producto clara en ese sitio, o no logras identificar cuál es el "Código" propio ' +
    'del sitio (solo referencias de fabricante), dilo explícitamente.';

  const response = await openai.responses.create({
    model: 'gpt-4o',
    tools: [{ type: 'web_search' }],
    input
  });

  const textoBusqueda = response.output_text || '';
  const citasReales = [];

  for (const item of response.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      for (const ann of content.annotations || []) {
        if (ann.type === 'url_citation' && ann.url) {
          citasReales.push(ann.url);
        }
      }
    }
  }

  const citasDelDominio = citasReales.filter((url) => url.includes(fuente.dominio));

  return { textoBusqueda, citasDelDominio };
}

/**
 * PASO B: extrae JSON estructurado del texto del Paso A, validando la URL
 * contra la lista real de citas obtenidas (no se confía en la palabra del modelo).
 */
async function extraerNumeroParte(textoBusqueda, citasDelDominio) {
  const respuesta = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'resultado_fuente_externa', schema: SCHEMA_EXTRACCION, strict: true }
    },
    messages: [
      {
        role: 'system',
        content: 'Extrae el número de parte del siguiente texto de búsqueda. ' +
          'IMPORTANTE: "numero_parte" debe ser específicamente el "Código" PROPIO del sitio fuente (su clave interna de catálogo, ' +
          'normalmente mencionado como "Código:" o "Código del sitio:" en el texto). ' +
          'NUNCA pongas en "numero_parte" un número de referencia de fabricante (Hitachi, Bosch, Lester, WAI, número OEM del vehículo, etc.), ' +
          'aunque aparezca primero, se repita varias veces o parezca más relevante — esos van únicamente en el arreglo "referencias". ' +
          'Si el texto no distingue con claridad cuál es el "Código" propio del sitio (por ejemplo, solo menciona referencias de fabricante), ' +
          'responde resultado=NO_ENCONTRADO_EN_FUENTE con los demás campos en null, en vez de adivinar cuál usar. ' +
          `La "url_fuente" que regreses DEBE ser EXACTAMENTE una de estas URLs, copiada tal cual: ${JSON.stringify(citasDelDominio)}. ` +
          'No modifiques, abrevies ni completes el número de parte.'
      },
      { role: 'user', content: textoBusqueda }
    ]
  });

  return JSON.parse(respuesta.choices[0].message.content);
}

/**
 * Busca un número de parte en UNA fuente autorizada específica.
 */
async function buscarEnFuente(producto, vehiculo, fuente) {
  let textoBusqueda, citasDelDominio;

  try {
    ({ textoBusqueda, citasDelDominio } = await buscarConWebSearch(producto, vehiculo, fuente));
  } catch (error) {
    console.error(`❌ MODO_REFACCIONES - error consultando ${fuente.nombre}:`, error.message);
    return { resultado: 'FUENTE_NO_DISPONIBLE', fuente: fuente.nombre, motivo: error.message };
  }

  // Sin evidencia de navegación real a este dominio -> no hay nada que validar
  if (citasDelDominio.length === 0) {
    return { resultado: 'NO_ENCONTRADO_EN_FUENTE', fuente: fuente.nombre };
  }

  let extraccion;
  try {
    extraccion = await extraerNumeroParte(textoBusqueda, citasDelDominio);
  } catch (error) {
    console.error(`❌ MODO_REFACCIONES - error extrayendo resultado de ${fuente.nombre}:`, error.message);
    return { resultado: 'FUENTE_NO_DISPONIBLE', fuente: fuente.nombre, motivo: error.message };
  }

  // Validación dura: la URL declarada debe estar en la lista de citas reales
  const urlValida = extraccion.url_fuente && citasDelDominio.includes(extraccion.url_fuente);

  if (extraccion.resultado !== 'ENCONTRADO_EN_FUENTE' || !urlValida || !extraccion.numero_parte) {
    return { resultado: 'NO_ENCONTRADO_EN_FUENTE', fuente: fuente.nombre };
  }

  return {
    resultado: 'ENCONTRADO_EN_FUENTE',
    fuente: fuente.nombre,
    fuente_tipo: 'FUENTE_EXTERNA_AUTORIZADA',
    numero_parte: extraccion.numero_parte,
    marca: extraccion.marca || null,
    url_fuente: extraccion.url_fuente,
    referencias: extraccion.referencias || []
  };
}

/**
 * Busca el número de parte de una refacción en las fuentes externas autorizadas,
 * en orden de prioridad (FUENTES_AUTORIZADAS). Se detiene en la primera fuente
 * donde encuentra un resultado verificado.
 *
 * @param {string} producto - ej. "alternador"
 * @param {{marca?:string, modelo?:string, anio?:string, motor?:string}} vehiculo
 * @returns {Promise<object>}
 */
async function buscarNumeroParteExterno(producto, vehiculo) {
  const fuentesActivas = FUENTES_AUTORIZADAS.filter((f) => f.activo);
  const intentos = [];

  for (const fuente of fuentesActivas) {
    console.log(`🔎 MODO_REFACCIONES - buscando en fuente externa: ${fuente.nombre}`);
    const resultado = await buscarEnFuente(producto, vehiculo, fuente);
    if (resultado.resultado === 'ENCONTRADO_EN_FUENTE') {
      return resultado;
    }
    intentos.push({ fuente: fuente.nombre, resultado: resultado.resultado });
  }

  return {
    resultado: 'NO_ENCONTRADO_EN_FUENTE',
    fuentes_consultadas: intentos
  };
}

module.exports = {
  buscarNumeroParteExterno,
  FUENTES_AUTORIZADAS
};
