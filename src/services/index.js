// src/services/index.js
// Exporta todos los servicios del sistema

// Clasificador (Fase 1)
const {
  clasificarIntencion,
  clasificarBatch,
  confianzaSuficiente,
  requiereFallbackPromptCompleto,
  crearRespuestaFallback
} = require('./clasificador_service');

// Referencias (Fase 1)
const {
  resolverReferencia,
  resolverMultiplesReferencias,
  extraerReferenciasConCantidad,
  resolverParametrosClasificador,
  puedeResolverReferencia,
  resolverPorIndice,
  REFERENCIAS_A_INDICE
} = require('./referencia_service');

// Router (Fase 2)
const {
  enrutarSolicitud,
  filtrarTools,
  accionRequiereTools,
  getToolsParaAccion,
  getDescripcionAccion,
  listarAcciones,
  ACCION_CONFIG
} = require('./router_service');

module.exports = {
  // Clasificador
  clasificarIntencion,
  clasificarBatch,
  confianzaSuficiente,
  requiereFallbackPromptCompleto,
  crearRespuestaFallback,

  // Referencias
  resolverReferencia,
  resolverMultiplesReferencias,
  extraerReferenciasConCantidad,
  resolverParametrosClasificador,
  puedeResolverReferencia,
  resolverPorIndice,
  REFERENCIAS_A_INDICE,

  // Router
  enrutarSolicitud,
  filtrarTools,
  accionRequiereTools,
  getToolsParaAccion,
  getDescripcionAccion,
  listarAcciones,
  ACCION_CONFIG
};
