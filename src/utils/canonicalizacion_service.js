// daiko/src/utils/canonicalizacion_service.js
// Servicio de Canonización de Sinónimos - PostgreSQL
// V23.3.0 - Implementación con tabla wintook.palabras_sinonimos
// ACTUALIZADO: Con timeout y fail-open

const { executeQuery } = require('../config/database');

/**
 * Timeout para queries PostgreSQL (2 segundos)
 */
const QUERY_TIMEOUT_MS = 2000;

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
 * Ejecuta una query con timeout
 * @param {string} query - Query SQL
 * @param {Array} params - Parámetros
 * @param {number} timeoutMs - Timeout en milisegundos
 * @returns {Promise<Object>} Resultado o timeout
 */
async function executeQueryWithTimeout(query, params, timeoutMs = QUERY_TIMEOUT_MS) {
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
  );
  
  try {
    return await Promise.race([
      executeQuery(query, params),
      timeoutPromise
    ]);
  } catch (error) {
    if (error.message === 'Query timeout') {
      console.warn(`⚠️ Query timeout después de ${timeoutMs}ms`);
      return {
        success: false,
        error: 'timeout',
        rows: [],
        rowCount: 0
      };
    }
    throw error;
  }
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
 * FAIL-OPEN: Si hay timeout o error, retorna null y el flujo continúa
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

    // PASO 1: Buscar el token en la tabla (CON TIMEOUT)
    const queryBusqueda = `
      SELECT palabra_id, palabra, palabra_sinonimo_id, account_id
      FROM wintook.palabras_sinonimos
      WHERE LOWER(TRIM(palabra)) = $1
        AND account_id = $2
      LIMIT 1
    `;
    
    const resultadoBusqueda = await executeQueryWithTimeout(queryBusqueda, [tokenNormalizado, accountId]);
    
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

    // PASO 3: Resolver la palabra principal (CON TIMEOUT)
    // La palabra principal es aquella donde palabra_id == palabra_sinonimo_id
    const queryPrincipal = `
      SELECT palabra
      FROM wintook.palabras_sinonimos
      WHERE palabra_id = $1
        AND palabra_id = palabra_sinonimo_id
        AND account_id = $2
      LIMIT 1
    `;
    
    const resultadoPrincipal = await executeQueryWithTimeout(queryPrincipal, [palabraSinonimoId, accountId]);
    
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
    
    // FAIL-OPEN: Retornar null en caso de error de BD o timeout
    return {
      token_original: token,
      token_canonico: null,
      encontrado: false,
      source: 'error',
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
    
    const resultado = await executeQueryWithTimeout(query, [accountId]);
    
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

module.exports = {
  resolverCanonico,
  resolverMultiplesCanonico,
  obtenerSinonimos,
  normalizarToken
};