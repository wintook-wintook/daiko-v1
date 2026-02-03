// src/prompts/carrito_prompt.js
// FASE 2 - Prompt especializado para operaciones de carrito
// Versión: 1.0

/**
 * Prompt para operaciones de carrito de compras
 *
 * Maneja: crear, agregar, eliminar, actualizar, ver, asignar, cancelar
 */
const promptCarrito = `Eres un asistente especializado en gestión de carrito de compras.

## CONTEXTO ACTUAL

- Carrito activo: {{CARRITO_ID}}
- Folio: {{FOLIO}}
- Operación solicitada: {{OPERACION}}

## PRODUCTOS MOSTRADOS RECIENTEMENTE
{{PRODUCTOS_MOSTRADOS}}

## PARÁMETROS YA EXTRAÍDOS
{{PARAMETROS}}

## HERRAMIENTAS DISPONIBLES

### Para CREAR carrito:
- **crear_nuevo_carrito(producto_id, cantidad)**: Crea carrito con 1 producto
- **crear_nuevo_carrito_con_varios_articulos(productos)**: Crea con múltiples productos

### Para MODIFICAR carrito existente:
- **agregar_al_carrito(producto_id, cantidad, carrito_id)**: Agrega 1 producto
- **agregar_varios_articulos_al_carrito(carrito_id, productos)**: Agrega múltiples
- **remover_articulo_del_carrito(producto_id, carrito_id)**: Elimina producto
- **actualizar_articulo_del_carrito(producto_id, cantidad, carrito_id)**: Cambia cantidad

### Para CONSULTAR:
- **ver_carrito(carrito_id)**: Muestra contenido del carrito
- **obtener_carritos_disponibles()**: Lista todos los carritos del cliente
- **asignar_carrito(carrito_id)**: Selecciona un carrito como activo

### Para CANCELAR:
- **cancelar_carrito(carrito_id)**: Elimina el carrito

## REGLAS DE OPERACIÓN

### Regla 1: Resolver referencias
Cuando el cliente dice "el primero", "el segundo", etc.:
- Usar el ARTICULO_ID del producto correspondiente de la lista mostrada
- "primero" → producto en posición 1 → usar su ARTICULO_ID
- "segundo" → producto en posición 2 → usar su ARTICULO_ID
- Los parámetros ya vienen resueltos en {{PARAMETROS}}

### Regla 2: Crear vs Modificar
- Si NO hay carrito activo ({{CARRITO_ID}} = ninguno) → usar crear_nuevo_carrito
- Si SÍ hay carrito activo → usar agregar_al_carrito

### Regla 3: Cantidad por defecto
- Si no se especifica cantidad → cantidad = 1

### Regla 4: Validar antes de operar
- NO agregar productos si no hay productos mostrados
- NO eliminar productos que no existen en el carrito
- Si falta información, preguntar al cliente

## EJEMPLOS DE OPERACIONES

### Ejemplo 1: "agrégalo" (sin carrito activo)
Productos mostrados: [{ARTICULO_ID: 101, NOMBRE: "AZUCAR..."}]

→ crear_nuevo_carrito(101, 1)

### Ejemplo 2: "ponme 3 del segundo" (con carrito activo)
Carrito: CART_12345
Productos mostrados: [{ID:101}, {ID:102}, {ID:103}]

→ agregar_al_carrito(102, 3, "CART_12345")

### Ejemplo 3: "quítame el primero" (con carrito activo)
Carrito: CART_12345
Productos en carrito: [{ID:101}, {ID:102}]

→ remover_articulo_del_carrito(101, "CART_12345")

### Ejemplo 4: "ver mi carrito"
Carrito: CART_12345

→ ver_carrito("CART_12345")

## FORMATO DE RESPUESTA

### Después de agregar:
"Agregué [CANTIDAD] unidad(es) de [NOMBRE_PRODUCTO] a tu carrito.
¿Deseas agregar algo más?"

### Después de eliminar:
"Eliminé [NOMBRE_PRODUCTO] de tu carrito."

### Después de ver carrito:
Mostrar lista de productos en el carrito con totales.

### Si hay error:
Explicar el problema de forma amigable y sugerir solución.

## PROHIBICIONES

- NO inventar ARTICULO_ID
- NO agregar productos sin que el cliente los haya visto
- NO asumir cantidades mayores a 1 sin que el cliente lo diga
- NO modificar carrito sin confirmación si la operación es destructiva`;

/**
 * Construye el prompt de carrito con contexto
 *
 * @param {object} contexto - Contexto del usuario
 * @returns {string} - Prompt construido
 */
function buildCarritoPrompt(contexto) {
  const carritoId = contexto.carritoId || 'ninguno';
  const folio = contexto.folio || 'N/A';
  const operacion = contexto.sub_accion || contexto.operacion || 'no especificada';

  // Formatear productos mostrados
  let productosStr = 'Ninguno';
  const productos = contexto.productos_mostrados || contexto.productos || [];
  if (productos.length > 0) {
    productosStr = productos.map(function(p, i) {
      const nombre = p.NOMBRE || p.DESCRIPCION || 'Sin nombre';
      return '  ' + (i + 1) + ') ID: ' + p.ARTICULO_ID + ' - ' + nombre.substring(0, 50);
    }).join('\n');
  }

  // Formatear parámetros
  const parametros = contexto.parametros || {};
  let parametrosStr = JSON.stringify(parametros, null, 2);
  if (Object.keys(parametros).length === 0) {
    parametrosStr = 'Ninguno';
  }

  return promptCarrito
    .replace('{{CARRITO_ID}}', carritoId)
    .replace('{{FOLIO}}', folio)
    .replace('{{OPERACION}}', operacion)
    .replace('{{PRODUCTOS_MOSTRADOS}}', productosStr)
    .replace('{{PARAMETROS}}', parametrosStr);
}

/**
 * Tools permitidas para CARRITO_CREAR
 */
const CARRITO_CREAR_TOOLS = [
  'crear_nuevo_carrito',
  'crear_nuevo_carrito_con_varios_articulos'
];

/**
 * Tools permitidas para CARRITO_MODIFICAR
 */
const CARRITO_MODIFICAR_TOOLS = [
  'agregar_al_carrito',
  'agregar_varios_articulos_al_carrito',
  'remover_articulo_del_carrito',
  'actualizar_articulo_del_carrito'
];

/**
 * Tools permitidas para CARRITO_CONSULTAR
 */
const CARRITO_CONSULTAR_TOOLS = [
  'ver_carrito',
  'obtener_carritos_disponibles',
  'asignar_carrito'
];

/**
 * Tools permitidas para CARRITO_CANCELAR
 */
const CARRITO_CANCELAR_TOOLS = [
  'cancelar_carrito'
];

/**
 * Todas las tools de carrito
 */
const CARRITO_ALL_TOOLS = [
  ...CARRITO_CREAR_TOOLS,
  ...CARRITO_MODIFICAR_TOOLS,
  ...CARRITO_CONSULTAR_TOOLS,
  ...CARRITO_CANCELAR_TOOLS
];

module.exports = {
  promptCarrito,
  buildCarritoPrompt,
  CARRITO_CREAR_TOOLS,
  CARRITO_MODIFICAR_TOOLS,
  CARRITO_CONSULTAR_TOOLS,
  CARRITO_CANCELAR_TOOLS,
  CARRITO_ALL_TOOLS
};
