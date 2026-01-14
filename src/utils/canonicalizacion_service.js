// daiko/src/utils/canonicalizacion_service.js
// Servicio de Canonización de Sinónimos - PostgreSQL
// V23.3.0 - Implementación con tabla wintook.palabras_sinonimos

const { executeQuery } = require('../config/database');

/**
 * Normaliza un token para búsqueda
 * - Convierte a minúsculas
 * - Elimina espacios al inicio y fin
 * @param {string} token - Token a normalizar
 * @returns {string} Token normalizado
 */
function normalizarToken(token) {
  if (!token || typeof token !== 'string') return '';
  
  return token
    .toLowerCase()
    .trim();
}

/**
 * Resuelve un token a su forma canónica consultando PostgreSQL
 * 
 * Flujo:
 * 1. Normalizar token (lowercase + trim)
 * 2. Buscar en wintook.palabras_sinonimos WHERE palabra = token AND account_id = accountId
 * 3. Si existe, obtener palabra_sinonimo_id
 * 4. Buscar la palabra principal WHERE palabra_id = palabra_sinonimo_id AND palabra_id = palabra_sinonimo_id
 * 5. Retornar la palabra principal o null
 * 
 * @param {string} token - Token a resolver
 * @param {number} accountId - ID de la cuenta (desde webhookData)
 * @returns {Promise<Object>} { token_original, token_canonico, encontrado, source }
 */
async function resolverCanonico(token, accountId = 0) {
  try {
    // Validación de entrada
    if (!token || typeof token !== 'string') {
      console.warn('⚠️ resolver_canonico: Token inválido recibido');
      return {
        token_original: token,
        token_canonico: null,
        encontrado: false,
        source: null
      };
    }

    // Normalizar el token para búsqueda
    const tokenNormalizado = normalizarToken(token);
    
    if (!tokenNormalizado) {
      console.warn('⚠️ resolver_canonico: Token vacío después de normalización');
      return {
        token_original: token,
        token_canonico: null,
        encontrado: false,
        source: null
      };
    }

    console.log(`🔍 resolver_canonico: Buscando "${token}" (normalizado: "${tokenNormalizado}") para account_id: ${accountId}`);

    // PASO 1: Buscar el token en la tabla
    const queryBusqueda = `
      SELECT palabra_id, palabra, palabra_sinonimo_id, account_id
      FROM wintook.palabras_sinonimos
      WHERE LOWER(TRIM(palabra)) = $1
        AND account_id = $2
      LIMIT 1
    `;
    
    const resultadoBusqueda = await executeQuery(queryBusqueda, [tokenNormalizado, accountId]);
    
    // PASO 2: Verificar si se encontró el token
    if (!resultadoBusqueda.success || resultadoBusqueda.rowCount === 0) {
      console.log(`ℹ️ resolver_canonico: No se encontró "${token}" en la tabla para account_id ${accountId}`);
      return {
        token_original: token,
        token_canonico: null,
        encontrado: false,
        source: null
      };
    }

    const registro = resultadoBusqueda.rows[0];
    const palabraSinonimoId = registro.palabra_sinonimo_id;
    
    console.log(`✅ resolver_canonico: Token encontrado. palabra_id=${registro.palabra_id}, palabra_sinonimo_id=${palabraSinonimoId}`);

    // PASO 3: Resolver la palabra principal
    // La palabra principal es aquella donde palabra_id == palabra_sinonimo_id
    const queryPrincipal = `
      SELECT palabra
      FROM wintook.palabras_sinonimos
      WHERE palabra_id = palabra_sinonimo_id
        AND account_id = $2
      LIMIT 1
    `;
    
    const resultadoPrincipal = await executeQuery(queryPrincipal, [palabraSinonimoId, accountId]);
    
    // PASO 4: Retornar resultado
    if (!resultadoPrincipal.success || resultadoPrincipal.rowCount === 0) {
      console.warn(`⚠️ resolver_canonico: No se encontró palabra principal para palabra_sinonimo_id=${palabraSinonimoId}`);
      return {
        token_original: token,
        token_canonico: null,
        encontrado: false,
        source: null,
        error: 'Palabra principal no encontrada'
      };
    }

    const palabraPrincipal = resultadoPrincipal.rows[0].palabra;
    
    console.log(`✅ resolver_canonico: Palabra canónica encontrada: "${palabraPrincipal}"`);

    return {
      token_original: token,
      token_canonico: palabraPrincipal.toUpperCase(), // Retornar en MAYÚSCULAS según especificación
      encontrado: true,
      source: `account_${accountId}`,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Error en resolver_canonico:', error);
    
    // Fail-safe: retornar null en caso de error de BD
    return {
      token_original: token,
      token_canonico: null,
      encontrado: false,
      source: null,
      error: error.message
    };
  }
}

/**
 * Resuelve múltiples tokens en paralelo
 * @param {Array<string>} tokens - Array de tokens a resolver
 * @param {number} accountId - ID de la cuenta
 * @returns {Promise<Array<Object>>} Array de resultados de canonización
 */
async function resolverMultiplesCanonico(tokens, accountId = 0) {
  if (!Array.isArray(tokens)) {
    console.warn('⚠️ resolverMultiplesCanonico: Se esperaba un array de tokens');
    return [];
  }

  try {
    const promesas = tokens.map(token => resolverCanonico(token, accountId));
    return await Promise.all(promesas);
  } catch (error) {
    console.error('❌ Error en resolverMultiplesCanonico:', error);
    return tokens.map(token => ({
      token_original: token,
      token_canonico: null,
      encontrado: false,
      source: null,
      error: error.message
    }));
  }
}

/**
 * Agrega un nuevo sinónimo a la tabla (función auxiliar para administración)
 * @param {string} palabra - Palabra sinónimo
 * @param {number} palabraSinonimoId - ID de la palabra principal
 * @param {number} accountId - ID de la cuenta
 * @returns {Promise<Object>} Resultado de la operación
 */
/*
async function agregarSinonimo(palabra, palabraSinonimoId, accountId = 0) {
  try {
    const palabraNormalizada = normalizarToken(palabra);
    
    if (!palabraNormalizada || !palabraSinonimoId) {
      console.warn('⚠️ agregarSinonimo: Palabra o palabraSinonimoId inválido');
      return {
        success: false,
        message: 'Parámetros inválidos'
      };
    }

    const query = `
      INSERT INTO wintook.palabras_sinonimos (palabra, palabra_sinonimo_id, account_id)
      VALUES ($1, $2, $3)
      RETURNING palabra_id, palabra, palabra_sinonimo_id, account_id
    `;
    
    const resultado = await executeQuery(query, [palabraNormalizada, palabraSinonimoId, accountId]);
    
    if (resultado.success && resultado.rowCount > 0) {
      console.log(`✅ Sinónimo agregado: "${palabra}" -> palabra_sinonimo_id=${palabraSinonimoId} (account: ${accountId})`);
      return {
        success: true,
        data: resultado.rows[0],
        message: 'Sinónimo agregado exitosamente'
      };
    }
    
    return {
      success: false,
      message: 'No se pudo agregar el sinónimo'
    };
  } catch (error) {
    console.error('❌ Error al agregar sinónimo:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
*/

/**
 * Obtiene todos los sinónimos de una cuenta
 * @param {number} accountId - ID de la cuenta
 * @returns {Promise<Array>} Lista de sinónimos
 */
async function obtenerSinonimos(accountId = 0) {
  try {
    const query = `
      SELECT palabra_id, palabra, palabra_sinonimo_id, account_id
      FROM wintook.palabras_sinonimos
      WHERE account_id = $1
      ORDER BY palabra_sinonimo_id, palabra
    `;
    
    const resultado = await executeQuery(query, [accountId]);
    
    if (resultado.success) {
      return {
        success: true,
        data: resultado.rows,
        count: resultado.rowCount
      };
    }
    
    return {
      success: false,
      data: [],
      count: 0
    };
  } catch (error) {
    console.error('❌ Error al obtener sinónimos:', error);
    return {
      success: false,
      error: error.message,
      data: [],
      count: 0
    };
  }
}

/**
 * Elimina un sinónimo de la tabla
 * @param {number} palabraId - ID de la palabra a eliminar
 * @param {number} accountId - ID de la cuenta
 * @returns {Promise<Object>} Resultado de la operación
 */
/*
async function eliminarSinonimo(palabraId, accountId = 0) {
  try {
    const query = `
      DELETE FROM wintook.palabras_sinonimos
      WHERE palabra_id = $1 AND account_id = $2
      RETURNING palabra_id, palabra
    `;
    
    const resultado = await executeQuery(query, [palabraId, accountId]);
    
    if (resultado.success && resultado.rowCount > 0) {
      console.log(`✅ Sinónimo eliminado: palabra_id=${palabraId} (account: ${accountId})`);
      return {
        success: true,
        data: resultado.rows[0],
        message: 'Sinónimo eliminado exitosamente'
      };
    }
    
    return {
      success: false,
      message: 'Sinónimo no encontrado o no se pudo eliminar'
    };
  } catch (error) {
    console.error('❌ Error al eliminar sinónimo:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
*/

module.exports = {
  resolverCanonico,
  resolverMultiplesCanonico,
  // agregarSinonimo,
  obtenerSinonimos,
  // eliminarSinonimo,
  normalizarToken
};