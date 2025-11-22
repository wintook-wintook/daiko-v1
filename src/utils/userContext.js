
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



  // === MÉTODOS PARA PREFERENCIAS ===

  async getPreferencias() {
    const data = await redis.hget(this.key, 'preferencias');

    // Estructura por defecto
    const defaultPrefs = {
      categorias: [],
      productos_vistos: [],
      historial_busquedas: [],
      rango_precio: { min: 0, max: 0, promedio: 0 },
      marcas_interes: [],
      etiquetas_interes: []
    };
    
    if (!data) {
      return defaultPrefs;
    }
    
    // Parsear y mezclar con valores por defecto para asegurar que todos los campos existan
    const parsed = JSON.parse(data);
    return {
      categorias: parsed.categorias || [],
      productos_vistos: parsed.productos_vistos || [],
      historial_busquedas: parsed.historial_busquedas || [],
      rango_precio: parsed.rango_precio || { min: 0, max: 0, promedio: 0 },
      marcas_interes: parsed.marcas_interes || [],
      etiquetas_interes: parsed.etiquetas_interes || []
    };
  }

  async setPreferencias(preferencias) {
    await redis.hset(this.key, 'preferencias', JSON.stringify(preferencias));
    await redis.expire(this.key, this.ttl);
  }

  // Agregar categoría de interés
  async addCategoria(categoria) {
    const prefs = await this.getPreferencias();
    
    if (!prefs.categorias.includes(categoria)) {
      prefs.categorias.push(categoria);
      
      // Mantener solo las últimas 10
      if (prefs.categorias.length > 10) {
        prefs.categorias = prefs.categorias.slice(-10);
      }
      
      await this.setPreferencias(prefs);
    }
  }

  // Registrar producto visto
  async addProductoVisto(productoId, productoNombre) {
    const prefs = await this.getPreferencias();
    
    prefs.productos_vistos.push({
      id: productoId,
      nombre: productoNombre,
      timestamp: new Date().toISOString()
    });
    
    // Mantener solo los últimos 20
    if (prefs.productos_vistos.length > 20) {
      prefs.productos_vistos = prefs.productos_vistos.slice(-20);
    }
    
    await this.setPreferencias(prefs);
  }

  // Registrar búsqueda
  async addBusqueda(query, resultados) {
    const prefs = await this.getPreferencias();
    
    prefs.historial_busquedas.push({
      query: query,
      resultados: resultados,
      timestamp: new Date().toISOString()
    });
    
    // Mantener últimas 15 búsquedas
    if (prefs.historial_busquedas.length > 15) {
      prefs.historial_busquedas = prefs.historial_busquedas.slice(-15);
    }
    
    await this.setPreferencias(prefs);
  }

  // Actualizar rango de precio
  async updateRangoPrecio(precioMax) {
    const prefs = await this.getPreferencias();
    
    if (precioMax > prefs.rango_precio.max_buscado) {
      prefs.rango_precio.max_buscado = precioMax;
    }
    
    // Calcular promedio simple
    const precios = prefs.historial_busquedas
      .filter(b => b.precio_max)
      .map(b => b.precio_max);
    
    if (precios.length > 0) {
      const suma = precios.reduce((a, b) => a + b, 0);
      prefs.rango_precio.promedio = Math.round(suma / precios.length);
    }
    
    await this.setPreferencias(prefs);
  }

  // Agregar marca de interés
  async addMarca(marca) {
    const prefs = await this.getPreferencias();
    
    if (!prefs.marcas_interes.includes(marca)) {
      prefs.marcas_interes.push(marca);
      
      // Mantener solo las últimas 5 marcas
      if (prefs.marcas_interes.length > 5) {
        prefs.marcas_interes = prefs.marcas_interes.slice(-5);
      }
      
      await this.setPreferencias(prefs);
    }
  }




  // Generar contexto para system prompt
  async toSystemContext() {
    const context = await this.get();
    const prefs = await this.getPreferencias();
    
    let contextStr = '\\n=== CONTEXTO DEL USUARIO ACTUAL ===\\n';
    
    if (context.nombre_usuario) {
      contextStr += `- Nombre: ${context.nombre_usuario}\\n`;
    }
    
    if (context.carrito_id) {
      contextStr += `- Carrito ID: ${context.carrito_id}\\n`;
    }


    if (prefs.categorias && prefs.categorias.length > 0) {
      contextStr += `- Categorías de interés: ${prefs.categorias.join(', ')}\\n`;
    }
    
    if (prefs.productos_vistos && prefs.productos_vistos.length > 0) {
      const ultimosVistos = prefs.productos_vistos.slice(-3);
      contextStr += `- Últimos productos vistos: ${ultimosVistos.map(p => p.nombre).join(', ')}\\n`;
    }
    
    if (prefs.historial_busquedas && prefs.historial_busquedas.length > 0) {
      const ultimasBusquedas = prefs.historial_busquedas.slice(-3);
      contextStr += `- Búsquedas recientes: ${ultimasBusquedas.map(b => b.query).join(', ')}\\n`;
    }
    
    if (prefs.rango_precio && prefs.rango_precio.max_buscado > 0) {
      contextStr += `- Rango de precio típico: $${prefs.rango_precio.min_buscado}-$${prefs.rango_precio.max_buscado}\\n`;
    }
    
    if (prefs.marcas_interes && prefs.marcas_interes.length > 0) {
      contextStr += `- Marcas de interés: ${prefs.marcas_interes.join(', ')}\\n`;
    }
/*    
    if (context.ultima_categoria) {
      contextStr += `- Última categoría vista: ${context.ultima_categoria}\\n`;
    }
    
    if (context.preferencias && context.preferencias.length > 0) {
      contextStr += `- Categorías de interés: ${context.preferencias.join(', ')}\\n`;
    }
  

    contextStr += '\\nUsa esta información para personalizar tus respuestas de manera natural.\\n';
*/

    contextStr += '\\n💡 Usa esta información para hacer recomendaciones personalizadas y recordar contexto previo.\\n';

console.log({obj: "UserContext", contextStr});

    
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