// daiko/src/utils/busqueda_externa_service.js

const OpenAI = require('openai');
require('dotenv').config();

/**
 * Servicio de Búsqueda Externa
 * Utiliza OpenAI para buscar información adicional sobre productos
 * que no está disponible en el catálogo interno
 */

class BusquedaExternaService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_APIKEY
    });
  }

  /**
   * Busca información externa sobre productos
   * @param {string} query - Consulta de búsqueda
   * @param {number|null} producto_id - ID del producto (opcional)
   * @param {string} tipo_informacion - Tipo de información: especificaciones, reviews, comparativa, compatibilidad, usos
   * @returns {Promise<Object>} Información encontrada
   */
  async buscarInformacion(query, producto_id = null, tipo_informacion = 'especificaciones') {
    try {
      console.log(`🔍 Iniciando búsqueda externa: "${query}" | Tipo: ${tipo_informacion}`);

      // Construir el prompt según el tipo de información solicitada
      const systemPrompt = this._construirSystemPrompt(tipo_informacion);
      const userPrompt = this._construirUserPrompt(query, producto_id, tipo_informacion);

      // Ejecutar consulta a OpenAI
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      const resultado = response.choices[0].message.content;

      console.log(`✅ Búsqueda externa completada: ${resultado.substring(0, 100)}...`);

      return {
        success: true,
        tipo_informacion: tipo_informacion,
        query: query,
        producto_id: producto_id,
        resultado: resultado,
        fuente: "OpenAI GPT-4o (Información basada en conocimiento general)",
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Error en búsqueda externa:', error);
      return {
        success: false,
        error: error.message,
        query: query,
        tipo_informacion: tipo_informacion
      };
    }
  }

  /**
   * Construye el system prompt según el tipo de información
   */
  _construirSystemPrompt(tipo_informacion) {
    const prompts = {
      especificaciones: `Eres un experto en especificaciones técnicas de productos. 
Proporciona información detallada, precisa y estructurada sobre características técnicas, 
componentes, dimensiones, capacidades y especificaciones de productos electrónicos, 
electrodomésticos y tecnología en general.

REGLAS:
- Sé específico y técnico
- Si no tienes datos exactos, indícalo claramente
- Estructura la información en puntos claros
- Incluye datos cuantitativos cuando sea posible
- Menciona limitaciones o consideraciones importantes`,

      reviews: `Eres un analista de productos que resume opiniones y reviews de usuarios.
Proporciona un análisis equilibrado sobre la reputación, calificaciones y experiencias 
comunes de los usuarios con productos específicos.

REGLAS:
- Presenta puntos positivos y negativos
- Si es posible, menciona calificación aproximada
- Destaca características más mencionadas por usuarios
- Sé objetivo y equilibrado
- Indica si la información es general del tipo de producto o específica del modelo`,

      comparativa: `Eres un experto en comparación de productos.
Proporciona análisis comparativos claros entre productos similares, destacando 
diferencias clave, ventajas y desventajas de cada opción.

REGLAS:
- Compara características similares lado a lado
- Destaca diferencias significativas
- Indica cuál es mejor para qué tipo de usuario
- Sé neutral y objetivo
- Estructura la comparación de forma clara`,

      compatibilidad: `Eres un especialista en compatibilidad de productos y tecnología.
Proporciona información sobre compatibilidad entre dispositivos, sistemas operativos,
accesorios y productos complementarios.

REGLAS:
- Sé específico sobre versiones y modelos compatibles
- Menciona requisitos o limitaciones
- Indica si hay configuraciones especiales necesarias
- Proporciona información sobre alternativas si no es compatible
- Si no estás seguro, indícalo claramente`,

      usos: `Eres un consultor que ayuda a entender aplicaciones y casos de uso de productos.
Proporciona información sobre para qué sirve un producto, en qué escenarios es útil,
y qué tareas puede realizar.

REGLAS:
- Describe casos de uso prácticos
- Menciona para qué tipo de usuario es ideal
- Indica limitaciones o escenarios donde NO es recomendable
- Sugiere complementos o accesorios útiles
- Sé práctico y orientado a resultados`
    };

    return prompts[tipo_informacion] || prompts.especificaciones;
  }

  /**
   * Construye el user prompt
   */
  _construirUserPrompt(query, producto_id, tipo_informacion) {
    let prompt = `Necesito información sobre: "${query}"\n\n`;

    if (producto_id) {
      prompt += `(Esta información es para complementar el producto ID: ${producto_id} de nuestro catálogo)\n\n`;
    }

    prompt += `Tipo de información requerida: ${tipo_informacion}\n\n`;
    prompt += `Por favor proporciona información ${tipo_informacion === 'especificaciones' ? 'técnica detallada' : 
                tipo_informacion === 'reviews' ? 'sobre opiniones y experiencias de usuarios' :
                tipo_informacion === 'comparativa' ? 'comparativa entre las opciones mencionadas' :
                tipo_informacion === 'compatibilidad' ? 'sobre compatibilidad' :
                'sobre usos y aplicaciones'}.`;

    return prompt;
  }

  /**
   * Método auxiliar para formatear la respuesta para el asistente
   */
  formatearParaAsistente(resultadoBusqueda) {
    if (!resultadoBusqueda.success) {
      return `Lo siento, no pude obtener información externa en este momento. Error: ${resultadoBusqueda.error}`;
    }

    return `
📊 Información adicional (${resultadoBusqueda.tipo_informacion}):

${resultadoBusqueda.resultado}

💡 Nota: Esta información complementaria proviene de fuentes externas generales y debe ser verificada con el fabricante para confirmación exacta.
    `.trim();
  }
}

// Función principal para usar en el manejador de tool calls
async function ejecutarBusquedaExterna(query, producto_id = null, tipo_informacion = 'especificaciones') {
  const servicio = new BusquedaExternaService();
  const resultado = await servicio.buscarInformacion(query, producto_id, tipo_informacion);
  return servicio.formatearParaAsistente(resultado);
}

module.exports = {
  BusquedaExternaService,
  ejecutarBusquedaExterna
};