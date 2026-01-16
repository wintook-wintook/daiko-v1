// daiko/src/tools/chatwoot.js

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

var Readable    = require('stream').Readable;
const { Buffer } = require('buffer');

let fuenteWeb ="Fuente: WEB";

// ============================================================
// DETECCIÓN DE NECESIDAD - OPCIÓN A2
// ============================================================
/**
 * Detecta si el mensaje del usuario corresponde a una intención de NECESIDAD
 * Implementación ligera y conservadora según requisitos
 * @param {string} mensaje - Mensaje del usuario
 * @returns {boolean} true si es NECESIDAD, false en caso contrario
 */
function detectarNecesidad(mensaje) {
  if (!mensaje || typeof mensaje !== 'string') {
    return false;
  }
  
  const mensajeNormalizado = mensaje.toLowerCase().trim();
  
  // REGLA 1: El comando "reiniciate" NO es necesidad
  if (mensajeNormalizado.includes('reinicia')) {
    return false;
  }
  
  // REGLA 2: Patrones claros de NECESIDAD
  const patronesNecesidad = [
    /\btengo sed\b/i,
    /\btengo hambre\b/i,
    /\bme duele\b/i,
    /\bbusco algo para\b/i,
    /\bnecesito algo para\b/i,
    /\btengo\s+\w+/i  // "tengo [algo]" - caso general conservador
  ];
  
  const esNecesidad = patronesNecesidad.some(patron => patron.test(mensajeNormalizado));
  
  console.log(`🔍 Detección NECESIDAD: mensaje="${mensaje.substring(0, 50)}" → ${esNecesidad ? 'SÍ ✅' : 'NO ❌'}`);
  
  return esNecesidad;
}


// ============================================================
// DETECCIÓN DE NECESIDAD - OPCIÓN A2

function extraerDatosWebhook(webhookData) {
    try {
      // Extraer informaciÃ³n del webhook de Chatwoot
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
        message: "Datos extraÃ­dos correctamente del webhook"
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
    // TOOL-CALLING LOOP - IMPLEMENTACIÃ“N CORRECTA
    // ============================================================
    
    const MAX_ITERATIONS = 10; // LÃ­mite de seguridad
    let iteration = 0;
    let continueLoop = true;
    let isGetPDF = false;
    
    while (continueLoop && iteration < MAX_ITERATIONS) {
      iteration++;
      console.log(`\nðŸ”„ Tool-calling loop - IteraciÃ³n ${iteration}/${MAX_ITERATIONS}`);
      
      // ============================================================
      // DETECCIÓN DE NECESIDAD (solo en primera iteración)
      // ============================================================
      let isNecesidad = false;
      if (iteration === 1) {
        isNecesidad = detectarNecesidad(messageContent);
        if (isNecesidad) {
          console.log(`⚡ NECESIDAD DETECTADA - Forzando ejecución de buscar_productos`);
        }
      }
      
      // ============================================================
      // DETERMINAR tool_choice SEGÚN DETECCIÓN
      // ============================================================
      let toolChoice = "auto";  // Por defecto: modo automático
      
      if (isNecesidad && iteration === 1) {
        // OPCIÓN A2: Forzar específicamente buscar_productos
        toolChoice = {
          type: "function",
          function: { name: "buscar_productos" }
        };
        console.log(`🎯 tool_choice FORZADO a buscar_productos para NECESIDAD`);
      }
      
      // Preparar input con historial actualizado
      const input = [
        { role: "system", content: systemPromptWithContext },
        ...conversationHistory
      ];

      // âœ… LLAMAR AL MODELO CON TOOLS EN CADA ITERACIÃ“N
      const response = await openai.chat.completions.create({
        model: "gpt-4o",  // âœ… MISMO MODELO EN TODAS LAS RONDAS
        messages: input,
        tools: functionDefinitions,  // âœ… TOOLS DISPONIBLES EN CADA RONDA
        tool_choice: toolChoice,  // ✅ MODIFICADO: Usa toolChoice dinámico
        temperature: 0.3
      });

      const assistantMessage = response.choices[0].message;
      
      // ============================================================
      // VERIFICAR SI HAY TOOL CALLS
      // ============================================================
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        console.log(`ðŸ› ï¸ Procesando ${assistantMessage.tool_calls.length} tool calls en iteraciÃ³n ${iteration}`);
        
        // Agregar mensaje del asistente al historial
        conversationHistory.push(assistantMessage);

        // ============================================================
        // EJECUTAR CADA TOOL CALL
        // ============================================================
        for (const toolCall of assistantMessage.tool_calls) {
          const { id, function: func } = toolCall;
          const { name, arguments: args } = func;
          
          console.log(`  ðŸ“Œ Ejecutando tool: ${name}`);
          
          try {
            const functionArgs = JSON.parse(args);
            
            // âœ… EJECUTAR TOOL con account_id desde webhookData
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

            // âœ… AGREGAR RESULTADO AL HISTORIAL
            conversationHistory.push({
              role: "tool",
              tool_call_id: id,
              content: JSON.stringify(functionResult)
            });
            
            console.log(`  âœ… Tool ${name} ejecutada exitosamente`);

          } catch (error) {
            console.error(`  âŒ Error ejecutando ${name}:`, error);
            
            conversationHistory.push({
              role: "tool",
              tool_call_id: id,
              content: JSON.stringify({
                success: false,
                message: `Error ejecutando la funciÃ³n: ${error.message}`
              })
            });
          }
        }
        
        // âœ… CONTINUAR LOOP - El modelo puede pedir mÃ¡s tools
        continueLoop = true;
        
      } else {
        // ============================================================
        // NO HAY MÃS TOOL CALLS - GENERAR RESPUESTA FINAL
        // ============================================================
        console.log(`âœ… No hay mÃ¡s tool calls. Generando respuesta final.`);
        
        const finalResponse = assistantMessage.content || "";
        
        // Agregar respuesta final al historial
        conversationHistory.push({
          role: "assistant",
          content: finalResponse
        });
        
        // âœ… TERMINAR LOOP
        continueLoop = false;
        
        // Mantener solo los Ãºltimos 20 mensajes
        if (conversationHistory.length > 20) {
          conversationHistory.splice(0, conversationHistory.length - 20);
          if (conversationHistory[0].role !== 'user') {
            let firstUser = conversationHistory.find(element => element.role === 'user');
            if (firstUser) {
              conversationHistory.splice(0, conversationHistory.indexOf(firstUser));
            }
          }
        }
        
        console.log(`ðŸ¤– Respuesta final: ${finalResponse}`);
        
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
            originalMessage: messageContent
          },
          message: "Mensaje procesado correctamente"
        };
      }
    }
    
    // ============================================================
    // LÃMITE DE ITERACIONES ALCANZADO
    // ============================================================
    if (iteration >= MAX_ITERATIONS) {
      console.error(`âš ï¸ LÃ­mite de ${MAX_ITERATIONS} iteraciones alcanzado`);
      return {
        success: false,
        error: "Se alcanzÃ³ el lÃ­mite de procesamiento. Por favor, intenta reformular tu pregunta.",
        details: `LÃ­mite de ${MAX_ITERATIONS} iteraciones alcanzado`
      };
    }

  } catch (error) {
    console.error('âŒ Error procesando webhook:', error);
    sendMessage(webhookData.token, webhookData.account_id, webhookData.conversation_id, error.message);
    return {
      success: false,
      error: "Disculpa, tuve un problema tÃ©cnico procesando tu mensaje.",
      details: error.message
    };
  }
}

// ============================================================
// NOTAS DE IMPLEMENTACIÃ“N
// ============================================================
/*

CAMBIOS CLAVE:

1. âœ… TOOL-CALLING LOOP REAL
   - Permite mÃºltiples rondas de tool calls
   - Ronda 1: resolver_canonico
   - Ronda 2: buscar_productos
   - Ronda N: generar respuesta final

2. âœ… MISMO MODELO EN TODAS LAS RONDAS
   - model: "gpt-4o" en TODAS las llamadas
   - No hay cambio a gpt-3.5-turbo

3. âœ… TOOLS REGISTRADAS EN CADA ITERACIÃ“N
   - tools: functionDefinitions en cada llamada
   - tool_choice: "auto" siempre

4. âœ… TERMINA CUANDO NO HAY MÃS TOOL CALLS
   - El modelo decide cuÃ¡ndo generar respuesta final
   - No hay "segunda llamada" hardcodeada

5. âœ… LÃMITE DE SEGURIDAD
   - MAX_ITERATIONS = 10 para evitar loops infinitos

FLUJO ESPERADO:

Usuario: "vendes azucar"

IteraciÃ³n 1:
  GPT-4o â†’ tool_calls: [resolver_canonico("azucar")]
  Ejecutar â†’ { token_canonico: "AZUCAR" }
  Continuar loop

IteraciÃ³n 2:
  GPT-4o â†’ tool_calls: [buscar_productos("AZUCAR")]
  Ejecutar â†’ { data: [...productos] }
  Continuar loop

IteraciÃ³n 3:
  GPT-4o â†’ sin tool_calls
  Generar respuesta: "AquÃ­ estÃ¡n los productos de azÃºcar: 1) ..."
  Terminar loop
  
âœ… Retornar respuesta

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
    if (message.role != 'user' && (message.content.includes('conversaciÃ³n nueva') || message.content.includes('nueva conversaciÃ³n'))) {
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
  
  
  // ConfiguraciÃ³n de la peticiÃ³n
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
      // Extraer informaciÃ³n del webhook de Chatwoot
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
        message: "Datos extraÃ­dos correctamente del webhook"
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