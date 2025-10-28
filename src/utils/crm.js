require('dotenv').config();

let cliente_id = 0; 
let moneda_id  = 1;
let almacen_id = 0;
let vendedor_id = 0;
const folio_ventas_id = 92226;
let api_access_token = ''; // process.env.CRMZEUS_APIACCESSTOKEN;
let url_crm_zeus = '';     // process.env.CRMZEUS_URL; // 'https://app.chatzeus.com/';

const { getApiData } = require('./functions');
const { generarPDFCotizacion } = require('./pdf-make');

let evalError = (data, title = '') => {
  if (data.error && data.error === true) {
    data.success = false;
    data.preserveCurrentCart = true;
    data.message = title + data.message;
    console.log(data);
  }
}

function getConfigApiDaiko(api, data, version = '1', urlExtra = ''){
  urlExtra = urlExtra.trim();
  let url = ( urlExtra.length == 0 ? `${url_crm_zeus}apiCrm/externalAccess/accessToken/api/Daiko/v${version}/${api}` : `${url_crm_zeus}apiCrm/externalAccess/accessToken/${urlExtra}`) ;
  console.log({url, data});
  // Se supone que aquí se debe de agregar lo de recuperar el api_access_token desde https://app.chatzeus.com/api/v1/accounts/416/integrations/apps/daiko
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
    console.error('Error:', error.message);
  }
}

  
async function buscarcliente2(url_crm_zeus_, api_access_token_, info){
  almacen_id = await info.almacen_id;
  url_crm_zeus = await url_crm_zeus_;
  api_access_token = await api_access_token_;

  //console.log({info});

  let {email, phone_number, contact_id} = info;
  phone_number = (phone_number ? phone_number.substr(-10) : phone_number);

  let data = JSON.stringify({});
  let urlExtra = '';
  
  let buscarContacto = false;

  if(email && email.length > 4){
    data = JSON.stringify({"EMAIL": email});
    urlExtra = 'api/v1/contact/find_Contacto';
  
  }

  if(phone_number){
    data = JSON.stringify({"TELEFONO": phone_number});
    urlExtra = 'api/v1/contact/find_Contacto';
    
  }

  let config = getConfigApiDaiko('', data, '', urlExtra);
  let response = [];
  let contacto = [];

  try {

    response = await getApiData(config);
    contacto = response.data[0];

  } catch (error) {
    // No se encontró el contacto recuperar el CLIENTE_ID usando el CONTACTO_ID ASIGNADO

    data = JSON.stringify({CLIENTE_ID: contact_id});
    urlExtra = 'api/v1/org/get_Organizacion';
    config = getConfigApiDaiko('', data, '', urlExtra);
    buscarContacto = true;
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


    let cliente = response.data[0];
   
    vendedor_id = await cliente.VENDEDOR_ID;
    cliente_id = cliente.CLIENTE_ID;
    moneda_id = cliente.MONEDA_ID || moneda_id; 

    return {
      success: true,
      data: {        
        ALMACEN_ID: almacen_id,
        CLIENTE_ID: cliente.CLIENTE_ID, 
        MONEDA_ID: cliente.MONEDA_ID || moneda_id, 
        VENDEDOR_ID: cliente.VENDEDOR_ID, 
        NOMBRE_COMERCIAL: cliente.NOMBRE_COMERCIAL        
      },
      preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error:', error.message);
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
      data: Categorias, // Máximo 5 resultados
      message: `Encontré ${Categorias.length} categorias que coinciden con tu búsqueda`,
      preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error:', error.message);
  }
}
  
async function buscarProductos(query, categoria = null, precioMax = null, current_page=1, per_page=5) {
  let data = JSON.stringify({ cliente_id: cliente_id, moneda_id: moneda_id, current_page, per_page });
  //console.log({ln: 76, data});  
  let config = getConfigApiDaiko('getProduct' + (!query ? `ByCategory/${categoria}` : `Search/${query}`), data);
  try {
    const response = await getApiData(config);
    let productos  = await response.data.data; //response.data.productos;
    //console.log({productos, meta: response.data.meta});

    //for (const producto of productos) {
    //  console.log({producto});
    //};
    return {
      success: true,
      data: productos,
      length: productos.length,
      pagina_actual: current_page,
      message: `Encontré ${productos.length} productos que coinciden con tu búsqueda`,
      preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error:', error.message);
  }
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
      preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error:', error.message);
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
      preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error:', error.message);
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
        preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
      };
    } else {
      return {
        success: true,
        productos: Productos, 
        carritoId,
        message: `Productos agregados al carrito correctamente`,
        preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
      };
    }
  } catch (error) {
    console.error('Error:', error.message);
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
      return response.data;
    }
    return {
      success: true,
      productoId, 
      cantidad, 
      carritoId: response.data.carrito_creado,
      message: `Producto agregado a un nuevo carrito correctamente`,
      preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error:', error.message);
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
    return {
      success: true,
      productos: Productos, 
      carritoId: response.data.carrito_creado,
      message: `Productos agregados a un nuevo carrito correctamente`,
      preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
    };
  } catch (error) {
    console.error('Error:', error.message);
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
        preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
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
        preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
      };
    }
  } catch (error) {
    console.error('Error:', error.message);
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
      message: "No hay carrito asignado"
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
        },
        message: response.data.message,
        preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
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
        "Tu carrito está vacío",
        preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
      };
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

async function crearOrden(carritoId) {
  // 08/09/2025 Queda pendiente el cambio de la API para que registre correctamente la orden
  let tipoDocto = 'P';
  if(!carritoId){
    return {
      success: false,
      data: [],
      message: `El carrito no fue proporcionado`
    };
  }
  let data = JSON.stringify({ tipo_docto: tipoDocto });
  let config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://crmzeus-app.com/apiCrm/externalAccess/accessToken/api/Daiko/v1/createDocto/'+carritoId,
    headers: { 
      'api_access_token': api_access_token,     
      'Content-Type': 'application/json', 
      'Cookie': 'connect.sid=s%3A0tL5QPECvc3vmYUnupoVcskyLwi1-YFm.SByWF6a5CDxboz4KqOVSBZiLokAJwvoHThep%2BnZg8xc'
    },
    data : data
  };
  try {
    const response = await getApiData(config);
    let orden = response.data;
    if(response.data.error){
      return {
        success: false,
        data: {
          items: orden,
          total: 0.0,
          cantidad: 0,
        },
        message: response.data.message
      };
    }else{
      return {
        success: true,
        data: orden,
        message: `La orden con folio: ${orden.getCartId.orden_id} fue creada exitosamente`
      };
    }
  } catch (error) {
    console.error('Error:', error.message);
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
      message: "No hay carrito asignado"
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
        preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
      };
    }else{
      return {
        success: true,
        data: response.data,
        message: `El carrito ha sido cancelado `,
        preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
      };
    }
  } catch (error) {
    console.error('Error:', error.message);
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
      message: "No hay carrito asignado"
    };
  }
  let {data} = await verCarrito(carrito_id);
  let cliente = await buscarCliente(data.importeCarrito.CLIENTE_ID);
  let vendedor = await buscarVendedor(data.importeCarrito.VENDEDOR_ID);
  let moneda = await buscarMoneda(data.importeCarrito.MONEDA_ID);

  let pdf = await generarPDFCotizacion({cliente: cliente, 
    FECHA: data.importeCarrito.FECHA,
    FOLIO: data.importeCarrito.FOLIO,
    VENDEDOR_NOMBRE: vendedor.NOMBRE,
    articulos: data.Carrito,
    MONEDA_NOMBRE: moneda.NOMBRE,
    IMPORTE_NETO: data.importeCarrito.IMPORTE_NETO
  });

  return {
    success: true,
    data: pdf,
    message: `El PDF ha sido creado`,
    preserveCurrentCart: true  // ✅ Indicar que NO debe cambiar el carrito actual
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
  generarPdf
};