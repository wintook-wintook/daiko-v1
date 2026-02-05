// daiko/src/tools/chatwoot.js
// DAIKO V25.0 - Arquitectura Multi-Prompt con Router

const OpenAI = require('openai');
require('dotenv').config();

let openai ;

const FormData  = require('form-data');

const carts = new Map(); // userId -> cart items
const orders = new Map(); // orderId -> order details
const conversations = new Map(); // userId -> conversation history

const { openaiConfig, systemPrompt } = require('../config/openai_prompt');
const { functionDefinitions, executeFunctionCall } = require('../tools/openai_tools');
const {buscarcliente, buscarcliente2} = require('../utils/crm');
const { getApiData } = require('../utils/functions');
let urlWA = process.env.CHATWOOT_URL; // 'https://app.chatzeus.com/';

const UserContext = require('../utils/userContext');

// ============================================================
// V25.0 - FASE 3: Servicios de Clasificación y Router
// ============================================================
const {
  clasificarIntencion,
  confianzaSuficiente,
  requiereFallbackPromptCompleto
} = require('../services/clasificador_service');

const {
  enrutarSolicitud,
  filtrarTools
} = require('../services/router_service');

const {
  resolverParametrosClasificador
} = require('../services/referencia_service');

// Feature toggle para activación gradual
const USAR_MULTI_PROMPT = process.env.USAR_MULTI_PROMPT === 'true' || false;

var Readable    = require('stream').Readable;
const { Buffer } = require('buffer');

let fuenteWeb ="Fuente: WEB";

function extraerDatosWebhook(webhookData) {
    try {
      // Extraer información del webhook de Chatwoot
      const conversationId = webhookData.conversation?.id;
      const messageContent = webhookData.content;
      const senderId = webhookData.sender?.id;
      const senderName = webhookData.sender?.name;
      const messageType = webhookData.message_type;
      const inboxId = webhookData.inbox?.id;
      const inboxName = webhookData.inbox?.name;
      
      return {
        success: true,
        data: {
          conversationId,
          messageContent,
          senderId,
          senderName,
          messageType,
          inboxId,
          inboxName
        },
        message: "Datos extraídos correctamente del webhook"
      };
    } catch (error) {
      return {
        success: false,
        message: `Error al extraer datos del webhook: ${error.message}`
      };
    }
  }
  
// ============================================================
// HANDLER CORREGIDO - procesarMensajeWebhook()
// Tool-Calling Loop Real - DAIKO V23.3.0
// ============================================================

async function procesarMensajeWebhook(webhookData) {
  try {
    let sender = webhookData.conversation.meta.sender;
    let OPENAI_APIKEY = await getOPENAI_APIKEY(webhookData.token, webhookData.account_id);

    const extractedData = extraerDatosWebhook(webhookData);
    if (!extractedData.success) {
      return extractedData;
    }
    
    // Inicializar OpenAI
    openai = new OpenAI({
      apiKey: OPENAI_APIKEY[0].settings.api_key
    });

    const { conversationId, messageContent, senderId, senderName, messageType, inboxId } = extractedData.data;
    let url_crm_zeus = ''; 
    let api_access_token = '';
    let almacen_id = '';
    let contact_id = '';

    let hooks = await getHooksCrm(webhookData.token, webhookData.account_id);
    const item = await (hooks.length >= 1 ? hooks.find((element) => element.inbox.id === inboxId) : []);
    
    if (!inboxId || !item) {
      return {
        success: false,
        message: "Mensaje no procesable - no hay hooks que concuerden con el inbox_id"
      };
    }

    url_crm_zeus = item.settings.api_url_base+'/';
    api_access_token = item.settings.api_access_token;
    contact_id = item.settings.contact_id;
    almacen_id = item.settings.almacen_id;

    if (messageType !== 'incoming' || !messageContent) {
      return {
        success: false,
        message: "Mensaje no procesable - solo se procesan mensajes entrantes con contenido"
      };
    }
    
    // Preparar contexto
    const userId = `chatwoot_${conversationId}`;
    const userContext = new UserContext(userId);
    const contextStr = await userContext.toSystemContext();

    let Cliente = await buscarcliente2(url_crm_zeus, api_access_token, {
        email: sender.email, 
        phone_number: sender.phone_number, 
        contact_id: contact_id, 
        almacen_id: almacen_id,
        userContext
      });  

    if (Cliente.data.NOMBRE_COMERCIAL) {
      await userContext.setNombre(Cliente.data.NOMBRE_COMERCIAL);
    }

    const systemPromptWithContext = systemPrompt;
    
    if (!conversations.has(userId)) {
      conversations.set(userId, []);
    }
    
    const conversationHistory = await getMessages(webhookData.token, webhookData.account_id, webhookData.conversation_id, contextStr);

    // ============================================================
    // V25.0 - FASE 1: CLASIFICACIÓN DE INTENCIÓN
    // ============================================================

    let promptAUsar = systemPromptWithContext;
    let toolsAUsar = functionDefinitions;
    let clasificacion = null;
    let usarFallback = true;

    if (USAR_MULTI_PROMPT) {
      console.log('\n' + '='.repeat(60));
      console.log('🎯 V25.0 - SISTEMA MULTI-PROMPT ACTIVO');
      console.log('='.repeat(60));

      try {
        // Preparar contexto para el clasificador
        const contextoClasificador = {
          carritoId: await userContext.getCarrito(),
          folio: await userContext.getFolio ? await userContext.getFolio() : null,
          ultimaBusqueda: await userContext.getBusquedaActiva(),
          productos: await userContext.getUltimosResultados ? await userContext.getUltimosResultados() : [],
          ultimaAccion: await userContext.getUltimaAccion ? await userContext.getUltimaAccion() : null,
          historial: conversationHistory.slice(-4) // Últimos 4 mensajes
        };

        // PASO 1: Clasificar intención con gpt-4o-mini
        clasificacion = await clasificarIntencion(
          messageContent,
          contextoClasificador,
          OPENAI_APIKEY[0].settings.api_key
        );

        console.log('📊 Clasificación:', {
          accion: clasificacion.accion,
          sub_accion: clasificacion.sub_accion,
          confianza: clasificacion.confianza,
          parametros: clasificacion.parametros
        });

        // PASO 1.5: Resolver referencias ("el primero", "el segundo")
        if (clasificacion.parametros && contextoClasificador.ultimaBusqueda) {
          const ultimosResultados = await userContext.getUltimosResultados
            ? await userContext.getUltimosResultados()
            : [];

          if (ultimosResultados && ultimosResultados.length > 0) {
            clasificacion.parametros = resolverParametrosClasificador(
              clasificacion.parametros,
              ultimosResultados
            );
            console.log('🔗 Referencias resueltas:', clasificacion.parametros);
          }
        }

        // PASO 2: Enrutar a prompt y tools especializados
        const ruteo = enrutarSolicitud(clasificacion, {
          ...contextoClasificador,
          nombre: await userContext.getNombre()
        });

        if (!ruteo.usarFallback && ruteo.prompt) {
          promptAUsar = ruteo.prompt;
          toolsAUsar = filtrarTools(ruteo.tools, functionDefinitions);
          usarFallback = false;

          console.log('✅ Usando prompt especializado:', ruteo.config.descripcion);
          console.log('🛠️ Tools filtradas:', ruteo.tools ? ruteo.tools.length : 'todas');
        } else {
          console.log('⚠️ Usando fallback (prompt completo)');
        }

      } catch (clasificacionError) {
        console.error('❌ Error en clasificación:', clasificacionError.message);
        console.log('⚠️ Fallback: usando prompt completo');
        // En caso de error, usar el flujo original
        promptAUsar = systemPromptWithContext;
        toolsAUsar = functionDefinitions;
      }
    } else {
      console.log('ℹ️ Multi-prompt desactivado (USAR_MULTI_PROMPT=false)');
    }

    // ============================================================
    // TOOL-CALLING LOOP - IMPLEMENTACIÓN CORRECTA
    // ============================================================

    const MAX_ITERATIONS = 10; // Límite de seguridad
    let iteration = 0;
    let continueLoop = true;
    let isGetPDF = false;

    while (continueLoop && iteration < MAX_ITERATIONS) {
      iteration++;
      console.log(`\n🔄 Tool-calling loop - Iteración ${iteration}/${MAX_ITERATIONS}`);

      // Preparar input con historial actualizado
      // V25.0: Usar prompt especializado si está disponible
      const input = [
        { role: "system", content: promptAUsar },
        ...conversationHistory
      ];

      // ✅ LLAMAR AL MODELO CON TOOLS EN CADA ITERACIÓN
      // V25.0: Usar tools filtradas si están disponibles
      const response = await openai.chat.completions.create({
        model: "gpt-4o",  // ✅ MISMO MODELO EN TODAS LAS RONDAS
        messages: input,
        tools: toolsAUsar,  // V25.0: Tools filtradas o todas
        tool_choice: "auto",
        temperature: 0.3
      });

      const assistantMessage = response.choices[0].message;
      
      // ============================================================
      // VERIFICAR SI HAY TOOL CALLS
      // ============================================================
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        console.log(`🛠️ Procesando ${assistantMessage.tool_calls.length} tool calls en iteración ${iteration}`);
        
        // Agregar mensaje del asistente al historial
        conversationHistory.push(assistantMessage);

        // ============================================================
        // EJECUTAR CADA TOOL CALL
        // ============================================================
        for (const toolCall of assistantMessage.tool_calls) {
          const { id, function: func } = toolCall;
          const { name, arguments: args } = func;
          
          console.log(`  📌 Ejecutando tool: ${name}`);
          
          try {
            const functionArgs = JSON.parse(args);
            
            // ✅ EJECUTAR TOOL con account_id desde webhookData
            const functionResult = await executeFunctionCall(
              name, 
              functionArgs, 
              userId, 
              webhookData.account_id
            );
            
            // Manejo especial para generar_pdf
            if (name === 'generar_pdf' && !functionResult.error) {
              isGetPDF = true;
            }

            // ✅ AGREGAR RESULTADO AL HISTORIAL
            conversationHistory.push({
              role: "tool",
              tool_call_id: id,
              content: JSON.stringify(functionResult)
            });
            
            console.log(`  ✅ Tool ${name} ejecutada exitosamente`);

          } catch (error) {
            console.error(`  ❌ Error ejecutando ${name}:`, error);
            
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
        
        // ✅ CONTINUAR LOOP - El modelo puede pedir más tools
        continueLoop = true;
        
      } else {
        // ============================================================
        // NO HAY MÁS TOOL CALLS - GENERAR RESPUESTA FINAL
        // ============================================================
        console.log(`✅ No hay más tool calls. Generando respuesta final.`);
        
        let finalResponse = assistantMessage.content || "";

        // Agregar info del carrito activo al final de la respuesta (si no está ya incluida)
        // No agregar si es respuesta de reinicio
        const esReinicio = finalResponse.includes('conversación nueva') || finalResponse.includes('conversacion nueva');
        if (!esReinicio) {
          const carritoActivo = await userContext.getCarrito();
          if (carritoActivo && !finalResponse.includes('Carrito activo:')) {
            const folioActivo = await userContext.getFolio();
            finalResponse += '\n\nCarrito activo: ' + carritoActivo + (folioActivo ? ' | Folio: ' + folioActivo : '');
          }
        }

        // Agregar respuesta final al historial
        conversationHistory.push({
          role: "assistant",
          content: finalResponse
        });
        
        // ✅ TERMINAR LOOP
        continueLoop = false;
        
        // Mantener solo los últimos 20 mensajes
        if (conversationHistory.length > 20) {
          conversationHistory.splice(0, conversationHistory.length - 20);
          if (conversationHistory[0].role !== 'user') {
            let firstUser = conversationHistory.find(element => element.role === 'user');
            if (firstUser) {
              conversationHistory.splice(0, conversationHistory.indexOf(firstUser));
            }
          }
        }
        
        console.log(`🤖 Respuesta final: ${finalResponse}`);

        // ============================================================
        // V25.0 - MÉTRICAS DE RENDIMIENTO
        // ============================================================
        if (USAR_MULTI_PROMPT && clasificacion) {
          console.log('\n' + '-'.repeat(40));
          console.log('📈 MÉTRICAS V25.0:');
          console.log('   Acción clasificada: ' + clasificacion.accion);
          console.log('   Usó fallback: ' + usarFallback);
          console.log('   Iteraciones: ' + iteration);
          console.log('   Prompt tokens aprox: ' + (usarFallback ? '~5000' : '~500-1500'));
          console.log('-'.repeat(40) + '\n');
        }

        // ============================================================
        // RETORNAR RESPUESTA
        // ============================================================
        return {
          success: true,
          data: {
            conversationId,
            response: isGetPDF ? finalResponse.content : finalResponse,
            fileName: isGetPDF ? finalResponse.name : "",
            userId: userId,
            senderName,
            originalMessage: messageContent,
            // V25.0: Incluir metadata de clasificación
            clasificacion: USAR_MULTI_PROMPT ? {
              accion: clasificacion ? clasificacion.accion : null,
              sub_accion: clasificacion ? clasificacion.sub_accion : null,
              usarFallback: usarFallback
            } : null
          },
          message: "Mensaje procesado correctamente"
        };
      }
    }
    
    // ============================================================
    // LÍMITE DE ITERACIONES ALCANZADO
    // ============================================================
    if (iteration >= MAX_ITERATIONS) {
      console.error(`⚠️ Límite de ${MAX_ITERATIONS} iteraciones alcanzado`);
      return {
        success: false,
        error: "Se alcanzó el límite de procesamiento. Por favor, intenta reformular tu pregunta.",
        details: `Límite de ${MAX_ITERATIONS} iteraciones alcanzado`
      };
    }

  } catch (error) {
    console.error('❌ Error procesando webhook:', error);
    sendMessage(webhookData.token, webhookData.account_id, webhookData.conversation_id, error.message);
    return {
      success: false,
      error: "Disculpa, tuve un problema técnico procesando tu mensaje.",
      details: error.message
    };
  }
}

// ============================================================
// NOTAS DE IMPLEMENTACIÓN
// ============================================================
/*

CAMBIOS CLAVE:

1. ✅ TOOL-CALLING LOOP REAL
   - Permite múltiples rondas de tool calls
   - Ronda 1: resolver_canonico
   - Ronda 2: buscar_productos
   - Ronda N: generar respuesta final

2. ✅ MISMO MODELO EN TODAS LAS RONDAS
   - model: "gpt-4o" en TODAS las llamadas
   - No hay cambio a gpt-3.5-turbo

3. ✅ TOOLS REGISTRADAS EN CADA ITERACIÓN
   - tools: functionDefinitions en cada llamada
   - tool_choice: "auto" siempre

4. ✅ TERMINA CUANDO NO HAY MÁS TOOL CALLS
   - El modelo decide cuándo generar respuesta final
   - No hay "segunda llamada" hardcodeada

5. ✅ LÍMITE DE SEGURIDAD
   - MAX_ITERATIONS = 10 para evitar loops infinitos

FLUJO ESPERADO:

Usuario: "vendes azucar"

Iteración 1:
  GPT-4o → tool_calls: [resolver_canonico("azucar")]
  Ejecutar → { token_canonico: "AZUCAR" }
  Continuar loop

Iteración 2:
  GPT-4o → tool_calls: [buscar_productos("AZUCAR")]
  Ejecutar → { data: [...productos] }
  Continuar loop

Iteración 3:
  GPT-4o → sin tool_calls
  Generar respuesta: "Aquí están los productos de azúcar: 1) ..."
  Terminar loop
  
✅ Retornar respuesta

*/

const getHooksCrm = async (token, account_id) => {
    let url = `${urlWA}api/v1/accounts/${account_id}/integrations/apps/daiko`;
//    console.log(url);
    let headers = {}; 
    headers = {
      api_access_token: token,
    }
    let config = {
      method: "get",
      url,
      headers,
    };
    let data = (await getApiData(config)).data;
    //console.log({hooks: data.hooks});

    return data.hooks;

}

const getOPENAI_APIKEY = async (token, account_id) => {
  let url = `${urlWA}api/v1/accounts/${account_id}/integrations/apps/openai`;
//    console.log(url);
  let headers = {}; 
  headers = {
    api_access_token: token,
  }
  let config = {
    method: "get",
    url,
    headers,
  };
  let data = (await getApiData(config)).data;
  //console.log({hooks: data.hooks});

  return data.hooks;

}

const getMessages = async (token, account_id, conversation_id, contextStr) => {
  let url = `${urlWA}api/v1/accounts/${account_id}/conversations/${conversation_id}/messages`;
  console.log(url);
  let headers = {};
  headers = {
    api_access_token: token,
  }
  let config = {
    method: "get",
    url,
    headers,
  };
  let data = (await getApiData(config)).data;
  let messages = [];
  for (var idx = 0; idx < data.payload.length; idx++) {
    let item = data.payload[idx];
    let addMessage = true;
    if (item.message_type != 0) {
      if (item.content.includes(fuenteWeb)) { addMessage = false; }
    }
    if (addMessage || true) {
      if (idx == data.payload.length - 1) {
        messages.push({
          //role: 'assistant', content: contextStr
          role: 'system', content: contextStr
        })
      }
      messages.push({
        role: (item.message_type != 0 ? 'assistant' : 'user' ),
        content: item.content
      })
    }
  }
  /*
  messages.push({
    role: 'user',
    content: data.payload[data.payload.length -1].content
  })
  */
  messages.splice(0, messages.length - 10);
  idx = -1;
  for (var i = messages.length - 1; i >= 0; i--) {
    let message = messages[i];
    if (message.role != 'user' && (message.content.includes('conversación nueva') || message.content.includes('nueva conversación'))) {
      idx = i;
      break;
    }
  }
  console.log(idx, messages.length);
  if (idx != -1) { messages.splice(0, idx + 1); }
  console.log(idx, messages.length);
  // console.log(messages);
  console.log({ msg1: messages[0] || '', ["msg" + messages.length]: messages[messages.length - 1] || '' });
  return messages;
}

/*
const sendMessage = async (token, account_id, conversation_id, messageData) => {
  let frmData = new FormData();
  let headers = {};
  frmData.append('content', messageData)
  headers = {
    api_access_token: token,
    ...frmData.getHeaders(),
  }
  let config = {
    method: "post",
    url: `${urlWA}api/v1/accounts/${account_id}/conversations/${conversation_id}/messages`,
    headers,
    data: frmData,
  };
  let data = (await getApiData(config)).data;
  return data;
};
*/



/*

const sendMessage = async (token, account_id, conversation_id, messageData, fileName = '') => {
console.log({Ln: 343, obj: "sendMessage"});
  let frmData = new FormData();
  let headers = {};
console.log({Ln: 346, obj: "sendMessage"});
  if (fileName != '') {
console.log({Ln: 348, obj: "sendMessage"});
    let bufferData = Buffer.from(messageData, 'base64');
console.log({Ln: 350, obj: "sendMessage"});
    let readableStream = new Readable();
console.log({Ln: 352, obj: "sendMessage"});
    readableStream._read = () => {};
    readableStream.push(bufferData);
    readableStream.push(null);
console.log({Ln: 360, obj: "sendMessage"});
    frmData.append("attachments[]", readableStream, { filename: fileName });
    headers = {
      api_access_token: token,
      file_type: "application/pdf",
      "content-type": "multipart/form-data; boundary=----WebKitFormBoundary",
      ...frmData.getHeaders(),
    }
  } else {
    frmData.append('content', messageData)
    headers = {
      api_access_token: token,
      ...frmData.getHeaders(),
    }
  }
  console.log({Ln: 375, obj: "sendMessage"});
  let config = {
    method: "post",
    url: `${urlWA}api/v1/accounts/${account_id}/conversations/${conversation_id}/messages`,
    headers,
    data: frmData,
  };
  console.log({Ln: 382, obj: "sendMessage", config});
  let data = (await getApiData(config));
  console.log({Ln: 384, data});
  return data.data;  
};
*/

const sendMessage = async (token, account_id, conversation_id, messageData, fileName = '') => {
   
  const frmData = new FormData();
  
  if (fileName !== '') {
    
    // Convertir base64 a buffer
    const bufferData = Buffer.from(messageData, 'base64');
    
    // Crear stream del buffer
    const readableStream = new Readable();
    readableStream._read = () => {};
    readableStream.push(bufferData);
    readableStream.push(null);
    
    // Agregar el archivo al FormData
    // IMPORTANTE: Chatwoot espera 'attachments[]' (con corchetes)
    frmData.append('attachments[]', readableStream, {
      filename: fileName,
      contentType: 'application/pdf'
    });
    
    // Opcionalmente agregar un mensaje de texto
    frmData.append('content', 'Documento adjunto');
    
  } else {
    // Solo mensaje de texto
    frmData.append('content', messageData);
  }
  
  
  // Configuración de la petición
  const config = {
    method: "post",
    url: `${urlWA}api/v1/accounts/${account_id}/conversations/${conversation_id}/messages`,
    headers: {
      'api_access_token': token,
      ...frmData.getHeaders() // Esto incluye el content-type correcto con boundary
    },
    data: frmData,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  };
  
  
  try {
    const response = await getApiData(config);
    
    return response.data;
  } catch (error) {
    
    throw error;
  }
};


  async function enviarMensajeWebhook(webhookData) {
    try {
      // Extraer información del webhook de Chatwoot
      let data = await sendMessage(webhookData.token, 
        webhookData.account_id, 
        webhookData.conversation_id, 
        webhookData.data.response, webhookData.data.fileName);
      
      
      /*
      return {
        success: true,
        data: {
          conversationId,
          messageContent,
          senderId,
          senderName,
          messageType,
          inboxId,
          inboxName
        },
        message: "Datos extraídos correctamente del webhook"
      };
      */
    } catch (error) {
      console.log({error});
      return {
        success: false,
        message: `Error al extraer datos del webhook: ${error.message}`
      };
    }
  }

  module.exports = {
    extraerDatosWebhook,
    procesarMensajeWebhook,
    enviarMensajeWebhook,
    getHooksCrm  // DEV0001 Integracion Whatsapp - 24 oct 
  };