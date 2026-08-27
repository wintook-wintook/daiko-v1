// daiko/src/tools/openai_tools.js
// ACTUALIZADO: V24.0 - PASO 8 (Normalización) + PASO 9 (Canonización) separados
// Según documento normativo MBC01 v2.2

const { obtenerCategorias, buscarProductos, obtenerDetalleProducto, agregarAlCarrito, agregarVariosArticulosAlCarrito, crearNuevoCarrito, crearNuevoCarritoConVariosArticulos, obtenerCarritosDisponibles, verCarrito, crearOrden, cancelarCarrito, generarPdf, copiarArticulosEntreCarritos, copiarArticulosDeUnCarritoExisenteAUnoNuevo, actualizarObservaciones, consultarAtributoProducto, buscarClientesPorNombre, buscarClientePorIdLocal, getBalanceDue, getStockArticle } = require('../utils/crm');
const { ejecutarBusquedaExterna } = require('../utils/busqueda_externa_service');
const { buscarNumeroParteExterno } = require('../utils/fuentes_externas_service');
const { resolverCanonico, resolverMultiplesCanonico } = require('../utils/canonicalizacion_service');
const UserContext = require('../utils/userContext');
const { ordenarPorRelevancia } = require('../utils/relevancia');

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
    {
      type: "function",
      function: {
        name: "configurar_filtro_existencia",
        description: "Activa o desactiva el filtro que limita las búsquedas de productos a solo aquellos con existencia/stock disponible en el almacén del cliente. Usar cuando el cliente pide ver solo productos disponibles/con stock (activar=true), o pide ver todos los productos de nuevo incluyendo agotados (activar=false). Ejemplos: 'solo muéstrame los que tengan existencia', 'ya no me muestres agotados', 'muéstrame todos aunque no tengan stock', 'quítame ese filtro'.",
        parameters: {
          type: "object",
          properties: {
            activar: {
              type: "boolean",
              description: "true para mostrar solo productos con existencia, false para mostrar todos los productos"
            }
          },
          required: ["activar"],
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
        description: "Obtiene productos de una categoría especificada. USAR OBLIGATORIAMENTE cuando el usuario elige una categoría por nombre O por número del listado previo ('categoria 3', 'la opción 2', 'la primera', 'quiero la 5'). El número debe resolverse al nombre de categoría mostrado. NUNCA listar productos sin llamar esta función primero.",
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
        description: "Busca productos en el catálogo. IMPORTANTE: query/categoria/etiquetas SOLO llevan el SUSTANTIVO. Todo lo demás (marca, medida, características) va en filtros. Cuando el mensaje contenga =CLAVE usar el parámetro clave en lugar de query.",
        parameters: {
          type: "object",
          properties: {
            clave: {
              type: ["string", "null"],
              description: "Clave exacta del producto cuando el usuario escribe =CLAVE en su mensaje. Cuando se usa este campo, query/categoria/etiquetas deben ser null."
            },
            query: {
              type: ["string", "null"],
              description: "SOLO el sustantivo principal normalizado en SINGULAR (ejemplo: 'monitor', 'azucar', 'tuberia'). NUNCA incluir marca, medida ni características. Null cuando se usa clave."
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
          required: ["clave", "query", "categoria", "etiquetas", "filtros", "precio_max", "current_page", "per_page"],
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
        description: "Crea un carrito con MÚLTIPLES productos en una sola operación. Ejecutar INMEDIATAMENTE cuando el usuario solicita múltiples productos con cantidades ya especificadas. NO pedir confirmación — si el usuario indicó qué quiere y en qué cantidad, crear el carrito directamente sin preguntar.",
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
        name: "limpiar_carrito_activo",
        description: "Desvincula el carrito activo del contexto sin cancelarlo en el CRM. Usar cuando el usuario pide crear un carrito nuevo sin especificar productos. El carrito anterior queda en el CRM pero ya no es el activo.",
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
        description: "Elimina completamente una partida del carrito. Usar cuando el usuario pide quitar/eliminar un producto SIN especificar cantidad: 'quita el licor', 'elimina el jabón', 'quita un aceite', 'elimina la escoba'. Si NO hay número ni cantidad en el mensaje → usar esta función.",
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
        description: "Actualiza la cantidad de una partida del carrito. Dos casos: (1) 'quita/elimina N producto' → nueva_cantidad = cantidad_actual - N. Si el resultado es ≤ 0 usar remover_articulo_del_carrito en su lugar. (2) 'deja N producto' → nueva_cantidad = N directamente. Para conocer cantidad_actual consultar el carrito del contexto o llamar ver_carrito primero.",
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
    },
    {
      type: "function",
      function: {
        name: "actualizar_observaciones",
        description: "Agrega, reemplaza o elimina las observaciones/comentarios/notas de una cotización (carrito). Usar cuando el usuario quiera agregar una nota, cambiar los comentarios, concatenar texto a observaciones existentes, o quitar/borrar las observaciones. Sinónimos: observación, nota, comentario, indicación.",
        parameters: {
          type: "object",
          properties: {
            carrito_id: {
              type: ["string", "null"],
              description: "ID del carrito al que se le agregan las observaciones. Usar el carrito activo si no se especifica uno distinto."
            },
            observaciones: {
              type: "string",
              description: "Texto de las observaciones. Dejar vacío solo cuando modo es 'quitar'."
            },
            modo: {
              type: "string",
              description: "'agregar' concatena el texto a las observaciones existentes, 'reemplazar' sustituye las observaciones actuales, 'quitar' elimina todas las observaciones.",
              enum: ["agregar", "reemplazar", "quitar"]
            }
          },
          required: ["carrito_id", "observaciones", "modo"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "consultar_saldo",
        description: "Consulta el saldo pendiente de pago del cliente actual. Usar cuando el usuario pregunta por su saldo, cuánto debe, su estado de cuenta o adeudo. Ejemplos: '¿cuánto debo?', '¿cuál es mi saldo?', '¿tengo algo pendiente de pago?'",
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
        name: "consultar_existencia",
        description: "Consulta la existencia/disponibilidad en inventario de un producto ya identificado por su ID. Usar cuando el usuario pregunta cuánta existencia, disponibilidad o stock hay de un artículo. Ejemplos: '¿cuánta existencia hay del producto 1234?', '¿tienes disponibilidad del artículo 55?'",
        parameters: {
          type: "object",
          properties: {
            articulo_id: {
              type: "integer",
              description: "ID del artículo a consultar"
            }
          },
          required: ["articulo_id"],
          additionalProperties: false
        },
        strict: true
      }
    },
    // ============================================================
    // CONSULTA_ATRIBUTO - Extrae valores únicos de un atributo
    // ============================================================
    {
      type: "function",
      function: {
        name: "consultar_atributo_producto",
        description: "Consulta los valores únicos de un atributo (marca, medida/tamaño, tipo/modelo/presentación) para un producto. Usar cuando el cliente pregunta '¿qué marcas de X tienen?', '¿qué tamaños de Y hay?', etc. NO muestra productos, solo los valores únicos del atributo.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Sustantivo del producto a buscar (normalizado, sin marca ni medida)"
            },
            atributo: {
              type: "string",
              enum: ["marca", "medida", "tipo"],
              description: "Atributo a consultar. 'marca'=fabricante; 'medida'=tamaño/presentación/capacidad; 'tipo'=modelo/variante/tipo"
            }
          },
          required: ["query", "atributo"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "buscar_clientes",
        description: "Busca clientes por nombre en modo vendedor. Usar cuando el vendedor escribe un nombre de cliente para buscarlo.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Nombre o parte del nombre del cliente a buscar"
            }
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
        name: "asignar_cliente",
        description: "Selecciona un cliente para trabajar con el en modo vendedor. Todas las operaciones posteriores usaran este cliente.",
        parameters: {
          type: "object",
          properties: {
            cliente_id: {
              type: "number",
              description: "CLIENTE_ID del cliente seleccionado de la lista"
            }
          },
          required: ["cliente_id"],
          additionalProperties: false
        },
        strict: true
      }
    }
  ];

// ============================================================
// MODO_REFACCIONES - tool exclusiva del modo, NO se incluye en
// functionDefinitions para que no se filtre al MOTOR_GENERAL.
// Se agrega a la lista de tools solo cuando modo_refacciones está activo
// (ver chatwoot.js).
// ============================================================
const TOOL_BUSCAR_NUMERO_PARTE_EXTERNO = {
  type: "function",
  function: {
    name: "buscar_numero_parte_externo",
    description: "MODO_REFACCIONES: busca el número de parte (clave de refacción) en fuentes externas autorizadas (Apymsa, Rolcar) cuando la pieza depende de aplicación vehicular. Úsala ANTES de buscar_productos para piezas como alternador, balatas, rótula, etc. Una vez que te devuelva un numero_parte, búscalo en buscar_productos usando el parámetro 'clave' con ese número EXACTO (no lo modifiques). Si regresa NO_ENCONTRADO_EN_FUENTE o FUENTE_NO_DISPONIBLE, no inventes un número; informa al usuario y ofrece derivar a un asesor.",
    parameters: {
      type: "object",
      properties: {
        producto: {
          type: "string",
          description: "Nombre de la refacción solicitada, ej: 'alternador', 'rotula', 'balatas delanteras'"
        },
        vehiculo: {
          type: "object",
          description: "Datos del vehículo ya confirmados con el usuario. Usar null en los campos que no se conozcan.",
          properties: {
            marca: { type: ["string", "null"] },
            modelo: { type: ["string", "null"] },
            anio: { type: ["string", "null"] },
            motor: { type: ["string", "null"] }
          },
          required: ["marca", "modelo", "anio", "motor"],
          additionalProperties: false
        }
      },
      required: ["producto", "vehiculo"],
      additionalProperties: false
    },
    strict: true
  }
};

// ===== ROUTER PARA MANEJAR FUNCTION CALLS =====
/**
 * Pre-formatea el listado de carritos disponibles.
 * Evita que GPT omita el CARRITO_ID y muestre solo el folio.
 * Estructura API: data.CARRITOS = [{ CARRITO_ID, FOLIO }, ...]
 */
function formatearListaCarritos(resultado) {
  if (!resultado.success || !resultado.data?.CARRITOS || resultado.data.CARRITOS.length === 0) {
    return null;
  }

  const carritos = resultado.data.CARRITOS;
  let texto = `Tienes ${carritos.length} carrito(s) disponible(s):\n\n`;

  carritos.forEach((c, i) => {
    texto += `${i + 1}) ID: ${c.CARRITO_ID} - Folio: ${c.FOLIO}\n`;
  });

  texto += '\nCual deseas usar?';
  return texto;
}

/**
 * Pre-formatea los datos del carrito para que GPT no tenga que decidir el formato.
 * Sigue el formato exacto definido en carrito_prompt.js
 */
function formatearCarritoTexto(carritoData) {
  if (!carritoData.success || !carritoData.data?.Carrito) return null;

  const productos = carritoData.data.Carrito;
  const importe = carritoData.data.importeCarrito || {};
  const folio = importe.FOLIO || 'N/A';

  if (productos.length === 0) {
    return 'Tu carrito esta vacio. Quieres buscar algun producto?';
  }

  let texto = 'Tu carrito (Folio: ' + folio + '):\n\n';
  for (let i = 0; i < productos.length; i++) {
    const p = productos[i];
    const cantidad = p.UNIDADES || 0;
    // PRECIOTOTALARTICULOS = subtotal de línea con IVA (precio_unitario + impuesto) × unidades
    const subtotal = p.PRECIOTOTALARTICULOS != null ? parseFloat(p.PRECIOTOTALARTICULOS) : 0;
    // Precio unitario con IVA = subtotal / unidades (evita usar MONTO_IMPUESTO que es total de línea, no por unidad)
    const precioConIva = cantidad > 0 ? subtotal / cantidad : 0;
    texto += (i + 1) + ') ID: ' + p.ARTICULO_ID + ' - ' + (p.NOMBRE || 'Sin nombre') + '\n';
    texto += '   Cantidad: ' + cantidad + ' | Precio: $' + precioConIva.toFixed(2) + ' | Subtotal: $' + subtotal.toFixed(2) + '\n\n';
  }

  const total = importe.TOTAL_CARRITO || 0;
  texto += 'Total: $' + (typeof total === 'number' ? total.toFixed(2) : total);

  return texto;
}

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

      case "configurar_filtro_existencia": {
        const activar = !!args.activar;
        await userContext.setFiltroExistencia(activar);
        return {
          success: true,
          data: [],
          message: activar
            ? 'Listo, a partir de ahora solo te mostraré productos con existencia disponible.'
            : 'Listo, ahora te mostraré todos los productos, tengan o no existencia.',
          preserveCurrentCart: true
        };
      }

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
          console.log(`🔍 BÚSQUEDA DE PRODUCTOS - Query: "${args.query}" Clave: "${args.clave}"`);
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

          // Búsqueda por clave: saltar canonización
          if (args.clave) {
            console.log(`🔑 BÚSQUEDA POR CLAVE: "${args.clave}"`);
            const filtrosNormalizados = {
              marca: [], medida: [], caracteristicas: [], tipo: [], compatibilidad: []
            };
            return buscarProductos(null, null, null, null, 1, 100, filtrosNormalizados, args.clave);
          }

          // ============================================================
          // CANONIZACIÓN INTEGRADA (antes era una tool separada)
          // Ejecuta PASO 8 (normalización) + PASO 9 (sinónimos BD)
          // directamente aquí, eliminando 1 iteración GPT-4o
          // ============================================================
          let queryFinal = args.query;
          let categoriaFinal = args.categoria;
          let etiquetasFinal = args.etiquetas;

          // Canonizar query (flujo de búsqueda normal)
          if (args.query) {
            try {
              const canonResult = await Promise.race([
                resolverCanonico(args.query, accountId),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout canonizacion')), 2000))
              ]);
              if (canonResult && canonResult.token_final) {
                console.log(`🔄 Canonización integrada: "${args.query}" → "${canonResult.token_final}"`);
                queryFinal = canonResult.token_final;
              }
            } catch (canonError) {
              console.warn(`⚠️ Canonización falló (fail-open): ${canonError.message}. Usando query original.`);
            }
          }

          // Canonizar categoria/etiquetas (flujo de necesidad: query=null, categoria="sed")
          if (!args.query && args.categoria) {
            try {
              const canonResult = await Promise.race([
                resolverCanonico(args.categoria, accountId),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout canonizacion')), 2000))
              ]);
              if (canonResult && canonResult.token_final) {
                console.log(`🔄 Canonización necesidad: "${args.categoria}" → "${canonResult.token_final}"`);
                categoriaFinal = canonResult.token_final;
                etiquetasFinal = canonResult.token_final;
              }
            } catch (canonError) {
              console.warn(`⚠️ Canonización necesidad falló (fail-open): ${canonError.message}`);
            }
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

          // Para mensajes de "sin resultados" más precisos cuando el filtro está activo
          const filtroExistenciaActivo = await userContext.getFiltroExistencia();

          // ✅ Pasar filtros a buscarProductos
          const resultado = await buscarProductos(
            queryFinal,
            categoriaFinal,
            etiquetasFinal,
            args.precio_max,
            args.current_page,
            args.per_page,
            filtrosNormalizados
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
                success: true,
                data: [],
                sinResultados: true,
                message: filtroExistenciaActivo
                  ? `No encontré productos con existencia para "${args.query || args.clave}".`
                  : `No encontré productos para "${args.query || args.clave}" con información completa.`,
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
              success: true,
              data: [],
              sinResultados: true,
              message: filtroExistenciaActivo
                ? `No encontré productos con existencia para "${args.query || args.clave}" en el catálogo.`
                : `No encontré productos para "${args.query || args.clave}" en el catálogo.`,
              preserveCurrentCart: true
            };
          }
          
          console.log(`✅ Productos normalizados finales: ${productosNormalizadosBusqueda.length}`);

          // ✅ Jerarquía por relevancia: el CRM devuelve en orden alfabético y su WHERE
          // incluye coincidencias por etiqueta, así que al buscar "libreta" salían primero
          // BLOCK y CUADERNO. Se reordena para que lo que más coincide con el sustantivo y
          // los filtros quede arriba. Afecta a los 6 visibles, a la lista semántica y a
          // lo que se guarda en Redis, todo de una.
          const productosOrdenados = ordenarPorRelevancia(
            productosNormalizadosBusqueda,
            queryFinal || categoriaFinal,
            filtrosNormalizados
          );

          // ✅ V22.0: Paginación de 6 productos
          const PRODUCTOS_POR_PAGINA = 6;
          const currentPage = args.current_page || 1;

          // Recuperar hasta 100 productos para análisis
          const productosRecuperados = productosOrdenados.slice(0, 100);
          
          // Calcular índices para la ventana de 6 productos
          const startIndex = (currentPage - 1) * PRODUCTOS_POR_PAGINA;
          const endIndex = startIndex + PRODUCTOS_POR_PAGINA;
          
          // Obtener solo los 6 productos de la página actual
          const visibles = productosRecuperados.slice(startIndex, endIndex);
          
          // ✅ Usar el count total de la API, no el length del array
          const totalProductos = resultado.meta?.count || productosNormalizadosBusqueda.length;
          
          console.log(`📋 V22.0 - Página ${currentPage}: Mostrando productos ${startIndex + 1}-${Math.min(endIndex, totalProductos)} de ${totalProductos} totales`);

          // Top de la jerarquía, para poder calibrar los pesos desde el log
          console.log(`🏅 Jerarquía por relevancia (top ${visibles.length}):`, visibles.map(p => p.NOMBRE));
          
          // ✅ V22.0: Preparar descripciones para análisis semántico (solo si total > 6)
          let descripcionesParaAnalisis = null;
          if (totalProductos > 6) {
            descripcionesParaAnalisis = productosRecuperados.map(p => `ID: ${p.ARTICULO_ID} - ${p.NOMBRE} | Precio: $${p.PRECIO}`);
            console.log(`🔍 Enviando ${descripcionesParaAnalisis.length} descripciones al LLM para análisis semántico`);
          }
          
          await userContext.setBusquedaActiva({
            // ✅ Guardar el query YA CANONIZADO: la paginación ("ver más") vuelve a buscar
            // con este valor, y con el crudo la página 2 buscaba distinto que la 1
            // (ej. "tijeras" → 0 resultados vs "tijera" → 143)
            query: queryFinal,
            filtros: filtrosNormalizados,
            total_resultados: totalProductos,
            mostrados: endIndex,
            current_page: currentPage  // ✅ V22.0: Guardar página actual
          });

          // Guardar TODOS los productos para resolución por nombre ("torres", "licor de melon")
          // Los índices 0-5 siguen siendo los visibles para referencias posicionales ("el primero"),
          // por eso se guarda la lista YA ORDENADA por relevancia (mismo orden que ve el cliente)
          await userContext.setUltimosResultados(productosOrdenados);
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
  
      case "limpiar_carrito_activo": {
        await userContext.setCarrito('', '');
        return { success: true, message: 'Carrito activo desvinculado. El siguiente pedido creará un carrito nuevo.' };
      }

      case "crear_nuevo_carrito": {
        const carritoExistente = await userContext.getCarrito();
        if (carritoExistente) {
          const resAgregar = await agregarAlCarrito(args.producto_id, args.cantidad, carritoExistente);
          if (resAgregar && resAgregar.success) return resAgregar;
          const msgE = (resAgregar?.message || '').toLowerCase();
          const esEstatus = msgE.includes('cancelad') || msgE.includes('ganado') || msgE.includes('cerrado');
          if (!esEstatus) return resAgregar;
        }
        const nuevoCarrito = await crearNuevoCarrito(args.producto_id, args.cantidad);
        if (nuevoCarrito.success && nuevoCarrito.carritoId) {
          await userContext.setCarrito(nuevoCarrito.carritoId, nuevoCarrito.folio);
        }
        return nuevoCarrito;
      }

      case "crear_nuevo_carrito_con_varios_articulos": {
        const carritoExistenteV = await userContext.getCarrito();
        if (carritoExistenteV) {
          const resAgregarV = await agregarVariosArticulosAlCarrito(carritoExistenteV, args.productos);
          if (resAgregarV && resAgregarV.success) return resAgregarV;
          const msgEV = (resAgregarV?.message || '').toLowerCase();
          const esEstatusV = msgEV.includes('cancelad') || msgEV.includes('ganado') || msgEV.includes('cerrado');
          if (!esEstatusV) return resAgregarV;
        }
        const carritoN = await crearNuevoCarritoConVariosArticulos(args.productos);
        if (carritoN.success) {
          await userContext.setCarrito(carritoN.carritoId, carritoN.folio);
        }
        return carritoN;
      }
  
      case "obtener_carritos_disponibles": {
        await userContext.setUltimaAccion('listar_carritos');
        const listaCarritos = await obtenerCarritosDisponibles();
        if (listaCarritos.success) {
          listaCarritos.texto_formateado = formatearListaCarritos(listaCarritos);
        }
        return listaCarritos;
      }
      
      case "ver_carrito":
        const carrito = await verCarrito(args.carrito_id);
        if (carrito.success) {
          carrito.texto_formateado = formatearCarritoTexto(carrito);
        }
        return carrito;

      case "asignar_carrito":
        const carritoA = await verCarrito(args.carrito_id);
        console.log('🛒 asignar_carrito - args.carrito_id:', args.carrito_id);
        console.log('🛒 asignar_carrito - importeCarrito:', JSON.stringify(carritoA.data?.importeCarrito));
        if (carritoA.success) {
          // Usar args.carrito_id directamente en lugar de confiar en la estructura de respuesta
          const folio = carritoA.data?.importeCarrito?.FOLIO || null;
          await userContext.setCarrito(args.carrito_id, folio);
          console.log('🛒 asignar_carrito - setCarrito:', args.carrito_id, folio);
          carritoA.texto_formateado = formatearCarritoTexto(carritoA);
        }
        return carritoA;

      case "cancelar_carrito": {
        const resultCancelar = await cancelarCarrito(args.carrito_id);
        const msgCancelar = (resultCancelar.message || '').toLowerCase();
        const esCarritoFinalizado = msgCancelar.includes('ganado') || msgCancelar.includes('cerrado') || msgCancelar.includes('confirmado');
        if (esCarritoFinalizado) {
          const carritoActualC = await userContext.getCarrito();
          if (carritoActualC && String(carritoActualC) === String(args.carrito_id)) {
            await userContext.setCarrito('', '');
          }
          return {
            success: false,
            message: 'El carrito ya fue convertido en pedido y no puede cancelarse. El carrito activo ha sido liberado.',
            preserveCurrentCart: false
          };
        }
        return resultCancelar;
      }

      case "generar_pdf":
        return generarPdf(args.carrito_id);
      
      case "crear_orden": {
        const orden = await crearOrden(args.carrito_id);
        if (orden.success) {
          await userContext.setCarrito('', '');
        }
        return orden;
      }
      
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

      case "actualizar_observaciones": {
        const carritoObsId = args.carrito_id || await userContext.getCarrito();
        if (!carritoObsId) {
          return {
            success: false,
            message: "No tienes un carrito activo. Primero selecciona un carrito para agregar observaciones.",
            preserveCurrentCart: true
          };
        }
        const modoMap = { 'agregar': 'append', 'reemplazar': 'set', 'quitar': 'clear' };
        const modoInterno = modoMap[args.modo] || 'set';
        return await actualizarObservaciones(carritoObsId, args.observaciones || '', modoInterno);
      }

      case "consultar_atributo_producto": {
        return await consultarAtributoProducto(args.query, args.atributo, accountId);
      }

      case "consultar_saldo":
        return await getBalanceDue();

      case "consultar_existencia":
        return await getStockArticle(args.articulo_id);

      case "buscar_clientes": {
        const resultadoClientes = await buscarClientesPorNombre(args.query);
        await userContext.setUltimaAccion('busqueda_clientes');
        if (resultadoClientes.success && resultadoClientes.data.length > 0) {
          resultadoClientes.texto_formateado = resultadoClientes.data.map(function(c, i) {
            return (i + 1) + ') ID: ' + c.CLIENTE_ID + ' - ' + c.NOMBRE;
          }).join('\n') + '\n\nCon cual deseas trabajar?';
        }
        return resultadoClientes;
      }

      case "asignar_cliente": {
        const clienteAsignado = await buscarClientePorIdLocal(args.cliente_id);
        if (clienteAsignado) {
          await userContext.setClienteVendedor(clienteAsignado);
          return {
            success: true,
            data: clienteAsignado,
            message: 'Trabajando con ' + clienteAsignado.NOMBRE + '. Que deseas hacer?'
          };
        }
        return { success: false, message: 'No se encontro el cliente', preserveCurrentCart: true };
      }

      // ============================================================
      // MODO_REFACCIONES - búsqueda en fuentes externas autorizadas
      // ============================================================
      case "buscar_numero_parte_externo": {
        console.log(`🔧 MODO_REFACCIONES - buscar_numero_parte_externo:`, args);
        try {
          const resultadoFuente = await buscarNumeroParteExterno(args.producto, args.vehiculo);
          return {
            success: true,
            data: resultadoFuente,
            preserveCurrentCart: true
          };
        } catch (error) {
          console.error('❌ Error en buscar_numero_parte_externo:', error.message);
          return {
            success: true,
            data: { resultado: 'FUENTE_NO_DISPONIBLE', motivo: error.message },
            preserveCurrentCart: true
          };
        }
      }

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
    executeFunctionCall,
    TOOL_BUSCAR_NUMERO_PARTE_EXTERNO
  };