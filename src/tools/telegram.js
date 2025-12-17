// daiko/src/tools/telegram.js

const axios = require('axios');
const { TELEGRAM_BOT_TOKEN, TELEGRAM_API_URL } = require('../config/telegram');
const {buscarcliente} = require('../utils/crm');

const carts = new Map(); // userId -> cart items
const orders = new Map(); // orderId -> order details
const conversations = new Map(); // userId -> conversation history

const { openai, openaiConfig, systemPrompt } = require('../config/openai_prompt');
const { functionDefinitions, executeFunctionCall } = require('../tools/openai_tools');

async function enviarMensajeTelegram(chatId, texto, opciones = {}) {
    try {
      const payload = {
        chat_id: chatId,
        text: texto,
        parse_mode: 'Markdown',
        ...opciones
      };
  
      const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, payload);
      
      return {
        success: true,
        data: response.data,
        message: "Mensaje enviado correctamente"
      };
    } catch (error) {
      console.error('❌ Error enviando mensaje a Telegram:', error.response?.data || error.message);
      return {
        success: false,
        message: `Error enviando mensaje: ${error.message}`
      };
    }
  }
  
  async function configurarWebhookTelegram(webhookUrl) {
    try {
      const response = await axios.post(`${TELEGRAM_API_URL}/setWebhook`, {
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query']
      });
  
      return {
        success: true,
        data: response.data,
        message: "Webhook configurado correctamente"
      };
    } catch (error) {
      console.error('❌ Error configurando webhook de Telegram:', error.response?.data || error.message);
      return {
        success: false,
        message: `Error configurando webhook: ${error.message}`
      };
    }
  }

  
function extraerDatosTelegram(update) {
    try {
      // Manejar diferentes tipos de updates
      let message, chatId, userId, username, firstName, lastName, messageText;
  
      if (update.message) {
        // Mensaje normal
        message = update.message;
        chatId = message.chat.id;
        userId = message.from.id;
        username = message.from.username || message.from.first_name;
        firstName = message.from.first_name;
        lastName = message.from.last_name;
        messageText = message.text;
      } else if (update.callback_query) {
        // Callback de botón inline
        message = update.callback_query.message;
        chatId = message.chat.id;
        userId = update.callback_query.from.id;
        username = update.callback_query.from.username || update.callback_query.from.first_name;
        firstName = update.callback_query.from.first_name;
        lastName = update.callback_query.from.last_name;
        messageText = update.callback_query.data;
      } else {
        throw new Error('Tipo de update no soportado');
      }
  
      return {
        success: true,
        data: {
          chatId,
          userId,
          username,
          firstName,
          lastName,
          messageText,
          updateType: update.message ? 'message' : 'callback_query',
          originalUpdate: update
        },
        message: "Datos extraídos correctamente"
      };
    } catch (error) {
      return {
        success: false,
        message: `Error extrayendo datos de Telegram: ${error.message}`
      };
    }
  }



async function procesarMensajeTelegram(update) {
    let extractedData ;
    try {
console.log({ln: 113});    
      // Extraer datos del update de Telegram
      extractedData = extraerDatosTelegram(update);
      
      if (!extractedData.success) {
        return extractedData;
      }
console.log({ln: 120});  
      const { chatId, userId, username, firstName, lastName, messageText, updateType } = extractedData.data;
      await buscarcliente(firstName+' '+lastName);
  
  //console.log({firstName, lastName, cliente});
  
      // Validar que hay contenido para procesar
      if (!messageText || messageText.trim() === '') {
        return {
          success: false,
          message: "Mensaje sin contenido de texto"
        };
      }
  
      // Usar chatId como identificador único para la conversación
      const conversationId = `telegram_${chatId}`;
      
      console.log(`📱 Telegram - ${username} (${userId}): ${messageText}`);
  
      // Manejar comandos especiales de Telegram
      if (messageText.startsWith('/')) {
        //return await manejarComandoTelegram(chatId, messageText, username);
      }
  
      // Obtener historial de conversación
      if (!conversations.has(conversationId)) {
        conversations.set(conversationId, []);
      }
      
      const conversationHistory = conversations.get(conversationId);
      
      // Agregar mensaje del usuario
      conversationHistory.push({
        role: "user",
        content: messageText
      });
  
      // Crear input para OpenAI
      const input = [
        { role: "system", content: systemPrompt },
        ...conversationHistory
      ];
  
      // Llamar a OpenAI
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: input,
        tools: functionDefinitions,
        tool_choice: "auto",
        temperature: 0.7
      });
  
      const assistantMessage = response.choices[0].message;
      let finalResponse = assistantMessage.content || "";
  
      // Procesar tool calls si existen
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        console.log(`🛠️ Procesando ${assistantMessage.tool_calls.length} function calls para Telegram`);
        
        // Agregar el mensaje del asistente con tool calls al historial
        conversationHistory.push(assistantMessage);
  
        // Ejecutar cada function call
        for (const toolCall of assistantMessage.tool_calls) {
          const { id, function: func } = toolCall;
          const { name, arguments: args } = func;
          
          try {
            const functionArgs = JSON.parse(args);
            const functionResult = await executeFunctionCall(name, functionArgs);
            
            // Agregar el resultado de la función al historial
            conversationHistory.push({
              role: "tool",
              tool_call_id: id,
              content: JSON.stringify(functionResult)
            });
  
          } catch (error) {
            console.error(`❌ Error ejecutando ${name} en Telegram:`, error);
            
            conversationHistory.push({
              role: "tool", 
              tool_call_id: id,
              content: JSON.stringify({
                success: false,
                message: `Error ejecutando la función: ${error.message}`
              })
            });
          }
        }
  
        // Obtener respuesta final del asistente
        const finalInput = [
          { role: "system", content: systemPrompt },
          ...conversationHistory
        ];
  
        const finalOpenAIResponse = await openai.chat.completions.create({
          model: "gpt-4",
          messages: finalInput,
          temperature: 0.7
        });
  
        finalResponse = finalOpenAIResponse.choices[0].message.content;
        
        // Agregar respuesta final al historial
        conversationHistory.push({
          role: "assistant",
          content: finalResponse
        });
      } else {
        // Si no hay tool calls, agregar directamente la respuesta
        conversationHistory.push({
          role: "assistant", 
          content: finalResponse
        });
      }
  
      // Mantener solo los últimos 20 mensajes
      if (conversationHistory.length > 20) {
        conversationHistory.splice(0, conversationHistory.length - 20);
      }
  
      console.log(`🤖 Alex respuesta Telegram: ${finalResponse}`);
  
      // Enviar respuesta a Telegram
      const envioResult = await enviarMensajeTelegram(chatId, finalResponse);
      
      if (!envioResult.success) {
        console.error('❌ Error enviando respuesta a Telegram:', envioResult.message);
      }
console.log({ln: 252});   
      return {
        success: true,
        data: {
          chatId,
          userId,
          username,
          response: finalResponse,
          conversationId,
          originalMessage: messageText,
          sent: envioResult.success
        },
        message: "Mensaje procesado y enviado correctamente"
      };
 
    } catch (error) {
      console.error('❌ Error procesando mensaje de Telegram:', error);
      
      // Intentar enviar mensaje de error al usuario
      if (extractedData?.success && extractedData.data.chatId) {
        await enviarMensajeTelegram(
          extractedData.data.chatId, 
          "❌ Disculpa, tuve un problema técnico. Por favor intenta de nuevo."
        );
      }
console.log({ln: 277});
      return {
        success: false,
        error: "Error procesando mensaje de Telegram",
        details: error.message
      };
    }
}


async function obtenerInfoBot() {
    try {
      const response = await axios.get(`${TELEGRAM_API_URL}/getMe`);
      return {
        success: true,
        data: response.data.result,
        message: "Información del bot obtenida"
      };
    } catch (error) {
      console.error('❌ Error obteniendo info del bot:', error.response?.data || error.message);
      return {
        success: false,
        message: `Error obteniendo info: ${error.message}`
      };
    }
  }


  async function manejarComandoTelegram(chatId, comando, username) {
    let respuesta = "";
  
    switch (comando.toLowerCase()) {
      case '/start':
        respuesta = `¡Hola ${username}! 👋\n\n` +
                   `Soy *ALEX*, tu asistente de ventas personal. Estoy aquí para ayudarte a encontrar los mejores productos.\n\n` +
                   `Puedes preguntarme sobre:\n` +
                   `🔍 Búsqueda de productos\n` +
                   `📦 Categorías disponibles\n` +
                   `🛒 Gestión de carrito\n` +
                   `📋 Estado de pedidos\n\n` +
                   `¿En qué puedo ayudarte hoy?`;
        break;
  
      case '/help':
        respuesta = `*Comandos disponibles:* 📚\n\n` +
                   `/start - Iniciar conversación\n` +
                   `/help - Ver esta ayuda\n` +
                   `/carrito - Ver mi carrito actual\n` +
                   `/categorias - Ver categorías de productos\n` +
                   `/limpiar - Limpiar historial de conversación\n\n` +
                   `También puedes escribirme directamente lo que buscas, por ejemplo:\n` +
                   `• "Busco una laptop para trabajo"\n` +
                   `• "Muéstrame productos de electrónicos"\n` +
                   `• "¿Cuánto cuesta el producto X?"`;
        break;
  
      case '/carrito':
        // Obtener carritos disponibles y mostrar el contenido
        try {
          const carritosResult = await obtenerCarritosDisponibles();
          if (carritosResult.success && carritosResult.data.CARRITOS_ID && carritosResult.data.CARRITOS_ID.length > 0) {
            const primerCarrito = carritosResult.data.CARRITOS_ID[0];
            const carritoResult = await verCarrito(primerCarrito);
            
            if (carritoResult.success && carritoResult.data.Carrito && carritoResult.data.Carrito.length > 0) {
              respuesta = `🛒 *Tu carrito actual:*\n\n`;
              carritoResult.data.Carrito.forEach((item, index) => {
                respuesta += `${index + 1}. *${item.NOMBRE}*\n`;
                respuesta += `   Cantidad: ${item.UNIDADES}\n`;
                respuesta += `   Precio: $${item.PRECIO_VENTA}\n\n`;
              });
              respuesta += `💰 *Total: $${carritoResult.data.TOTAL}*`;
            } else {
              respuesta = "🛒 Tu carrito está vacío.\n\n¿Te ayudo a encontrar algunos productos?";
            }
          } else {
            respuesta = "🛒 No tienes carritos activos.\n\n¿Te ayudo a encontrar algunos productos para empezar?";
          }
        } catch (error) {
          respuesta = "❌ Error consultando el carrito. Intenta de nuevo.";
        }
        break;
  
      case '/categorias':
        try {
          const categoriasResult = await obtenerCategorias();
          if (categoriasResult.success && categoriasResult.data.length > 0) {
            respuesta = `📂 *Categorías disponibles:*\n\n`;
            categoriasResult.data.forEach((categoria, index) => {
              respuesta += `${index + 1}. ${categoria.NOMBRE}\n`;
            });
            respuesta += `\n¿Qué categoría te interesa?`;
          } else {
            respuesta = "❌ Error obteniendo categorías. Intenta de nuevo.";
          }
        } catch (error) {
          respuesta = "❌ Error consultando categorías. Intenta de nuevo.";
        }
        break;
  
      case '/limpiar':
        const conversationId = `telegram_${chatId}`;
        conversations.delete(conversationId);
        respuesta = "🧹 Historial de conversación limpiado.\n\n¡Empecemos de nuevo! ¿En qué puedo ayudarte?";
        break;
  
      default:
        respuesta = `❓ Comando no reconocido: ${comando}\n\nUsa /help para ver los comandos disponibles.`;
    }
  
    await enviarMensajeTelegram(chatId, respuesta);
    
    return {
      success: true,
      data: { chatId, comando, respuesta },
      message: "Comando procesado correctamente"
    };
  }

  module.exports = {
    enviarMensajeTelegram, 
    configurarWebhookTelegram,
    extraerDatosTelegram,
    procesarMensajeTelegram,
    obtenerInfoBot,
    manejarComandoTelegram
  };
