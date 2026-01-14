// daiko/src/config/database.js
// Módulo de conexión PostgreSQL - Pool Singleton

const { Pool } = require('pg');
require('dotenv').config();

/**
 * Configuración de conexión PostgreSQL desde variables de entorno
 */
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: parseInt(process.env.DB_POOL_MAX) || 10, // Máximo de conexiones en el pool
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000, // 30 segundos
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 5000, // 5 segundos
};

// Configuración SSL si está habilitada
if (process.env.DB_SSL === 'true') {
  dbConfig.ssl = {
    rejectUnauthorized: false // Ajustar según necesidades de seguridad
  };
}

/**
 * Pool singleton - Se crea una sola vez y se reutiliza
 */
let pool = null;

/**
 * Obtiene el pool de conexiones (singleton)
 * @returns {Pool} Pool de conexiones PostgreSQL
 */
function getPool() {
  if (!pool) {
    pool = new Pool(dbConfig);
    
    // Manejo de errores del pool
    pool.on('error', (err) => {
      console.error('❌ Error inesperado en el pool de PostgreSQL:', err);
    });

    // Log de conexión exitosa
    pool.on('connect', () => {
      console.log('✅ Nueva conexión establecida al pool de PostgreSQL');
    });

    console.log('✅ Pool de conexiones PostgreSQL creado:', {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      max: dbConfig.max
    });
  }
  
  return pool;
}

/**
 * Ejecuta una consulta en la base de datos
 * @param {string} query - Query SQL
 * @param {Array} params - Parámetros de la query
 * @returns {Promise<Object>} Resultado de la query
 */
async function executeQuery(query, params = []) {
  const client = await getPool().connect();
  
  try {
    const result = await client.query(query, params);
    return {
      success: true,
      rows: result.rows,
      rowCount: result.rowCount
    };
  } catch (error) {
    console.error('❌ Error ejecutando query:', error.message);
    return {
      success: false,
      error: error.message,
      rows: [],
      rowCount: 0
    };
  } finally {
    client.release();
  }
}

/**
 * Cierra el pool de conexiones (usar solo al cerrar la aplicación)
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✅ Pool de PostgreSQL cerrado');
  }
}

/**
 * Verifica la conexión a la base de datos
 * @returns {Promise<boolean>} true si la conexión es exitosa
 */
async function testConnection() {
  try {
    const result = await executeQuery('SELECT NOW() as current_time');
    if (result.success) {
      console.log('✅ Conexión a PostgreSQL verificada:', result.rows[0].current_time);
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Error verificando conexión a PostgreSQL:', error);
    return false;
  }
}

module.exports = {
  getPool,
  executeQuery,
  closePool,
  testConnection
};