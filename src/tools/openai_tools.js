// daiko/src/tools/openai_tools.js

const { obtenerCategorias, buscarProductos, obtenerDetalleProducto, agregarAlCarrito, agregarVariosArticulosAlCarrito, crearNuevoCarrito, crearNuevoCarritoConVariosArticulos, obtenerCarritosDisponibles, verCarrito, crearOrden, cancelarCarrito, generarPdf, copiarArticulosEntreCarritos, copiarArticulosDeUnCarritoExisenteAUnoNuevo } = require('../utils/crm');
const { ejecutarBusquedaExterna } = require('../utils/busqueda_externa_service');
const UserContext = require('../utils/userContext');

const functionDefinitions = [
    {
      type: "function",
      function: {
        name: "saludo",
        description: "Se ejecuta cuando el usuario envía cualquier tipo de saludo o expresión de cortesía. Ejemplos: 'hola', 'buenos días', 'buenas tardes', 'buenas noches', 'qué tal', 'cómo estás', 'hey', 'saludos', 'buen día', o cualquier variación de saludo en español",
        parameters: {
          type: "object",
          properties: {
            tipo_saludo: {
              type: "string",
              description: "El tipo de saludo detectado (formal, informal, temporal como buenos días/tardes/noches)",
              enum: ["formal", "informal", "temporal", "general"]
            },
            nombre_usuario: {
              type: "string",
              description: "Nombre del usuario si lo menciona en el saludo"
            }
          },
          required: ["tipo_saludo", "nombre_usuario"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "reiniciar",
        description: "Reinicia la conversacion",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Filtro a aplicar"
            },          
          },
          required: ["query"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "obtener_categorias",
        description: "Obtiene el catálogo de categorías de los artículos",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Filtro a aplicar al catálogo de categorias"
            },          
          },
          required: ["query"],
          additionalProperties: false
        },
        strict: true
      }
    },
   
    {
      type: "function",
      function: {
        name: "tienes_mas",
        description: "Muestra los SIGUIENTES productos de la búsqueda activa actual. USA ESTA FUNCIÓN OBLIGATORIAMENTE cuando el usuario pida: 'hay más', 'tienes más', 'muestra más', 'más opciones', 'siguiente', 'otros productos', 'ver más'. Esta función NO requiere parámetros porque lee automáticamente la búsqueda anterior del contexto. NUNCA uses buscar_productos cuando el usuario solo pide ver más de lo mismo.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false
        },
        strict: true
      }
    },

    {
      type: "function",
      function: {
        name: "que_vendes",
        description: "Obtiene el catálogo de categorías de los artículos",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Filtro a aplicar al catálogo de categorias"
            },          
          },
          required: ["query"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "que_me_puedes_ofrecer",
        description: "Obtiene el catálogo de categorías de los artículos",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Filtro a aplicar al catálogo de categorias"
            },          
          },
          required: ["query"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "seleccionar_categoria",
        description: "Obtiene productos de una categoría especificada",
        parameters: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description: "Filtra el catálogo de productos usando la categoría seleccionada"
            },
            current_page: {
              type: "integer",
              description: "Página actual para el listado de los productos"
            },
            per_page: {
              type: "integer",
              description: "Cantidad de productos a listar"
            },
          },
          required: ["category", "current_page", "per_page"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "buscar_por_etiquetas",
        description: "Busca productos específicamente por etiquetas o tags",
        parameters: {
          type: "object",
          properties: {
            etiquetas: {
              type: "array",
              description: "Lista de etiquetas a buscar",
              items: {
                type: "string"
              },
              minItems: 1
            },
            current_page: {
              type: "integer",
              description: "Página actual para el listado de los productos"
            },
            per_page: {
              type: "integer",
              description: "Cantidad de productos a listar"
            },
          },
          required: ["etiquetas", "current_page", "per_page"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "buscar_productos",
        description: "Busca productos en el catálogo",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Término de búsqueda: SOLO el sustantivo principal en SINGULAR (ejemplo: 'azucar refinada' → 'azucar', 'leche entera' → 'leche', 'arroz blanco' → 'arroz'). NO incluir adjetivos ni modificadores."
            },
            categoria: {
              type: ["string", "null"],
              description: "Categoría específica para filtrar productos"
            },
            etiquetas: {
              type: ["array", "null"],
              description: "Lista de etiquetas para filtrar productos",
              items: {
                type: "string"
              }
            },
            precio_max: {
              type: ["number", "null"],
              description: "Precio máximo en USD"
            },
            current_page: {
              type: "integer",
              description: "Página actual para el listado de los productos"
            },
            per_page: {
              type: "integer",
              description: "Cantidad de productos a listar"
            },
          },
          required: ["query", "categoria", "etiquetas", "precio_max", "current_page", "per_page"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "agregar_varios_articulos_al_carrito",
        description: "Agrega MÚLTIPLES productos al carrito en una sola operación",
        parameters: {
          type: "object",
          properties: {
            carrito_id: {
              type: "string",
              description: "ID del carrito donde se agregarán los productos"
            },
            productos: {
              type: "array",
              description: "Lista de productos a agregar al carrito",
              items: {
                type: "object",
                properties: {
                  articulo_id: {
                    type: "integer",
                    description: "ID del producto a agregar"
                  },
                  unidades: {
                    type: "integer",
                    minimum: 1,
                    description: "Cantidad de unidades del producto"
                  }
                },
                required: ["articulo_id", "unidades"],
                additionalProperties: false
              },
              minItems: 1
            }
          },
          required: ["carrito_id", "productos"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "agregar_al_carrito",
        description: "Agrega UN ÚNICO producto al carrito",
        parameters: {
          type: "object",
          properties: {
            producto_id: {
              type: "integer",
              description: "ID del producto a agregar"
            },
            cantidad: {
              type: "integer",
              minimum: 1,            
              description: "Cantidad de unidades"
            },
            carrito_id: {
              type: "string", 
              description: "ID del usuario"
            }
          },
          required: ["producto_id", "cantidad", "carrito_id"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "crear_nuevo_carrito_con_varios_articulos",
        description: "Crea un carrito de productos con MÚLTIPLES productos en una sola operación",
        parameters: {
          type: "object",
          properties: {
            productos: {
              type: "array",
              description: "Lista de productos para crear el carrito",
              items: {
                type: "object",
                properties: {
                  articulo_id: {
                    type: "integer",
                    description: "ID del producto a agregar"
                  },
                  unidades: {
                    type: "integer",
                    minimum: 1,
                    description: "Cantidad de unidades del producto"
                  }
                },
                required: ["articulo_id", "unidades"],
                additionalProperties: false
              },
              minItems: 1
            }
          },
          required: ["productos"],
          additionalProperties: false
        },        
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "crear_nuevo_carrito",
        description: "Crea un carrito con un producto",
        parameters: {
          type: "object",
          properties: {
            producto_id: {
              type: "integer",
              description: "ID del producto a agregar"
            },
            cantidad: {
              type: "integer",
              minimum: 1,            
              description: "Cantidad de unidades"
            }
          },
          required: ["producto_id", "cantidad"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "remover_articulo_del_carrito",
        description: "Remover un artículo del carrito",
        parameters: {
          type: "object",
          properties: {
            producto_id: {
              type: "integer",
              description: "ID del producto a agregar"
            },
            carrito_id: {
              type: "string", 
              description: "ID del usuario"
            }
          },
          required: ["producto_id", "carrito_id"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "actualizar_articulo_del_carrito",
        description: "Actualiza las unidades de un artículo del carrito",
        parameters: {
          type: "object",
          properties: {
            producto_id: {
              type: "integer",
              description: "ID del producto a agregar"
            },
            cantidad: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              description: "Cantidad de unidades"
            },
            carrito_id: {
              type: "string", 
              description: "ID del usuario"
            }
          },
          required: ["producto_id", "cantidad", "carrito_id"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "obtener_carritos_disponibles",
        description: "Función para obtener los carritos disponibles",
        parameters: {
          type: "object",
          properties: {          
          },
          required: [],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "ver_carrito",
        description: "Muestra el contenido del carrito del usuario",
        parameters: {
          type: "object",
          properties: {
            carrito_id: {
              type: "string",
              description: "ID del carrito elegido"
            }
          },
          required: ["carrito_id"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "asignar_carrito",
        description: "Asigna un carrito como elegido",
        parameters: {
          type: "object",
          properties: {
            carrito_id: {
              type: "string",
              description: "ID del carrito a asignar"
            }
          },
          required: ["carrito_id"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "cancelar_carrito",
        description: "Cancelar un carrito",
        parameters: {
          type: "object",
          properties: {
            carrito_id: {
              type: "string",
              description: "ID del carrito elegido"
            }
          },
          required: ["carrito_id"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "generar_pdf",
        description: "Crear PDF de un carrito proporcionado",
        parameters: {
          type: "object",
          properties: {
            carrito_id: {
              type: "string",
              description: "ID del carrito elegido"
            }
          },
          required: ["carrito_id"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "crear_orden",
        description: "Crea una orden de compra con los productos del carrito",
        parameters: {
          type: "object",
          properties: {
            carrito_id: {
              type: "integer",
              description: "ID del usuario"
            }
          },
          required: ["carrito_id"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "consultar_orden",
        description: "Consulta el estado de una orden específica",
        parameters: {
          type: "object",
          properties: {
            orden_id: {
              type: "string",
              description: "ID de la orden a consultar"
            }
          },
          required: ["orden_id"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "generar_factura",
        description: "Genera la factura de una orden confirmada",
        parameters: {
          type: "object",
          properties: {
            orden_id: {
              type: "string",
              description: "ID de la orden para facturar"
            }
          },
          required: ["orden_id"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "copiar_articulos_entre_carritos",
        description: "Copia artículos de un carrito origen a un carrito destino",
        parameters: {
          type: "object",
          properties: {
            carrito_origen_id: {
              type: "string",
              description: "ID del carrito desde donde se copiarán los artículos"
            },
            carrito_destino_id: {
              type: "string",
              description: "ID del carrito donde se agregarán los artículos copiados"
            },
            articulos_especificos: {
              type: ["array", "null"],
              description: "Lista de artículos específicos a copiar con sus cantidades",
              items: {
                type: "object",
                properties: {
                  articulo_id: {
                    type: "integer",
                    description: "ID del artículo a copiar"
                  },
                  cantidad: {
                    type: ["integer", "null"],
                    description: "Cantidad a copiar"
                  }
                },
                required: ["articulo_id", "cantidad"],
                additionalProperties: false
              }
            },
            modo_copia: {
              type: "string",
              description: "Modo de copia",
              enum: ["todos", "especificos"]
            }
          },
          required: ["carrito_origen_id", "carrito_destino_id", "articulos_especificos", "modo_copia"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "copiar_articulos_de_un_carrito_exisente_a_uno_nuevo",
        description: "Copia artículos de un carrito origen a un carrito nuevo",
        parameters: {
          type: "object",
          properties: {
            carrito_origen_id: {
              type: "string",
              description: "ID del carrito desde donde se copiarán los artículos"
            },            
            articulos_especificos: {
              type: ["array", "null"],
              description: "Lista de artículos específicos a copiar",
              items: {
                type: "object",
                properties: {
                  articulo_id: {
                    type: "integer",
                    description: "ID del artículo a copiar"
                  },
                  cantidad: {
                    type: ["integer", "null"],
                    description: "Cantidad a copiar"
                  }
                },
                required: ["articulo_id", "cantidad"],
                additionalProperties: false
              }
            },
            modo_copia: {
              type: "string",
              description: "Modo de copia",
              enum: ["todos", "especificos"]
            }
          },
          required: ["carrito_origen_id", "articulos_especificos", "modo_copia"],
          additionalProperties: false
        },
        strict: true
      }
    }
  ];

  
// ===== ROUTER PARA MANEJAR FUNCTION CALLS =====
async function executeFunctionCall(name, args, userId) {
    console.log(`🔧 Ejecutando función: ${name}`, args);

    // Crear instancia de contexto para este usuario
    const userContext = new UserContext(userId);
    
    switch (name) {
      case "saludo":    
        // Guardar nombre si lo proporciona
        if (args.nombre_usuario) {
          await userContext.setNombre(args.nombre_usuario);
        }

        const nombreGuardado = await userContext.getNombre();
        const nombre = args.nombre_usuario || nombreGuardado;
        const nombrePersonalizado = nombre ? ` ${nombre}` : "";
        
        return {
          success: true,
          data: [],
          message: `¡Hola${nombrePersonalizado}! Soy tu asesor comercial y estoy aquí para ayudarte con tu proceso de compra. ¿En qué puedo asistirte hoy?`,
          preserveCurrentCart: true
        };
        
      case "reiniciar":
        await userContext.reset();
        return {
          success: true,
          data: [],
          message: `Claro, a partir de este momento inicia una conversación nueva`,
          preserveCurrentCart: false
        };
        
      case "obtener_categorias":
        return obtenerCategorias();
        
      case "que_vendes":
        return obtenerCategorias();
        
      case "que_me_puedes_ofrecer":
        return obtenerCategorias();
        
      case "seleccionar_categoria": 
        await userContext.addCategoria(args.category);     
        return buscarProductos(args.query, args.category, args.etiquetas, args.precio_max, args.current_page, args.per_page);
        
      case "buscar_por_etiquetas":      
        return buscarProductos(args.query, args.category, args.etiquetas, args.precio_max, args.current_page, args.per_page);
        
      case "buscar_productos":
        console.log(`🔍 BÚSQUEDA DE PRODUCTOS - Query: "${args.query}"`);
        
        const resultado = await buscarProductos(
          args.query, 
          args.categoria, 
          args.etiquetas, 
          args.precio_max, 
          args.current_page, 
          args.per_page
        );
        
        console.log(`📊 RESULTADO DE BÚSQUEDA:`, {
          success: resultado.success,
          totalProductos: resultado.data?.length || 0,
          mensaje: resultado.message
        });
        
        // ✅ VALIDACIÓN CRÍTICA ADICIONAL
        // Verificar que TODOS los productos tengan ARTICULO_ID válido
        if (resultado.success && resultado.data && Array.isArray(resultado.data)) {
          const productosConId = resultado.data.filter(p => 
            p.ARTICULO_ID !== undefined && 
            p.ARTICULO_ID !== null && 
            p.ARTICULO_ID !== ''
          );
          
          if (productosConId.length === 0) {
            console.warn(`⚠️ ALERTA: Todos los productos fueron filtrados por falta de ARTICULO_ID`);
            return {
              success: false,
              data: [],
              message: "No encontré productos disponibles con información completa para esta búsqueda.",
              preserveCurrentCart: true
            };
          }
          
          if (productosConId.length < resultado.data.length) {
            console.warn(`⚠️ FILTRADOS ${resultado.data.length - productosConId.length} productos sin ARTICULO_ID`);
          }
          
          // Log de productos válidos para debugging
          console.log(`✅ Productos válidos con ID:`, productosConId.map(p => ({
            id: p.ARTICULO_ID,
            nombre: p.NOMBRE
          })));
          
          // Actualizar resultado con solo productos válidos
          resultado.data = productosConId;
        }
        
        // Guardar preferencias
        if (args.categoria) {
          await userContext.addCategoria(args.categoria);
        }
        
        if (args.precio_max) {
          await userContext.updateRangoPrecio(args.precio_max);
        }
        
        // Guardar búsqueda en historial
        await userContext.addBusqueda(args.query, { 
          total_resultados: (resultado.data || []).length 
        });

        // Estado de búsqueda activa
        const productosApi = resultado.data || [];
        const productosNormalizados = productosApi
          .map(p => ({
            ARTICULO_ID: p.ARTICULO_ID,
            NOMBRE: p.NOMBRE,
            PRECIO: p.PRECIO
          }))
          .filter(p =>
            p.ARTICULO_ID !== undefined &&
            p.ARTICULO_ID !== null &&
            p.NOMBRE &&
            p.PRECIO !== undefined
          );
        
        if (!productosNormalizados.length) {
          console.warn(`⚠️ No hay productos normalizados válidos después del segundo filtro`);
          return {
            success: false,
            data: [],
            message: "No encontré productos disponibles para esta búsqueda.",
            preserveCurrentCart: true
          };
        }
        
        console.log(`✅ Productos normalizados finales: ${productosNormalizados.length}`);
        
        const LIMITE = 5;
        const visibles = productosNormalizados.slice(0, LIMITE);
        
        // ✅ Usar el count total de la API, no el length del array
        const totalProductos = resultado.meta?.count || productosNormalizados.length;
        
        console.log(`📋 Productos a mostrar al usuario: ${visibles.length}/${totalProductos}`);
        
        await userContext.setBusquedaActiva({
          query: args.query,
          total_resultados: totalProductos,  // ✅ Total real de la API
          mostrados: visibles.length
        });
        
        return {
          success: true,
          data: visibles,
          preserveCurrentCart: true
        };
      
      case "tienes_mas":
        console.log('📞 Ejecutando tienes_mas (mostrar siguientes productos)');
        
        const estado = await userContext.getBusquedaActiva();

        if (!estado || !estado.query) {
          console.warn('⚠️ tienes_mas: No hay búsqueda activa en el estado');
          return {
            success: false,
            message: "No hay una búsqueda activa para mostrar más productos.",
            preserveCurrentCart: true
          };
        }
        
        console.log(`🔍 tienes_mas: Continuando búsqueda "${estado.query}" desde producto ${estado.mostrados + 1}`);
      
        const resultadoTM = await buscarProductos(
          estado.query,
          null,
          null,
          null,
          1,
          1000
        );
      
        const productosTM = resultadoTM.data || [];
        
        // ✅ Usar el total del estado (que viene del meta.count original)
        const total = estado.total_resultados;
      
        if (estado.mostrados >= total) {
          return {
            success: true,
            data: [],
            message: "No hay más productos disponibles para esta búsqueda.",
            preserveCurrentCart: true
          };
        }
      
        const LIMITETM = 5;
        const inicio = estado.mostrados;
        const fin = inicio + LIMITETM;
      
        const visiblesTM = productosTM.slice(inicio, fin);
      
        // ✅ Mantener el total_resultados del estado (NO sobrescribir)
        await userContext.setBusquedaActiva({
          query: estado.query,
          total_resultados: estado.total_resultados,  // ✅ Mantener el original
          mostrados: estado.mostrados + visiblesTM.length
        });
      
        return {
          success: true,
          data: visiblesTM,
          preserveCurrentCart: true
        };

      case "obtener_detalle_producto":
        const detalle = await obtenerDetalleProducto(args.id);
      
        if (detalle.success) {
          await userContext.addProductoVisto(
            detalle.data.articulo_id, 
            detalle.data.nombre
          );
          
          if (detalle.data.marca) {
            await userContext.addMarca(detalle.data.marca);
          }
        }
        
        return detalle;

      case "agregar_al_carrito":
        const carritoId = args.carrito_id || await userContext.getCarrito();
        
        if (!carritoId) {
          return {
            success: false,
            message: "No tienes un carrito asignado. Primero crea uno.",
            preserveCurrentCart: true
          };
        }
        
        return await agregarAlCarrito(args.producto_id, args.cantidad, carritoId);
      
      case "agregar_varios_articulos_al_carrito":
        return agregarVariosArticulosAlCarrito(args.carrito_id, args.productos);
  
      case "remover_articulo_del_carrito":
        return agregarAlCarrito(args.producto_id, args.cantidad, args.carrito_id, "remove");
      
      case "actualizar_articulo_del_carrito":
        return agregarAlCarrito(args.producto_id, args.cantidad, args.carrito_id, "update");
  
      case "crear_nuevo_carrito":
        const nuevoCarrito = await crearNuevoCarrito(args.producto_id, args.cantidad);
        
        if (nuevoCarrito.success && nuevoCarrito.carritoId) {          
          await userContext.setCarrito(nuevoCarrito.carritoId, nuevoCarrito.folio);
        }
        
        return nuevoCarrito;

      case "crear_nuevo_carrito_con_varios_articulos":
        const carritoN = await crearNuevoCarritoConVariosArticulos(args.productos);

        if(carritoN.success){
          await userContext.setCarrito(carritoN.carritoId, carritoN.folio);
        }

        return carritoN;
  
      case "obtener_carritos_disponibles":
        return obtenerCarritosDisponibles();
      
      case "ver_carrito":
        const carrito = await verCarrito(args.carrito_id);
        return carrito;

      case "asignar_carrito":
        const carritoA = await verCarrito(args.carrito_id);
        await userContext.setCarrito(carritoA.data.importeCarrito.ID_CARRITO, carritoA.data.importeCarrito.FOLIO);
        return carritoA;

      case "cancelar_carrito":
        return cancelarCarrito(args.carrito_id);

      case "generar_pdf":
        return generarPdf(args.carrito_id);
      
      case "crear_orden":
        return crearOrden(args.carrito_id);
      
      case "consultar_orden":
        return consultarOrden(args.orden_id);
      
      case "generar_factura":
        return generarFactura(args.orden_id);

      case "copiar_articulos_entre_carritos":
        return copiarArticulosEntreCarritos(
          args.carrito_origen_id,
          args.carrito_destino_id,
          args.articulos_especificos,
          args.modo_copia
        );

      case "copiar_articulos_de_un_carrito_exisente_a_uno_nuevo":
        const carritoEN = await copiarArticulosDeUnCarritoExisenteAUnoNuevo(
          args.carrito_origen_id,          
          args.articulos_especificos,
          args.modo_copia
        );

        if(carritoEN.success){
          await userContext.setCarrito(carritoEN.data.carrito_destino_id, carritoEN.data.folio);
        }

        return carritoEN;
      
      default:
        return {
          success: false,
          message: `Función ${name} no implementada`,
          preserveCurrentCart: true
        };
    }
  }

  module.exports = {
    functionDefinitions,    
    executeFunctionCall
  };