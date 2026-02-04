// daiko/src/tools/openai_tools.js
// ACTUALIZADO: V24.0 - PASO 8 (Normalización) + PASO 9 (Canonización) separados
// Según documento normativo MBC01 v2.2

const { obtenerCategorias, buscarProductos, obtenerDetalleProducto, agregarAlCarrito, agregarVariosArticulosAlCarrito, crearNuevoCarrito, crearNuevoCarritoConVariosArticulos, obtenerCarritosDisponibles, verCarrito, crearOrden, cancelarCarrito, generarPdf, copiarArticulosEntreCarritos, copiarArticulosDeUnCarritoExisenteAUnoNuevo } = require('../utils/crm');
const { ejecutarBusquedaExterna } = require('../utils/busqueda_externa_service');
const { resolverCanonico, resolverMultiplesCanonico } = require('../utils/canonicalizacion_service');
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
        description: "Reinicia la conversación y limpia el estado (Redis/contexto/paginación/filtros).",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false
        },
        strict: true
      }
    },
    // ============================================================
    // V24.0 - resolver_canonico ACTUALIZADO
    // Ejecuta PASO 8 (Normalización) + PASO 9 (Canonización)
    // ============================================================
    {
      type: "function",
      function: {
        name: "resolver_canonico",
        description: `V24.0: Ejecuta PASO 8 (Normalización) + PASO 9 (Canonización) según documento normativo v2.2.

PASO 8 (interno): Normaliza el token (trim, lowercase, singular, unidades)
PASO 9 (interno): Busca sinónimo en BD

Retorna:
- token_original: lo que envió el usuario
- token_normalizado: después de PASO 8
- token_canonico: después de PASO 9 (o null si no existe)
- token_final: el que debe usarse (canónico si existe, normalizado si no)

REGLAS (9.4):
- Si canonico ≠ null → usar canónico
- Si canonico = null → conservar normalizado
- NUNCA bloquea el flujo
- NUNCA produce errores`,
        parameters: {
          type: "object",
          properties: {
            token: {
              type: "string",
              description: "Token individual a procesar. Puede ser crudo (la función ejecuta normalización internamente)."
            }
          },
          required: ["token"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "obtener_categorias",
        description: "Obtiene el catálogo de categorías de los artículos. Usar cuando el usuario pregunta de forma genérica sin mencionar producto específico: 'qué vendes', 'qué productos tienes', 'en qué me ayudas', 'qué me puedes ofrecer', 'muéstrame tu catálogo'",
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
        description: "Busca productos en el catálogo. IMPORTANTE: query/categoria/etiquetas SOLO llevan el SUSTANTIVO. Todo lo demás (marca, medida, características) va en filtros.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "SOLO el sustantivo principal normalizado en SINGULAR (ejemplo: 'monitor', 'azucar', 'tuberia'). NUNCA incluir marca, medida ni características."
            },
            categoria: {
              type: ["string", "null"],
              description: "SOLO el sustantivo principal (igual que query)"
            },
            etiquetas: {
              type: ["string", "null"],
              description: "SOLO el sustantivo principal (igual que query)"
            },
            filtros: {
              type: "object",
              description: "Objeto con filtros estructurados. Cada campo es un array de strings normalizados en MAYUSCULAS.",
              properties: {
                marca: {
                  type: "array",
                  description: "Marcas (MAYUSCULAS): ['SAMSUNG', 'QIAN']",
                  items: { type: "string" }
                },
                tipo: {
                  type: "array",
                  description: "Tipos/variantes (MAYUSCULAS): ['MORENA', 'GALVANIZADA', 'ENTERA']",
                  items: { type: "string" }
                },
                medida: {
                  type: "array",
                  description: "Medidas normalizadas (MAYUSCULAS): ['450 GR', '2 LT', '24 PULGADAS']",
                  items: { type: "string" }
                },
                caracteristicas: {
                  type: "array",
                  description: "Características técnicas (MAYUSCULAS): ['VGA', 'HDMI', 'LED']",
                  items: { type: "string" }
                },
                compatibilidad: {
                  type: "array",
                  description: "Compatibilidad (MAYUSCULAS): ['WINDOWS 10', 'ANDROID']",
                  items: { type: "string" }
                }
              },
              required: ["marca", "medida", "caracteristicas", "tipo", "compatibilidad"],
              additionalProperties: false
            },
            precio_max: {
              type: ["number", "null"],
              description: "Precio maximo en USD"
            },
            current_page: {
              type: "integer",
              description: "Pagina actual - SIEMPRE usar 1 para primera busqueda"
            },
            per_page: {
              type: "integer",
              description: "Cantidad de productos a recuperar - DEBE SER SIEMPRE 100"
            },
          },
          required: ["query", "categoria", "etiquetas", "filtros", "precio_max", "current_page", "per_page"],
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
async function executeFunctionCall(name, args, userId, accountId = 0) {
    console.log(`🔧 Ejecutando función: ${name}`, args);
    console.log(`📋 Context: userId=${userId}, accountId=${accountId}`);

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

      // ============================================================
      // V24.0 - resolver_canonico ACTUALIZADO
      // Ejecuta PASO 8 (Normalización) + PASO 9 (Canonización)
      // ============================================================
      case "resolver_canonico": {
        console.log(`🔍 V24.0 - Procesando token: "${args.token}" (account: ${accountId})`);
        
        try {
          // Timeout de 2 segundos - FAIL-OPEN
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout en resolver_canonico')), 2000)
          );
          
          // Ejecutar PASO 8 + PASO 9 (internos en resolverCanonico)
          const resultado = await Promise.race([
            resolverCanonico(args.token, accountId),
            timeoutPromise
          ]);
          
          console.log(`✅ Resultado V24.0:`, {
            original: resultado.token_original,
            normalizado: resultado.token_normalizado,
            canonico: resultado.token_canonico,
            final: resultado.token_final,
            encontrado: resultado.encontrado
          });
          
          // Construir instrucción para el modelo (PASO 10)
          let instruction = "";
          
          if (resultado.token_canonico) {
            // Caso: Se encontró sinónimo canónico
            instruction = `INSTRUCCIÓN PASO 10: Usar "${resultado.token_final}" en buscar_productos. Token "${resultado.token_original}" → normalizado "${resultado.token_normalizado}" → canónico "${resultado.token_canonico}". EJECUTAR búsqueda inmediatamente.`;
          } else {
            // Caso: No hay sinónimo, usar normalizado
            instruction = `INSTRUCCIÓN PASO 10: Usar "${resultado.token_final}" en buscar_productos. Token "${resultado.token_original}" → normalizado "${resultado.token_normalizado}" (sin sinónimo registrado). EJECUTAR búsqueda inmediatamente.`;
          }
          
          // SIEMPRE success:true - NUNCA bloquear flujo (regla 9.4)
          return {
            success: true,
            
            // Datos del proceso completo
            token_original: resultado.token_original,
            token_normalizado: resultado.token_normalizado,
            token_canonico: resultado.token_canonico,
            token_final: resultado.token_final,
            
            // Metadata
            encontrado: resultado.encontrado,
            source: resultado.source,
            cambios_normalizacion: resultado.cambios_normalizacion,
            
            // Instrucción para PASO 10
            instruction: instruction,
            
            preserveCurrentCart: true
          };
          
        } catch (error) {
          // FAIL-OPEN: Timeout o error → normalización básica de emergencia
          console.warn(`⚠️ resolver_canonico error: ${error.message}`);
          console.log(`   → FAIL-OPEN: Aplicando normalización básica`);
          
          // Normalización mínima de emergencia
          const tokenNormalizado = args.token ? args.token.toLowerCase().trim() : args.token;
          
          return {
            success: true,  // CRÍTICO: success:true para NO bloquear flujo
            
            token_original: args.token,
            token_normalizado: tokenNormalizado,
            token_canonico: null,
            token_final: tokenNormalizado,
            
            encontrado: false,
            source: 'timeout_or_error',
            cambios_normalizacion: ['emergency_trim_lowercase'],
            
            instruction: `INSTRUCCIÓN PASO 10: Usar "${tokenNormalizado}" en buscar_productos (FAIL-OPEN por ${error.message}). EJECUTAR búsqueda inmediatamente.`,
            
            preserveCurrentCart: true
          };
        }
      }
        
      case "obtener_categorias":
        return obtenerCategorias();
        
      // ✅ ELIMINADOS: que_vendes y que_me_puedes_ofrecer (eran redundantes - usaban obtenerCategorias)
        
      case "seleccionar_categoria": 
        await userContext.addCategoria(args.category);     
        return buscarProductos(args.query, args.category, args.etiquetas, args.precio_max, args.current_page, args.per_page);
        
      case "buscar_por_etiquetas":      
        return buscarProductos(args.query, args.category, args.etiquetas, args.precio_max, args.current_page, args.per_page);
        
      case "tienes_mas": {
        console.log('🔄 FUNCIÓN tienes_mas - Mostrando siguiente página');
        
        // Recuperar búsqueda activa de Redis
        const busquedaActiva = await userContext.getBusquedaActiva();
        
        if (!busquedaActiva) {
          console.warn('⚠️ No hay búsqueda activa en Redis');
          return {
            success: false,
            message: "No hay búsqueda activa. Por favor, realiza una nueva búsqueda.",
            preserveCurrentCart: true
          };
        }
        
        console.log('🔍 Búsqueda activa encontrada:', {
          query: busquedaActiva.query,
          current_page: busquedaActiva.current_page,
          total: busquedaActiva.total_resultados,
          mostrados: busquedaActiva.mostrados
        });
        
        // Calcular siguiente página
        const paginaActual = busquedaActiva.current_page || 1;
        const siguientePagina = paginaActual + 1;
        
        // ✅ V22.0: Límite de 3 páginas
        if (siguientePagina > 3) {
          console.warn(`⚠️ Límite de páginas alcanzado (${siguientePagina} > 3)`);
          return {
            success: false,
            message: "Has alcanzado el límite de 3 páginas. Por favor, refina tu búsqueda para obtener resultados más específicos.",
            preserveCurrentCart: true
          };
        }
        
        console.log(`➡️ Avanzando a página ${siguientePagina}`);
        
        // Ejecutar búsqueda con mismos parámetros + nueva página
        const resultadoMas = await buscarProductos(
          busquedaActiva.query,
          busquedaActiva.query,  // categoria
          busquedaActiva.query,  // etiquetas
          null,  // precio_max
          siguientePagina,
          100,
          busquedaActiva.filtros || {
            marca: [],
            medida: [],
            caracteristicas: [],
            tipo: [],
            compatibilidad: []
          }
        );
        
        if (!resultadoMas.success) {
          return resultadoMas;
        }
        
        // Normalizar productos
        const productosNormalizados = (resultadoMas.data || [])
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
          return {
            success: false,
            message: "No hay más productos disponibles.",
            preserveCurrentCart: true
          };
        }
        
        // Recuperar hasta 100 productos
        const productosRecuperados = productosNormalizados.slice(0, 100);
        
        // ✅ V22.0: Calcular ventana de 6 productos para la página solicitada
        const PRODUCTOS_POR_PAGINA = 6;
        const startIndex = (siguientePagina - 1) * PRODUCTOS_POR_PAGINA;
        const endIndex = startIndex + PRODUCTOS_POR_PAGINA;
        const productosVentana = productosRecuperados.slice(startIndex, endIndex);
        
        console.log(`📦 Mostrando productos ${startIndex + 1}-${endIndex} (página ${siguientePagina})`);
        
        if (productosVentana.length === 0) {
          return {
            success: false,
            message: "No hay más productos en esta página.",
            preserveCurrentCart: true
          };
        }
        
        // Actualizar página en búsqueda activa
        await userContext.setBusquedaActiva({
          query: busquedaActiva.query,
          filtros: busquedaActiva.filtros,
          total_resultados: busquedaActiva.total_resultados,
          mostrados: endIndex,
          current_page: siguientePagina  // ✅ V22.0: Actualizar página
        });
        
        console.log(`✅ Página actualizada a ${siguientePagina} en Redis`);
        
        return {
          success: true,
          data: productosVentana,
          current_page: siguientePagina,
          total_disponibles: busquedaActiva.total_resultados,
          preserveCurrentCart: true
        };
      }
        
      case "buscar_productos": {
          console.log(`🔍 BÚSQUEDA DE PRODUCTOS - Query: "${args.query}"`);
          console.log(`📦 Filtros recibidos:`, JSON.stringify(args.filtros, null, 2));
          
          // ✅ Validar que filtros sea un objeto
          if (!args.filtros || typeof args.filtros !== 'object') {
            console.error('❌ ERROR: filtros debe ser un objeto');
            return {
              success: false,
              message: "Error interno: filtros invalido",
              preserveCurrentCart: true
            };
          }
          
          // ✅ Normalizar filtros vacíos a arrays vacíos
          const filtrosNormalizados = {
            marca: Array.isArray(args.filtros.marca) ? args.filtros.marca : [],
            medida: Array.isArray(args.filtros.medida) ? args.filtros.medida : [],
            caracteristicas: Array.isArray(args.filtros.caracteristicas) ? args.filtros.caracteristicas : [],
            tipo: Array.isArray(args.filtros.tipo) ? args.filtros.tipo : [],
            compatibilidad: Array.isArray(args.filtros.compatibilidad) ? args.filtros.compatibilidad : []
          };
          
          console.log(`✅ Filtros normalizados:`, JSON.stringify(filtrosNormalizados, null, 2));
          
          // ✅ Pasar filtros a buscarProductos
          const resultado = await buscarProductos(
            args.query, 
            args.categoria, 
            args.etiquetas, 
            args.precio_max, 
            args.current_page, 
            args.per_page,
            filtrosNormalizados  // ← NUEVO PARÁMETRO
          );
          
          // Log de búsqueda con filtros
          console.log(`📊 RESULTADO DE BÚSQUEDA:`, {
            success: resultado.success,
            totalProductos: resultado.data?.length || 0,
            mensaje: resultado.message,
            filtrosAplicados: Object.keys(filtrosNormalizados)
              .filter(k => filtrosNormalizados[k].length > 0)
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
          
          // ✅ NUEVO: Guardar filtros en contexto (siempre, para limpiar filtros anteriores)
          await userContext.setFiltrosActivos(filtrosNormalizados);
          
          // Guardar búsqueda en historial
          await userContext.addBusqueda(args.query, { 
            total_resultados: (resultado.data || []).length,
            filtros: filtrosNormalizados  // ← Guardar filtros aplicados
          });
  
          // Estado de búsqueda activa
          const productosApi = resultado.data || [];
          const productosNormalizadosBusqueda = productosApi
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
          
          if (!productosNormalizadosBusqueda.length) {
            console.warn(`⚠️ No hay productos normalizados válidos después del segundo filtro`);
            return {
              success: false,
              data: [],
              message: "No encontré productos disponibles para esta búsqueda.",
              preserveCurrentCart: true
            };
          }
          
          console.log(`✅ Productos normalizados finales: ${productosNormalizadosBusqueda.length}`);
          
          // ✅ V22.0: Paginación de 6 productos
          const PRODUCTOS_POR_PAGINA = 6;
          const currentPage = args.current_page || 1;
          
          // Recuperar hasta 100 productos para análisis
          const productosRecuperados = productosNormalizadosBusqueda.slice(0, 100);
          
          // Calcular índices para la ventana de 6 productos
          const startIndex = (currentPage - 1) * PRODUCTOS_POR_PAGINA;
          const endIndex = startIndex + PRODUCTOS_POR_PAGINA;
          
          // Obtener solo los 6 productos de la página actual
          const visibles = productosRecuperados.slice(startIndex, endIndex);
          
          // ✅ Usar el count total de la API, no el length del array
          const totalProductos = resultado.meta?.count || productosNormalizadosBusqueda.length;
          
          console.log(`📋 V22.0 - Página ${currentPage}: Mostrando productos ${startIndex + 1}-${Math.min(endIndex, totalProductos)} de ${totalProductos} totales`);
          
          // ✅ V22.0: Preparar descripciones para análisis semántico (solo si total > 6)
          let descripcionesParaAnalisis = null;
          if (totalProductos > 6) {
            descripcionesParaAnalisis = productosRecuperados.map(p => p.NOMBRE);
            console.log(`🔍 Enviando ${descripcionesParaAnalisis.length} descripciones al LLM para análisis semántico`);
          }
          
          await userContext.setBusquedaActiva({
            query: args.query,
            filtros: filtrosNormalizados,
            total_resultados: totalProductos,
            mostrados: endIndex,
            current_page: currentPage  // ✅ V22.0: Guardar página actual
          });

          // ✅ V25.0: Guardar últimos resultados para resolver referencias ("el primero", "el segundo")
          await userContext.setUltimosResultados(visibles);
          await userContext.setUltimaAccion('busqueda_productos');

        return {
          success: true,
          data: visibles,  // Solo 6 productos para mostrar
          total_disponibles: totalProductos,
          filtros_aplicados: filtrosNormalizados,
          descripciones_completas: descripcionesParaAnalisis,  // ✅ V22.0: Para análisis del LLM
          preserveCurrentCart: true
        };
      }

      case "obtener_detalle_producto": {
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
      }

      case "agregar_al_carrito": {
        const carritoId = args.carrito_id || await userContext.getCarrito();
        
        if (!carritoId) {
          return {
            success: false,
            message: "No tienes un carrito asignado. Primero crea uno.",
            preserveCurrentCart: true
          };
        }
        
        return await agregarAlCarrito(args.producto_id, args.cantidad, carritoId);
      }
      
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
        await userContext.setUltimaAccion('listar_carritos');
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