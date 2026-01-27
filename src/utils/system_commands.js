// daiko/src/utils/system_commands.js
// CAPA 0 - COMANDOS DEL SISTEMA
// Prioridad ABSOLUTA sobre cualquier otra lógica

const UserContext = require('./userContext');

/**
 * Tabla de comandos del sistema
 * Cada comando tiene prioridad absoluta y bypass total del flujo normal
 */
const SYSTEM_COMMANDS = {
  'reiniciate': {
    tipo: 'terminal',
    prioridad: 'absoluta',
    descripcion: 'Reinicia la conversación y limpia el estado',
    accion: 'reset_conversation',
    detenerFlujo: true
  }
  // Espacio para futuros comandos del sistema
};

/**
 * Normaliza el mensaje del usuario para detección de comandos
 * - Convierte a minúsculas
 * - Elimina acentos
 * - Elimina signos de puntuación
 * - Elimina espacios iniciales/finales
 * 
 * @param {string} mensaje - Mensaje del usuario
 * @returns {string} Mensaje normalizado
 */
function normalizarMensaje(mensaje) {
  if (!mensaje || typeof mensaje !== 'string') {
    return '';
  }

  let normalizado = mensaje.trim().toLowerCase();
  
  // Eliminar acentos
  normalizado = normalizado
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/ñ/g, 'n');
  
  // Eliminar signos de puntuación
  normalizado = normalizado.replace(/[^\w\s]/g, '');
  
  // Eliminar espacios múltiples
  normalizado = normalizado.replace(/\s+/g, ' ').trim();
  
  return normalizado;
}

/**
 * Detecta si un mensaje es un comando del sistema
 * 
 * CRITERIOS DE DETECCIÓN:
 * - El mensaje normalizado debe ser exactamente el comando
 * - O el comando debe ser la palabra dominante (>50% del mensaje)
 * 
 * @param {string} mensaje - Mensaje del usuario
 * @returns {object|null} Comando detectado o null
 */
function detectarComandoSistema(mensaje) {
  const normalizado = normalizarMensaje(mensaje);
  
  if (!normalizado) {
    return null;
  }

  console.log(`🔍 CAPA 0 - Evaluando comando del sistema: "${normalizado}"`);

  // Verificar comandos exactos
  for (const [comando, config] of Object.entries(SYSTEM_COMMANDS)) {
    if (normalizado === comando) {
      console.log(`✅ COMANDO DEL SISTEMA DETECTADO: ${comando}`);
      return { comando, config };
    }
    
    // Verificar si el comando es dominante
    if (normalizado.includes(comando)) {
      const palabras = normalizado.split(' ');
      const palabrasComando = comando.split(' ');
      
      // Si el comando representa >50% de las palabras
      if (palabrasComando.length / palabras.length > 0.5) {
        console.log(`✅ COMANDO DEL SISTEMA DETECTADO (dominante): ${comando}`);
        return { comando, config };
      }
    }
  }

  console.log(`❌ No es comando del sistema, continuar flujo normal`);
  return null;
}

/**
 * Ejecuta un comando del sistema
 * 
 * COMPORTAMIENTO:
 * - Ejecución inmediata
 * - Bypass de toda lógica (búsqueda, UX, formato)
 * - Respuesta terminal (no permite encadenamiento)
 * 
 * @param {string} comando - Nombre del comando
 * @param {object} config - Configuración del comando
 * @param {string} userId - ID del usuario
 * @returns {Promise<object>} Resultado de la ejecución
 */
async function ejecutarComandoSistema(comando, config, userId) {
  console.log(`\n🔒 ========================================`);
  console.log(`   EJECUTANDO COMANDO DEL SISTEMA`);
  console.log(`   Comando: ${comando}`);
  console.log(`   Tipo: ${config.tipo}`);
  console.log(`   Acción: ${config.accion}`);
  console.log(`   ========================================\n`);

  try {
    // Ejecutar acción según el tipo de comando
    switch (config.accion) {
      case 'reset_conversation':
        const userContext = new UserContext(userId);
        await userContext.reset();
        
        console.log(`✅ Conversación reiniciada para usuario: ${userId}`);
        
        // Respuesta LITERAL según especificación
        return {
          success: true,
          isSystemCommand: true,
          detenerFlujo: config.detenerFlujo,
          response: "Claro, a partir de este momento inicia una conversación nueva"
        };
      
      // Espacio para futuros comandos del sistema
      default:
        console.warn(`⚠️ Acción de comando desconocida: ${config.accion}`);
        return {
          success: false,
          isSystemCommand: true,
          detenerFlujo: true,
          response: "Comando del sistema no implementado"
        };
    }
    
  } catch (error) {
    console.error(`❌ Error ejecutando comando del sistema:`, error);
    return {
      success: false,
      isSystemCommand: true,
      detenerFlujo: true,
      error: error.message,
      response: "Error ejecutando comando del sistema"
    };
  }
}

/**
 * Procesa un mensaje verificando primero si es comando del sistema
 * 
 * FLUJO:
 * 1. Evalúa si es comando del sistema
 * 2. Si SÍ: ejecuta y detiene flujo
 * 3. Si NO: retorna null para continuar flujo normal
 * 
 * @param {string} mensaje - Mensaje del usuario
 * @param {string} userId - ID del usuario
 * @returns {Promise<object|null>} Resultado o null si continuar flujo normal
 */
async function procesarMensajeConComandosSistema(mensaje, userId) {
  // PASO 1: Detectar comando del sistema
  const comandoDetectado = detectarComandoSistema(mensaje);
  
  // PASO 2: Si NO es comando, continuar flujo normal
  if (!comandoDetectado) {
    return null;
  }
  
  // PASO 3: Si SÍ es comando, ejecutar y detener flujo
  const resultado = await ejecutarComandoSistema(
    comandoDetectado.comando, 
    comandoDetectado.config, 
    userId
  );
  
  return resultado;
}

module.exports = {
  detectarComandoSistema,
  ejecutarComandoSistema,
  procesarMensajeConComandosSistema,
  normalizarMensaje,
  SYSTEM_COMMANDS
};