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
| BUSQUEDA_PRODUCTO | Busca un producto específico (menciona sustantivo concreto) | "quiero azúcar", "tienes monitores", "busco tubería", "necesito cable", "necesito agua", "requiero leche" |
| BUSQUEDA_CATEGORIA | Explora catálogo sin producto específico | "qué vendes", "muéstrame categorías", "tu catálogo", "qué productos tienes" |
| CARRITO_CREAR | Agregar productos cuando NO tiene carrito activo | "agrégalo", "ponme 2", "lo quiero", "dame ese" |
| CARRITO_MODIFICAR | Modificar carrito existente (agregar, quitar, actualizar) | "quítame el segundo", "ponme 5 del primero", "elimina el producto", "agrega 3 más" |
| CARRITO_CONSULTAR | Ver o gestionar carritos | "ver mi carrito", "mis carritos", "qué tengo en el carrito", "muéstrame mi pedido", "muéstrame el contenido", "ver el contenido", "qué tiene mi carrito" |
| CARRITO_CANCELAR | Cancelar o vaciar carrito | "cancela el carrito", "vacía mi carrito", "borra todo" |
| ORDEN | Finalizar compra o generar documentos | "confirmar compra", "generar PDF", "cotización", "factura", "finalizar pedido" |
| PAGINACION | Ver más resultados de búsqueda anterior | "hay más", "ver más", "siguiente", "otros", "más opciones" |
| NECESIDAD | Expresa problema/condición SIN mencionar ningún producto concreto | "tengo sed", "me duele la cabeza", "tengo hambre", "hace calor" |
| CONVERSACION | Preguntas generales, charla, dudas sobre el bot | "cómo funciona", "qué puedes hacer", "ayuda", "eres un robot" |
| REINICIAR | Reiniciar o borrar la conversación | "reiniciar", "reiniciate", "reinicia", "borrar conversación", "empezar de nuevo", "reset" |
| DESCONOCIDO | No se puede clasificar claramente | mensajes ambiguos, fuera de contexto, o sin sentido |

## CONTEXTO ACTUAL DEL USUARIO

- Tiene carrito activo: {{TIENE_CARRITO}}
- ID del carrito: {{CARRITO_ID}}
- Folio del carrito: {{FOLIO}}
- Última búsqueda realizada: {{ULTIMA_BUSQUEDA}}
- Cantidad de productos mostrados: {{CANTIDAD_PRODUCTOS}}
- Última acción ejecutada: {{ULTIMA_ACCION}}
- Productos mostrados recientemente:
{{PRODUCTOS_MOSTRADOS}}

## INSTRUCCIONES DE CLASIFICACIÓN

1. Lee cuidadosamente el mensaje del usuario
2. Considera el contexto actual (carrito, productos mostrados, etc.)
3. Clasifica en UNA SOLA acción de la tabla
4. Extrae parámetros relevantes del mensaje
5. Asigna un nivel de confianza (0.0 a 1.0)

## REGLAS ESPECIALES

### Para distinguir BUSQUEDA_PRODUCTO vs NECESIDAD:
- Si el mensaje menciona un producto o sustantivo concreto → SIEMPRE es BUSQUEDA_PRODUCTO, sin importar el verbo usado
  Ejemplos: "necesito agua" → BUSQUEDA_PRODUCTO (menciona "agua")
  "requiero azúcar" → BUSQUEDA_PRODUCTO (menciona "azúcar")
  "necesito cable hdmi" → BUSQUEDA_PRODUCTO (menciona "cable hdmi")
  "quiero leche" → BUSQUEDA_PRODUCTO (menciona "leche")
- NECESIDAD es SOLO cuando NO hay producto/sustantivo concreto, solo una condición o estado
  Ejemplos: "tengo sed" → NECESIDAD (no menciona producto, solo estado)
  "me duele la cabeza" → NECESIDAD (condición sin producto)
  "tengo hambre" → NECESIDAD (estado sin producto)

### Para distinguir BUSQUEDA vs CARRITO:
- Si el usuario menciona un producto con nombre (sustantivo) y NO hay productos mostrados recientemente → BUSQUEDA_PRODUCTO
  Ejemplos: "quiero azúcar", "quiero arroz de 1 kilo", "necesito cable hdmi" → BUSQUEDA_PRODUCTO
- Si dice "agrégalo/ponme/dame ese" refiriéndose a un producto YA MOSTRADO → CARRITO_CREAR o CARRITO_MODIFICAR
- REGLA CRITICA: Si el usuario menciona un producto por NOMBRE (sustantivo concreto) y ese nombre NO coincide con ninguno de los PRODUCTOS_MOSTRADOS → SIEMPRE es BUSQUEDA_PRODUCTO, aunque el mensaje tambien contenga "del primero/segundo/etc"
  Ejemplo: Productos mostrados son escobas, usuario dice "agregame frijol del primero" → BUSQUEDA_PRODUCTO (frijol NO es escoba)
  Ejemplo: Productos mostrados son escobas, usuario dice "agregame la primera" → CARRITO_MODIFICAR (no menciona otro producto)

### Para operaciones de carrito (REGLA CRITICA):
- PRIMERO verificar si {{TIENE_CARRITO}} = SI
- Si {{TIENE_CARRITO}} = SI y el usuario quiere agregar producto → SIEMPRE es CARRITO_MODIFICAR (sub_accion: agregar)
- Si {{TIENE_CARRITO}} = NO y el usuario quiere agregar producto → CARRITO_CREAR
- NUNCA clasificar como CARRITO_CREAR si ya tiene carrito activo
- Si dice "quítame/elimina/borra" un producto → CARRITO_MODIFICAR (sub_accion: eliminar)
- IMPORTANTE: Solo clasificar como CARRITO si hay productos mostrados Y el usuario hace referencia a ellos

### Para referencias según contexto (ULTIMA_ACCION):
- Si {{ULTIMA_ACCION}} = "listar_carritos" y el usuario dice "el primero", "el segundo", "muéstrame el segundo", etc. → CARRITO_CONSULTAR (sub_accion: ver_carrito). El usuario se refiere a un CARRITO de la lista, NO a un producto.
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

### Para paginación:
- Solo clasificar como PAGINACION si hay una búsqueda activa previa
- "hay más", "ver más", "siguiente", "otros" → PAGINACION

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
Respuesta: {"accion":"NECESIDAD","sub_accion":"detectar_necesidad","confianza":0.90,"parametros":{"necesidad":"sed"},"razon":"Expresa una necesidad sin mencionar producto"}`;

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
    'CARRITO_CREAR',
    'CARRITO_MODIFICAR',
    'CARRITO_CONSULTAR',
    'CARRITO_CANCELAR',
    'ORDEN',
    'PAGINACION',
    'NECESIDAD',
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
