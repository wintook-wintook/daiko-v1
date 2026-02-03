// src/prompts/index.js
// Exporta todos los prompts del sistema

// Clasificador (Fase 1)
const {
  promptClasificador,
  buildClasificadorPrompt,
  validarRespuestaClasificador,
  ACCIONES_VALIDAS
} = require('./clasificador_prompt');

// Prompts especializados (Fase 2)
const { promptSaludo, buildSaludoPrompt, SALUDO_TOOLS } = require('./saludo_prompt');
const { promptBusqueda, buildBusquedaPrompt, BUSQUEDA_TOOLS } = require('./busqueda_prompt');
const { promptCategoria, buildCategoriaPrompt, CATEGORIA_TOOLS } = require('./categoria_prompt');
const {
  promptCarrito,
  buildCarritoPrompt,
  CARRITO_CREAR_TOOLS,
  CARRITO_MODIFICAR_TOOLS,
  CARRITO_CONSULTAR_TOOLS,
  CARRITO_CANCELAR_TOOLS,
  CARRITO_ALL_TOOLS
} = require('./carrito_prompt');
const { promptOrden, buildOrdenPrompt, ORDEN_TOOLS } = require('./orden_prompt');
const { promptNecesidad, buildNecesidadPrompt, NECESIDAD_TOOLS, NECESIDAD_MAPPING } = require('./necesidad_prompt');

module.exports = {
  // Clasificador
  promptClasificador,
  buildClasificadorPrompt,
  validarRespuestaClasificador,
  ACCIONES_VALIDAS,

  // Saludo
  promptSaludo,
  buildSaludoPrompt,
  SALUDO_TOOLS,

  // Búsqueda
  promptBusqueda,
  buildBusquedaPrompt,
  BUSQUEDA_TOOLS,

  // Categorías
  promptCategoria,
  buildCategoriaPrompt,
  CATEGORIA_TOOLS,

  // Carrito
  promptCarrito,
  buildCarritoPrompt,
  CARRITO_CREAR_TOOLS,
  CARRITO_MODIFICAR_TOOLS,
  CARRITO_CONSULTAR_TOOLS,
  CARRITO_CANCELAR_TOOLS,
  CARRITO_ALL_TOOLS,

  // Órdenes
  promptOrden,
  buildOrdenPrompt,
  ORDEN_TOOLS,

  // Necesidad
  promptNecesidad,
  buildNecesidadPrompt,
  NECESIDAD_TOOLS,
  NECESIDAD_MAPPING
};
