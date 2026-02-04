// daiko/src/utils/canonicalizacion_service.js
// V24.0 - PASO 8 y PASO 9 como procesos SEPARADOS
// Según documento normativo MBC01 v2.2
// SIN HARDCODE - Solo reglas genéricas

const { executeQuery } = require('../config/database');

/**
 * Timeout para queries PostgreSQL (2 segundos)
 */
const QUERY_TIMEOUT_MS = 2000;

// ============================================================
// PASO 8 – NORMALIZACIÓN (PROCESO TEXTUAL - SIN BD)
// Según documento normativo v2.2, punto 8
// ============================================================

/**
 * PASO 8.2.1 - Normalización de unidades (GENÉRICA)
 * Usa regex para detectar patrones numéricos seguidos de unidades
 * NO usa diccionarios hardcoded
 * 
 * @param {string} texto - Texto a normalizar
 * @returns {string} Texto con unidades normalizadas
 */
function normalizarUnidades(texto) {
  if (!texto) return texto;
  
  let resultado = texto;
  
  // Patrones genéricos: número + unidad (sin espacio o con espacio)
  const patrones = [
    // Peso
    { regex: /(\d+(?:\.\d+)?)\s*(kg|kilos?|kilogramos?)/gi, formato: '$1 KG' },
    { regex: /(\d+(?:\.\d+)?)\s*(gr|grs|gramos?)/gi, formato: '$1 GR' },
    { regex: /(\d+(?:\.\d+)?)\s*(lb|lbs|libras?)/gi, formato: '$1 LB' },
    { regex: /(\d+(?:\.\d+)?)\s*(oz|onzas?)/gi, formato: '$1 OZ' },
    
    // Volumen
    { regex: /(\d+(?:\.\d+)?)\s*(lt|lts|litros?)/gi, formato: '$1 LT' },
    { regex: /(\d+(?:\.\d+)?)\s*(ml|mililitros?)/gi, formato: '$1 ML' },
    { regex: /(\d+(?:\.\d+)?)\s*(gal|galones?)/gi, formato: '$1 GAL' },
    
    // Longitud
    { regex: /(\d+(?:\.\d+)?)\s*(mm|milimetros?|milímetros?)/gi, formato: '$1 MM' },
    { regex: /(\d+(?:\.\d+)?)\s*(cm|centimetros?|centímetros?)/gi, formato: '$1 CM' },
    { regex: /(\d+(?:\.\d+)?)\s*(mts?|metros?)/gi, formato: '$1 M' },
    { regex: /(\d+(?:\.\d+)?)\s*(pulgadas?|pulg|inch|inches|")/gi, formato: '$1 PULGADAS' },
    { regex: /(\d+(?:\.\d+)?)\s*(pies?|ft|feet)/gi, formato: '$1 PIES' },
    
    // Electricidad/Potencia
    { regex: /(\d+(?:\.\d+)?)\s*(watts?|w)/gi, formato: '$1 W' },
    { regex: /(\d+(?:\.\d+)?)\s*(volts?|v)/gi, formato: '$1 V' },
    { regex: /(\d+(?:\.\d+)?)\s*(amperes?|amp|a)/gi, formato: '$1 A' },
  ];
  
  for (const { regex, formato } of patrones) {
    resultado = resultado.replace(regex, formato);
  }
  
  return resultado;
}

/**
 * PASO 8.2.2 - Normalización singular/plural (GENÉRICA)
 * Aplica reglas del español, NO diccionarios
 * 
 * Reglas del español:
 * - Palabras terminadas en vocal + s → quitar s (casas → casa)
 * - Palabras terminadas en consonante + es → quitar es (monitores → monitor)
 * - Palabras terminadas en z + es → cambiar ces por z (peces → pez)
 * 
 * @param {string} palabra - Palabra a convertir a singular
 * @returns {string} Palabra en singular
 */
function normalizarSingular(palabra) {
  if (!palabra || palabra.length < 3) return palabra;
  
  const palabraLower = palabra.toLowerCase();
  
  // Excepciones: palabras que terminan en 's' pero NO son plurales
  const excepcionesSingular = [
    'lunes', 'martes', 'miercoles', 'jueves', 'viernes',
    'virus', 'plus', 'bus', 'gas', 'mes', 'pais', 'ingles',
    'estres', 'interes', 'reves', 'arnes', 'ciempies'
  ];
  
  if (excepcionesSingular.includes(palabraLower)) {
    return palabraLower;
  }
  
  // Regla 1: Palabras terminadas en -ces → -z (peces → pez, luces → luz)
  if (palabraLower.endsWith('ces') && palabraLower.length > 4) {
    return palabraLower.slice(0, -3) + 'z';
  }
  
  // Regla 2: Palabras terminadas en -es después de consonante
  // (monitores → monitor, cables → cable, azúcares → azúcar)
  if (palabraLower.endsWith('es') && palabraLower.length > 4) {
    const sinEs = palabraLower.slice(0, -2);
    const ultimaLetra = sinEs.charAt(sinEs.length - 1);
    
    // Si termina en consonante (excepto s), quitar -es
    if (/[bcdfghjklmnpqrstvwxyz]/.test(ultimaLetra) && ultimaLetra !== 's') {
      return sinEs;
    }
    
    // Si termina en vocal acentuada + es (cafés → café)
    // Mantener el -es ya que la palabra sin él sería incorrecta
  }
  
  // Regla 3: Palabras terminadas en -s después de vocal no acentuada
  // (casas → casa, perros → perro, teclados → teclado)
  if (palabraLower.endsWith('s') && palabraLower.length > 3) {
    const sinS = palabraLower.slice(0, -1);
    const penultimaLetra = sinS.charAt(sinS.length - 1);
    
    // Si la penúltima es vocal, quitar la s
    if (/[aeiouáéíóú]/.test(penultimaLetra)) {
      return sinS;
    }
  }
  
  // Si no aplica ninguna regla, devolver original
  return palabraLower;
}

/**
 * PASO 8.2.4 - Quitar acentos/diacríticos
 * Convierte caracteres acentuados a su forma sin acento
 * (é→e, á→a, í→i, ó→o, ú→u, ñ se preserva)
 *
 * @param {string} texto - Texto con posibles acentos
 * @returns {string} Texto sin acentos
 */
function quitarAcentos(texto) {
  if (!texto) return texto;
  // Rango U+0300-U+036F pero excluyendo U+0303 (tilde combinante de ñ)
  return texto.normalize('NFD').replace(/[\u0300-\u0302\u0304-\u036f]/g, '').normalize('NFC');
}

/**
 * PASO 8 COMPLETO - Normalización de token
 *
 * Según documento normativo v2.2, punto 8:
 * - Corrección ortográfica básica (trim, lowercase)
 * - Remoción de acentos/diacríticos
 * - Normalización singular/plural
 * - Normalización de unidades
 *
 * PROHIBICIONES (8.3):
 * - NO resolver sinónimos
 * - NO canonizar términos
 * - NO inferir significados
 * - NO modificar intención
 * - NO validar existencia de productos
 *
 * @param {string} token - Token crudo del usuario
 * @returns {object} { token_raw, token_normalizado, cambios_aplicados }
 */
function ejecutarPaso8_Normalizacion(token) {
  console.log(`\n📝 ========== PASO 8: NORMALIZACIÓN ==========`);
  console.log(`   Token recibido (raw): "${token}"`);

  if (!token || typeof token !== 'string') {
    console.log(`   ⚠️ Token inválido, retornando vacío`);
    return {
      token_raw: token,
      token_normalizado: '',
      cambios_aplicados: []
    };
  }

  const cambios = [];
  let resultado = token;

  // 8.2.1 - Trim y lowercase (corrección ortográfica básica)
  const trimLower = resultado.trim().toLowerCase();
  if (trimLower !== resultado) {
    cambios.push('trim+lowercase');
    resultado = trimLower;
  }

  // 8.2.2 - Quitar acentos/diacríticos (café → cafe, azúcar → azucar)
  const sinAcentos = quitarAcentos(resultado);
  if (sinAcentos !== resultado) {
    cambios.push('acentos');
    resultado = sinAcentos;
  }

  // 8.2.3 - Normalización de unidades
  const conUnidades = normalizarUnidades(resultado);
  if (conUnidades !== resultado) {
    cambios.push('unidades');
    resultado = conUnidades;
  }

  // 8.2.4 - Singular/plural (solo si NO contiene números - no es medida)
  if (!/\d/.test(resultado)) {
    const singular = normalizarSingular(resultado);
    if (singular !== resultado) {
      cambios.push('singular');
      resultado = singular;
    }
  }
  
  console.log(`   Token normalizado: "${resultado}"`);
  console.log(`   Cambios aplicados: [${cambios.join(', ') || 'ninguno'}]`);
  console.log(`   ============================================\n`);
  
  return {
    token_raw: token,
    token_normalizado: resultado,
    cambios_aplicados: cambios
  };
}


// ============================================================
// PASO 9 – CANONIZACIÓN (CONSULTA A BD)
// Según documento normativo v2.2, punto 9
// ============================================================

/**
 * Ejecuta una query con timeout
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
      console.warn(`   ⚠️ Query timeout después de ${timeoutMs}ms`);
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
 * PASO 9 COMPLETO - Canonización por sinónimos
 * 
 * Según documento normativo v2.2, punto 9:
 * - Proceso MECÁNICO de sustitución
 * - Solo reemplaza alias por forma canónica SI EXISTE mapeo
 * - Si no existe mapeo, conservar token normalizado
 * 
 * PROHIBICIONES (9.5):
 * - NO decir que "no existe el producto"
 * - NO detener el flujo
 * - NO hacer preguntas
 * - NO solicitar aclaraciones
 * - NO inferir error del usuario
 * - NO cambiar intención
 * 
 * @param {string} tokenNormalizado - Token YA normalizado (salida del PASO 8)
 * @param {number} accountId - ID de la cuenta
 * @returns {object} { token_normalizado, token_canonico, encontrado }
 */
async function ejecutarPaso9_Canonizacion(tokenNormalizado, accountId) {
  console.log(`\n🔍 ========== PASO 9: CANONIZACIÓN ==========`);
  console.log(`   Token normalizado (entrada): "${tokenNormalizado}"`);
  console.log(`   Account ID: ${accountId}`);
  
  if (!tokenNormalizado) {
    console.log(`   ⚠️ Token vacío, retornando null`);
    console.log(`   ============================================\n`);
    return {
      token_normalizado: tokenNormalizado,
      token_canonico: null,
      encontrado: false,
      source: null
    };
  }
  
  try {
    // Buscar en tabla de sinónimos
    const queryBusqueda = `
      SELECT palabra_id, palabra, palabra_sinonimo_id, account_id
      FROM wintook.palabras_sinonimos
      WHERE LOWER(TRIM(palabra)) = $1
        AND account_id = $2
      LIMIT 1
    `;
    
    console.log(`   Consultando BD...`);
    const resultadoBusqueda = await executeQueryWithTimeout(queryBusqueda, [tokenNormalizado, accountId]);
    
    // Si no se encontró
    if (!resultadoBusqueda.success || resultadoBusqueda.rowCount === 0) {
      console.log(`   ℹ️ No existe mapeo para "${tokenNormalizado}"`);
      console.log(`   → Conservar token normalizado (regla 9.4)`);
      console.log(`   ============================================\n`);
      return {
        token_normalizado: tokenNormalizado,
        token_canonico: null,
        encontrado: false,
        source: null
      };
    }
    
    const registro = resultadoBusqueda.rows[0];
    const palabraSinonimoId = registro.palabra_sinonimo_id;
    
    console.log(`   ✓ Mapeo encontrado: palabra_id=${registro.palabra_id}, sinonimo_id=${palabraSinonimoId}`);
    
    // Buscar palabra principal
    const queryPrincipal = `
      SELECT palabra
      FROM wintook.palabras_sinonimos
      WHERE palabra_id = $1
        AND palabra_id = palabra_sinonimo_id
        AND account_id = $2
      LIMIT 1
    `;
    
    const resultadoPrincipal = await executeQueryWithTimeout(queryPrincipal, [palabraSinonimoId, accountId]);
    
    if (!resultadoPrincipal.success || resultadoPrincipal.rowCount === 0) {
      console.log(`   ⚠️ Palabra principal no encontrada`);
      console.log(`   → Conservar token normalizado`);
      console.log(`   ============================================\n`);
      return {
        token_normalizado: tokenNormalizado,
        token_canonico: null,
        encontrado: false,
        source: null
      };
    }
    
    const palabraPrincipal = resultadoPrincipal.rows[0].palabra;
    const tokenCanonico = palabraPrincipal.toUpperCase();
    
    console.log(`   ✅ Canónico encontrado: "${tokenCanonico}"`);
    console.log(`   ============================================\n`);
    
    return {
      token_normalizado: tokenNormalizado,
      token_canonico: tokenCanonico,
      encontrado: true,
      source: `account_${accountId}`
    };
    
  } catch (error) {
    console.error(`   ❌ Error en BD: ${error.message}`);
    console.log(`   → FAIL-OPEN: Conservar token normalizado`);
    console.log(`   ============================================\n`);
    
    return {
      token_normalizado: tokenNormalizado,
      token_canonico: null,
      encontrado: false,
      source: 'error',
      error: error.message
    };
  }
}


// ============================================================
// FUNCIÓN PRINCIPAL: resolverCanonico
// Ejecuta PASO 8 + PASO 9 en secuencia
// ============================================================

/**
 * Resuelve un token ejecutando PASO 8 y PASO 9 en secuencia
 * 
 * Flujo:
 * 1. PASO 8: Normalización (textual, sin BD)
 * 2. PASO 9: Canonización (consulta BD)
 * 3. Retorna token_final (canónico si existe, normalizado si no)
 * 
 * @param {string} token - Token crudo del usuario
 * @param {number} accountId - ID de la cuenta
 * @returns {Promise<object>} Resultado completo del proceso
 */
async function resolverCanonico(token, accountId = 0) {
  console.log(`\n🚀 ========================================`);
  console.log(`   RESOLVER CANÓNICO V24.0`);
  console.log(`   Token entrada: "${token}"`);
  console.log(`   Account: ${accountId}`);
  console.log(`   ========================================`);
  
  // PASO 8: Normalización
  const paso8 = ejecutarPaso8_Normalizacion(token);
  
  // PASO 9: Canonización
  const paso9 = await ejecutarPaso9_Canonizacion(paso8.token_normalizado, accountId);
  
  // Determinar token final (regla 9.4)
  // Si canonico ≠ null → usar canónico
  // Si canonico = null → conservar normalizado
  const tokenFinal = paso9.token_canonico || paso8.token_normalizado;
  
  // Log resumen
  console.log(`\n📊 ========== RESUMEN ==========`);
  console.log(`   token_raw:         "${token}"`);
  console.log(`   token_normalizado: "${paso8.token_normalizado}"`);
  console.log(`   token_canonico:    "${paso9.token_canonico || '(null)'}"`);
  console.log(`   token_final:       "${tokenFinal}"`);
  console.log(`   ================================\n`);
  
  return {
    // Datos del proceso
    token_original: token,
    token_normalizado: paso8.token_normalizado,
    token_canonico: paso9.token_canonico,
    token_final: tokenFinal,
    
    // Metadata
    encontrado: paso9.encontrado,
    source: paso9.source,
    cambios_normalizacion: paso8.cambios_aplicados,
    
    // Timestamp
    timestamp: new Date().toISOString()
  };
}

/**
 * Resuelve múltiples tokens en paralelo
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
    return tokens.map(token => {
      const paso8 = ejecutarPaso8_Normalizacion(token);
      return {
        token_original: token,
        token_normalizado: paso8.token_normalizado,
        token_canonico: null,
        token_final: paso8.token_normalizado,
        encontrado: false,
        source: 'error',
        error: error.message
      };
    });
  }
}

/**
 * Obtiene todos los sinónimos de una cuenta
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

// Exportar funciones
module.exports = {
  // Función principal
  resolverCanonico,
  resolverMultiplesCanonico,
  obtenerSinonimos,
  
  // Funciones de pasos individuales (para testing)
  ejecutarPaso8_Normalizacion,
  ejecutarPaso9_Canonizacion,
  
  // Funciones auxiliares (para testing)
  normalizarUnidades,
  normalizarSingular,
  quitarAcentos
};