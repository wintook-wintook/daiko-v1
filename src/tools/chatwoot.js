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
  
  async function procesarMensajeWebhook(webhookData) {
    try {
      let sender = webhookData.conversation.meta.sender;
      let OPENAI_APIKEY = await getOPENAI_APIKEY(webhookData.token, webhookData.account_id);
//console.log({sender: sender, webhookData});

      // Extraer datos del webhook
      const extractedData = extraerDatosWebhook(webhookData);

      // Buscar el inboxid, si no coincide o está vacio no responder el mensaje a Wintook

      if (!extractedData.success) {
        return extractedData;
      }
      
      //console.log({OPENAI_APIKEY: OPENAI_APIKEY[0].settings.api_key});  
      
      openai = new OpenAI({
        apiKey: OPENAI_APIKEY[0].settings.api_key
      });

      const { conversationId, messageContent, senderId, senderName, messageType, inboxId } = extractedData.data;
      let url_crm_zeus = ''; 
      let api_access_token = '';
      let almacen_id = '';
      let contact_id = '';

      
      let hooks = await getHooksCrm(webhookData.token, webhookData.account_id); // hooks[]
      const item = await (hooks.length >= 1 ? hooks.find((element) => element.inbox.id === inboxId) : []);
      
      // Solo procesar mensajes entrantes (incoming) de contactos
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

      //console.log({url_crm_zeus, api_access_token, contact_id, sender});


      // console.log({Cliente});

      // Solo procesar mensajes entrantes (incoming) de contactos
      if (messageType !== 'incoming' || !messageContent) {
        return {
          success: false,
          message: "Mensaje no procesable - solo se procesan mensajes entrantes con contenido"
        };
      }
      

      //await buscarcliente(senderName);
  
      // Usar el conversation ID como userId para mantener contexto
      const userId = `chatwoot_${conversationId}`;
      
      // console.log(`📨 Webhook recibido - Conversación ${conversationId} de ${senderName}: ${messageContent}`);

      
      // 1. Obtener contexto del usuario desde Redis
      const userContext = new UserContext(userId);
      console.log({userContext});
      const contextStr = await userContext.toSystemContext();

      let Cliente = await buscarcliente2(url_crm_zeus, api_access_token, {
          email: sender.email, 
          phone_number: sender.phone_number, 
          contact_id: contact_id, 
          almacen_id: almacen_id,
          userContext
        });  

      // Guardar nombre si lo proporciona
      if (Cliente.data.NOMBRE_COMERCIAL) {
        await userContext.setNombre(Cliente.data.NOMBRE_COMERCIAL);
      }

      // 2. Inyectar contexto en el system prompt
      const systemPromptWithContext = systemPrompt; // + contextStr;
      
      // Obtener historial de conversación
      if (!conversations.has(userId)) {
        conversations.set(userId, []);
      }
      
      // const conversationHistory = conversations.get(userId);
      const conversationHistory = await getMessages(webhookData.token, webhookData.account_id, webhookData.conversation_id, contextStr);

/* // conversaciones de respuesta
      const conversationAssistants = conversationHistory.filter(conversation => conversation.role === 'assistant');
      const conversationAssistant  = conversationAssistants[conversationAssistants.length - 1];
console.log({conversationAssistant});
*/
      
      // // Agregar mensaje del usuario
      // conversationHistory.push({
      //   role: "user",
      //   content: messageContent
      // });
  
      // Crear input para OpenAI
      const input = [
        { role: "system", content: systemPromptWithContext },
        ...conversationHistory
      ];
      //console.log({input});
      // Llamar a OpenAI
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: input,
        tools: functionDefinitions,
        tool_choice: "auto",
        temperature: 0.3  // ✅ Cambiar de 0.7 a 0.3 para más precisión
      });
  
      const assistantMessage = response.choices[0].message;
      let finalResponse = assistantMessage.content || "";
      let functionResult;
      let isGetPDF = false;
      // Procesar tool calls si existen
      let showSourceMessage = false;
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        console.log(`🛠️ Procesando ${assistantMessage.tool_calls.length} function calls para webhook`);
        
        // Agregar el mensaje del asistente con tool calls al historial
        conversationHistory.push(assistantMessage);
  
        
        // Ejecutar cada function call
        for (const toolCall of assistantMessage.tool_calls) {
          const { id, function: func } = toolCall;
          const { name, arguments: args } = func;
          if (name == 'buscar_informacion_externa') { showSourceMessage = true; }
          try {            
            const functionArgs = JSON.parse(args);
            functionResult = await executeFunctionCall(name, functionArgs, userId);
            
            if(name==='generar_pdf' && !functionResult.error){isGetPDF=true; finalResponse = functionResult.data; }

            // Agregar el resultado de la función al historial
            conversationHistory.push({
              role: "tool",
              tool_call_id: id,
              content: JSON.stringify(functionResult)
            });
  
          } catch (error) {
            console.error(`❌ Error ejecutando ${name} en webhook:`, error);
            
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
        if(!isGetPDF){
          // Obtener respuesta final del asistente
          const finalInput = [
            { role: "system", content: systemPromptWithContext },
            ...conversationHistory
          ];
    
          const finalOpenAIResponse = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: finalInput,
            temperature: 0.3  // ✅ Cambiar de 0.7 a 0.3 para más precisión
          });
          finalResponse = finalOpenAIResponse.choices[0].message.content;
          console.log({ functionResult, finalResponse });

          
          // Agregar respuesta final al historial
          conversationHistory.push({
            role: "assistant",
            content: finalResponse
          });
        }else{

        }

      } else {
        showSourceMessage = true;
        // Si no hay tool calls, agregar directamente la respuesta
        conversationHistory.push({
          role: "assistant", 
          content: finalResponse
        });
      }
      if (showSourceMessage && false) { finalResponse += `\r\n${fuenteWeb}`; }

      // Mantener solo los últimos 20 mensajes
      //console.log({ length: conversationHistory.length, firtsRole: conversationHistory[0].role, question: messageContent });
      if (conversationHistory.length > 20) {
        conversationHistory.splice(0, conversationHistory.length - 20);
        //console.log({ msg: 'lenght before splice', length: conversationHistory.length, firtsRole: conversationHistory[0].role });
        if (conversationHistory[0].role != 'user') {
          console.log(typeof conversationHistory); // "object"
          console.log(Array.isArray(conversationHistory)); // false
          let firstUser = conversationHistory.find(element => element.role ==  'user');
          conversationHistory.splice(0, conversationHistory.indexOf(firstUser));
        }
        console.log({ msg: 'lenght after splice', length: conversationHistory.length, firtsRole: conversationHistory[0].role });
      }
  
      console.log(`🤖 Alex respuesta webhook: ${finalResponse}`, finalResponse);
  
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
  
    } catch (error) {
      console.error('❌ Error procesando webhook:', error);
      sendMessage(webhookData.token, webhookData.account_id, webhookData.conversation_id, error.message );
      return {
        success: false,
        error: "Disculpa, tuve un problema técnico procesando tu mensaje.",
        details: error.message
      };
    }
  }

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
