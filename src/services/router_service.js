// src/services/router_service.js
// FASE 2 - Servicio Router
// Versión: 1.0

/**
 * Servicio que enruta solicitudes al prompt y tools correctos
 * según la acción clasificada.
 */

const { buildSaludoPrompt, SALUDO_TOOLS } = require('../prompts/saludo_prompt');
const { buildBusquedaPrompt, BUSQUEDA_TOOLS } = require('../prompts/busqueda_prompt');
const { buildCategoriaPrompt, CATEGORIA_TOOLS } = require('../prompts/categoria_prompt');
const {
  buildCarritoPrompt,
  CARRITO_CREAR_TOOLS,
  CARRITO_MODIFICAR_TOOLS,
  CARRITO_CONSULTAR_TOOLS,
  CARRITO_CANCELAR_TOOLS
} = require('../prompts/carrito_prompt');
const { buildOrdenPrompt, ORDEN_TOOLS } = require('../prompts/orden_prompt');
const { buildNecesidadPrompt, NECESIDAD_TOOLS } = require('../prompts/necesidad_prompt');
const { buildAtributoPrompt, CONSULTAR_ATRIBUTO_TOOLS } = require('../prompts/atributo_prompt');

/**
 * Configuración de cada acción
 */
const ACCION_CONFIG = {
  'SALUDO': {
    buildPrompt: buildSaludoPrompt,
    tools: SALUDO_TOOLS,
    requiereTools: false,  // Solo genera texto
    descripcion: 'Responder saludo'
  },

  'BUSQUEDA_PRODUCTO': {
    buildPrompt: buildBusquedaPrompt,
    tools: BUSQUEDA_TOOLS,
    requiereTools: true,
    descripcion: 'Buscar productos en catálogo'
  },

  'BUSQUEDA_CATEGORIA': {
    buildPrompt: buildCategoriaPrompt,
    tools: CATEGORIA_TOOLS,
    requiereTools: true,
    descripcion: 'Explorar categorías del catálogo'
  },

  'CARRITO_CREAR': {
    buildPrompt: buildCarritoPrompt,
    tools: CARRITO_CREAR_TOOLS,
    requiereTools: true,
    descripcion: 'Crear carrito nuevo'
  },

  'CARRITO_MODIFICAR': {
    buildPrompt: buildCarritoPrompt,
    tools: CARRITO_MODIFICAR_TOOLS,
    requiereTools: true,
    descripcion: 'Modificar carrito existente'
  },

  'CARRITO_CONSULTAR': {
    buildPrompt: buildCarritoPrompt,
    tools: CARRITO_CONSULTAR_TOOLS,
    requiereTools: true,
    descripcion: 'Consultar carrito'
  },

  'CARRITO_CANCELAR': {
    buildPrompt: buildCarritoPrompt,
    tools: CARRITO_CANCELAR_TOOLS,
    requiereTools: true,
    descripcion: 'Cancelar carrito'
  },

  'ORDEN': {
    buildPrompt: buildOrdenPrompt,
    tools: ORDEN_TOOLS,
    requiereTools: true,
    descripcion: 'Gestionar órdenes y documentos'
  },

  'PAGINACION': {
    buildPrompt: buildBusquedaPrompt,  // Usa el mismo prompt de búsqueda
    tools: ['tienes_mas'],
    requiereTools: true,
    descripcion: 'Ver más resultados'
  },

  'NECESIDAD': {
    buildPrompt: buildNecesidadPrompt,
    tools: NECESIDAD_TOOLS,
    requiereTools: true,
    descripcion: 'Buscar por necesidad'
  },

  'CONSULTA_ATRIBUTO': {
    buildPrompt: buildAtributoPrompt,
    tools: CONSULTAR_ATRIBUTO_TOOLS,
    requiereTools: true,
    descripcion: 'Consultar valores únicos de atributo de producto'
  },

  'CONVERSACION': {
    buildPrompt: buildSaludoPrompt,  // Usa saludo para conversación general
    tools: [],
    requiereTools: false,
    descripcion: 'Conversación general'
  },

  'REINICIAR': {
    buildPrompt: buildSaludoPrompt,
    tools: ['reiniciar'],
    requiereTools: true,
    descripcion: 'Reiniciar conversación'
  },

  'DESCONOCIDO': {
    buildPrompt: null,  // Usa prompt completo
    tools: null,        // Todas las tools
    requiereTools: true,
    descripcion: 'Acción no clasificada - usar fallback'
  }
};

/**
 * Enruta la solicitud al prompt y tools correctos
 *
 * @param {object} clasificacion - Resultado del clasificador
 * @param {object} contexto - Contexto completo del usuario
 * @returns {object} - { prompt, tools, config }
 */
function enrutarSolicitud(clasificacion, contexto) {
  const { accion, sub_accion, parametros } = clasificacion;

  console.log('\n' + '='.repeat(60));
  console.log('🔀 CAPA 2 - ROUTER');
  console.log('='.repeat(60));
  console.log('   Acción: ' + accion);
  console.log('   Sub-acción: ' + (sub_accion || 'N/A'));

  // Obtener configuración
  const config = ACCION_CONFIG[accion];

  if (!config) {
    console.log('   ⚠️ Acción no reconocida: ' + accion);
    console.log('   → Usando fallback (prompt completo)');
    console.log('='.repeat(60) + '\n');

    return {
      prompt: null,
      tools: null,
      usarFallback: true,
      accion: accion,
      config: ACCION_CONFIG['DESCONOCIDO']
    };
  }

  // Construir contexto enriquecido para el prompt
  const contextoEnriquecido = {
    ...contexto,
    sub_accion: sub_accion,
    parametros: parametros,
    operacion: sub_accion
  };

  // Construir prompt especializado
  let promptEspecializado = null;
  if (config.buildPrompt) {
    promptEspecializado = config.buildPrompt(contextoEnriquecido);
  }

  console.log('   📝 Prompt: ' + (config.buildPrompt ? config.buildPrompt.name : 'fallback'));
  console.log('   🛠️ Tools: [' + (config.tools ? config.tools.join(', ') : 'todas') + ']');
  console.log('   📋 Descripción: ' + config.descripcion);
  console.log('='.repeat(60) + '\n');

  return {
    prompt: promptEspecializado,
    tools: config.tools,
    usarFallback: !config.buildPrompt,
    requiereTools: config.requiereTools,
    accion: accion,
    sub_accion: sub_accion,
    config: config
  };
}

/**
 * Filtra las definiciones de tools según las permitidas
 *
 * @param {array} toolsPermitidas - Lista de nombres de tools permitidas
 * @param {array} todasLasTools - Todas las definiciones de tools
 * @returns {array} - Tools filtradas
 */
function filtrarTools(toolsPermitidas, todasLasTools) {
  if (toolsPermitidas === null || toolsPermitidas === undefined) {
    return todasLasTools;
  }
  if (toolsPermitidas.length === 0) {
    return [];
  }

  return todasLasTools.filter(function(tool) {
    return toolsPermitidas.includes(tool.function.name);
  });
}

/**
 * Verifica si una acción requiere tools
 *
 * @param {string} accion - Nombre de la acción
 * @returns {boolean}
 */
function accionRequiereTools(accion) {
  const config = ACCION_CONFIG[accion];
  return config ? config.requiereTools : true;
}

/**
 * Obtiene las tools permitidas para una acción
 *
 * @param {string} accion - Nombre de la acción
 * @returns {array|null} - Lista de tools o null para todas
 */
function getToolsParaAccion(accion) {
  const config = ACCION_CONFIG[accion];
  return config ? config.tools : null;
}

/**
 * Obtiene la descripción de una acción
 *
 * @param {string} accion - Nombre de la acción
 * @returns {string}
 */
function getDescripcionAccion(accion) {
  const config = ACCION_CONFIG[accion];
  return config ? config.descripcion : 'Acción desconocida';
}

/**
 * Lista todas las acciones disponibles
 *
 * @returns {array}
 */
function listarAcciones() {
  return Object.keys(ACCION_CONFIG);
}

module.exports = {
  enrutarSolicitud,
  filtrarTools,
  accionRequiereTools,
  getToolsParaAccion,
  getDescripcionAccion,
  listarAcciones,
  ACCION_CONFIG
};
