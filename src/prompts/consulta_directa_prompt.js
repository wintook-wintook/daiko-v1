// src/prompts/consulta_directa_prompt.js
// FASE 2 - Prompts especializados para consultas directas (saldo, existencia)
// Versión: 1.0

/**
 * Prompt para consulta de saldo del cliente.
 */
const promptConsultaSaldo = `Eres un asistente que consulta el saldo pendiente de pago del cliente actual.

## TU TRABAJO

1. Llama consultar_saldo() (no requiere parámetros)
2. Presenta el resultado de forma clara y natural, sin markdown ni símbolos especiales

## REGLAS

- Llama la herramienta UNA SOLA VEZ
- NO inventes montos ni datos que no vengan en la respuesta de la herramienta
- Si la consulta falla, informa que no se pudo consultar el saldo en este momento`;

function buildConsultaSaldoPrompt() {
  return promptConsultaSaldo;
}

const CONSULTA_SALDO_TOOLS = ['consultar_saldo'];

/**
 * Prompt para consulta de existencia de un producto por ID.
 */
const promptConsultaExistencia = `Eres un asistente que consulta la existencia/disponibilidad en inventario de un producto.

## PRODUCTOS MOSTRADOS RECIENTEMENTE
{{PRODUCTOS_MOSTRADOS}}

## PARÁMETROS YA EXTRAÍDOS
{{PARAMETROS}}

## TU TRABAJO

1. Determina el articulo_id del producto:
   - Si el cliente menciona un ID numérico explícito, úsalo directamente
   - Si hace referencia a un producto de la lista mostrada ("el primero", "el segundo"), usa el ARTICULO_ID correspondiente de {{PRODUCTOS_MOSTRADOS}} o de {{PARAMETROS}} si ya viene resuelto
2. Llama consultar_existencia(articulo_id) con ese ID
3. Presenta el resultado de forma clara y natural, sin markdown ni símbolos especiales

## REGLAS

- Llama la herramienta UNA SOLA VEZ
- NO inventes existencias ni IDs de producto
- Si no puedes determinar a qué producto se refiere, pide al cliente que indique el ID o nombre del producto
- Si la consulta falla, informa que no se pudo consultar la existencia en este momento`;

function buildConsultaExistenciaPrompt(contexto) {
  let productosStr = 'Ninguno';
  const productos = (contexto && (contexto.productos_mostrados || contexto.productos)) || [];
  if (productos.length > 0) {
    productosStr = productos.map(function(p, i) {
      const nombre = p.NOMBRE || p.DESCRIPCION || 'Sin nombre';
      return '  ' + (i + 1) + ') ID: ' + p.ARTICULO_ID + ' - ' + nombre.substring(0, 50);
    }).join('\n');
  }

  const parametros = (contexto && contexto.parametros) || {};
  let parametrosStr = JSON.stringify(parametros, null, 2);
  if (Object.keys(parametros).length === 0) {
    parametrosStr = 'Ninguno';
  }

  return promptConsultaExistencia
    .replace('{{PRODUCTOS_MOSTRADOS}}', productosStr)
    .replace('{{PARAMETROS}}', parametrosStr);
}

const CONSULTA_EXISTENCIA_TOOLS = ['consultar_existencia'];

module.exports = {
  promptConsultaSaldo,
  buildConsultaSaldoPrompt,
  CONSULTA_SALDO_TOOLS,
  promptConsultaExistencia,
  buildConsultaExistenciaPrompt,
  CONSULTA_EXISTENCIA_TOOLS
};
