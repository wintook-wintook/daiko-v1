const { obtenerCategorias, buscarProductos, obtenerDetalleProducto, agregarAlCarrito, agregarVariosArticulosAlCarrito, crearNuevoCarrito, crearNuevoCarritoConVariosArticulos, obtenerCarritosDisponibles, verCarrito, crearOrden, cancelarCarrito, generarPdf } = require('../utils/crm');
const { ejecutarBusquedaExterna } = require('../utils/busqueda_externa_service');

const functionDefinitions = [
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
        description: "Obtiene productos de una categoría especificada, si no se especifica la página actual asignarle el valor de 1, si no se especifica la cantidad de productos a listar asigna la cantidad de 5",
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
        description: "Busca productos específicamente por etiquetas o tags. Útil cuando el cliente busca productos con características específicas como 'productos en oferta', 'nuevos productos', 'más vendidos', etc., si no se especifica la página actual asignarle el valor de 1, si no se especifica la cantidad de productos a listar asigna la cantidad de 5",
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
        description: "Busca productos en el catálogo. Puede buscar por nombre, categoría, etiquetas o combinación de estos criterios. Si no se especifica la página actual asignarle el valor de 1, si no se especifica la cantidad de productos a listar asigna la cantidad de 5, siempre y sin exepción debe de mostrar la información del artículo, como mínimo: precio, nombre, articulo_id, impuesto, unidad de venta",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Término de búsqueda (nombre, marca, características)"
            },
            categoria: {
              type: ["string", "null"],
              enum: ["electronica", "hogar", "deportes", "moda", "libros", null],
              description: "Categoría específica para filtrar"
            },
            etiquetas: {
              type: ["array", "null"],
              description: "Lista de etiquetas para filtrar productos (ej: ['oferta', 'nuevo', 'destacado'])",
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
    // {
    //   type: "function",
    //   function: {
    //     name: "obtener_detalle_producto",
    //     description: "Obtiene información detallada de un producto específico, siempre y sin exepción debe de mostrar la información del artículo, como mínimo: precio, nombre, articulo_id, impuesto, unidad de venta",
    //     parameters: {
    //       type: "object",
    //       properties: {
    //         id: {
    //           type: "number",
    //           description: "ID único del producto"
    //         }
    //       },
    //       required: ["id"],
    //       additionalProperties: false
    //     },
    //     strict: true
    //   }
    // },
    {
      type: "function",
      function: {
        name: "buscar_informacion_externa",
        description: "Busca información adicional sobre productos, características técnicas, especificaciones, comparativas, compatibilidad o reviews en fuentes externas. USA ESTA FUNCIÓN cuando: 1) El cliente pregunta por especificaciones técnicas no disponibles en el catálogo, 2) Se solicitan comparativas entre productos, 3) Se pregunta sobre compatibilidad, 4) Se buscan opiniones o reviews, 5) Se necesita información sobre usos específicos o aplicaciones del producto",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Término de búsqueda detallado sobre el producto o característica específica que se desea conocer. Ejemplo: 'laptop HP 15 especificaciones RAM procesador', 'comparativa Samsung vs LG refrigeradores', 'compatibilidad teclado Logitech K380 con iPad'"
            },
            producto_id: {
              type: ["integer", "null"],
              description: "ID del producto del catálogo interno sobre el cual buscar información adicional (opcional, usar cuando se está consultando sobre un producto específico ya listado)"
            },
            tipo_informacion: {
              type: "string",
              enum: ["especificaciones", "reviews", "comparativa", "compatibilidad", "usos"],
              description: "Tipo específico de información a buscar: 'especificaciones' para detalles técnicos, 'reviews' para opiniones, 'comparativa' para comparar productos, 'compatibilidad' para verificar funcionamiento con otros dispositivos, 'usos' para aplicaciones y casos de uso"
            }
          },
          required: ["query", "producto_id", "tipo_informacion"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "agregar_varios_articulos_al_carrito",
        // description: "Este método agrega más de un producto en una sola ejecución a un carrito, se requiere contar con un carrito elegido, si no está elegido consulta la función obtener carritos disponibles, si al consultar la función obtener carritos disponibles no cuenta con almenos un carrito ejecuta la función crear nuevo carrito. Importante: cuando sea listado el carrito siempre sugierele al cliente lo siguiente: ¿Deseas agregar más productos o quieres continuar con el pedido?, una vez agregado el producto establece el carrito como elegido.",
        description: "Agrega MÚLTIPLES productos al carrito en una sola operación. USA ESTA FUNCIÓN cuando el cliente quiera agregar 2 O MÁS PRODUCTOS AL MISMO TIEMPO. Ejemplos: 'agrégame los productos 101, 205 y 308', 'quiero llevar estos 5 productos', 'agrégame los primeros 3 de la lista'. Si solo es UN producto, usa 'agregar_al_carrito'. Se requiere contar con un carrito elegido, si no está elegido consulta la función obtener carritos disponibles primero. . Importante: cuando sea listado el carrito siempre sugierele al cliente lo siguiente: ¿Deseas agregar más productos o quieres continuar con el pedido?, una vez agregado el producto establece el carrito como elegido.",
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
        // description: "Este método es solo para agregar un producto al carrito, se requiere contar con un carrito elegido, si no está elegido consulta la función obtener carritos disponibles, si al consultar la función obtener carritos disponibles no cuenta con almenos un carrito ejecuta la función crear nuevo carrito. Importante: cuando sea listado el carrito siempre sugierele al cliente lo siguiente: ¿Deseas agregar más productos o quieres continuar con el pedido?, una vez agregado el producto establece el carrito como elegido.",
        description: "Agrega UN ÚNICO producto al carrito. USA ESTA FUNCIÓN SOLO cuando el cliente quiera agregar UN SOLO PRODUCTO. Si el cliente menciona varios productos, usa 'agregar_varios_articulos_al_carrito' en su lugar. Se requiere contar con un carrito elegido, si no está elegido consulta la función obtener carritos disponibles, si al consultar la función obtener carritos disponibles no cuenta con al menos un carrito ejecuta la función crear nuevo carrito. Importante: cuando sea listado el carrito siempre sugierele al cliente lo siguiente: ¿Deseas agregar más productos o quieres continuar con el pedido?, una vez agregado el producto establece el carrito como elegido.",
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
        description: "Crea un carrito de productos con MÚLTIPLES productos en una sola operación. USA ESTA FUNCIÓN cuando el cliente quiera agregar 2 O MÁS PRODUCTOS AL MISMO TIEMPO. Ejemplos: 'agrégame los productos 101, 205 y 308', 'quiero llevar estos 5 productos', 'agrégame los primeros 3 de la lista'. Si solo es UN producto, usa 'crear_nuevo_carrito'. Importante: cuando sea listado el carrito siempre sugierele al cliente lo siguiente: ¿Deseas agregar más productos o quieres continuar con el pedido?",
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
        description: "Crea un carrito con un producto, se requiere contar con el identificador del articulo y la cantidad. USA ESTA FUNCIÓN SOLO cuando el cliente quiera crear un carrito con UN SOLO PRODUCTO. Si el cliente menciona varios productos, usa 'agregar_varios_articulos_al_carrito' en su lugar. Importante: cuando sea listado el carrito siempre sugierele al cliente lo siguiente: ¿Deseas agregar más productos o quieres continuar con el pedido?",        
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
        description: "Remover un artículo del carrito, se requiere contar con un carrito elegido, si no está elegido consulta la función obtener carritos disponibles. Importante: cuando sea listado el carrito siempre sugierele al cliente lo siguiente: ¿Quieres continuar con el pedido?",
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
        description: "Actualiza las unidades de un artículo del carrito, se requiere contar con un carrito elegido, si no está elegido consulta la función obtener carritos disponibles. Importante: cuando sea listado el carrito siempre sugierele al cliente lo siguiente: ¿Quieres continuar con el pedido?",
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
        description: "Muestra el contenido del carrito del usuario, no se requiere identificar el usuario para esta acción. Importante: cuando sea listado el carrito siempre sugierele al cliente lo siguiente: ¿Deseas agregar más productos o quieres continuar con el pedido?",
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
        name: "cancelar_carrito",
        description: "Cancelar un carrito, se requiere contar con el identificador del carrito",
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
        description: "Crear PDF de un carrito proporcionado, se requiere contar con el identificador del carrito",
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
        name: "crear_orden", // 05Sep2025 Pedido en CRMZeus
        description: "Crea una orden de compra con los productos del carritose requiere contar con un carrito elegido, si no está elegido el carrito consulta la función obtener carritos disponibles",
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
    }
  ];
  
// ===== ROUTER PARA MANEJAR FUNCTION CALLS =====
function executeFunctionCall(name, args) {
    console.log(`🔧 Ejecutando función: ${name}`, args);
    
    switch (name) {
      case "obtener_categorias":
        return obtenerCategorias();
      case "que_vendes":
        return obtenerCategorias();      
      case "que_me_puedes_ofrecer":
        return obtenerCategorias();
      case "seleccionar_categoria":      
        return buscarProductos(args.query, args.category, args.etiquetas, args.precio_max, args.current_page, args.per_page);      
      case "buscar_por_etiquetas":      
        return buscarProductos(args.query, args.category, args.etiquetas, args.precio_max, args.current_page, args.per_page);      
      case "buscar_productos":
        return buscarProductos(args.query, args.categoria, args.etiquetas, args.precio_max, args.current_page, args.per_page);
      
      case "obtener_detalle_producto":
        return obtenerDetalleProducto(args.id);
      case 'buscar_informacion_externa':
        return ejecutarBusquedaExterna(args.query, args.producto_id || null, args.tipo_informacion);
      case "agregar_al_carrito":
        return agregarAlCarrito(args.producto_id, args.cantidad, args.carrito_id);
      
      case "agregar_varios_articulos_al_carrito":
        return agregarVariosArticulosAlCarrito(args.carrito_id, args.productos);        
  
      case "remover_articulo_del_carrito":
        return agregarAlCarrito(args.producto_id, args.cantidad, args.carrito_id, "remove");
      
      case "actualizar_articulo_del_carrito":
        return agregarAlCarrito(args.producto_id, args.cantidad, args.carrito_id, "update");
  
      case "crear_nuevo_carrito":
        return crearNuevoCarrito(args.producto_id, args.cantidad);

      case "crear_nuevo_carrito_con_varios_articulos":
        return crearNuevoCarritoConVariosArticulos(args.productos);
  
      case "obtener_carritos_disponibles":
        return obtenerCarritosDisponibles();
      
      case "ver_carrito":
        return verCarrito(args.carrito_id);

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
      
      default:
        return {
          success: false,
          message: `Función ${name} no implementada`
        };
    }
  }

  module.exports = {
    functionDefinitions,    
    executeFunctionCall
  };