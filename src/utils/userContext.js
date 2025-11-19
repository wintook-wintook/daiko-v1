
const redis = require('../config/redis');

class UserContext {
  constructor(userId) {
    this.userId = userId;
    this.key = `user:${userId}:context`;
    this.ttl = 3600 * 24 * 7; // 7 días
  }

  // Obtener todo el contexto
  async get() {
    const data = await redis.hgetall(this.key);
    
    // Si no existe, devolver valores por defecto
    if (Object.keys(data).length === 0) {
      return {
        nombre_usuario: null,
        cliente: {},
        carrito_id: null,
        folio: null,
        ultima_categoria: null,
        preferencias: [],
        created_at: new Date().toISOString()
      };
    }

    // Parsear campos JSON
    if (data.cliente) {
        data.cliente = JSON.parse(data.cliente);
    }

    // Parsear campos JSON
    if (data.preferencias) {
      data.preferencias = JSON.parse(data.preferencias);
    }

    return data;
  }

  // Guardar nombre
  async setNombre(nombre) {
    await redis.hset(this.key, 'nombre_usuario', nombre);
    await redis.hset(this.key, 'updated_at', new Date().toISOString());
    await redis.expire(this.key, this.ttl);
    return true;
  }

  // Recuperar cliente
  async getCliente() {
    let v = await redis.hget(this.key, 'cliente');
    return JSON.parse(v);
  }

  // Obtener nombre
  async getNombre() {
    return await redis.hget(this.key, 'nombre_usuario');
  }

  // Guardar carrito
  async setCarrito(carritoId, folio) {
    await redis.hset(this.key, 'carrito_id', carritoId);
    await redis.hset(this.key, 'folio', folio);
    await redis.hset(this.key, 'updated_at', new Date().toISOString());
    await redis.expire(this.key, this.ttl);
    return true;
  }

  // Obtener carrito
  async getCarrito() {
    return await redis.hget(this.key, 'carrito_id');
  }

  // Guardar múltiples campos
  async setMultiple(data) {
    const pipeline = redis.pipeline();
    
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object') {
        pipeline.hset(this.key, key, JSON.stringify(value));
      } else {
        pipeline.hset(this.key, key, value);
      }
    }
    
    pipeline.hset(this.key, 'updated_at', new Date().toISOString());
    pipeline.expire(this.key, this.ttl);
    
    await pipeline.exec();
    return true;
  }

  // Asignar cliente
  async setCliente(cliente) {    
    await redis.hset(this.key, 'cliente', JSON.stringify(cliente));    
    await redis.expire(this.key, this.ttl);
  }

  // Agregar preferencia/historial
  async addPreferencia(categoria) {
    const preferencias = await redis.hget(this.key, 'preferencias');
    let lista = preferencias ? JSON.parse(preferencias) : [];
    
    // Agregar sin duplicados
    if (!lista.includes(categoria)) {
      lista.push(categoria);
      // Mantener solo las últimas 10
      if (lista.length > 10) {
        lista = lista.slice(-10);
      }
      await redis.hset(this.key, 'preferencias', JSON.stringify(lista));
    }
    
    await redis.expire(this.key, this.ttl);
  }

  // Generar contexto para system prompt
  async toSystemContext() {
    const context = await this.get();
    
    let contextStr = '\\n=== CONTEXTO DEL USUARIO ACTUAL ===\\n';
    
    if (context.nombre_usuario) {
      contextStr += `- Nombre: ${context.nombre_usuario}\\n`;
    }
    
    if (context.carrito_id) {
      contextStr += `- Carrito ID: ${context.carrito_id}\\n`;
    }
    
    if (context.ultima_categoria) {
      contextStr += `- Última categoría vista: ${context.ultima_categoria}\\n`;
    }
    
    if (context.preferencias && context.preferencias.length > 0) {
      contextStr += `- Categorías de interés: ${context.preferencias.join(', ')}\\n`;
    }
    
    contextStr += '\\nUsa esta información para personalizar tus respuestas de manera natural.\\n';
    
    return contextStr;
  }

  // Limpiar contexto (opcional)
  async clear() {
    await redis.del(this.key);
    return true;
  }

  // Extender TTL
  async keepAlive() {
    await redis.expire(this.key, this.ttl);
  }
}

module.exports = UserContext;