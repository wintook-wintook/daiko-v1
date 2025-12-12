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
        description: `Busca productos en el catálogo

        IMPORTANTE: Extrae SOLO el sustantivo (UNA palabra), NO la frase completa.
            
        Reglas de extracción:
        - "Azucar Refinada" → pasar "Azucar"
        - "Cafe Molido Gourmet" → pasar "Cafe"
        - "Refresco Cola Light" → pasar "Refresco"
        - "Jugo de Naranja Natural" → pasar "Jugo"
        - "Pan Blanco de Caja" → pasar "Pan"
        
        La función buscará el producto genérico y retornará todas las variantes disponibles.

        . Siempre y sin exepción debe de mostrar la información del artículo, como mínimo: precio, nombre, articulo_id, impuesto, unidad de venta`,
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "SOLO el sustantivo principal del producto (una palabra). Ejemplos: 'Azucar', 'Cafe', 'Refresco', 'Jugo', 'Pan'. Término de búsqueda en SINGULAR (nombre, marca, características). IMPORTANTE: Siempre usa la forma singular del producto, nunca plural. Ejemplos correctos: 'arroz' (no 'arroces'), 'laptop' (no 'laptops'), 'mouse' (no 'mouses'), 'teclado' (no 'teclados'), 'silla' (no 'sillas'). Si el usuario dice 'quiero arroces', usa query='arroz'. Si dice 'necesito laptops', usa query='laptop'."
            },
            categoria: {
              type: ["string", "null"],
              description: "Categoría específica para filtrar productos (ej: ['muebles', 'farmacia'])"
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
    },

    {
      type: "function",
      function: {
        name: "copiar_articulos_entre_carritos",
        description: "Copia artículos de un carrito origen a un carrito destino. Puede copiar todos los artículos del carrito o solo artículos específicos con cantidades personalizadas.",
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
              description: "Lista de artículos específicos a copiar con sus cantidades. Si es null, se copian TODOS los artículos del carrito origen con sus cantidades originales",
              items: {
                type: "object",
                properties: {
                  articulo_id: {
                    type: "integer",
                    description: "ID del artículo a copiar"
                  },
                  cantidad: {
                    type: ["integer", "null"],
                    description: "Cantidad a copiar. Si es null, usa la cantidad del carrito origen"
                  }
                },
                required: ["articulo_id", "cantidad"],
                additionalProperties: false
              }
            },
            modo_copia: {
              type: "string",
              description: "Modo de copia: 'todos' para copiar todos los artículos, 'especificos' para copiar solo los indicados en articulos_especificos",
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
        description: "Copia artículos de un carrito origen a un carrito nuevo. Puede copiar todos los artículos del carrito o solo artículos específicos con cantidades personalizadas.",
        parameters: {
          type: "object",
          properties: {
            carrito_origen_id: {
              type: "string",
              description: "ID del carrito desde donde se copiarán los artículos"
            },            
            articulos_especificos: {
              type: ["array", "null"],
              description: "Lista de artículos específicos a copiar con sus cantidades. Si es null, se copian TODOS los artículos del carrito origen con sus cantidades originales",
              items: {
                type: "object",
                properties: {
                  articulo_id: {
                    type: "integer",
                    description: "ID del artículo a copiar"
                  },
                  cantidad: {
                    type: ["integer", "null"],
                    description: "Cantidad a copiar. Si es null, usa la cantidad del carrito origen"
                  }
                },
                required: ["articulo_id", "cantidad"],
                additionalProperties: false
              }
            },
            modo_copia: {
              type: "string",
              description: "Modo de copia: 'todos' para copiar todos los artículos, 'especificos' para copiar solo los indicados en articulos_especificos",
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

        // Obtener nombre (podría ser de una conversación anterior)
        const nombreGuardado = await userContext.getNombre();
        const nombre = args.nombre_usuario || nombreGuardado;
        const nombrePersonalizado = nombre ? ` ${nombre}` : "";
        
        return {
          success: true,
          data: [],
          message: `¡Hola${nombrePersonalizado}! Soy tu asesor comercial y estoy aquí para ayudarte con tu proceso de compra. ¿En qué puedo asistirte hoy?`,
          preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
        };
      case "reiniciar":
        //await userContext.clear();  // 
        await userContext.reset();  // ← Llamar al reset

        return {
          success: true,
          data: [],
          message: `Claro, a partir de este momento inicia una conversación nueva`,
          preserveCurrentCart: false  // ❌ El carrito fue eliminado
        };
      case "obtener_categorias":
        return obtenerCategorias();
      case "que_vendes":
        return obtenerCategorias();      
      case "que_me_puedes_ofrecer":
        return obtenerCategorias();
      case "seleccionar_categoria": 
        //await userContext.addPreferencia(args.category);     
        await userContext.addCategoria(args.category);     
        return buscarProductos(args.query, args.category, args.etiquetas, args.precio_max, args.current_page, args.per_page);      
      case "buscar_por_etiquetas":      
        return buscarProductos(args.query, args.category, args.etiquetas, args.precio_max, args.current_page, args.per_page);      
      case "buscar_productos":

        const resultado = await buscarProductos(
          args.query, 
          args.categoria, 
          args.etiquetas, 
          args.precio_max, 
          args.current_page, 
          args.per_page
        );
        
        // Guardar preferencias
        if (args.categoria) {
          await userContext.addCategoria(args.categoria);
        }
        
        if (args.precio_max) {
          await userContext.updateRangoPrecio(args.precio_max);
        }
        
        // Guardar búsqueda en historial
        await userContext.addBusqueda(args.query, resultado.data || []);
        
        return resultado;

        // return buscarProductos(args.query, args.categoria, args.etiquetas, args.precio_max, args.current_page, args.per_page);
      
      case "obtener_detalle_producto":
        //return obtenerDetalleProducto(args.id);
        const detalle = await obtenerDetalleProducto(args.id);
      
        // Registrar que vio este producto
        if (detalle.success) {
          await userContext.addProductoVisto(
            detalle.data.articulo_id, 
            detalle.data.nombre
          );
          
          // Si tiene marca, agregarla
          if (detalle.data.marca) {
            await userContext.addMarca(detalle.data.marca);
          }
        }
        
        return detalle;

      case "agregar_al_carrito":
        // Obtener carrito actual de Redis si no se proporciona
        const carritoId = args.carrito_id || await userContext.getCarrito();
        
        if (!carritoId) {
          return {
            success: false,
            message: "No tienes un carrito asignado. Primero crea uno."
          };
        }
        
        return await agregarAlCarrito(args.producto_id, args.cantidad, carritoId);        
        // return agregarAlCarrito(args.producto_id, args.cantidad, args.carrito_id);
      
      case "agregar_varios_articulos_al_carrito":
        return agregarVariosArticulosAlCarrito(args.carrito_id, args.productos);        
  
      case "remover_articulo_del_carrito":
        return agregarAlCarrito(args.producto_id, args.cantidad, args.carrito_id, "remove");
      
      case "actualizar_articulo_del_carrito":
        return agregarAlCarrito(args.producto_id, args.cantidad, args.carrito_id, "update");
  
      case "crear_nuevo_carrito":
        const nuevoCarrito = await crearNuevoCarrito(args.producto_id, args.cantidad);
        console.log({nuevoCarrito});
        // Guardar carrito_id en Redis
        if (nuevoCarrito.success && nuevoCarrito.carrito_id) {          
          await userContext.setCarrito(nuevoCarrito.carrito_id, nuevoCarrito.folio);
        }
        
        return nuevoCarrito;
        // return crearNuevoCarrito(args.producto_id, args.cantidad);

      case "crear_nuevo_carrito_con_varios_articulos":
        return crearNuevoCarritoConVariosArticulos(args.productos);
  
      case "obtener_carritos_disponibles":
        return obtenerCarritosDisponibles();
      
      case "ver_carrito":
        const carrito = await verCarrito(args.carrito_id);
console.log({carrito, data: carrito.data, ID_CARRITO: carrito.data.ID_CARRITO, FOLIO: carrito.data.FOLIO});        
        await userContext.setCarrito(carrito.data.ID_CARRITO, carrito.data.FOLIO);
        return carrito;

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
        return copiarArticulosDeUnCarritoExisenteAUnoNuevo(
          args.carrito_origen_id,          
          args.articulos_especificos,
          args.modo_copia
        );
      
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