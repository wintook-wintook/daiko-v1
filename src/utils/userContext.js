// daiko/src/utils/userContext.js

const redis = require('../config/redis');

class UserContext {
  constructor(userId) {
    this.userId = userId;
    this.key = `user:${userId}:context`;
    this.ttl = 1800; // ✅ V22.0: 30 minutos (antes: 7 días)
  }

  // Obtener todo el contexto
  async get() {
    const data = await redis.hgetall(this.key);
    
    // Si no existe, devolver valores por defecto
    if (Object.keys(data).length === 0) {
      await this.setCliente({});
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

  // Guardar nombre del contacto (persona física, ej: senderName de Chatwoot)
  async setNombreContacto(nombre) {
    await redis.hset(this.key, 'nombre_contacto', nombre);
    await redis.expire(this.key, this.ttl);
  }

  // Obtener nombre del contacto
  async getNombreContacto() {
    return await redis.hget(this.key, 'nombre_contacto');
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
    const carrito = await redis.hget(this.key, 'carrito_id');
    return carrito !== null ? carrito : null;  // null solo si la clave no existe en Redis
  }

  // V25.0: Obtener folio del carrito activo
  async getFolio() {
    const folio = await redis.hget(this.key, 'folio');
    return folio || null;  // Devolver null si es vacío
  }

  // V25.0: Obtener últimos resultados de búsqueda (para resolver referencias)
  async getUltimosResultados() {
    const data = await redis.hget(this.key, 'ultimos_resultados');
    if (!data) {
      return [];
    }
    try {
      return JSON.parse(data);
    } catch (error) {
      console.error('❌ Error parseando ultimos_resultados:', error);
      return [];
    }
  }

  // V25.0: Guardar últimos resultados de búsqueda
  async setUltimosResultados(productos) {
    // Guardar solo los primeros 10 productos para resolver referencias
    const productosParaGuardar = (productos || []).slice(0, 10).map(function(p) {
      return {
        ARTICULO_ID: p.ARTICULO_ID,
        NOMBRE: p.NOMBRE,
        PRECIO: p.PRECIO
      };
    });
    await redis.hset(this.key, 'ultimos_resultados', JSON.stringify(productosParaGuardar));
    await redis.expire(this.key, this.ttl);
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
    if (prefs.historial_busquedas.length > 5) {
      prefs.historial_busquedas = prefs.historial_busquedas.slice(-5);
    }
    
    await this.setPreferencias(prefs);
  }


  // ✅ NUEVO V19.0: Guardar filtros activos
  async setFiltrosActivos(filtros) {
    await redis.hset(this.key, 'filtros_activos', JSON.stringify(filtros));
    await redis.expire(this.key, this.ttl);
    console.log(`💾 Filtros guardados en Redis para ${this.userId}:`, filtros);
  }

  // ✅ NUEVO V19.0: Obtener filtros activos
  async getFiltrosActivos() {
    const data = await redis.hget(this.key, 'filtros_activos');
    
    const filtrosPorDefecto = {
      marca: [],
      medida: [],
      caracteristicas: [],
      tipo: [],
      compatibilidad: []
    };
    
    if (!data) {
      return filtrosPorDefecto;
    }
    
    try {
      const parsed = JSON.parse(data);
      // Asegurar que todos los campos existan
      return {
        marca: parsed.marca || [],
        medida: parsed.medida || [],
        caracteristicas: parsed.caracteristicas || [],
        tipo: parsed.tipo || [],
        compatibilidad: parsed.compatibilidad || []
      };
    } catch (error) {
      console.error('❌ Error parseando filtros_activos:', error);
      return filtrosPorDefecto;
    }
  }


  // Guardar última acción ejecutada (para contexto del clasificador)
  async setUltimaAccion(accion) {
    await redis.hset(this.key, 'ultima_accion', accion);
    await redis.expire(this.key, this.ttl);
  }

  // Obtener última acción ejecutada
  async getUltimaAccion() {
    return await redis.hget(this.key, 'ultima_accion') || null;
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
    
    if (context.nombre_contacto) {
      contextStr += `- Nombre del contacto: ${context.nombre_contacto}\\n`;
    }
    if (context.nombre_usuario) {
      contextStr += `- Organización: ${context.nombre_usuario}\\n`;
    }
    
    if (context.carrito_id) {
      contextStr += `- CARRITO_ACTIVO: ID ${context.carrito_id} | FOLIO ${context.folio} \\n`;
    }else{
      contextStr += `- El usuario no tiene un carrito activo.\\n`;
    }
    
    /*
    // ❌ DESHABILITADO: Las categorías de interés NO deben influir en las búsquedas
    // El motor de búsqueda V18.0 usa búsqueda exhaustiva que no necesita este contexto
    if (prefs.categorias && prefs.categorias.length > 0) {
      contextStr += `- Categorías de interés: ${prefs.categorias.join(', ')}\\n`;
    }
    */
    
    if (prefs.productos_vistos && prefs.productos_vistos.length > 0) {
      const ultimosVistos = prefs.productos_vistos.slice(-3);
      contextStr += `- Últimos productos vistos: ${ultimosVistos.map(p => p.nombre).join(', ')}\\n`;
    }
    
    /*
    if (prefs.historial_busquedas && prefs.historial_busquedas.length > 0) {
      const ultimasBusquedas = prefs.historial_busquedas.slice(-3);
      contextStr += `- Búsquedas recientes: ${JSON.stringify(ultimasBusquedas)}\\n`;
    }
    */
    
    if (prefs.rango_precio && prefs.rango_precio.max_buscado > 0) {
      contextStr += `- Rango de precio típico: $${prefs.rango_precio.min_buscado}-$${prefs.rango_precio.max_buscado}\\n`;
    }
    
    if (prefs.marcas_interes && prefs.marcas_interes.length > 0) {
      contextStr += `- Marcas de interés: ${prefs.marcas_interes.join(', ')}\\n`;
    }

    // ✅ NUEVO V19.0: Información de filtros activos
    const filtrosActivos = await this.getFiltrosActivos();
    const hayFiltros = Object.values(filtrosActivos).some(arr => arr.length > 0);
        
    if (hayFiltros) {
      contextStr += `\n📦 FILTROS ACTIVOS:\n`;
      if (filtrosActivos.marca.length > 0) {
        contextStr += `- Marca: ${filtrosActivos.marca.join(', ')}\n`;
      }
      if (filtrosActivos.medida.length > 0) {
        contextStr += `- Medida: ${filtrosActivos.medida.join(', ')}\n`;
      }
      if (filtrosActivos.caracteristicas.length > 0) {
        contextStr += `- Características: ${filtrosActivos.caracteristicas.join(', ')}\n`;
      }
      if (filtrosActivos.tipo.length > 0) {
        contextStr += `- Tipo: ${filtrosActivos.tipo.join(', ')}\n`;
      }
      if (filtrosActivos.compatibilidad.length > 0) {
        contextStr += `- Compatibilidad: ${filtrosActivos.compatibilidad.join(', ')}\n`;
      }
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



    // ===============================
    // ESTADO DE BÚSQUEDA ACTIVA  - 18 Dic 2025
    // SOLUCIÓN: Guardar estado en Redis PERO NO mostrarlo al LLM
    // ===============================
    
    // ✅ SÍ obtener el estado (para uso interno de las funciones)
    const busquedaActiva = await this.getBusquedaActiva();
    
    // ❌ PERO NO agregarlo al contextStr que ve el LLM
    // Esto evita que el LLM vea "total_resultados=55" y decida NO ejecutar funciones
    
    // Solo log para debugging (opcional)
    if (busquedaActiva) {
      console.log('🔍 Búsqueda activa (solo interno, NO visible al LLM):', {
        query: busquedaActiva.query,
        total: busquedaActiva.total_resultados,
        mostrados: busquedaActiva.mostrados
      });
    }
    
    // FIN ESTADO DE BÚSQUEDA ACTIVA 


    
    return contextStr;
  }

  // Limpiar contexto (opcional)
  async clear() {
    await redis.del(this.key);
    return true;
  }


  // Reiniciar contexto a valores por defecto
  async reset() {
    console.log('🔄 EJECUTANDO RESET - Limpiando contexto completo');
    
    // Usar pipeline para eficiencia
    const pipeline = redis.pipeline();
    
    // Limpiar campos relacionados con el carrito (usar hset con vacío en lugar de hdel)
    pipeline.hset(this.key, 'carrito_id', '');
    pipeline.hset(this.key, 'folio', '');

    // ✅ Limpiar búsqueda activa
    console.log('🗑️ Limpiando busqueda_activa de Redis');
    pipeline.hset(this.key, 'busqueda_activa', '');

    pipeline.hset(this.key, 'filtros_activos', '');
    pipeline.hset(this.key, 'ultimos_resultados', '');
    pipeline.hset(this.key, 'ultima_accion', '');
    pipeline.hset(this.key, 'wizard_state', '');
    pipeline.hset(this.key, 'modo_vendedor', 'false');
    pipeline.hset(this.key, 'cliente_vendedor', '');
    pipeline.hset(this.key, 'modo_refacciones', 'false');
    pipeline.hset(this.key, 'filtro_existencia', 'false');

    // Establecer valores básicos
    pipeline.hset(this.key, 'nombre_usuario', '');
    pipeline.hset(this.key, 'nombre_contacto', '');
    pipeline.hset(this.key, 'cliente', JSON.stringify({}));
    pipeline.hset(this.key, 'ultima_categoria', '');
    pipeline.hset(this.key, 'created_at', new Date().toISOString());
    pipeline.hset(this.key, 'updated_at', new Date().toISOString());
    
    // Establecer preferencias por defecto (estructura completa)
    const defaultPreferencias = {
      categorias: [],
      productos_vistos: [],
      historial_busquedas: [],
      rango_precio: { min: 0, max: 0, promedio: 0 },
      marcas_interes: [],
      etiquetas_interes: []
    };
    pipeline.hset(this.key, 'preferencias', JSON.stringify(defaultPreferencias));
    
    // Establecer TTL
    pipeline.expire(this.key, this.ttl);
    
    await pipeline.exec();
    
    console.log(`✅ Contexto reiniciado para usuario ${this.userId}`);
    
    // ✅ Verificar que se limpió
    const estadoDespues = await this.getBusquedaActiva();
    console.log('🔍 Estado después de reset:', estadoDespues);
    
    return true;
  }


  // ===============================
  // BÚSQUEDA ACTIVA (PAGINACIÓN) - 15 Dic 2025
  // ===============================

  async setBusquedaActiva(data) {
    console.log(`💾 GUARDANDO búsqueda activa:`, data);
    
    // ✅ Asegurar que filtros y current_page estén incluidos
    const dataConFiltros = {
      query: data.query,
      filtros: data.filtros || {
        marca: [],
        medida: [],
        caracteristicas: [],
        tipo: [],
        compatibilidad: []
      },
      total_resultados: data.total_resultados,
      mostrados: data.mostrados,
      current_page: data.current_page || 1  // ✅ V22.0: Guardar página actual
    };
    
    await redis.hset(this.key, 'busqueda_activa', JSON.stringify(dataConFiltros));
    await redis.expire(this.key, this.ttl);
    console.log(`✅ Búsqueda guardada en Redis para ${this.userId} - Página ${dataConFiltros.current_page}`);
  }

  async getBusquedaActiva() {
    const v = await redis.hget(this.key, 'busqueda_activa');
    
    if (!v) {
      return null;
    }
    
    try {
      const parsed = JSON.parse(v);
      
      // ✅ Asegurar que filtros esté incluido
      if (!parsed.filtros) {
        parsed.filtros = {
          marca: [],
          medida: [],
          caracteristicas: [],
          tipo: [],
          compatibilidad: []
        };
      }
      
      return parsed;
    } catch (error) {
      console.error('❌ Error parseando busqueda_activa:', error);
      return null;
    }
  }

  async clearBusquedaActiva() {
    await redis.hdel(this.key, 'busqueda_activa');
  }

  // FIN BÚSQUEDA ACTIVA (PAGINACIÓN)


  // Extender TTL
  async keepAlive() {
    await redis.expire(this.key, this.ttl);
  }

  /**
   * Obtiene todo el contexto necesario para el clasificador en UNA sola llamada Redis.
   * Reemplaza 5 hget individuales por 1 hgetall.
   */
  async getClasificadorContext() {
    const data = await redis.hgetall(this.key);

    let ultimaBusqueda = null;
    if (data.busqueda_activa) {
      try {
        ultimaBusqueda = JSON.parse(data.busqueda_activa);
        if (!ultimaBusqueda.filtros) {
          ultimaBusqueda.filtros = { marca: [], medida: [], caracteristicas: [], tipo: [], compatibilidad: [] };
        }
      } catch (e) {
        ultimaBusqueda = null;
      }
    }

    let productos = [];
    if (data.ultimos_resultados) {
      try {
        productos = JSON.parse(data.ultimos_resultados);
      } catch (e) {
        productos = [];
      }
    }

    let clienteVendedor = false;
    if (data.cliente_vendedor) {
      try {
        const cv = JSON.parse(data.cliente_vendedor);
        clienteVendedor = !!(cv && cv.CLIENTE_ID);
      } catch (e) {}
    }

    return {
      carritoId: data.carrito_id || null,
      folio: data.folio || null,
      ultimaBusqueda,
      productos,
      ultimaAccion: data.ultima_accion || null,
      modoVendedor: data.modo_vendedor === 'true',
      clienteVendedor
    };
  }

  // ============================================================
  // MODO VENDEDOR
  // ============================================================

  async setModoVendedor(activo) {
    await redis.hset(this.key, 'modo_vendedor', activo ? 'true' : 'false');
    if (activo) {
      await redis.hset(this.key, 'carrito_id', '');
      await redis.hset(this.key, 'folio', '');
    }
    await redis.expire(this.key, this.ttl);
  }

  async setClienteVendedor(clienteData) {
    await redis.hset(this.key, 'cliente_vendedor', JSON.stringify(clienteData));
    await redis.expire(this.key, this.ttl);
  }

  async getClienteVendedor() {
    const data = await redis.hget(this.key, 'cliente_vendedor');
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch (e) {
      return null;
    }
  }

  async clearModoVendedor() {
    await redis.hdel(this.key, 'modo_vendedor', 'cliente_vendedor', 'cliente');
    await redis.hset(this.key, 'carrito_id', '');
    await redis.hset(this.key, 'folio', '');
  }

  // ============================================================
  // WIZARD STATE (flujos paso a paso, ej: /+prospecto)
  // ============================================================

  async setWizardState(state) {
    await redis.hset(this.key, 'wizard_state', JSON.stringify(state));
    await redis.expire(this.key, this.ttl);
  }

  async getWizardState() {
    const data = await redis.hget(this.key, 'wizard_state');
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch (e) {
      return null;
    }
  }

  async clearWizardState() {
    await redis.hdel(this.key, 'wizard_state');
  }

  async getComandoActivo() {
    const [modoVendedor, wizardRaw, modoRefacciones] = await Promise.all([
      redis.hget(this.key, 'modo_vendedor'),
      redis.hget(this.key, 'wizard_state'),
      redis.hget(this.key, 'modo_refacciones')
    ]);
    if (modoVendedor === 'true') return {
      tipo: 'vendedor',
      mensaje: 'Ya tienes el modo cotizar activo. Escribe /salir para finalizarlo antes de iniciar otro comando.'
    };
    if (modoRefacciones === 'true') return {
      tipo: 'refacciones',
      mensaje: 'Ya tienes el modo refacciones activo. Escribe /salir_refacciones para finalizarlo antes de iniciar otro comando.'
    };
    if (wizardRaw) {
      try {
        const ws = JSON.parse(wizardRaw);
        if (ws && ws.tipo) return {
          tipo: ws.tipo,
          mensaje: `Ya tienes el comando /${ws.tipo} activo. Escribe /salir para finalizarlo antes de iniciar otro comando.`
        };
      } catch (e) {}
    }
    return null;
  }

  // ============================================================
  // MODO REFACCIONES
  // ============================================================

  async setModoRefacciones(activo) {
    await redis.hset(this.key, 'modo_refacciones', activo ? 'true' : 'false');
    await redis.expire(this.key, this.ttl);
  }

  async getModoRefacciones() {
    const v = await redis.hget(this.key, 'modo_refacciones');
    return v === 'true';
  }

  // ============================================================
  // FILTRO "SOLO CON EXISTENCIA"
  // ============================================================

  async setFiltroExistencia(activo) {
    await redis.hset(this.key, 'filtro_existencia', activo ? 'true' : 'false');
    await redis.expire(this.key, this.ttl);
  }

  async getFiltroExistencia() {
    const v = await redis.hget(this.key, 'filtro_existencia');
    return v === 'true';
  }
}

module.exports = UserContext;