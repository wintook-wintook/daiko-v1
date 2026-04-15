// daiko/src/utils/crm.js

require('dotenv').config();

let cliente_id = 0;
let moneda_id  = 1;
let almacen_id = 0;
let vendedor_id = 0;
let celular = '';
const folio_ventas_id = 92226;
let api_access_token = ''; // process.env.CRMZEUS_APIACCESSTOKEN;
let url_crm_zeus = '';     // process.env.CRMZEUS_URL; // 'https://app.chatzeus.com/';

const { getApiData } = require('./functions');
const { generarPDFCotizacion } = require('./pdf-make');

let evalError = (data, title = '') => {
  // Error nativo de JS (timeout, red, etc.)
  if (data instanceof Error) {
    const apiData = data.response && data.response.data ? data.response.data : null;
    const apiMsg = Array.isArray(apiData)
      ? (apiData[0] && (apiData[0].opc || apiData[0].message))
      : (apiData && (apiData.opc || apiData.message));
    const msg = apiMsg || data.message;
    return { success: false, message: title ? title + msg : msg, preserveCurrentCart: true };
  }
  // Error explícito de la API ({ error: true, message: '...' })
  if (data && data.error && data.error === true) {
    data.success = false;
    data.preserveCurrentCart = true;
    if (title) data.message = title + data.message;
    console.log(data);
    return data;
  }
  return null;
}

function getConfigApiDaiko(api, data, version = '1', urlExtra = ''){
  urlExtra = urlExtra.trim();
  let url = ( urlExtra.length == 0 ? `${url_crm_zeus}apiCrm/externalAccess/accessToken/api/Daiko/v${version}/${api}` : `${url_crm_zeus}apiCrm/externalAccess/accessToken/${urlExtra}`) ;
  console.log({url, data});
  // Se supone que aquÃ­ se debe de agregar lo de recuperar el api_access_token desde https://app.chatzeus.com/api/v1/accounts/416/integrations/apps/daiko
  return {
    method: 'post',
    maxBodyLength: Infinity,
    url,
    headers: { 
      'api_access_token': api_access_token,     
      'Content-Type': 'application/json', 
      'Cookie': 'connect.sid=s%3A0tL5QPECvc3vmYUnupoVcskyLwi1-YFm.SByWF6a5CDxboz4KqOVSBZiLokAJwvoHThep%2BnZg8xc'
    },
    data : data
  }
}
  
async function buscarcliente(name){
  let data = JSON.stringify({});
  let config = getConfigApiDaiko('getCustomers', data);
  try {
    const response = await getApiData(config);
//console.log({data: response.data});
    //let cliente  = await response.data;
    let cliente  = await response.data.find(function(user) { // 11 Sep 2025 Filtro temporal
      return user.CLIENTE_ID === 61448;      
    });
    if(cliente){
      cliente_id = cliente.CLIENTE_ID;
      moneda_id = cliente.MONEDA_ID;
    }else{
      // recuperar cliente
    }
    return {
      success: true,
      data: {
        ...cliente        
      }
    };
  } catch (error) {
    console.error('Error buscarcliente:', error.message);
    return evalError(error);
  }
}


async function buscarcliente2(url_crm_zeus_, api_access_token_, info){
  almacen_id = await info.almacen_id;
  url_crm_zeus = await url_crm_zeus_;
  api_access_token = await api_access_token_;

  let {email, phone_number, contact_id, senderName, userContext} = info;
  phone_number = (phone_number ? phone_number.substr(-10) : phone_number);

  // Modo vendedor: usar cliente seleccionado por el vendedor
  const clienteVendedor = await userContext.getClienteVendedor();
  if (clienteVendedor && clienteVendedor.CLIENTE_ID) {
    cliente_id = clienteVendedor.CLIENTE_ID;
    moneda_id = clienteVendedor.MONEDA_ID || moneda_id;
    vendedor_id = clienteVendedor.VENDEDOR_ID || vendedor_id;
    celular = phone_number || celular;
    return { success: true, data: clienteVendedor, preserveCurrentCart: true };
  }

  let cliente_redis = await userContext.getCliente();

  let data = JSON.stringify({});
  let urlExtra;

  let buscarContacto = false;

  if(email && email.length > 4){
    data = JSON.stringify({"EMAIL": email});
    urlExtra = 'api/v1/contact/find_Contacto';
  
  }

  if(phone_number){
    data = JSON.stringify({"TELEFONO": phone_number});
    urlExtra = 'api/v1/contact/find_Contacto';
    
  }



  let contacto = [];

  if(cliente_redis && cliente_redis.CLIENTE_ID){

    vendedor_id = await cliente_redis.VENDEDOR_ID;
    cliente_id = cliente_redis.CLIENTE_ID;
    moneda_id = cliente_redis.MONEDA_ID || moneda_id;
    celular = phone_number || celular; 

    return {
      success: true,
      data: {        
        ALMACEN_ID: almacen_id,
        CLIENTE_ID: cliente_redis.CLIENTE_ID, 
        MONEDA_ID: cliente_redis.MONEDA_ID || moneda_id, 
        VENDEDOR_ID: cliente_redis.VENDEDOR_ID, 
        NOMBRE_COMERCIAL: cliente_redis.NOMBRE_COMERCIAL        
      },
      preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
    };

  }



  let config;
  let response = [];

  if (urlExtra) {
    config = getConfigApiDaiko('', data, '', urlExtra);
    try {
      response = await getApiData(config);
      contacto = response.data[0];
    } catch (error) {
      const apiData = error.response && error.response.data;
      const opc = Array.isArray(apiData) && apiData[0] && apiData[0].opc;
      if (opc === 'No se encontraron contactos registrados.' && phone_number) {
        console.log('⚠️ Contacto no encontrado, creando prospecto automáticamente...');
        try {
          const nombreProspecto = senderName || 'Sin nombre';
          const resultadoProspecto = await crearProspecto(url_crm_zeus, api_access_token, {
            nombre_prospecto: nombreProspecto,
            nombre_contacto: nombreProspecto,
            celular: phone_number,
            telefono_oficina: null,
            permisos_default: true,
            clave: phone_number
          });
          if (resultadoProspecto && resultadoProspecto.success) {
            const prospectoId = resultadoProspecto.data && resultadoProspecto.data.PROSPECTO_ID;
            console.log('✅ Prospecto creado automáticamente:', prospectoId);
            cliente_id = prospectoId;
            celular = phone_number;
            await userContext.setNombre(nombreProspecto);
            return {
              success: true,
              esProspecto: true,
              data: {
                ALMACEN_ID: almacen_id,
                CLIENTE_ID: prospectoId,
                MONEDA_ID: moneda_id,
                VENDEDOR_ID: vendedor_id,
                NOMBRE_COMERCIAL: nombreProspecto
              },
              preserveCurrentCart: true
            };
          }
        } catch (errProspecto) {
          console.error('Error creando prospecto automático:', errProspecto.message);
        }
      }
      buscarContacto = true;
    }
  } else {
    buscarContacto = true;
  }

  if (buscarContacto) {
    data = JSON.stringify({ CLIENTE_ID: contact_id });
    config = getConfigApiDaiko('', data, '', 'api/v1/org/get_Organizacion');
  }

  try {
    
    if(buscarContacto){

      response = await getApiData(config);  

      contacto = response.data[0];

    }


    data = JSON.stringify({CLIENTE_ID: contacto.CLIENTE_ID});

    urlExtra = 'api/v1/org/get_Organizacion';
    config = getConfigApiDaiko('', data, '', urlExtra);

    response = await getApiData(config);

    let cliente = await response.data[0];
    cliente.default = true;

    await userContext.setCliente(cliente);
    await userContext.setNombre(cliente.NOMBRE_COMERCIAL);
   
    vendedor_id = await cliente.VENDEDOR_ID;
    cliente_id = cliente.CLIENTE_ID;
    moneda_id = cliente.MONEDA_ID || moneda_id;
    celular = phone_number || celular; 

    return {
      success: true,
      data: {        
        ALMACEN_ID: almacen_id,
        CLIENTE_ID: cliente.CLIENTE_ID, 
        MONEDA_ID: cliente.MONEDA_ID || moneda_id, 
        VENDEDOR_ID: cliente.VENDEDOR_ID, 
        NOMBRE_COMERCIAL: cliente.NOMBRE_COMERCIAL        
      },
      preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error buscarcliente2:', error.message);
    return evalError(error);
  }
}

async function obtenerCategorias() {
  let data = JSON.stringify({});
  let config = getConfigApiDaiko('getListCategory',data);
  let Categorias = [];
  try {
    const response = await getApiData(config);    
    Categorias  = await response.data.Categorias;      
    evalError(response.data);
    if (response.data.error && response.data.error === true) {
      return response.data;
    }
    return {
      success: true,
      data: Categorias, // MÃ¡ximo 5 resultados
      message: `EncontrÃ© ${Categorias.length} categorias que coinciden con tu bÃºsqueda`,
      preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error obtenerCategorias:', error.message);
    return evalError(error);
  }
}

async function buscarProductos(query, categoria = null, etiquetas = null, precioMax = null, current_page=1, per_page=100, filtros = null, clave = null) {
  let data = { cliente_id: cliente_id, moneda_id: moneda_id, per_page };

  if (clave) { data.clave = clave; }
  if (categoria) { data.categoria = categoria; }
  if (query) { data.query = query; }
  if (etiquetas && etiquetas.length > 0) { 
    data.etiquetas = Array.isArray(etiquetas) ? etiquetas : [etiquetas]; 
  }

  // ✅ NUEVO V19.0: Aplicar filtros si existen
  if (filtros) {
    console.log('📦 Filtros recibidos en buscarProductos:', filtros);
    
    if (filtros.marca && filtros.marca.length > 0) {
      data.marca = filtros.marca;
      console.log('  → Filtro marca aplicado:', filtros.marca);
    }
    
    if (filtros.medida && filtros.medida.length > 0) {
      data.medida = filtros.medida;
      console.log('  → Filtro medida aplicado:', filtros.medida);
    }
    
    if (filtros.caracteristicas && filtros.caracteristicas.length > 0) {
      data.caracteristicas = filtros.caracteristicas;
      console.log('  → Filtro características aplicado:', filtros.caracteristicas);
    }
    
    if (filtros.tipo && filtros.tipo.length > 0) {
      data.tipo = filtros.tipo;
      console.log('  → Filtro tipo aplicado:', filtros.tipo);
    }
    
    if (filtros.compatibilidad && filtros.compatibilidad.length > 0) {
      data.compatibilidad = filtros.compatibilidad;
      console.log('  → Filtro compatibilidad aplicado:', filtros.compatibilidad);
    }
    
    console.log('✅ Data con filtros aplicados:', {
      query: data.query,
      categoria: data.categoria,
      filtros: {
        marca: data.marca,
        medida: data.medida,
        caracteristicas: data.caracteristicas,
        tipo: data.tipo,
        compatibilidad: data.compatibilidad
      }
    });
  }

  data.filtros = filtros;
  data = JSON.stringify(data);
  let url = `s`;
  if (clave) { url = `ByKey`; } // TODO: confirmar endpoint con equipo API
  else if (!categoria && (!etiquetas || etiquetas.length == 0)) { url = `Search/${query}`; }
  else if (!query && (!etiquetas || etiquetas.length == 0)) { url = `ByCategory/${categoria}`; }
  else if (!query && !categoria) { url = `ByLabels/`; }
  let config = getConfigApiDaiko('getProduct' + url, data);
  try {
    const response = await getApiData(config);
    evalError(response.data);
    if (response.data.error && response.data.error === true) {
      return response.data;
    }
    
    // ✅ Guardar meta original de la API
    const metaOriginal = response.data.meta || {};
    const totalProductos = metaOriginal.count || 0;
    
    let productos  = await response.data.data || response.data.productos;
    
    // ✅ VALIDACIÓN CRÍTICA: Filtrar productos sin ARTICULO_ID
    // Esto evita que el LLM invente IDs cuando la API no los proporciona
    if (productos && Array.isArray(productos)) {
      const productosOriginales = productos.length;
      
      productos = productos.filter(p => {
        // Validar que el producto tenga ARTICULO_ID válido
        const tieneId = p.ARTICULO_ID !== undefined && 
                       p.ARTICULO_ID !== null && 
                       p.ARTICULO_ID !== '';
        
        if (!tieneId) {
          console.warn(`⚠️ Producto sin ARTICULO_ID filtrado:`, p.NOMBRE || 'Sin nombre');
        }
        
        return tieneId;
      });
      
      if (productosOriginales > productos.length) {
        console.log(`📊 Filtrados ${productosOriginales - productos.length} productos sin ARTICULO_ID válido`);
      }
    }
    
    // Calcular precio con IVA incluido (sobreescribe PRECIO para que GPT muestre el precio final)
    if (productos && Array.isArray(productos)) {
      productos.forEach(p => {
        p.PRECIO = parseFloat((( p.PRECIO || 0) + (p.MONTO_IMPUESTO || 0)).toFixed(2));
      });
    }

    // Si después del filtro no quedan productos, retornar error
    if (!productos || productos.length === 0) {
      return {
        success: false,
        data: [],
        message: "No se encontraron productos con IDs válidos para esta búsqueda",
        preserveCurrentCart: true
      };
    }

    return {
      success: true,
      data: productos,
      meta: {
        count: totalProductos,  // ✅ Total de productos (de la API)
        count_filtered: productos.length,  // Productos después del filtro
        current_page: current_page,
        per_page: per_page,
        total_pages: Math.ceil(totalProductos / per_page)
      },
      message: `Encontré ${productos.length} productos que coinciden con tu búsqueda`,
      preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error buscarProductos:', error.message);
    return evalError(error);
  }
}

async function consultarAtributoProducto(query, atributo, accountId) {
  const campoMap = { marca: 'MARCA', medida: 'MEDIDA', tipo: 'TIPO' };
  const campo = campoMap[atributo] || 'MARCA';

  console.log(`🔎 consultarAtributoProducto: query="${query}", atributo="${atributo}", campo="${campo}"`);

  const resultado = await buscarProductos(query, null, null, null, 1, 100, null);

  if (!resultado.success) {
    return {
      success: false,
      message: resultado.message || `No se encontraron productos para "${query}"`,
      preserveCurrentCart: true
    };
  }

  // Intentar extraer desde campo dedicado (MARCA/MEDIDA/TIPO)
  const valores = [...new Set(
    resultado.data
      .map(p => p[campo])
      .filter(v => v && String(v).trim() !== '')
      .map(v => String(v).trim().toUpperCase())
  )].sort();

  if (valores.length > 0) {
    console.log(`✅ ${valores.length} valor(es) únicos de ${campo} para "${query}" (campo dedicado):`, valores);
    return {
      success: true,
      atributo,
      producto: query.toUpperCase(),
      valores,
      total: valores.length,
      message: `Se encontraron ${valores.length} ${atributo}(s) para ${query.toUpperCase()}`
    };
  }

  // Fallback: el campo no existe en la API — devolver nombres para que GPT extraiga
  const nombres = resultado.data
    .map(p => p.NOMBRE || '')
    .filter(n => n.trim() !== '');

  console.log(`⚠️ Campo "${campo}" vacío. Fallback a extracción desde NOMBRE (${nombres.length} productos)`);

  return {
    success: true,
    atributo,
    producto: query.toUpperCase(),
    valores: [],
    nombres,
    total_productos: nombres.length,
    message: `El campo ${campo} no está disponible en la API. Extrae los valores únicos de ${atributo} analizando los siguientes nombres de productos: ${nombres.join(' | ')}`
  };
}

async function obtenerDetalleProducto(id) {
  let data = JSON.stringify({ cliente_id: cliente_id, moneda_id: moneda_id });
  let config = getConfigApiDaiko(`getProduct/${id}`, data);
  try {
    const response = await getApiData(config);
    let producto  = await response.data;
    producto.PRECIO_VENTA = await (producto.PRECIO + producto.MONTO_IMPUESTO);
    return {
      success: true,
      data: {
        ...producto        
      },
      message: "Detalles del producto obtenido correctamente",
      preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error obtenerDetalleProducto:', error.message);
    return evalError(error);
  }
}

async function agregarAlCarrito(productoId, cantidad, carritoId, opcion = "add") {
  let data = JSON.stringify({ articulo_id: productoId, unidades: cantidad });
  let config = getConfigApiDaiko(`cart/${carritoId}/${opcion}`, data, 2);
  try {
    let response = await getApiData(config);
    let title = 'Error al ' + { add: 'agregar', remove: 'eliminar', update: 'actualizar' }[opcion] + ' el producto. ';
    evalError(response.data, title);
    if (response.data.error && response.data.error === true) {
      return response.data;
    }
    return {
      success: true,
      productoId, 
      cantidad, 
      carritoId,
      message: `Producto agregado al carrito correctamente`,
      preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error agregarAlCarrito:', error.message);
    return evalError(error);
  }
}

async function agregarVariosArticulosAlCarrito(carritoId, Productos, opcion = "add") {
  //console.log({carritoId, Productos, opcion});

  let data = JSON.stringify({ "productos": Productos });
  let config = getConfigApiDaiko(`cart/${carritoId}/${opcion}`, data, 2);
  try {
    let data = (await getApiData(config)).data;
    console.log('agregarAlCarrito', {data});
    if (data.error && data.error === true) {
      return {
        success: false,
        message: data.message,
        preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
      };
    } else {
      return {
        success: true,
        productos: Productos, 
        carritoId,
        message: `Productos agregados al carrito correctamente`,
        preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
      };
    }
  } catch (error) {
    console.error('Error agregarVariosArticulosAlCarrito:', error.message);
    return evalError(error);
  }
}

async function crearNuevoCarrito(productoId, cantidad) {
  let data = JSON.stringify({ 
    "almacen_id":  almacen_id,
    "moneda_id":   moneda_id, 
    "vendedor_id": vendedor_id, 
    "folio_ventas_id": folio_ventas_id,
    "productos": [{"articulo_id":productoId, "unidades":cantidad}]    
  });
  let config = getConfigApiDaiko(`createCart/${cliente_id}`, data, 2);
//console.log({crearNuevoCarrito: data, config});
  
  try {
    const response = await getApiData(config);
    evalError(response.data);
    if (response.data.error && response.data.error === true) {
      return {
        success: false,
        error: true,
        message: `Error al crear carrito: ${response.data.message}`,
        error_detalle: response.data.message,
        preserveCurrentCart: true
      };
    }
    return {
      success: true,
      productoId,
      cantidad,
      carritoId: response.data.carrito_creado,
      folio: response.data.folio,
      message: `Producto agregado a un nuevo carrito correctamente`,
      preserveCurrentCart: true
    };
  } catch (error) {
    console.error('Error crearNuevoCarrito:', error.message);
    return evalError(error, 'Error al crear carrito: ');
  }

}

async function crearNuevoCarritoConVariosArticulos(Productos) {
 
  let data = JSON.stringify({ 
    "almacen_id":  almacen_id,
    "moneda_id":   moneda_id, 
    "vendedor_id": vendedor_id, 
    "folio_ventas_id": folio_ventas_id,
    "productos": Productos    
  });
  let config = getConfigApiDaiko(`createCart/${cliente_id}`, data, 2);
  try {
    const response = await getApiData(config);
    evalError(response.data);
    if (response.data.error && response.data.error === true) {
      return {
        success: false,
        error: true,
        message: `Error al crear carrito: ${response.data.message}`,
        error_detalle: response.data.message,
        preserveCurrentCart: true
      };
    }
    return {
      success: true,
      productos: Productos,
      carritoId: response.data.carrito_creado,
      folio: response.data.folio,
      message: `Productos agregados a un nuevo carrito correctamente`,
      preserveCurrentCart: true
    };
  } catch (error) {
    console.error('Error crearNuevoCarritoConVariosArticulos:', error.message);
    return evalError(error, 'Error al crear carrito: ');
  }

}

async function obtenerCarritosDisponibles() {
  let data = JSON.stringify({});
  let config = getConfigApiDaiko(`getIdCart/${cliente_id}`, data, 2);
  try {
    const response = await getApiData(config);
//console.log({carritos_disponibles: response.data});
    if(!response.data.CARRITOS_ID ){
      return {
        success: false,
        data: response.data,
        message: 'No tiene carritos disponibles',
        preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
      };
    }else{
      evalError(response.data);
      if (response.data.error && response.data.error === true) {
        return response.data;
      }
      delete response.data.CARRITOS_ID;
      return {
        success: true,
        data: response.data,
        message: 'Estos son tus carritos disponibles',
        preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
      };
    }
  } catch (error) {
    console.error('Error obtenerCarritosDisponibles:', error.message);
    return evalError(error, 'Error al obtener carritos: ');
  }
}

async function verCarrito(carrito_id) {
  if(!carrito_id){
    return {
      success: false,
      data: {
        items: [],
        total: 0,
        cantidad: 0,
      },
      message: "No hay carrito asignado",
      preserveCurrentCart: true
    };
  }
  let data = JSON.stringify({});
  let config = getConfigApiDaiko(`getCart/${carrito_id}`, data, 2);
  try {
    const response = await getApiData(config);
    if(response.data.error){
      return {
        success: false,
        data: {
          items: [],
          total: 0.0,
          cantidad: 0,
          error: true,
          message: response.data.message,
        },
        message: response.data.message,
        preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
      };
    }else{
      // let i = 0;
      // let TOTAL = 0.0;
      // for (const producto of response.data.Carrito) {
      //   delete response.data.Carrito[i].COSTO_ENVIO;
      //   response.data.Carrito[i].TOTAL = ( (response.data.Carrito[i].PRECIO_UNITARIO + response.data.Carrito[i].MONTO_IMPUESTO) * response.data.Carrito[i].UNIDADES);

      //   TOTAL = TOTAL + response.data.Carrito[i].TOTAL;
      //   i++;                
      // };
      // response.data.importeCarrito.TOTAL_CARRITO = TOTAL;

      return {
        success: true,
        data: response.data,
        message: response.data.Carrito.length > 0 ? 
        `Tienes ${response.data.Carrito.length} productos en tu carrito` : 
        "Tu carrito estÃ¡ vacÃ­o",
        preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
      };
    }
  } catch (error) {
    console.error('Error verCarrito:', error.message);
    return evalError(error, 'Error al ver carrito: ');
  }
}

async function crearOrden(carritoId) {
  // 08/09/2025 Queda pendiente el cambio de la API para que registre correctamente la orden
  let tipoDocto = 'P';
  if(!carritoId){
    return {
      success: false,
      data: [],
      message: `El carrito no fue proporcionado`,
      preserveCurrentCart: true
    };
  }
  let data = JSON.stringify({ tipo_docto: tipoDocto, cliente_id, celular });
  let config = getConfigApiDaiko(`createDocto/${carritoId}`, data, 2);
  try {
    const response = await getApiData(config);
    let orden = response.data;
    console.log('crearOrden response:', JSON.stringify(orden));
    if(response.data.error){
      return {
        success: false,
        data: orden,
        message: response.data.message,
        preserveCurrentCart: true
      };
    }else{
      return {
        success: true,
        data: orden,
        message: `Pedido confirmado. Folio: ${orden.FOLIO_DESTINO}`
      };
    }
  } catch (error) {
    console.error('Error crearOrden:', error.message);
    return evalError(error, 'Error al crear el pedido: ');
  }
}

async function cancelarCarrito(carrito_id) {
  if(!carrito_id){
    return {
      success: false,
      data: {
        items: [],
        total: 0,
        cantidad: 0,
      },
      message: "No hay carrito asignado",
      preserveCurrentCart: true
    };
  }
  let data = JSON.stringify({});
  let config = getConfigApiDaiko(`deleteCart/${carrito_id}`, data, 2);

  try {
    const response = await getApiData(config);
    
    let title = 'Error al cancelar el carrito. ';
    evalError(response.data, title);
    if (response.data.error && response.data.error === true) {
      return response.data;
    }
    
    if(response.data.error){
      return {
        success: false,
        data: {
          items: [],
          total: 0.0,
          cantidad: 0,
        },
        message: response.data.message,
        preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
      };
    }else{
      return {
        success: true,
        data: response.data,
        message: `El carrito ha sido cancelado `,
        preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
      };
    }
  } catch (error) {
    console.error('Error cancelarCarrito:', error.message);
    return evalError(error, 'Error al cancelar el carrito: ');
  }

}

async function actualizarObservaciones(carritoId, observaciones, modo = "set") {
  if (!carritoId) {
    return {
      success: false,
      error: true,
      message: "No hay carrito asignado",
      preserveCurrentCart: true
    };
  }

  let observacionesFinal = observaciones;

  if (modo === "append") {
    const carritoActual = await verCarrito(carritoId);
    if (carritoActual.success && carritoActual.data && carritoActual.data.importeCarrito) {
      const obsActuales = carritoActual.data.importeCarrito.OBSERVACIONES_ENC || '';
      observacionesFinal = obsActuales ? `${obsActuales}\n${observaciones}` : observaciones;
    }
  } else if (modo === "clear") {
    observacionesFinal = '';
  }

  let data = JSON.stringify({ observaciones: observacionesFinal });
  let config = getConfigApiDaiko(`cart/${carritoId}/observations`, data, '2');

  try {
    const response = await getApiData(config);
    let title = 'Error al actualizar observaciones. ';
    evalError(response.data, title);
    if (response.data.error && response.data.error === true) {
      return {
        success: false,
        error: true,
        message: `Error al actualizar observaciones: ${response.data.message}`,
        error_detalle: response.data.message,
        preserveCurrentCart: true
      };
    }
    return {
      success: true,
      carritoId,
      observaciones: observacionesFinal,
      modo,
      message: modo === 'clear'
        ? 'Las observaciones han sido eliminadas'
        : 'Las observaciones han sido actualizadas correctamente',
      preserveCurrentCart: true
    };
  } catch (error) {
    console.error('Error en actualizarObservaciones:', error.message);
    return {
      success: false,
      error: true,
      message: `Error al actualizar observaciones: ${error.message}`,
      error_detalle: error.message,
      preserveCurrentCart: true
    };
  }
}

async function buscarMoneda(MONEDA_ID){
  let data = JSON.stringify({});
  let urlExtra = 'api/v1/catalog/getLst_Moneda';    
  let config = getConfigApiDaiko('', data, '', urlExtra);
  try {
    const response = await getApiData(config);
    let moneda  = await response.data.find(function(item) { // 11 Sep 2025 Filtro temporal
      return item.MONEDA_ID === MONEDA_ID;      
    });
    return moneda;
  } catch (error) {
    console.error('Error:', error.message);
  }
}
async function buscarVendedor(VENDEDOR_ID){
  let data = JSON.stringify({});
  let urlExtra = 'api/v1/catalog/getLst_Vendedor';    
  let config = getConfigApiDaiko('', data, '', urlExtra);
  try {
    const response = await getApiData(config);
    let vendedor  = await response.data.find(function(user) { // 11 Sep 2025 Filtro temporal
      return user.VENDEDOR_ID === VENDEDOR_ID;      
    });
    return vendedor;
  } catch (error) {
    console.error('Error:', error.message);
  }
}

async function buscarCliente(CLIENTE_ID){
  let data = JSON.stringify({CLIENTE_ID: CLIENTE_ID});
  let urlExtra = 'api/v1/org/get_Organizacion';    
  let config = getConfigApiDaiko('', data, '', urlExtra);
  try {
    const response = await getApiData(config);
    let cliente  = await response.data[0];    
    return cliente;
  } catch (error) {
    console.error('Error:', error.message);
  }
}

async function generarPdf(carrito_id) {
  if(!carrito_id){
    return {
      success: false,
      data: {
        items: [],
        total: 0,
        cantidad: 0,
      },
      message: "No hay carrito asignado",
      preserveCurrentCart: true
    };
  }
  let {data} = await verCarrito(carrito_id);
  let title = 'Error al generar el PDF, el folio del carrito no existe. ';
  evalError(data, title);
  if (data.error && data.error === true) {
    return data;
  }
  
  let cliente = await buscarCliente(data.importeCarrito.CLIENTE_ID);
  let vendedor = await buscarVendedor(data.importeCarrito.VENDEDOR_ID);
  let moneda = await buscarMoneda(data.importeCarrito.MONEDA_ID);

  let pdf = await generarPDFCotizacion({cliente: cliente,
    FECHA: data.importeCarrito.FECHA,
    FOLIO: data.importeCarrito.FOLIO,
    VENDEDOR_NOMBRE: vendedor.NOMBRE,
    articulos: data.Carrito,
    MONEDA_NOMBRE: moneda.NOMBRE,
    IMPORTE_NETO: data.importeCarrito.IMPORTE_NETO,
    TOTAL_IMPUESTOS: data.importeCarrito.TOTAL_IMPUESTOS,
    TOTAL_RETENCIONES: data.importeCarrito.TOTAL_RETENCIONES,
    TOTAL_CARRITO: data.importeCarrito.TOTAL_CARRITO,
    observaciones: data.importeCarrito.OBSERVACIONES_ENC || data.importeCarrito.OBSERVACIONES || ''
  });

  return {
    success: true,
    data: pdf,
    message: `El PDF ha sido creado`,
    preserveCurrentCart: true  // âœ… Indicar que NO debe cambiar el carrito actual
  };

  /*
  let data = JSON.stringify({});
  let config = getConfigApiDaiko(`deleteCart/${carrito_id}`, data, 2);
  try {
    const response = await getApiData(config);
    if(response.data.error){
      return {
        success: false,
        data: {
          items: [],
          total: 0.0,
          cantidad: 0,
        },
        message: response.data.message
      };
    }else{
      return {
        success: true,
        data: response.data,
        message: `El carrito ha sido cancelado `
      };
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
  */
}

async function copiarArticulosEntreCarritos(carritoOrigenId, carritoDestinoId, articulosEspecificos = null, modoCopia = 'todos') {
  try {
    // 1. Verificar que ambos carritos existan
    const carritoOrigen = await verCarrito(carritoOrigenId);
    const carritoDestino = await verCarrito(carritoDestinoId);

    if (!carritoOrigen.success) {
      return {
        success: false,
        message: `El carrito origen ${carritoOrigenId} no existe o no se pudo acceder`,
        preserveCurrentCart: true
      };
    }

    if (!carritoDestino.success) {
      return {
        success: false,
        message: `El carrito destino ${carritoDestinoId} no existe o no se pudo acceder`,
        preserveCurrentCart: true
      };
    }

    // 2. Determinar quÃ© artÃ­culos copiar
    let articulosACopiar = [];

    if (modoCopia === 'todos') {
      // Copiar TODOS los artÃ­culos del carrito origen
      articulosACopiar = carritoOrigen.data.Carrito.map(articulo => ({
        articulo_id: articulo.ARTICULO_ID,
        unidades: articulo.UNIDADES
      }));
    } else if (modoCopia === 'especificos' && articulosEspecificos && articulosEspecificos.length > 0) {
      // Copiar solo los artÃ­culos especÃ­ficos
      for (const articuloEsp of articulosEspecificos) {
        // Buscar el artÃ­culo en el carrito origen
        const articuloEnOrigen = carritoOrigen.data.Carrito.find(
          a => a.ARTICULO_ID === articuloEsp.articulo_id
        );

        if (!articuloEnOrigen) {
          console.warn(`âš ï¸  ArtÃ­culo ${articuloEsp.articulo_id} no encontrado en carrito origen`);
          continue;
        }

        articulosACopiar.push({
          articulo_id: articuloEsp.articulo_id,
          unidades: articuloEsp.cantidad !== null && articuloEsp.cantidad !== undefined 
            ? articuloEsp.cantidad 
            : articuloEnOrigen.unidades
        });
      }
    } else {
      return {
        success: false,
        message: 'Debes especificar artÃ­culos cuando usas modo "especificos"',
        preserveCurrentCart: true
      };
    }

    // 3. Validar que hay artÃ­culos para copiar
    if (articulosACopiar.length === 0) {
      return {
        success: false,
        message: 'No hay artÃ­culos para copiar',
        preserveCurrentCart: true
      };
    }


    // 4. Agregar los artÃ­culos al carrito destino
    const resultado = await agregarVariosArticulosAlCarrito(carritoDestinoId, articulosACopiar);

    if (resultado.success) {
      return {
        success: true,
        message: `Se copiaron ${articulosACopiar.length} artÃ­culo(s) del carrito ${carritoOrigenId} al carrito ${carritoDestinoId}`,
        data: {
          carrito_origen_id: carritoOrigenId,
          carrito_destino_id: carritoDestinoId,
          articulos_copiados: articulosACopiar.length,
          carrito_destino_actualizado: resultado.data
        }
      };
    } else {
      return {
        success: false,
        message: `Error al agregar artÃ­culos al carrito destino: ${resultado.message}`,
        preserveCurrentCart: true
      };
    }

  } catch (error) {
    console.error('Error copiarArticulosEntreCarritos:', error.message);
    return evalError(error, 'Error al copiar artículos: ');



  }
}


async function copiarArticulosDeUnCarritoExisenteAUnoNuevo(carritoOrigenId, articulosEspecificos = null, modoCopia = 'todos') {
  try {
    // 1. Verificar que el carrito existe
    const carritoOrigen = await verCarrito(carritoOrigenId);    

    if (!carritoOrigen.success) {
      return {
        success: false,
        message: `El carrito origen ${carritoOrigenId} no existe o no se pudo acceder`,
        preserveCurrentCart: true
      };
    }

    // 2. Determinar quÃ© artÃ­culos copiar
    let articulosACopiar = [];

    if (modoCopia === 'todos') {
      // Copiar TODOS los artÃ­culos del carrito origen
      articulosACopiar = carritoOrigen.data.Carrito.map(articulo => ({
        articulo_id: articulo.ARTICULO_ID,
        unidades: articulo.UNIDADES
      }));
    } else if (modoCopia === 'especificos' && articulosEspecificos && articulosEspecificos.length > 0) {
      // Copiar solo los artÃ­culos especÃ­ficos
      for (const articuloEsp of articulosEspecificos) {
        // Buscar el artÃ­culo en el carrito origen
        const articuloEnOrigen = carritoOrigen.data.Carrito.find(
          a => a.ARTICULO_ID === articuloEsp.articulo_id
        );

        if (!articuloEnOrigen) {
          console.warn(`âš ï¸  ArtÃ­culo ${articuloEsp.articulo_id} no encontrado en carrito origen`);
          continue;
        }

        articulosACopiar.push({
          articulo_id: articuloEsp.articulo_id,
          unidades: articuloEsp.cantidad !== null && articuloEsp.cantidad !== undefined 
            ? articuloEsp.cantidad 
            : articuloEnOrigen.unidades
        });
      }
    } else {
      return {
        success: false,
        message: 'Debes especificar artÃ­culos cuando usas modo "especificos"',
        preserveCurrentCart: true
      };
    }

    // 3. Validar que hay artÃ­culos para copiar
    if (articulosACopiar.length === 0) {
      return {
        success: false,
        message: 'No hay artÃ­culos para copiar',
        preserveCurrentCart: true
      };
    }

    // 4. Agregar los artÃ­culos al carrito destino
    const resultado = await crearNuevoCarritoConVariosArticulos(articulosACopiar);

    if (resultado.success) {
      let carritoDestinoId = resultado.carritoId;
      return {
        success: true,
        message: `Se copiaron ${articulosACopiar.length} artÃ­culo(s) del carrito ${carritoOrigenId} al carrito ${carritoDestinoId}`,
        data: {
          carrito_origen_id: carritoOrigenId,     
          carrito_destino_id: carritoDestinoId,
          folio: resultado.folio,     
          articulos_copiados: articulosACopiar.length,
          carrito_destino_actualizado: resultado.data
        }
      };
    } else {
      return {
        success: false,
        message: `Error al agregar artÃ­culos al carrito destino: ${resultado.message}`,
        preserveCurrentCart: true
      };
    }

  } catch (error) {
    console.error('Error copiarArticulosDeUnCarritoExisenteAUnoNuevo:', error.message);
    return evalError(error, 'Error al copiar artículos: ');



  }
}

async function buscarClientesPorNombre(nombre) {
  let data = JSON.stringify(nombre ? { name: nombre } : {});
  let config = getConfigApiDaiko('getCustomers', data);
  try {
    const response = await getApiData(config);
    const clientes = response.data;
    const nombreUpper = nombre.toUpperCase();
    const filtrados = clientes.filter(function(c) {
      return c.NOMBRE && c.NOMBRE.toUpperCase().indexOf(nombreUpper) !== -1;
    }).slice(0, 10);
    return {
      success: true,
      data: filtrados,
      message: filtrados.length > 0
        ? 'Se encontraron ' + filtrados.length + ' cliente(s)'
        : 'No se encontraron clientes con ese nombre'
    };
  } catch (error) {
    console.error('Error buscarClientesPorNombre:', error.message);
    return evalError(error, 'Error al buscar clientes: ');
  }
}

async function getBalanceDue() {
  let data = JSON.stringify({ cliente_id, celular });
  let config = getConfigApiDaiko('getBalanceDue', data);
  try {
    const response = await getApiData(config);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Error getBalanceDue:', error.message);
    return evalError(error, 'Error al consultar saldo: ');
  }
}

async function getStockArticle(articulo_id) {
  let data = JSON.stringify({ cliente_id, celular, articulo_id });
  let config = getConfigApiDaiko('getStockArticle', data);
  try {
    const response = await getApiData(config);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Error getStockArticle:', error.message);
    return evalError(error, 'Error al consultar existencia: ');
  }
}

async function getTrackingPedido(folio) {
  let data = JSON.stringify({ cliente_id, celular, folio });
  let config = getConfigApiDaiko('getTrackingPedido', data);
  try {
    const response = await getApiData(config);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Error getTrackingPedido:', error.message);
    return evalError(error, 'Error al consultar pedido: ');
  }
}

async function buscarClientePorIdLocal(id) {
  let data = JSON.stringify(id ? { cliente_id: parseInt(id, 10) } : {});
  let config = getConfigApiDaiko('getCustomers', data);
  try {
    const response = await getApiData(config);
    const clientes = response.data;
    const cliente = Array.isArray(clientes)
      ? clientes.find(function(c) { return c.CLIENTE_ID === parseInt(id, 10); })
      : clientes;
    return cliente || null;
  } catch (error) {
    console.error('Error buscarClientePorIdLocal:', error.message);
    return null;
  }
}

async function crearProspecto(url_crm_, token_, datos) {
  url_crm_zeus = url_crm_;
  api_access_token = token_;
  const data = JSON.stringify({
    nombre: datos.nombre_prospecto,
    nombre_contacto: datos.nombre_contacto,
    celular: datos.celular,
    telefono_oficina: datos.telefono_oficina || null,
    permisos_default: datos.permisos_default !== undefined ? datos.permisos_default : false,
    clave: datos.clave !== undefined ? datos.clave : null
  });
  let config = getConfigApiDaiko('createProspecto', data);
  try {
    const response = await getApiData(config);
    const err = evalError(response.data, 'Error al crear prospecto: ');
    if (err) return err;
    return { success: true, data: response.data, message: 'Prospecto creado exitosamente' };
  } catch (error) {
    console.error('Error crearProspecto:', error.message);
    return evalError(error, 'Error al crear prospecto: ');
  }
}

module.exports = {
  buscarcliente,
  buscarcliente2,
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
  generarPdf,
  copiarArticulosEntreCarritos,
  copiarArticulosDeUnCarritoExisenteAUnoNuevo,
  actualizarObservaciones,
  consultarAtributoProducto,
  buscarClientesPorNombre,
  buscarClientePorIdLocal,
  buscarCliente,
  getBalanceDue,
  getStockArticle,
  getTrackingPedido,
  crearProspecto
};