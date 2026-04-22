// src/services/clasificador_service.js
// FASE 1 - Servicio Clasificador de Acciones
// Versión: 1.0

const OpenAI = require('openai');
const {
  buildClasificadorPrompt,
  validarRespuestaClasificador,
  ACCIONES_VALIDAS
} = require('../prompts/clasificador_prompt');

/**
 * Clasificador de intenciones/acciones del usuario
 *
 * Usa gpt-4o-mini para clasificar rápidamente el mensaje
 * del usuario en una categoría de acción.
 */

/**
 * Clasifica la intención del usuario
 *
 * @param {string} mensaje - Mensaje del usuario
 * @param {object} contexto - Contexto actual del usuario
 * @param {string} contexto.carritoId - ID del carrito activo o null
 * @param {string} contexto.folio - Folio del carrito o null
 * @param {object} contexto.ultimaBusqueda - Última búsqueda realizada
 * @param {array} contexto.productos - Productos mostrados recientemente
 * @param {string} apiKey - API key de OpenAI
 * @returns {Promise<object>} - Resultado de clasificación
 */
async function clasificarIntencion(mensaje, contexto, apiKey) {
  const openai = new OpenAI({ apiKey });

  // Construir prompt con contexto
  const prompt = buildClasificadorPrompt(contexto);

  // Log de inicio
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎯 CAPA 1 - CLASIFICADOR DE ACCIÓN`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📝 Mensaje: "${mensaje}"`);
  console.log(`🛒 Carrito activo: ${contexto.carritoId ? 'SÍ (' + contexto.carritoId + ')' : 'NO'}`);
  console.log(`🔍 Última búsqueda: ${(contexto.ultimaBusqueda && contexto.ultimaBusqueda.query) || 'ninguna'}`);
  console.log(`📦 Productos mostrados: ${(contexto.productos && contexto.productos.length) || 0}`);
  console.log(`${'─'.repeat(60)}`);

  const startTime = Date.now();

  try {
    // Incluir último mensaje del asistente para que el clasificador entienda confirmaciones ("si", "ok", etc.)
    const messages = [{ role: "system", content: prompt }];
    if (contexto.historial && contexto.historial.length > 0) {
      const lastAssistant = [...contexto.historial].reverse().find(m => m.role === 'assistant');
      if (lastAssistant) {
        const content = typeof lastAssistant.content === 'string' ? lastAssistant.content : JSON.stringify(lastAssistant.content);
        messages.push({ role: "assistant", content });
      }
    }
    messages.push({ role: "user", content: mensaje });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",  // Modelo rápido y económico
      messages,
      temperature: 0,  // Determinístico para consistencia
      response_format: { type: "json_object" },
      max_tokens: 300
    });

    const tiempoMs = Date.now() - startTime;
    const tokensUsados = (response.usage && response.usage.total_tokens) || 0;

    // Parsear respuesta
    let resultado;
    try {
      resultado = JSON.parse(response.choices[0].message.content);
    } catch (parseError) {
      console.error(`❌ Error parseando respuesta del clasificador:`, parseError.message);
      console.error(`   Respuesta raw:`, response.choices[0].message.content);
      return crearRespuestaFallback(mensaje, 'Error parseando JSON', tiempoMs);
    }

    // Validar respuesta
    if (!validarRespuestaClasificador(resultado)) {
      console.error(`❌ Respuesta del clasificador no válida:`, resultado);
      return crearRespuestaFallback(mensaje, 'Respuesta inválida', tiempoMs);
    }

    // Override programático: en modo vendedor sin cliente asignado, forzar BUSQUEDA_CLIENTE
    if (contexto.modoVendedor === true && contexto.clienteVendedor === false) {
      if (resultado.accion !== 'BUSQUEDA_CLIENTE') {
        console.log(`⚠️  Override clasificador: ${resultado.accion} → BUSQUEDA_CLIENTE (modo vendedor sin cliente)`);
        resultado.accion = 'BUSQUEDA_CLIENTE';
        resultado.parametros = { texto_busqueda: mensaje };
        resultado.razon = '[override] Modo vendedor activo sin cliente asignado';
      }
    }

    // Log de resultado
    console.log(`✅ Acción clasificada: ${resultado.accion}`);
    console.log(`   Sub-acción: ${resultado.sub_accion || 'N/A'}`);
    console.log(`   Confianza: ${(resultado.confianza * 100).toFixed(1)}%`);
    console.log(`   Parámetros: ${JSON.stringify(resultado.parametros || {})}`);
    console.log(`   Razón: ${resultado.razon}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`⏱️  Tiempo: ${tiempoMs}ms | 🔢 Tokens: ${tokensUsados}`);
    console.log(`${'='.repeat(60)}\n`);

    return {
      ...resultado,
      tiempo_ms: tiempoMs,
      tokens_usados: tokensUsados,
      modelo: 'gpt-4o-mini',
      mensaje_original: mensaje
    };

  } catch (error) {
    const tiempoMs = Date.now() - startTime;

    console.error(`❌ Error en clasificador:`, error.message);
    console.log(`${'='.repeat(60)}\n`);

    return crearRespuestaFallback(mensaje, error.message, tiempoMs);
  }
}

/**
 * Crea una respuesta de fallback cuando hay error
 *
 * @param {string} mensaje - Mensaje original
 * @param {string} errorMsg - Mensaje de error
 * @param {number} tiempoMs - Tiempo transcurrido
 * @returns {object} - Respuesta de fallback
 */
function crearRespuestaFallback(mensaje, errorMsg, tiempoMs) {
  // Intentar clasificación básica por palabras clave
  const mensajeLower = mensaje.toLowerCase().trim();

  // Saludos
  if (/^(hola|buenos?\s*(días?|tardes?|noches?)|hey|saludos?|qué\s*tal)/i.test(mensajeLower)) {
    return {
      accion: 'SALUDO',
      sub_accion: 'saludo_inicial',
      confianza: 0.7,
      parametros: {},
      razon: `Fallback: Detectado saludo por keywords (error original: ${errorMsg})`,
      tiempo_ms: tiempoMs,
      es_fallback: true
    };
  }

  // Paginación
  if (/^(hay\s*más|ver\s*más|más|siguiente|otros?)/i.test(mensajeLower)) {
    return {
      accion: 'PAGINACION',
      sub_accion: 'siguiente_pagina',
      confianza: 0.7,
      parametros: {},
      razon: `Fallback: Detectado paginación por keywords (error original: ${errorMsg})`,
      tiempo_ms: tiempoMs,
      es_fallback: true
    };
  }

  // Carrito
  if (/^(ver\s*(mi\s*)?carrito|mi\s*carrito|qué\s*tengo)/i.test(mensajeLower)) {
    return {
      accion: 'CARRITO_CONSULTAR',
      sub_accion: 'ver_carrito',
      confianza: 0.7,
      parametros: {},
      razon: `Fallback: Detectado consulta carrito por keywords (error original: ${errorMsg})`,
      tiempo_ms: tiempoMs,
      es_fallback: true
    };
  }

  // Agregar producto (simple)
  if (/^(agré?galo|ponme|lo\s*quiero|dame)/i.test(mensajeLower)) {
    return {
      accion: 'CARRITO_CREAR',  // Asumimos crear, el router verificará si ya tiene carrito
      sub_accion: 'agregar',
      confianza: 0.6,
      parametros: { cantidad: 1, referencia: 'primero', referencia_idx: 0 },
      razon: `Fallback: Detectado agregar por keywords (error original: ${errorMsg})`,
      tiempo_ms: tiempoMs,
      es_fallback: true
    };
  }

  // Si no podemos clasificar, devolver DESCONOCIDO
  return {
    accion: 'DESCONOCIDO',
    sub_accion: null,
    confianza: 0,
    parametros: {},
    razon: `Error en clasificación: ${errorMsg}`,
    tiempo_ms: tiempoMs,
    es_fallback: true,
    error: errorMsg
  };
}

/**
 * Clasifica múltiples mensajes en batch (útil para testing)
 *
 * @param {array} mensajes - Lista de mensajes a clasificar
 * @param {object} contexto - Contexto del usuario
 * @param {string} apiKey - API key de OpenAI
 * @returns {Promise<array>} - Lista de clasificaciones
 */
async function clasificarBatch(mensajes, contexto, apiKey) {
  const resultados = [];

  for (const mensaje of mensajes) {
    const resultado = await clasificarIntencion(mensaje, contexto, apiKey);
    resultados.push({
      mensaje,
      clasificacion: resultado
    });
  }

  return resultados;
}

/**
 * Verifica si la confianza es suficiente para proceder
 *
 * @param {object} clasificacion - Resultado de clasificación
 * @param {number} umbral - Umbral mínimo de confianza (default: 0.7)
 * @returns {boolean} - true si la confianza es suficiente
 */
function confianzaSuficiente(clasificacion, umbral = 0.7) {
  return clasificacion.confianza >= umbral;
}

/**
 * Determina si se debe usar el prompt completo (fallback)
 * basado en la confianza y otros factores
 *
 * @param {object} clasificacion - Resultado de clasificación
 * @returns {boolean} - true si se debe usar fallback
 */
function requiereFallbackPromptCompleto(clasificacion) {
  // Si es DESCONOCIDO, usar fallback
  if (clasificacion.accion === 'DESCONOCIDO') {
    return true;
  }

  // Si la confianza es muy baja, usar fallback
  if (clasificacion.confianza < 0.5) {
    return true;
  }

  // Si hubo error en el clasificador, usar fallback
  if (clasificacion.es_fallback && clasificacion.error) {
    return true;
  }

  return false;
}

/**
 * Pre-clasificación rápida por keywords.
 * Detecta intenciones obvias SIN llamar a gpt-4o-mini.
 * Retorna null si no hay match (debe ir al clasificador completo).
 *
 * IMPORTANTE: Usa $ anchor para solo matchear mensajes puros.
 * "hola" matchea, pero "hola quiero azucar" NO matchea.
 *
 * @param {string} mensaje - Mensaje del usuario
 * @param {object} contexto - Contexto del clasificador
 * @returns {object|null} - Clasificación o null
 */
function preClasificarPorKeywords(mensaje, contexto) {
  const m = mensaje.toLowerCase().trim();

  // SALUDO puro
  if (/^(hola|buenos?\s*(d[ií]as?|tardes?|noches?)|hey|saludos?|qu[eé]\s*tal|buen\s*d[ií]a)\s*[!.?]*$/i.test(m)) {
    return {
      accion: 'SALUDO', sub_accion: 'saludo_inicial', confianza: 0.95,
      parametros: {}, razon: 'Pre-clasificador: saludo detectado', tiempo_ms: 0, es_preclasificacion: true
    };
  }

  // Despedida / Agradecimiento
  if (/^(gracias|adi[oó]s|hasta\s*(luego|pronto)|chao|bye)\s*[!.?]*$/i.test(m)) {
    return {
      accion: 'SALUDO', sub_accion: 'despedida', confianza: 0.90,
      parametros: {}, razon: 'Pre-clasificador: despedida', tiempo_ms: 0, es_preclasificacion: true
    };
  }

  // PAGINACION (solo si hay búsqueda activa)
  if (contexto.ultimaBusqueda && /^(hay\s*m[aá]s|ver\s*m[aá]s|m[aá]s|siguiente|otros?|m[aá]s\s*opciones?)\s*[?!.]*$/i.test(m)) {
    return {
      accion: 'PAGINACION', sub_accion: 'siguiente_pagina', confianza: 0.95,
      parametros: {}, razon: 'Pre-clasificador: paginacion con busqueda activa', tiempo_ms: 0, es_preclasificacion: true
    };
  }

  // REINICIAR
  if (/^(reinici(ar|ate|a)|reset|borrar\s*conversaci[oó]n|empezar\s*de\s*nuevo)\s*[!.?]*$/i.test(m)) {
    return {
      accion: 'REINICIAR', sub_accion: null, confianza: 0.99,
      parametros: {}, razon: 'Pre-clasificador: reiniciar', tiempo_ms: 0, es_preclasificacion: true
    };
  }

  // CARRITO_CONSULTAR puro
  if (/^(ver\s*(mi\s*)?carrito|mi\s*carrito|qu[eé]\s*tengo|mu[eé]strame\s*(mi\s*)?(carrito|pedido))\s*[?!.]*$/i.test(m)) {
    return {
      accion: 'CARRITO_CONSULTAR', sub_accion: 'ver_carrito', confianza: 0.90,
      parametros: {}, razon: 'Pre-clasificador: consulta carrito', tiempo_ms: 0, es_preclasificacion: true
    };
  }

  return null;
}

module.exports = {
  clasificarIntencion,
  clasificarBatch,
  confianzaSuficiente,
  requiereFallbackPromptCompleto,
  crearRespuestaFallback,
  preClasificarPorKeywords,
  ACCIONES_VALIDAS
};
