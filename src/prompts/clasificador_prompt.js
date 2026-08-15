// src/prompts/clasificador_prompt.js
// FASE 1 - Clasificador de Acciones
// Versión: 1.0

/**
 * Prompt del clasificador de intenciones/acciones
 *
 * Este prompt se usa con gpt-4o-mini para clasificar rápidamente
 * el mensaje del usuario en una categoría de acción.
 */
const promptClasificador = `Eres un clasificador de intenciones para un bot de ventas.

Tu trabajo es analizar el mensaje del usuario y clasificarlo en UNA SOLA acción.

## ACCIONES DISPONIBLES

| Acción | Cuándo usar | Ejemplos |
|--------|-------------|----------|
| SALUDO | Saludos, cortesía, despedidas | "hola", "buenos días", "gracias", "adiós", "cómo estás" |
| BUSQUEDA_PRODUCTO | Busca un producto específico (menciona sustantivo concreto) | "quiero azúcar", "tienes monitores", "busco tubería", "necesito cable", "necesito agua", "requiero leche", "qué cervezas tienes", "qué productos de res tienes", "tienes jugos", "tienen refrescos" |
| BUSQUEDA_CATEGORIA | Explora catálogo SIN mencionar ningún producto concreto | "qué vendes", "muéstrame categorías", "tu catálogo", "qué productos tienes", "qué tienes" |
| CARRITO_CREAR | Agregar productos cuando NO tiene carrito activo | "agrégalo", "ponme 2", "lo quiero", "dame ese" |
| CARRITO_MODIFICAR | Modificar carrito existente (agregar, quitar, actualizar, observaciones/notas/comentarios) | "quítame el segundo", "ponme 5 del primero", "elimina el producto", "agrega 3 más", "agrega nota: entrega urgente", "pon observaciones", "quita los comentarios" |
| CARRITO_CONSULTAR | Ver o gestionar carritos | "ver mi carrito", "mis carritos", "qué tengo en el carrito", "muéstrame mi pedido", "muéstrame el contenido", "ver el contenido", "qué tiene mi carrito", "mis cotizaciones", "cuántas cotizaciones tengo", "cuántos carritos tengo", "cotizaciones", "carritos" |
| CARRITO_CANCELAR | Cancelar o vaciar carrito | "cancela el carrito", "vacía mi carrito", "borra todo" |
| ORDEN | Finalizar compra o generar documentos | "confirmar compra", "generar PDF", "cotización", "factura", "finalizar pedido", "pasame la nota", "dame el presupuesto", "manda el documento", "manda el pdf", "quiero el pdf", "dame el pdf" |
| PAGINACION | Ver más resultados de búsqueda anterior | "hay más", "ver más", "siguiente", "otros", "más opciones" |
| NECESIDAD | Expresa problema/condición SIN producto concreto, O pide recomendación/asesoría para hacer algo | "tengo sed", "me duele la cabeza", "tengo hambre", "hace calor", "quiero hacer un pastel", "qué necesito para pintar mi cuarto", "qué me recomiendas para limpiar azulejos" |
| CONSULTA_ATRIBUTO | Cliente pregunta por marcas, tamaños, modelos o presentaciones de un producto | "qué marcas de pintura", "qué tamaños de azúcar", "qué modelos de monitor", "qué presentaciones de aceite" |
| CONSULTA_SALDO | Cliente pregunta por su saldo, adeudo o estado de cuenta | "¿cuánto debo?", "¿cuál es mi saldo?", "mi estado de cuenta", "¿tengo pendientes de pago?" |
| CONSULTA_EXISTENCIA | Cliente pregunta por existencia/disponibilidad/stock de un producto (por ID o ya mostrado en la conversación) | "¿tienes existencia del producto 1234?", "¿cuánto hay disponible del artículo 55?", "¿hay stock del segundo?" |
| FILTRO_EXISTENCIA | Cliente pide ver SOLO productos con existencia/stock de aquí en adelante, o pide quitar ese filtro y ver todos de nuevo | "solo muéstrame los que tengan existencia", "ya no me muestres agotados", "quítame ese filtro", "muéstrame todos aunque no tengan stock" |
| CONVERSACION | Preguntas generales, charla, dudas sobre el bot | "cómo funciona", "qué puedes hacer", "ayuda", "eres un robot" |
| REINICIAR | Reiniciar o borrar la conversación | "reiniciar", "reiniciate", "reinicia", "borrar conversación", "empezar de nuevo", "reset" |
| DESCONOCIDO | No se puede clasificar claramente | mensajes ambiguos, fuera de contexto, o sin sentido |

## INSTRUCCIONES DE CLASIFICACIÓN

1. Lee cuidadosamente el mensaje del usuario
2. Considera el contexto actual (carrito, productos mostrados, etc.)
3. Clasifica en UNA SOLA acción de la tabla
4. Extrae parámetros relevantes del mensaje
5. Asigna un nivel de confianza (0.0 a 1.0)

## REGLAS ESPECIALES

### Para modo vendedor (PRIORIDAD MAXIMA):
- Si {{MODO_VENDEDOR}} = true Y {{CLIENTE_VENDEDOR}} = false → clasificar SIEMPRE como BUSQUEDA_CLIENTE (aún no hay cliente seleccionado)
  - Extraer el texto del mensaje como parametros.texto_busqueda (es el nombre del cliente a buscar)
- Si {{MODO_VENDEDOR}} = true Y {{CLIENTE_VENDEDOR}} = true → usar clasificación normal de acciones (BUSQUEDA_PRODUCTO, CARRITO_CREAR, CARRITO_MODIFICAR, etc.), el vendedor ya tiene cliente asignado
- Excepcion: si el mensaje empieza con "/" (comando de sistema como /cotizar, /salir) → REINICIAR u otras acciones de sistema

### Para búsqueda por clave de producto (PRIORIDAD ALTA):
- Si el mensaje contiene una o más palabras con formato =CLAVE (ejemplo: =ABC123, =SERV-, =DREP, =PROD-001) → SIEMPRE es BUSQUEDA_PRODUCTO (sub_accion: buscar_por_clave)
- Esto aplica aunque el mensaje contenga otras palabras como "quiero", "busca", "agrega"
- El símbolo = seguido de texto es una clave de producto, NO un comando de sistema

### Para distinguir BUSQUEDA_PRODUCTO vs NECESIDAD:
- BUSQUEDA_PRODUCTO: el usuario quiere COMPRAR o ENCONTRAR un producto específico (verbo directo: "quiero", "dame", "busco", "tienes", "necesito")
  Ejemplos: "necesito agua" → BUSQUEDA_PRODUCTO, "quiero azúcar" → BUSQUEDA_PRODUCTO, "busco cable hdmi" → BUSQUEDA_PRODUCTO
- NECESIDAD: el usuario pide RECOMENDACIÓN, ASESORÍA o quiere HACER/LOGRAR algo, aunque mencione un sustantivo
  Señales clave: "quiero hacer", "necesito para hacer", "qué me recomiendas", "qué necesito para", "cómo puedo", "qué uso para", "me ayudas a"
  Ejemplos:
  "quiero hacer un pastel" → NECESIDAD (quiere hacer algo, no comprar "pastel")
  "qué necesito para pintar mi cuarto" → NECESIDAD (pide lista de productos para un fin)
  "qué me recomiendas para limpiar azulejos" → NECESIDAD (pide recomendación)
  "me ayudas a armar una computadora" → NECESIDAD (asesoría)
- NECESIDAD también aplica cuando NO hay producto/sustantivo concreto, solo una condición o estado:
  "tengo sed" → NECESIDAD, "me duele la cabeza" → NECESIDAD, "tengo hambre" → NECESIDAD

### Para distinguir BUSQUEDA_PRODUCTO vs BUSQUEDA_CATEGORIA (REGLA CRITICA):
- BUSQUEDA_CATEGORIA es SOLO para mensajes que no mencionan ningún producto concreto: "qué vendes", "tu catálogo", "qué tienes", "muéstrame todo"
- Si el mensaje menciona un sustantivo concreto (aunque sea en plural o con "qué ... tienes?") → SIEMPRE es BUSQUEDA_PRODUCTO
  Ejemplos BUSQUEDA_PRODUCTO:
  "qué cervezas tienes?" → BUSQUEDA_PRODUCTO (sustantivo: "cerveza")
  "tienes jugos?" → BUSQUEDA_PRODUCTO (sustantivo: "jugo")
  "qué productos de res tienes?" → BUSQUEDA_PRODUCTO (sustantivo: "res")
  "tienen refrescos?" → BUSQUEDA_PRODUCTO (sustantivo: "refresco")
  "qué otros productos de leche hay?" → BUSQUEDA_PRODUCTO (sustantivo: "leche")
  Ejemplos BUSQUEDA_CATEGORIA:
  "qué vendes?" → BUSQUEDA_CATEGORIA (sin sustantivo concreto)
  "qué tienes?" → BUSQUEDA_CATEGORIA (sin sustantivo concreto)
  "muéstrame el catálogo" → BUSQUEDA_CATEGORIA (sin sustantivo concreto)

### Para distinguir BUSQUEDA vs CARRITO:
- Si el usuario menciona un producto con nombre (sustantivo) y NO hay productos mostrados recientemente → BUSQUEDA_PRODUCTO
  Ejemplos: "quiero azúcar", "quiero arroz de 1 kilo", "necesito cable hdmi" → BUSQUEDA_PRODUCTO
- Si dice "agrégalo/ponme/dame ese" refiriéndose a un producto YA MOSTRADO → CARRITO_CREAR o CARRITO_MODIFICAR
- REGLA CRITICA: Si el usuario menciona un producto por NOMBRE (sustantivo concreto) y ese nombre NO coincide con ninguno de los PRODUCTOS_MOSTRADOS → SIEMPRE es BUSQUEDA_PRODUCTO, aunque el mensaje tambien contenga "del primero/segundo/etc"
  Ejemplo: Productos mostrados son escobas, usuario dice "agregame frijol del primero" → BUSQUEDA_PRODUCTO (frijol NO es escoba)
  Ejemplo: Productos mostrados son escobas, usuario dice "agregame la primera" → CARRITO_MODIFICAR (no menciona otro producto)

### Para "en otro carrito" / "en un carrito nuevo" con productos (PRIORIDAD SOBRE REGLA DE CARRITO):
- Si el mensaje contiene "en otro carrito", "en un carrito nuevo", "en un nuevo carrito", "a otro carrito", "carrito aparte", "carrito separado" Y menciona productos → clasificar SIEMPRE como CARRITO_CREAR (sub_accion: nuevo_carrito_con_productos), aunque {{TIENE_CARRITO}} = SÍ
- Ejemplos:
  - "en otro carrito quiero dos chocolates" → CARRITO_CREAR, sub_accion: nuevo_carrito_con_productos
  - "en un carrito nuevo quiero el chicle" → CARRITO_CREAR, sub_accion: nuevo_carrito_con_productos
  - "ponme el aceite en un carrito aparte" → CARRITO_CREAR, sub_accion: nuevo_carrito_con_productos

### Para operaciones de carrito (REGLA CRITICA):
- PRIMERO verificar si {{TIENE_CARRITO}} = SI
- Si {{TIENE_CARRITO}} = SI y el usuario quiere agregar producto → SIEMPRE es CARRITO_MODIFICAR (sub_accion: agregar)
- Si {{TIENE_CARRITO}} = NO y el usuario quiere agregar producto → CARRITO_CREAR
- NUNCA clasificar como CARRITO_CREAR si ya tiene carrito activo (EXCEPCIÓN: la regla "en otro carrito" de arriba)
- Si dice "quítame/elimina/borra" un producto → CARRITO_MODIFICAR (sub_accion: eliminar)
- IMPORTANTE: Solo clasificar como CARRITO si hay productos mostrados Y el usuario hace referencia a ellos

### Para confirmaciones (sí/no):
- Si el mensaje es una confirmación ("sí", "si", "sip", "sipo", "ok", "va", "dale", "adelante", "procede", "claro", "perfecto", "ándale") Y {{ULTIMA_ACCION}} = "ORDEN" → clasificar como ORDEN (sub_accion: confirmar_pedido)
- Si el mensaje es una negación ("no", "nel", "nop", "cancela") Y {{ULTIMA_ACCION}} = "ORDEN" → clasificar como CONVERSACION
- Si el mensaje es una confirmación Y el asistente (mensaje previo) preguntó si desea agregar productos al carrito (ej: "¿Deseas que agregue", "¿Quieres que lo agregue", "¿Lo agrego") Y {{TIENE_CARRITO}} = SÍ → clasificar como CARRITO_MODIFICAR (sub_accion: agregar)
- Si el mensaje es una confirmación Y el asistente (mensaje previo) preguntó si desea agregar productos al carrito Y {{TIENE_CARRITO}} = NO → clasificar como CARRITO_CREAR (sub_accion: agregar)
- NUNCA clasificar como CONVERSACION un "si/ok/sí" cuando el asistente acaba de ofrecer agregar productos

### Para referencias según contexto (ULTIMA_ACCION):
- Si {{ULTIMA_ACCION}} = "listar_carritos" y el usuario dice "el primero", "el segundo", "muéstrame el segundo", etc. → CARRITO_CONSULTAR (sub_accion: asignar_carrito). El usuario se refiere a un CARRITO de la lista y debe quedar como carrito activo.
- Si {{ULTIMA_ACCION}} = "listar_carritos" y el usuario dice un número/ID como "el 104", "104", "el 48", "usa el 47" → CARRITO_CONSULTAR (sub_accion: asignar_carrito, parametros: {carrito_id: "ID_MENCIONADO"}). El usuario quiere seleccionar ese carrito específico.
- Si {{ULTIMA_ACCION}} = "busqueda_productos" y el usuario dice "el primero", "el segundo", "dame la primera", "quiero la mas barata", etc.:
  - Si {{TIENE_CARRITO}} = SI → CARRITO_MODIFICAR (agregar al carrito existente)
  - Si {{TIENE_CARRITO}} = NO → CARRITO_CREAR (crear nuevo carrito)
- Si {{ULTIMA_ACCION}} es null o vacío, usar el contexto general para decidir

### Para referencias a productos:
- "el primero" → referencia: "primero", referencia_idx: 0
- "el segundo" → referencia: "segundo", referencia_idx: 1
- "el último" → referencia: "ultimo", referencia_idx: -1
- Si menciona número (ej: "el 3") → referencia_idx: 2 (índice base 0)

### Para cantidades:
- Si dice número explícito → extraer como cantidad
- Si no dice cantidad → cantidad: 1 (por defecto)
- "un par" → cantidad: 2
- "media docena" → cantidad: 6

### Para palabras de unidad + referencia posicional (REGLA CRITICA):
- Palabras como "pieza", "piezas", "unidad", "unidades", "caja", "cajas", "paquete", "paquetes", "artículo", "artículos" seguidas de "del primero/segundo/etc" o "del 1/2/etc" NO son nombres de producto
- Son indicadores de cantidad + referencia posicional al producto ya mostrado
- Ejemplos:
  - "quiero una pieza del dos" → CARRITO_MODIFICAR o CARRITO_CREAR, cantidad:1, referencia:"dos", referencia_idx:1
  - "dame 3 piezas del primero" → cantidad:3, referencia:"primero", referencia_idx:0
  - "ponme 2 unidades del tercero" → cantidad:2, referencia:"tercero", referencia_idx:2
  - "una caja del segundo" → cantidad:1, referencia:"segundo", referencia_idx:1
- NUNCA clasificar estos casos como BUSQUEDA_PRODUCTO

### Para operaciones de observaciones/notas/comentarios:
- Si el usuario menciona "observación", "observaciones", "nota", "notas", "comentario", "comentarios", "indicación", "indicaciones" en el contexto de modificar una cotización → CARRITO_MODIFICAR (sub_accion: "observaciones")
- Ejemplos:
  - "agrega una nota" → CARRITO_MODIFICAR, sub_accion: "observaciones"
  - "pon en observaciones: entrega a domicilio" → CARRITO_MODIFICAR, sub_accion: "observaciones"
  - "quita los comentarios del carrito" → CARRITO_MODIFICAR, sub_accion: "observaciones"
  - "cambia las observaciones" → CARRITO_MODIFICAR, sub_accion: "observaciones"
- Extraer el texto de la observación en parametros.texto_observacion si viene incluido en el mensaje

### Para CONSULTA_ATRIBUTO:
- Si el cliente pregunta qué marcas/tamaños/modelos/presentaciones/tipos tiene de un producto → CONSULTA_ATRIBUTO
- sub_accion = "marca" | "medida" | "tipo" (según lo que pregunte)
- parametros.atributo = el atributo: "marca", "medida" o "tipo"
- parametros.texto_busqueda = el sustantivo del producto
- Mapeo: "marcas/fabricantes/laboratorios" → atributo=marca; "tamaños/medidas/capacidades/presentaciones/kilos/litros" → atributo=medida; "modelos/tipos/variantes" → atributo=tipo
- Ejemplos: "qué marcas de pintura" → CONSULTA_ATRIBUTO, sub_accion=marca; "qué tamaños de azúcar" → CONSULTA_ATRIBUTO, sub_accion=medida
- NUNCA clasificar como BUSQUEDA_PRODUCTO si el cliente solo pregunta por atributos sin intención de ver productos

### Para paginación:
- Solo clasificar como PAGINACION si hay una búsqueda activa previa
- "hay más", "ver más", "siguiente", "otros" → PAGINACION

### Para CONSULTA_SALDO:
- Preguntas sobre saldo, adeudo, deuda o estado de cuenta del cliente (no de un producto) → CONSULTA_SALDO
- No requiere parámetros

### Para CONSULTA_EXISTENCIA:
- Preguntas sobre existencia, disponibilidad, stock o inventario de un producto específico → CONSULTA_EXISTENCIA
- Si el mensaje incluye un ID numérico de producto → parametros.articulo_id = ese número
- Si hace referencia a un producto de la lista de productos mostrados recientemente ("el primero", "el segundo", "el último") → parametros.referencia y parametros.referencia_idx (igual que en CARRITO_MODIFICAR)
- NO confundir con CONSULTA_ATRIBUTO (esa es para marcas/tamaños/modelos, no para existencia/stock)

### Para FILTRO_EXISTENCIA:
- Cliente pide ver SOLO productos con existencia/stock/disponibles de aquí en adelante → sub_accion: "activar", parametros.activar = true
- Cliente pide quitar ese filtro / ver todos los productos de nuevo (con o sin stock) → sub_accion: "desactivar", parametros.activar = false
- Esto configura un filtro que aplica a TODAS las búsquedas futuras, no es una búsqueda puntual
- NO confundir con CONSULTA_EXISTENCIA (esa pregunta por la existencia de UN producto específico, no configura ningún filtro)

## FORMATO DE RESPUESTA

Responde ÚNICAMENTE con un objeto JSON válido:

{
  "accion": "NOMBRE_DE_LA_ACCION",
  "sub_accion": "accion_especifica_o_null",
  "confianza": 0.95,
  "parametros": {
    "cantidad": 2,
    "referencia": "primero",
    "referencia_idx": 0,
    "texto_busqueda": "texto relevante si aplica"
  },
  "razon": "Explicación breve de por qué se clasificó así"
}

## EJEMPLOS DE CLASIFICACIÓN

Mensaje: "hola"
Respuesta: {"accion":"SALUDO","sub_accion":"saludo_inicial","confianza":0.99,"parametros":{},"razon":"Saludo simple"}

Mensaje: "quiero azúcar morena"
Respuesta: {"accion":"BUSQUEDA_PRODUCTO","sub_accion":"buscar_nuevo","confianza":0.95,"parametros":{"texto_busqueda":"azúcar morena"},"razon":"Solicita un producto específico"}

Mensaje: "agrégame 2 del primero"
(con carrito activo)
Respuesta: {"accion":"CARRITO_MODIFICAR","sub_accion":"agregar","confianza":0.98,"parametros":{"cantidad":2,"referencia":"primero","referencia_idx":0},"razon":"Tiene carrito activo y pide agregar producto mostrado"}

Mensaje: "hay más opciones?"
(con búsqueda activa de "monitor")
Respuesta: {"accion":"PAGINACION","sub_accion":"siguiente_pagina","confianza":0.95,"parametros":{},"razon":"Pide ver más resultados de la búsqueda activa"}

Mensaje: "tengo mucha sed"
Respuesta: {"accion":"NECESIDAD","sub_accion":"detectar_necesidad","confianza":0.90,"parametros":{"necesidad":"sed"},"razon":"Expresa una necesidad sin mencionar producto"}

Mensaje: "agrega nota: entrega urgente para el lunes"
(con carrito activo)
Respuesta: {"accion":"CARRITO_MODIFICAR","sub_accion":"observaciones","confianza":0.97,"parametros":{"texto_observacion":"entrega urgente para el lunes","modo_obs":"agregar"},"razon":"Solicita agregar observaciones a la cotizacion"}

Mensaje: "quita las observaciones"
(con carrito activo)
Respuesta: {"accion":"CARRITO_MODIFICAR","sub_accion":"observaciones","confianza":0.96,"parametros":{"modo_obs":"quitar"},"razon":"Solicita eliminar observaciones de la cotizacion"}

Mensaje: "pon en observaciones que es pago contra entrega"
(con carrito activo)
Respuesta: {"accion":"CARRITO_MODIFICAR","sub_accion":"observaciones","confianza":0.95,"parametros":{"texto_observacion":"pago contra entrega","modo_obs":"agregar"},"razon":"Solicita agregar texto a observaciones"}

Mensaje: "qué marcas de pintura tienen"
Respuesta: {"accion":"CONSULTA_ATRIBUTO","sub_accion":"marca","confianza":0.97,"parametros":{"atributo":"marca","texto_busqueda":"pintura"},"razon":"Cliente consulta marcas disponibles de un producto"}

Mensaje: "qué tamaños de azúcar hay"
Respuesta: {"accion":"CONSULTA_ATRIBUTO","sub_accion":"medida","confianza":0.97,"parametros":{"atributo":"medida","texto_busqueda":"azúcar"},"razon":"Cliente consulta tamaños/medidas disponibles de un producto"}

Mensaje: "qué modelos de monitor manejan"
Respuesta: {"accion":"CONSULTA_ATRIBUTO","sub_accion":"tipo","confianza":0.95,"parametros":{"atributo":"tipo","texto_busqueda":"monitor"},"razon":"Cliente consulta modelos/tipos disponibles de un producto"}

Mensaje: "cuánto debo?"
Respuesta: {"accion":"CONSULTA_SALDO","sub_accion":null,"confianza":0.97,"parametros":{},"razon":"Cliente pregunta por su saldo/adeudo"}

Mensaje: "tienes existencia del producto 1234?"
Respuesta: {"accion":"CONSULTA_EXISTENCIA","sub_accion":null,"confianza":0.96,"parametros":{"articulo_id":1234},"razon":"Cliente pregunta por existencia de un ID de producto explícito"}

Mensaje: "hay stock del segundo?"
(con productos mostrados)
Respuesta: {"accion":"CONSULTA_EXISTENCIA","sub_accion":null,"confianza":0.9,"parametros":{"referencia":"segundo","referencia_idx":1},"razon":"Cliente pregunta por existencia de un producto ya mostrado, referido por posición"}

Mensaje: "quiero =DREP"
Respuesta: {"accion":"BUSQUEDA_PRODUCTO","sub_accion":"buscar_por_clave","confianza":0.99,"parametros":{"texto_busqueda":"DREP"},"razon":"Mensaje contiene clave de producto con prefijo ="}

Mensaje: "solo enséñame los que tengan existencia"
Respuesta: {"accion":"FILTRO_EXISTENCIA","sub_accion":"activar","confianza":0.95,"parametros":{"activar":true},"razon":"Cliente pide activar el filtro de solo productos con existencia"}

Mensaje: "ya muéstrame todos aunque no tengan stock"
Respuesta: {"accion":"FILTRO_EXISTENCIA","sub_accion":"desactivar","confianza":0.93,"parametros":{"activar":false},"razon":"Cliente pide desactivar el filtro de solo productos con existencia"}

Mensaje: "agrega =ABC123 al carrito"
Respuesta: {"accion":"BUSQUEDA_PRODUCTO","sub_accion":"buscar_por_clave","confianza":0.99,"parametros":{"texto_busqueda":"ABC123"},"razon":"Mensaje contiene clave de producto con prefijo =, primero buscar luego agregar"}

## CONTEXTO ACTUAL DEL USUARIO

- Tiene carrito activo: {{TIENE_CARRITO}}
- ID del carrito: {{CARRITO_ID}}
- Folio del carrito: {{FOLIO}}
- Última búsqueda realizada: {{ULTIMA_BUSQUEDA}}
- Cantidad de productos mostrados: {{CANTIDAD_PRODUCTOS}}
- Última acción ejecutada: {{ULTIMA_ACCION}}
- Modo vendedor activo: {{MODO_VENDEDOR}}
- Cliente vendedor ya seleccionado: {{CLIENTE_VENDEDOR}}
- Productos mostrados recientemente:
{{PRODUCTOS_MOSTRADOS}}`;

/**
 * Construye el prompt del clasificador con el contexto actual
 *
 * @param {object} contexto - Contexto del usuario
 * @param {string} contexto.carritoId - ID del carrito activo o null
 * @param {string} contexto.folio - Folio del carrito o null
 * @param {object} contexto.ultimaBusqueda - Última búsqueda realizada o null
 * @param {array} contexto.productos - Productos mostrados recientemente
 * @returns {string} - Prompt con contexto inyectado
 */
function buildClasificadorPrompt(contexto = {}) {
  const tieneCarrito = contexto.carritoId ? 'SÍ' : 'NO';
  const carritoId = contexto.carritoId || 'ninguno';
  const folio = contexto.folio || 'N/A';
  const ultimaBusqueda = (contexto.ultimaBusqueda && contexto.ultimaBusqueda.query) || 'ninguna';
  const productos = contexto.productos || [];
  const cantidadProductos = productos.length;
  const ultimaAccion = contexto.ultimaAccion || 'ninguna';
  const modoVendedor = contexto.modoVendedor ? 'true' : 'false';
  const clienteVendedor = contexto.clienteVendedor ? 'true' : 'false';

  // Formatear productos mostrados
  let productosStr = 'Ninguno';
  if (productos.length > 0) {
    productosStr = productos.map((p, i) => {
      const nombre = p.NOMBRE || p.DESCRIPCION || 'Sin nombre';
      const nombreCorto = nombre.length > 40 ? nombre.substring(0, 40) + '...' : nombre;
      return `  ${i + 1}) ID: ${p.ARTICULO_ID} - ${nombreCorto}`;
    }).join('\n');
  }

  return promptClasificador
    .replace('{{TIENE_CARRITO}}', tieneCarrito)
    .replace('{{CARRITO_ID}}', carritoId)
    .replace('{{FOLIO}}', folio)
    .replace('{{ULTIMA_BUSQUEDA}}', ultimaBusqueda)
    .replace('{{CANTIDAD_PRODUCTOS}}', cantidadProductos.toString())
    .replace('{{ULTIMA_ACCION}}', ultimaAccion)
    .replace('{{MODO_VENDEDOR}}', modoVendedor)
    .replace('{{CLIENTE_VENDEDOR}}', clienteVendedor)
    .replace('{{PRODUCTOS_MOSTRADOS}}', productosStr);
}

/**
 * Valida que la respuesta del clasificador tenga el formato correcto
 *
 * @param {object} respuesta - Respuesta parseada del clasificador
 * @returns {boolean} - true si es válida
 */
function validarRespuestaClasificador(respuesta) {
  const accionesValidas = [
    'SALUDO',
    'BUSQUEDA_PRODUCTO',
    'BUSQUEDA_CATEGORIA',
    'BUSQUEDA_CLIENTE',
    'CARRITO_CREAR',
    'CARRITO_MODIFICAR',
    'CARRITO_CONSULTAR',
    'CARRITO_CANCELAR',
    'ORDEN',
    'PAGINACION',
    'NECESIDAD',
    'CONSULTA_ATRIBUTO',
    'CONSULTA_SALDO',
    'CONSULTA_EXISTENCIA',
    'FILTRO_EXISTENCIA',
    'CONVERSACION',
    'REINICIAR',
    'DESCONOCIDO'
  ];

  if (!respuesta || typeof respuesta !== 'object') {
    return false;
  }

  if (!respuesta.accion || !accionesValidas.includes(respuesta.accion)) {
    return false;
  }

  if (typeof respuesta.confianza !== 'number' ||
      respuesta.confianza < 0 ||
      respuesta.confianza > 1) {
    return false;
  }

  return true;
}

/**
 * Lista de acciones válidas (exportada para uso en otros módulos)
 */
const ACCIONES_VALIDAS = [
  'SALUDO',
  'BUSQUEDA_PRODUCTO',
  'BUSQUEDA_CATEGORIA',
  'CARRITO_CREAR',
  'CARRITO_MODIFICAR',
  'CARRITO_CONSULTAR',
  'CARRITO_CANCELAR',
  'ORDEN',
  'PAGINACION',
  'NECESIDAD',
  'CONSULTA_ATRIBUTO',
  'CONSULTA_SALDO',
  'CONSULTA_EXISTENCIA',
  'FILTRO_EXISTENCIA',
  'BUSQUEDA_CLIENTE',
  'CONVERSACION',
  'REINICIAR',
  'DESCONOCIDO'
];

module.exports = {
  promptClasificador,
  buildClasificadorPrompt,
  validarRespuestaClasificador,
  ACCIONES_VALIDAS
};
