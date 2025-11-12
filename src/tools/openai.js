const { 
  obtenerCategorias, 
  buscarProductos, 
  obtenerDetalleProducto, 
  agregarAlCarrito, 
  agregarVariosArticulosAlCarrito, 
  crearNuevoCarrito, 
  crearNuevoCarritoConVariosArticulos, 
  obtenerCarritosDisponibles, 
  verCarrito, 
  crearOrden, 
  cancelarCarrito, 
  generarPdf 
} = require('../utils/crm');

const functionDefinitions = [
  {
    type: "function",
    function: {
      name: "saludo",
      description: "Se ejecuta cuando el usuario envía cualquier tipo de saludo o expresión de cortesía. Ejemplos: 'hola', 'buenos días', 'buenas tardes', 'buenas noches', 'qué tal', 'cómo estás', 'hey', 'saludos', 'buen día', o cualquier variación de saludo en español",
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
      name: "reiniciar",
      description: "Reinicia la conversación cuando el usuario lo solicita explícitamente con frases como: 'reiniciar', 'empezar de nuevo', 'nueva conversación', 'borrar todo'",
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
      name: "obtener_categorias",
      description: "Obtiene el catálogo completo de categorías de productos disponibles. Se ejecuta cuando el usuario pregunta: 'qué vendes', 'qué ofreces', 'qué productos tienes', 'muéstrame las categorías', 'qué me puedes ofrecer', o cualquier pregunta similar sobre el inventario disponible",
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
      name: "buscar_productos",
      description: "Búsqueda universal de productos en el catálogo. Detecta automáticamente el tipo de búsqueda (por nombre, categoría, etiquetas o combinación). Si no se especifica página actual usa 1, si no se especifica cantidad usa 5. SIEMPRE debe mostrar: precio, nombre, articulo_id, impuesto, unidad de venta",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Término de búsqueda principal (nombre del producto, marca, características). IMPORTANTE: Debe estar en SINGULAR y SIN las palabras 'ARTICULOS', 'DE'. Ejemplo: 'azúcar' no 'azúcares', 'laptop' no 'laptops'"
          },
          categoria: {
            type: ["string", "null"],
            description: "Categoría específica para filtrar (ej: 'muebles', 'farmacia', 'electrónica')"
          },
          etiquetas: {
            type: ["array", "null"],
            description: "Lista de etiquetas para filtrar (ej: ['oferta', 'nuevo', 'destacado'])",
            items: {
              type: "string"
            }
          },
          precio_max: {
            type: ["number", "null"],
            description: "Precio máximo en la moneda local"
          },
          pagina_actual: {
            type: "integer",
            description: "Página actual para paginación (default: 1)",
            default: 1,
            minimum: 1
          },
          cantidad_por_pagina: {
            type: "integer",
            description: "Cantidad de productos por página (default: 5)",
            default: 5,
            minimum: 1,
            maximum: 20
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
      name: "agregar_al_carrito",
      description: "Agrega UN ÚNICO producto al carrito. USA SOLO cuando el cliente quiera agregar UN SOLO PRODUCTO. Para múltiples productos usa 'agregar_varios_articulos_al_carrito'. Requiere tener un carrito activo (consulta 'obtener_carritos_disponibles' si no hay carrito)",
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
            description: "Cantidad de unidades del producto"
          },
          carrito_id: {
            type: "string",
            description: "ID del carrito donde agregar el producto"
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
      name: "agregar_varios_articulos_al_carrito",
      description: "Agrega MÚLTIPLES productos al carrito en una sola operación. USA cuando el cliente mencione 2 O MÁS PRODUCTOS simultáneamente. Ejemplos: 'agrégame los productos 101, 205 y 308', 'quiero los primeros 3 de la lista', 'llevo estos 5'. Requiere carrito activo",
      parameters: {
        type: "object",
        properties: {
          carrito_id: {
            type: "string",
            description: "ID del carrito donde agregar los productos"
          },
          productos: {
            type: "array",
            description: "Lista de productos a agregar",
            items: {
              type: "object",
              properties: {
                articulo_id: {
                  type: "integer",
                  description: "ID del producto"
                },
                unidades: {
                  type: "integer",
                  minimum: 1,
                  description: "Cantidad de unidades"
                }
              },
              required: ["articulo_id", "unidades"],
              additionalProperties: false
            },
            minItems: 2
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
      name: "crear_nuevo_carrito",
      description: "Crea un nuevo carrito con UN SOLO producto. USA cuando no hay carrito activo y el cliente quiere agregar un producto. Para múltiples productos usa 'crear_nuevo_carrito_con_varios_articulos'",
      parameters: {
        type: "object",
        properties: {
          producto_id: {
            type: "integer",
            description: "ID del producto inicial"
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
      name: "crear_nuevo_carrito_con_varios_articulos",
      description: "Crea un nuevo carrito con MÚLTIPLES productos simultáneamente. USA cuando no hay carrito activo y el cliente menciona 2 O MÁS productos. Ejemplos: 'nuevo carrito con los productos 101 y 205', 'quiero crear carrito con estos 3'",
      parameters: {
        type: "object",
        properties: {
          productos: {
            type: "array",
            description: "Lista de productos para el nuevo carrito",
            items: {
              type: "object",
              properties: {
                articulo_id: {
                  type: "integer",
                  description: "ID del producto"
                },
                unidades: {
                  type: "integer",
                  minimum: 1,
                  description: "Cantidad de unidades"
                }
              },
              required: ["articulo_id", "unidades"],
              additionalProperties: false
            },
            minItems: 2
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
      name: "actualizar_articulo_del_carrito",
      description: "Actualiza la cantidad de unidades de un producto específico en el carrito. Requiere carrito activo",
      parameters: {
        type: "object",
        properties: {
          producto_id: {
            type: "integer",
            description: "ID del producto a actualizar"
          },
          cantidad: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Nueva cantidad de unidades"
          },
          carrito_id: {
            type: "string",
            description: "ID del carrito"
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
      name: "remover_articulo_del_carrito",
      description: "Elimina un producto específico del carrito. Requiere carrito activo",
      parameters: {
        type: "object",
        properties: {
          producto_id: {
            type: "integer",
            description: "ID del producto a eliminar"
          },
          carrito_id: {
            type: "string",
            description: "ID del carrito"
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
      name: "obtener_carritos_disponibles",
      description: "Obtiene la lista de todos los carritos disponibles del usuario",
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
      name: "ver_carrito",
      description: "Muestra el contenido detallado de un carrito específico con todos sus productos, cantidades y totales",
      parameters: {
        type: "object",
        properties: {
          carrito_id: {
            type: "string",
            description: "ID del carrito a visualizar"
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
      description: "Cancela y elimina un carrito específico",
      parameters: {
        type: "object",
        properties: {
          carrito_id: {
            type: "string",
            description: "ID del carrito a cancelar"
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
      description: "Genera un PDF con el detalle completo de un carrito",
      parameters: {
        type: "object",
        properties: {
          carrito_id: {
            type: "string",
            description: "ID del carrito para generar PDF"
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
      description: "Crea una orden de compra formal con los productos del carrito. Requiere carrito activo",
      parameters: {
        type: "object",
        properties: {
          carrito_id: {
            type: "integer",
            description: "ID del carrito para crear la orden"
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
      description: "Consulta el estado y detalles de una orden específica",
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
      description: "Genera la factura oficial de una orden confirmada",
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
  }
];

// ===== ROUTER MEJORADO PARA MANEJAR FUNCTION CALLS =====
function executeFunctionCall(name, args) {
  try {
    console.log(`🔧 Ejecutando función: ${name}`, args);
    
    // Mapa de funciones con manejo simplificado
    const functionMap = {
      saludo: () => ({
        success: true,
        data: [],
        message: "¡Hola! Soy ALEX, tu asesor comercial. Estoy aquí para ayudarte con tu proceso de compra. ¿En qué puedo asistirte hoy?",
        preserveCurrentCart: true
      }),
      
      reiniciar: () => ({
        success: true,
        data: [],
        message: "Perfecto, iniciamos una conversación nueva. ¿En qué puedo ayudarte?",
        preserveCurrentCart: false // Reinicia todo incluyendo carrito
      }),
      
      obtener_categorias: () => obtenerCategorias(),
      
      buscar_productos: () => buscarProductos(
        args.query,
        args.categoria || null,
        args.etiquetas || null,
        args.precio_max || null,
        args.pagina_actual || 1,
        args.cantidad_por_pagina || 5
      ),
      
      agregar_al_carrito: () => agregarAlCarrito(
        args.producto_id,
        args.cantidad,
        args.carrito_id
      ),
      
      agregar_varios_articulos_al_carrito: () => agregarVariosArticulosAlCarrito(
        args.carrito_id,
        args.productos
      ),
      
      crear_nuevo_carrito: () => crearNuevoCarrito(
        args.producto_id,
        args.cantidad
      ),
      
      crear_nuevo_carrito_con_varios_articulos: () => crearNuevoCarritoConVariosArticulos(
        args.productos
      ),
      
      actualizar_articulo_del_carrito: () => agregarAlCarrito(
        args.producto_id,
        args.cantidad,
        args.carrito_id,
        "update"
      ),
      
      remover_articulo_del_carrito: () => agregarAlCarrito(
        args.producto_id,
        0, // cantidad 0 para remover
        args.carrito_id,
        "remove"
      ),
      
      obtener_carritos_disponibles: () => obtenerCarritosDisponibles(),
      
      ver_carrito: () => verCarrito(args.carrito_id),
      
      cancelar_carrito: () => cancelarCarrito(args.carrito_id),
      
      generar_pdf: () => generarPdf(args.carrito_id),
      
      crear_orden: () => crearOrden(args.carrito_id),
      
      consultar_orden: () => consultarOrden(args.orden_id),
      
      generar_factura: () => generarFactura(args.orden_id)
    };

    // Ejecutar función correspondiente
    const handler = functionMap[name];
    
    if (!handler) {
      throw new Error(`Función '${name}' no está implementada`);
    }

    const result = handler();
    console.log(`✅ Función ${name} ejecutada exitosamente`);
    return result;
    
  } catch (error) {
    console.error(`❌ Error ejecutando función ${name}:`, error);
    return {
      success: false,
      message: `Error al ejecutar ${name}: ${error.message}`,
      error: error.stack
    };
  }
}

module.exports = {
  functionDefinitions,
  executeFunctionCall
};