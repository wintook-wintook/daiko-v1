// daiko/src/tools/chatwoot.js
// DAIKO V25.0 - Arquitectura Multi-Prompt con Router

const OpenAI = require('openai');
require('dotenv').config();

const FormData  = require('form-data');

const carts = new Map(); // userId -> cart items
const orders = new Map(); // orderId -> order details
const conversations = new Map(); // userId -> conversation history

const { openaiConfig, systemPrompt } = require('../config/openai_prompt');
const { functionDefinitions, executeFunctionCall, TOOL_BUSCAR_NUMERO_PARTE_EXTERNO } = require('../tools/openai_tools');
const {buscarcliente, buscarcliente2, crearProspecto, actualizarObservaciones, runWithCrmContext} = require('../utils/crm');
const { getApiData } = require('../utils/functions');
let urlWA = process.env.CHATWOOT_URL; // 'https://app.chatzeus.com/';

const UserContext = require('../utils/userContext');

// ============================================================
// V25.0 - FASE 3: Servicios de Clasificación y Router
// ============================================================
const {
  clasificarIntencion,
  confianzaSuficiente,
  requiereFallbackPromptCompleto,
  preClasificarPorKeywords
} = require('../services/clasificador_service');

const {
  enrutarSolicitud,
  filtrarTools
} = require('../services/router_service');

const {
  resolverParametrosClasificador
} = require('../services/referencia_service');

const { ejecutarQueryComando } = require('../utils/query_commands');
const { buildRefaccionesPrompt } = require('../prompts/refacciones_prompt');
const {
  extraerListaDeImagen,
  extraerListaDeExcel,
  buscarItemsLista,
  agregarEncontradosAlCarrito,
  formatearRespuestaImagen,
  mensajePideCarrito,
  esImagenAdjunta,
  esExcelAdjunto,
  esAudioAdjunto,
  descargarArchivo
} = require('../utils/imagen_service');

// Feature toggle para activación gradual
const USAR_MULTI_PROMPT = process.env.USAR_MULTI_PROMPT === 'true' || false;

// ============================================================
// CACHE EN MEMORIA - Hooks y API key (TTL 5 minutos)
// Evita llamadas HTTP repetidas a Chatwoot API
// ============================================================
const apiCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function getCached(key) {
  const entry = apiCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  apiCache.delete(key);
  return null;
}

function setCache(key, data) {
  apiCache.set(key, { data, timestamp: Date.now() });
}

var Readable    = require('stream').Readable;
const { Buffer } = require('buffer');

let fuenteWeb ="Fuente: WEB";

// ============================================================
// TYPING INDICATOR - Muestra "escribiendo..." en Chatwoot
// ============================================================
async function toggleTyping(token, account_id, conversation_id, status = 'on') {
  try {
    await getApiData({
      method: 'post',
      url: `${urlWA}api/v1/accounts/${account_id}/conversations/${conversation_id}/toggle_typing_status`,
      headers: { api_access_token: token },
      data: { typing_status: status },
      timeout: 3000
    });
  } catch (err) {
    // Fail silently - typing indicator is cosmetic
    console.warn(`⚠️ toggleTyping(${status}) falló:`, err.message);
  }
}

function extraerDatosWebhook(webhookData) {
    try {
      // Extraer información del webhook de Chatwoot
      const conversationId = webhookData.conversation && webhookData.conversation.id;
      const messageContent = webhookData.content;
      const senderId = webhookData.sender && webhookData.sender.id;
      const senderName = webhookData.sender && webhookData.sender.name;
      const messageType = webhookData.message_type;
      const inboxId = webhookData.inbox && webhookData.inbox.id;
      const inboxName = webhookData.inbox && webhookData.inbox.name;
      const attachments = webhookData.attachments || [];

      return {
        success: true,
        data: {
          conversationId,
          messageContent,
          senderId,
          senderName,
          messageType,
          inboxId,
          inboxName,
          attachments
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
// WIZARD /+prospecto - Helpers
// ============================================================

function validarNombre(input) {
  if (!input || input.trim().length < 3) return false;
  return /[a-záéíóúüñA-ZÁÉÍÓÚÜÑA-Z]/.test(input);
}

function validarTelefono(tel) {
  const digitos = (tel || '').replace(/\D/g, '');
  return digitos.length >= 10 && digitos.length <= 15;
}

function formatearResumenProspecto(datos) {
  return (
    'Resumen:\n' +
    `• Nombre de la organización: ${datos.nombre_prospecto}\n` +
    `• Nombre del contacto: ${datos.nombre_contacto}\n` +
    `• Celular: ${datos.celular}\n` +
    `• Teléfono de oficina: ${datos.telefono_oficina || 'No proporcionado'}\n\n` +
    '¿Los datos son correctos? Responde *sí* para confirmar o *no* para cancelar.'
  );
}

async function procesarWizardImagenNotas(wizardState, messageContent, userContext) {
  const inputLower = messageContent.trim().toLowerCase();
  const { noEncontrados, carritoId } = wizardState;

  if (['si', 'sí', 's', 'yes'].includes(inputLower)) {
    await userContext.clearWizardState();
    const textoNotas = 'Productos no encontrados:\n' + noEncontrados.map(function(item, i) {
      const desc = item.descripcion || item.clave || 'Sin descripción';
      return (i + 1) + ') ' + desc + (item.cantidad && item.cantidad > 1 ? ' x' + item.cantidad : '');
    }).join('\n');
    const resultado = await actualizarObservaciones(carritoId, textoNotas, 'append');
    if (resultado && resultado.success) {
      return 'Listo, los productos no encontrados fueron agregados como nota en el carrito.';
    }
    return 'No fue posible agregar las notas: ' + (resultado ? resultado.message : 'error desconocido');
  }

  if (['no', 'n'].includes(inputLower)) {
    await userContext.clearWizardState();
    return 'De acuerdo, los productos no encontrados no fueron agregados como nota.';
  }

  // Respuesta inválida — re-preguntar con la lista
  const lista = noEncontrados.map(function(item, i) {
    return (i + 1) + ') ' + (item.descripcion || item.clave || 'Sin descripción');
  }).join('\n');
  return 'Por favor responde *sí* o *no*.\n\nProductos no encontrados:\n' + lista + '\n\n¿Deseas agregarlos como nota al carrito?';
}

async function transcribirAudio(audioUrl, apiKey) {
  try {
    const { toFile } = require('openai/uploads');
    const openaiWhisper = new OpenAI({ apiKey });

    const buffer = await descargarArchivo(audioUrl);
    const ext = (audioUrl.split('?')[0].split('.').pop() || 'ogg').toLowerCase();
    const file = await toFile(buffer, `audio.${ext}`, { type: `audio/${ext}` });

    const transcripcion = await openaiWhisper.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'es'
    });

    console.log(`🎤 Transcripción Whisper: "${(transcripcion.text || '').substring(0, 100)}"`);
    return transcripcion.text || null;
  } catch (error) {
    console.error('Error transcribiendo audio:', error.message);
    return null;
  }
}

async function appendCarritoFooter(texto, userContext) {
  const carritoActivo = await userContext.getCarrito();
  if (carritoActivo && !texto.includes('Carrito activo:')) {
    const folioActivo = await userContext.getFolio();
    return texto + '\n\nCarrito activo: ' + carritoActivo + (folioActivo ? ' | Folio: ' + folioActivo : '');
  }
  return texto;
}

async function procesarWizardImagenCarrito(wizardState, messageContent, userContext) {
  const inputLower = (messageContent || '').trim().toLowerCase();
  const { encontrados, noEncontrados } = wizardState;

  if (['si', 'sí', 's', 'yes'].includes(inputLower)) {
    await userContext.clearWizardState();
    const carritoIdActual = await userContext.getCarrito();
    const resultadoCarrito = await agregarEncontradosAlCarrito(encontrados, carritoIdActual);
    if (resultadoCarrito && resultadoCarrito.success) {
      const nuevoCarritoId = resultadoCarrito.carritoId || carritoIdActual;
      if (!carritoIdActual) {
        await userContext.setCarrito(nuevoCarritoId, resultadoCarrito.folio || null);
      }
      if (noEncontrados && noEncontrados.length > 0) {
        await userContext.setWizardState({ tipo: 'imagen_notas', noEncontrados, carritoId: nuevoCarritoId });
        return 'Los productos encontrados fueron agregados al carrito.\n\n¿Deseas agregar los productos no encontrados como nota al carrito? (sí/no)';
      }
      return 'Productos agregados al carrito correctamente.';
    }
    return 'No fue posible agregar los productos al carrito: ' + (resultadoCarrito ? resultadoCarrito.message : 'error desconocido');
  }

  if (['no', 'n'].includes(inputLower)) {
    await userContext.clearWizardState();
    return 'De acuerdo, los productos no fueron agregados al carrito.';
  }

  return 'Por favor responde *sí* o *no*.\n\n¿Deseas agregar estos productos al carrito?';
}

async function procesarWizardProspecto(wizardState, messageContent, userContext, url_crm_zeus, api_access_token) {
  const paso = wizardState.paso;
  const datos = wizardState.datos;
  const input = (messageContent || '').trim();
  const inputLower = input.toLowerCase();

  if (inputLower === '/salir') {
    await userContext.clearWizardState();
    return 'Registro de prospecto cancelado.';
  }

  switch (paso) {
    case 1: {
      if (!validarNombre(input)) {
        return 'Por favor ingresa un nombre de organización válido (mínimo 3 caracteres).';
      }
      datos.nombre_prospecto = input;
      await userContext.setWizardState({ tipo: 'prospecto', paso: 2, datos });
      return '¿Cuál es el nombre del contacto?';
    }
    case 2: {
      if (!validarNombre(input)) {
        return 'Por favor ingresa un nombre de contacto válido (mínimo 3 caracteres).';
      }
      datos.nombre_contacto = input;
      await userContext.setWizardState({ tipo: 'prospecto', paso: 3, datos });
      return '¿Cuál es el número de celular del contacto?';
    }
    case 3: {
      if (!validarTelefono(input)) {
        return 'Por favor ingresa un número de celular válido (mínimo 10 dígitos).';
      }
      datos.celular = input.replace(/\D/g, '');
      await userContext.setWizardState({ tipo: 'prospecto', paso: 4, datos });
      return '¿Deseas agregar un número de teléfono de oficina? (sí/no)';
    }
    case 4: {
      if (['si', 'sí', 's', 'yes'].includes(inputLower)) {
        await userContext.setWizardState({ tipo: 'prospecto', paso: 5, datos });
        return '¿Cuál es el número de teléfono de oficina?';
      }
      if (['no', 'n'].includes(inputLower)) {
        datos.telefono_oficina = null;
        await userContext.setWizardState({ tipo: 'prospecto', paso: 6, datos });
        return formatearResumenProspecto(datos);
      }
      return 'Por favor responde *sí* o *no*. ¿Deseas agregar un número de teléfono de oficina?';
    }
    case 5: {
      if (!validarTelefono(input)) {
        return 'Por favor ingresa un número de teléfono de oficina válido (mínimo 10 dígitos).';
      }
      datos.telefono_oficina = input.replace(/\D/g, '');
      await userContext.setWizardState({ tipo: 'prospecto', paso: 6, datos });
      return formatearResumenProspecto(datos);
    }
    case 6: {
      if (['si', 'sí', 's', 'yes'].includes(inputLower)) {
        await userContext.clearWizardState();
        const resultado = await crearProspecto(url_crm_zeus, api_access_token, datos);
        if (resultado && resultado.success) {
          return 'Prospecto registrado exitosamente.';
        }
        return resultado ? resultado.message : 'Error desconocido al registrar el prospecto.';
      }
      if (['no', 'n'].includes(inputLower)) {
        await userContext.clearWizardState();
        return 'Registro cancelado. Los datos no fueron guardados.';
      }
      return formatearResumenProspecto(datos);
    }
    default:
      await userContext.clearWizardState();
      return 'Ocurrió un error en el flujo. Por favor intenta de nuevo con /+prospecto.';
  }
}

// ============================================================
// HANDLER CORREGIDO - procesarMensajeWebhook()
// Tool-Calling Loop Real - DAIKO V23.3.0
// ============================================================

async function procesarMensajeWebhook(webhookData) {
  // Envuelve toda la request en su propio contexto aislado de crm.js
  // (cliente_id, moneda_id, api_access_token, url_crm_zeus, etc.) para que
  // requests concurrentes de distintos usuarios/cuentas no se mezclen entre sí.
  return runWithCrmContext(async () => {
  let openai; // local a esta request (antes era variable de módulo compartida)
  try {
    let sender = webhookData.conversation.meta.sender;

    const extractedData = extraerDatosWebhook(webhookData);
    if (!extractedData.success) {
      return extractedData;
    }

    let { conversationId, messageContent, senderId, senderName, messageType, inboxId, attachments } = extractedData.data;

    const imagenAdjunta = attachments.find(esImagenAdjunta) || null;
    const excelAdjunto = attachments.find(esExcelAdjunto) || null;
    const audioAdjunto = attachments.find(esAudioAdjunto) || null;

    if (messageType !== 'incoming' || (!messageContent && !imagenAdjunta && !excelAdjunto && !audioAdjunto)) {
      return {
        success: false,
        message: "Mensaje no procesable - solo se procesan mensajes entrantes con contenido"
      };
    }

    // Activar indicador "escribiendo..." inmediatamente
    toggleTyping(webhookData.token, webhookData.account_id, webhookData.conversation_id, 'on');

    const _t0 = Date.now();
    let _tStep = Date.now();
    console.log(`⏱️ [0] Inicio procesamiento`);

    // Preparar contexto del usuario (independiente de APIs externas)
    const userId = `chatwoot_${conversationId}`;
    const userContext = new UserContext(userId);

    // ============================================================
    // COMANDOS DE SISTEMA (prioridad absoluta - antes de cualquier API)
    // ============================================================
    const msgNormEarly = messageContent ? messageContent.trim().toLowerCase() : '';
    let respuestaComandoSistema = null;

    if (/^(reinici(ar|ate|a)|reset|borrar\s*conversaci[oó]n|empezar\s*de\s*nuevo)\s*[!.?]*$/i.test(msgNormEarly)) {
      await userContext.reset();
      respuestaComandoSistema = 'Claro, a partir de este momento inicia una conversación nueva';
    } else if (msgNormEarly === '/cotizar') {
      const comandoActivo = await userContext.getComandoActivo();
      if (comandoActivo) {
        respuestaComandoSistema = comandoActivo.mensaje;
      } else {
        await userContext.setModoVendedor(true);
        respuestaComandoSistema = 'Modo cotizar activado. ¿Con qué cliente deseas trabajar?';
      }
    } else if (msgNormEarly === '/refacciones') {
      const comandoActivo = await userContext.getComandoActivo();
      if (comandoActivo) {
        respuestaComandoSistema = comandoActivo.mensaje;
      } else {
        await userContext.setModoRefacciones(true);
        respuestaComandoSistema = 'Listo, entramos en modo refacciones. Ahora dime qué pieza, servicio o vehículo quieres cotizar.';
      }
    } else if (msgNormEarly === '/salir_refacciones') {
      await userContext.setModoRefacciones(false);
      respuestaComandoSistema = 'Listo, salimos del modo refacciones. Ahora continuaré con la búsqueda general.';
    } else if (msgNormEarly === '/salir') {
      await Promise.all([
        userContext.clearModoVendedor(),
        userContext.clearWizardState(),
        userContext.setModoRefacciones(false)
      ]);
      respuestaComandoSistema = 'Modo desactivado.';
    } else if (msgNormEarly === '/ver_comandos') {
      respuestaComandoSistema =
        'Flujos:\n' +
        '   reiniciar — Borra la sesión y empieza una conversación nueva.\n' +
        '   /cotizar — Activa el modo vendedor para cotizar a nombre de un cliente.\n' +
        '   /+prospecto — Registra un nuevo prospecto en el CRM.\n' +
        '   /refacciones — Activa el modo refacciones (autopartes, servicios y vehículos).\n' +
        '   /salir_refacciones — Sale del modo refacciones.\n' +
        '   /salir — Desactiva el modo vendedor o cualquier flujo activo.\n\n' +
        'Consultas rápidas:\n' +
        '   ?saldo — Consulta el saldo pendiente del cliente.\n' +
        '   ?existencia <id> — Consulta la existencia de un artículo por su ID.\n' +
        '   ?estatuspedido <folio> — Consulta el estado de un pedido por folio.\n\n' +
        'Búsqueda directa:\n' +
        '   =<clave> — Busca un artículo por clave exacta. Ej: =ABC123';
    }

    if (respuestaComandoSistema !== null) {
      console.log('⚡ Comando de sistema detectado:', msgNormEarly);
      return {
        success: true,
        data: { conversationId, response: respuestaComandoSistema, fileName: '', userId, senderName, originalMessage: messageContent },
        message: 'Mensaje procesado correctamente'
      };
    }

    // ============================================================
    // FASE 1: Llamadas independientes en PARALELO
    // getOPENAI_APIKEY, getHooksCrm, keepAlive (todos independientes)
    // ============================================================
    _tStep = Date.now();
    const [OPENAI_APIKEY, hooks] = await Promise.all([
      getOPENAI_APIKEY(webhookData.token, webhookData.account_id),
      webhookData._hooks || getHooksCrm(webhookData.token, webhookData.account_id),
      userContext.keepAlive()
    ]);
    console.log(`⏱️ [1] FASE 1 (getOPENAI_APIKEY + getHooksCrm + keepAlive): ${Date.now() - _tStep}ms`);

    // Inicializar OpenAI
    openai = new OpenAI({
      apiKey: OPENAI_APIKEY[0].settings.api_key
    });

    // Transcribir audio si es un mensaje de voz
    if (audioAdjunto && !messageContent) {
      const audioUrl = audioAdjunto.data_url || audioAdjunto.file_url;
      if (audioUrl) {
        console.log(`\n🎤 Audio detectado, transcribiendo...`);
        const transcripcion = await transcribirAudio(audioUrl, OPENAI_APIKEY[0].settings.api_key);
        if (transcripcion) {
          messageContent = transcripcion;
        } else {
          return {
            success: true,
            data: { conversationId, response: 'No pude procesar el mensaje de voz. ¿Puedes escribir tu mensaje?', fileName: '', userId: `chatwoot_${conversationId}`, senderName, originalMessage: '' },
            message: 'Mensaje procesado correctamente'
          };
        }
      }
    }

    const item = hooks.length >= 1 ? hooks.find((element) => element.inbox.id === inboxId) : null;

    if (!inboxId || !item) {
      return {
        success: false,
        message: "Mensaje no procesable - no hay hooks que concuerden con el inbox_id"
      };
    }

    const url_crm_zeus = item.settings.api_url_base+'/';
    const api_access_token = item.settings.api_access_token;
    const contact_id = item.settings.contact_id;
    const almacen_id = item.settings.almacen_id;

    // ============================================================
    // FASE 2: buscarcliente2 + toSystemContext en PARALELO
    // (ambos necesitan hooks/userContext pero son independientes entre si)
    // ============================================================
    _tStep = Date.now();
    const [Cliente, contextStr] = await Promise.all([
      buscarcliente2(url_crm_zeus, api_access_token, {
        email: sender.email,
        phone_number: sender.phone_number,
        contact_id: contact_id,
        almacen_id: almacen_id,
        senderName,
        userContext
      }),
      userContext.toSystemContext()
    ]);
    console.log(`⏱️ [2] FASE 2 (buscarcliente2 + toSystemContext): ${Date.now() - _tStep}ms`);

    if (Cliente && !Cliente.success) {
      console.error('❌ buscarcliente2 falló, abortando procesamiento:', Cliente.message);
      const errorMsg = Cliente.message || 'No fue posible identificar al cliente. Por favor intenta más tarde.';
      return {
        success: true,
        data: { conversationId, response: errorMsg, fileName: '', userId, senderName, originalMessage: messageContent },
        message: 'Mensaje procesado correctamente'
      };
    }

    if (Cliente && Cliente.data && Cliente.data.NOMBRE_COMERCIAL) {
      await userContext.setNombre(Cliente.data.NOMBRE_COMERCIAL);
    }
    if (senderName) {
      await userContext.setNombreContacto(senderName);
    }

    const systemPromptWithContext = systemPrompt;

    if (!conversations.has(userId)) {
      conversations.set(userId, []);
    }

    // ============================================================
    // WIZARD /+prospecto (después de FASE 2 para tener credenciales CRM)
    // ============================================================
    const wizardState = await userContext.getWizardState();

    if (wizardState && wizardState.tipo === 'imagen_carrito') {
      let respuestaWizard = await procesarWizardImagenCarrito(wizardState, messageContent, userContext);
      respuestaWizard = await appendCarritoFooter(respuestaWizard, userContext);
      toggleTyping(webhookData.token, webhookData.account_id, webhookData.conversation_id, 'off');
      return {
        success: true,
        data: { conversationId, response: respuestaWizard, fileName: '', userId, senderName, originalMessage: messageContent },
        message: 'Mensaje procesado correctamente'
      };
    }

    if (wizardState && wizardState.tipo === 'imagen_notas') {
      let respuestaWizard = await procesarWizardImagenNotas(wizardState, messageContent, userContext);
      respuestaWizard = await appendCarritoFooter(respuestaWizard, userContext);
      toggleTyping(webhookData.token, webhookData.account_id, webhookData.conversation_id, 'off');
      return {
        success: true,
        data: { conversationId, response: respuestaWizard, fileName: '', userId, senderName, originalMessage: messageContent },
        message: 'Mensaje procesado correctamente'
      };
    }

    if (wizardState && wizardState.tipo === 'prospecto') {
      const respuestaWizard = await procesarWizardProspecto(wizardState, messageContent, userContext, url_crm_zeus, api_access_token);
      toggleTyping(webhookData.token, webhookData.account_id, webhookData.conversation_id, 'off');
      return {
        success: true,
        data: { conversationId, response: respuestaWizard, fileName: '', userId, senderName, originalMessage: messageContent },
        message: 'Mensaje procesado correctamente'
      };
    }

    if (msgNormEarly === '/+prospecto') {
      const comandoActivo = await userContext.getComandoActivo();
      if (comandoActivo) {
        toggleTyping(webhookData.token, webhookData.account_id, webhookData.conversation_id, 'off');
        return {
          success: true,
          data: { conversationId, response: comandoActivo.mensaje, fileName: '', userId, senderName, originalMessage: messageContent },
          message: 'Mensaje procesado correctamente'
        };
      }
      await userContext.setWizardState({ tipo: 'prospecto', paso: 1, datos: {} });
      toggleTyping(webhookData.token, webhookData.account_id, webhookData.conversation_id, 'off');
      return {
        success: true,
        data: { conversationId, response: '¿Cuál es el nombre de la organización?', fileName: '', userId, senderName, originalMessage: messageContent },
        message: 'Mensaje procesado correctamente'
      };
    }

    // FASE 3: getMessages (necesita contextStr de FASE 2)
    _tStep = Date.now();
    const conversationHistory = await getMessages(webhookData.token, webhookData.account_id, webhookData.conversation_id, contextStr);
    console.log(`⏱️ [3] FASE 3 (getMessages): ${Date.now() - _tStep}ms`);

    // Si el mensaje es un audio transcrito, agregarlo al historial
    // (el audio aparece sin contenido en Chatwoot y getMessages lo salta)
    if (audioAdjunto && messageContent) {
      conversationHistory.push({ role: 'user', content: messageContent });
    }

    // ============================================================
    // RESTAURAR CARRITO DESDE HISTORIAL SI REDIS EXPIRÓ
    // ============================================================
    const carritoActual = await userContext.getCarrito();
    if (carritoActual === null) {
      // Solo restaurar desde el mensaje más reciente del asistente.
      // Si el último mensaje no tiene "Carrito activo:" significa que fue
      // intencionalmente limpiado (pedido confirmado, reinicio, etc.) — no restaurar.
      const lastAssistantMsg = [...conversationHistory].reverse().find(m => m.role === 'assistant' && m.content);
      if (lastAssistantMsg) {
        const match = lastAssistantMsg.content.match(/Carrito activo:\s*(\d+)(?:\s*\|\s*Folio:\s*(\S+))?/);
        if (match) {
          console.log('🔄 Restaurando carrito desde historial (último mensaje):', match[1], match[2] || 'sin folio');
          await userContext.setCarrito(match[1], match[2] || null);
          const contextStrActualizado = await userContext.toSystemContext();
          for (let j = 0; j < conversationHistory.length; j++) {
            if (conversationHistory[j].role === 'system') {
              conversationHistory[j].content = contextStrActualizado;
              break;
            }
          }
        }
      }
    }

    // ============================================================
    // COMANDOS DE CONSULTA (prefijo '?') - antes del clasificador
    // Usan cliente_id/celular ya seteados por buscarcliente2
    // ============================================================
    if (messageContent && messageContent.trim().startsWith('?')) {
      const resultadoQuery = await ejecutarQueryComando(messageContent);
      if (resultadoQuery !== null) {
        let respuestaQuery;
        if (!resultadoQuery.success) {
          respuestaQuery = resultadoQuery.error;
        } else {
          const gptFormat = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'Eres un asistente de ventas. Formatea el siguiente resultado de la API de forma natural y concisa para el usuario. Sin markdown ni símbolos especiales.'
              },
              {
                role: 'user',
                content: `Comando: ${resultadoQuery.cmd}\nResultado: ${JSON.stringify(resultadoQuery.data)}`
              }
            ],
            temperature: 0.3,
            max_tokens: 500
          });
          respuestaQuery = gptFormat.choices[0].message.content;
        }
        conversationHistory.push({ role: 'assistant', content: respuestaQuery });
        return {
          success: true,
          data: { conversationId, response: respuestaQuery, fileName: '', userId, senderName, originalMessage: messageContent },
          message: 'Mensaje procesado correctamente'
        };
      }
    }

    // ============================================================
    // EXCEL / CSV CON LISTA DE COMPRAS - antes del clasificador
    // ============================================================
    if (excelAdjunto) {
      console.log('📊 Excel adjunto detectado, procesando lista de compras...');
      try {
        const fileUrl = excelAdjunto.data_url || excelAdjunto.file_url;
        const items = await extraerListaDeExcel(fileUrl);

        if (!items || items.length === 0) {
          const respuestaExcel = 'No pude identificar productos en el archivo. Verifica que tenga columnas con encabezados: clave, nombre y/o cantidad.';
          conversationHistory.push({ role: 'assistant', content: respuestaExcel });
          return {
            success: true,
            data: { conversationId, response: respuestaExcel, fileName: '', userId, senderName, originalMessage: messageContent || '' },
            message: 'Mensaje procesado correctamente'
          };
        }

        console.log('📋 Items extraídos de Excel:', items.length);
        const { encontrados, noEncontrados } = await buscarItemsLista(items);

        const pideCarrito = mensajePideCarrito(messageContent);
        let resultadoCarrito = null;

        if (pideCarrito && encontrados.length > 0) {
          const carritoIdActual = await userContext.getCarrito();
          resultadoCarrito = await agregarEncontradosAlCarrito(encontrados, carritoIdActual);
          if (resultadoCarrito && resultadoCarrito.success) {
            const nuevoCarritoId = resultadoCarrito.carritoId || carritoIdActual;
            if (!carritoIdActual) {
              await userContext.setCarrito(nuevoCarritoId, resultadoCarrito.folio || null);
            }
            if (noEncontrados.length > 0) {
              await userContext.setWizardState({ tipo: 'imagen_notas', noEncontrados, carritoId: nuevoCarritoId });
            }
          }
        }

        if (!pideCarrito && encontrados.length > 0) {
          await userContext.setWizardState({ tipo: 'imagen_carrito', encontrados, noEncontrados });
        }

        let respuestaExcel = formatearRespuestaImagen(encontrados, noEncontrados, resultadoCarrito, pideCarrito);
        respuestaExcel = await appendCarritoFooter(respuestaExcel, userContext);
        conversationHistory.push({ role: 'assistant', content: respuestaExcel });
        return {
          success: true,
          data: { conversationId, response: respuestaExcel, fileName: '', userId, senderName, originalMessage: messageContent || '' },
          message: 'Mensaje procesado correctamente'
        };
      } catch (errorExcel) {
        console.error('❌ Error procesando Excel:', errorExcel.message);
        const respuestaError = 'Ocurrió un error al procesar el archivo. Por favor intenta de nuevo.';
        return {
          success: true,
          data: { conversationId, response: respuestaError, fileName: '', userId, senderName, originalMessage: messageContent || '' },
          message: 'Mensaje procesado correctamente'
        };
      }
    }

    // ============================================================
    // IMAGEN CON LISTA DE COMPRAS - antes del clasificador
    // ============================================================
    if (imagenAdjunta) {
      console.log('🖼️  Imagen adjunta detectada, procesando lista de compras...');
      try {
        const imageUrl = imagenAdjunta.data_url;
        const items = await extraerListaDeImagen(imageUrl, openai);

        if (!items || items.length === 0) {
          const respuestaOcr = 'No pude identificar productos en la imagen. ¿Podrías enviar una imagen más clara o escribir los productos directamente?';
          conversationHistory.push({ role: 'assistant', content: respuestaOcr });
          return {
            success: true,
            data: { conversationId, response: respuestaOcr, fileName: '', userId, senderName, originalMessage: messageContent || '' },
            message: 'Mensaje procesado correctamente'
          };
        }

        console.log('📋 Items extraídos de imagen:', items.length);
        const { encontrados, noEncontrados } = await buscarItemsLista(items);

        const pideCarrito = mensajePideCarrito(messageContent);
        let resultadoCarrito = null;

        if (pideCarrito && encontrados.length > 0) {
          const carritoIdActual = await userContext.getCarrito();
          resultadoCarrito = await agregarEncontradosAlCarrito(encontrados, carritoIdActual);
          if (resultadoCarrito && resultadoCarrito.success) {
            const nuevoCarritoId = resultadoCarrito.carritoId || carritoIdActual;
            if (!carritoIdActual) {
              await userContext.setCarrito(nuevoCarritoId, resultadoCarrito.folio || null);
            }
            if (noEncontrados.length > 0) {
              await userContext.setWizardState({
                tipo: 'imagen_notas',
                noEncontrados,
                carritoId: nuevoCarritoId
              });
            }
          }
        }

        if (!pideCarrito && encontrados.length > 0) {
          await userContext.setWizardState({ tipo: 'imagen_carrito', encontrados, noEncontrados });
        }

        let respuestaImagen = formatearRespuestaImagen(encontrados, noEncontrados, resultadoCarrito, pideCarrito);
        respuestaImagen = await appendCarritoFooter(respuestaImagen, userContext);
        conversationHistory.push({ role: 'assistant', content: respuestaImagen });
        return {
          success: true,
          data: { conversationId, response: respuestaImagen, fileName: '', userId, senderName, originalMessage: messageContent || '' },
          message: 'Mensaje procesado correctamente'
        };
      } catch (errorImagen) {
        console.error('❌ Error procesando imagen:', errorImagen.message);
        const respuestaError = 'Ocurrió un error al procesar la imagen. Por favor intenta de nuevo.';
        return {
          success: true,
          data: { conversationId, response: respuestaError, fileName: '', userId, senderName, originalMessage: messageContent || '' },
          message: 'Mensaje procesado correctamente'
        };
      }
    }

    // ============================================================
    // V25.0 - FASE 1: CLASIFICACIÓN DE INTENCIÓN
    // ============================================================

    let promptAUsar = systemPromptWithContext;
    let toolsAUsar = functionDefinitions;
    let clasificacion = null;
    let usarFallback = true;

    // ============================================================
    // MODO_REFACCIONES - prioridad sobre el clasificador V25.0
    // Mientras la sesión esté activa, no se mezcla con MOTOR_GENERAL
    // ============================================================
    const modoRefaccionesActivo = await userContext.getModoRefacciones();

    if (modoRefaccionesActivo) {
      console.log('🔧 MODO_REFACCIONES activo - usando prompt especializado');
      promptAUsar = buildRefaccionesPrompt();
      toolsAUsar = [...functionDefinitions, TOOL_BUSCAR_NUMERO_PARTE_EXTERNO];
      usarFallback = false;
    } else if (USAR_MULTI_PROMPT) {
      console.log('\n' + '='.repeat(60));
      console.log('🎯 V25.0 - SISTEMA MULTI-PROMPT ACTIVO');
      console.log('='.repeat(60));

      try {
        // Preparar contexto para el clasificador (1 hgetall en vez de 5 hget)
        const contextoClasificador = {
          ...await userContext.getClasificadorContext(),
          historial: conversationHistory.slice(-4) // Últimos 4 mensajes
        };

        // PASO 0: Pre-clasificación rápida por keywords (sin API call)
        clasificacion = preClasificarPorKeywords(messageContent, contextoClasificador);

        if (clasificacion) {
          console.log('⚡ FAST PATH: Pre-clasificación por keywords:', clasificacion.accion);
        } else {
          // PASO 1: Clasificar intención con gpt-4o-mini (solo si no hubo match por keywords)
          clasificacion = await clasificarIntencion(
            messageContent,
            contextoClasificador,
            OPENAI_APIKEY[0].settings.api_key
          );
        }

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
          nombre: await userContext.getNombre(),
          clienteVendedor: await userContext.getClienteVendedor()
        });

        if (!ruteo.usarFallback && ruteo.prompt) {
          promptAUsar = ruteo.prompt;
          toolsAUsar = filtrarTools(ruteo.tools, functionDefinitions);
          usarFallback = false;

          // Guardar ultima_accion cuando se clasifica como ORDEN (antes de que GPT pida confirmación)
          if (clasificacion.accion === 'ORDEN') {
            await userContext.setUltimaAccion('ORDEN');
          }

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
    console.log(`⏱️ [4] Clasificador: ${Date.now() - _tStep}ms`);

    // ============================================================
    // EJECUCIÓN DIRECTA PARA REINICIAR (sin GPT - ahorra tokens)
    // ============================================================
    if (clasificacion && clasificacion.accion === 'REINICIAR') {
      console.log('🔄 Ejecutando REINICIAR directamente (sin GPT)');
      await userContext.reset();

      const mensajeReinicio = 'Claro, a partir de este momento inicia una conversación nueva';

      // Agregar al historial
      conversationHistory.push({
        role: "assistant",
        content: mensajeReinicio
      });

      return {
        success: true,
        data: {
          conversationId,
          response: mensajeReinicio,
          fileName: "",
          userId: userId,
          senderName,
          originalMessage: messageContent,
          clasificacion: {
            accion: 'REINICIAR',
            sub_accion: null,
            usarFallback: false
          }
        },
        message: "Mensaje procesado correctamente"
      };
    }

    // ============================================================
    // EJECUCIÓN DIRECTA PARA SALUDO (sin GPT-4o - ahorra 3-5s)
    // ============================================================
    if (clasificacion && clasificacion.accion === 'SALUDO') {
      console.log('⚡ Ejecutando SALUDO directamente (sin GPT)');

      const hora = new Date().getHours();
      let saludoHora = 'Buen dia';
      if (hora >= 6 && hora < 12) saludoHora = 'Buenos dias';
      else if (hora >= 12 && hora < 19) saludoHora = 'Buenas tardes';
      else saludoHora = 'Buenas noches';

      const nombreCliente = await userContext.getNombre();
      let mensajeSaludo;

      if (clasificacion.sub_accion === 'despedida') {
        mensajeSaludo = nombreCliente
          ? `Hasta pronto, ${nombreCliente}! Fue un placer atenderte.`
          : 'Hasta pronto! Fue un placer atenderte.';
      } else if (messageContent && messageContent.toLowerCase().includes('gracias')) {
        mensajeSaludo = 'Con gusto! Si necesitas algo mas, aqui estare.';
      } else {
        if (senderName && nombreCliente) {
          mensajeSaludo = `${saludoHora} ${senderName}, tu organizacion es ${nombreCliente}! En que puedo ayudarte hoy?`;
        } else if (senderName) {
          mensajeSaludo = `${saludoHora} ${senderName}! En que puedo ayudarte hoy?`;
        } else if (nombreCliente) {
          mensajeSaludo = `${saludoHora}, ${nombreCliente}! En que puedo ayudarte hoy?`;
        } else {
          mensajeSaludo = `${saludoHora}! Soy tu asesor comercial. En que puedo ayudarte?`;
        }
      }

      conversationHistory.push({ role: "assistant", content: mensajeSaludo });

      return {
        success: true,
        data: {
          conversationId,
          response: mensajeSaludo,
          fileName: "",
          userId: userId,
          senderName,
          originalMessage: messageContent,
          clasificacion: { accion: 'SALUDO', sub_accion: clasificacion.sub_accion, usarFallback: false }
        },
        message: "Mensaje procesado correctamente"
      };
    }

    // ============================================================
    // TOOL-CALLING LOOP - IMPLEMENTACIÓN CORRECTA
    // ============================================================

    const MAX_ITERATIONS = 10; // Límite de seguridad
    let iteration = 0;
    let continueLoop = true;
    let isGetPDF = false;
    let pdfData = null;

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
      _tStep = Date.now();
      const response = await openai.chat.completions.create({
        model: "gpt-4o",  // ✅ MISMO MODELO EN TODAS LAS RONDAS
        messages: input,
        tools: toolsAUsar,  // V25.0: Tools filtradas o todas
        tool_choice: "auto",
        temperature: 0.3
      });
      console.log(`⏱️ [5.${iteration}] GPT-4o (iteración ${iteration}): ${Date.now() - _tStep}ms`);

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
            _tStep = Date.now();
            const functionResult = await executeFunctionCall(
              name,
              functionArgs,
              userId,
              webhookData.account_id
            );
            console.log(`⏱️ [6.${iteration}] Tool "${name}": ${Date.now() - _tStep}ms`);
            
            // Manejo especial para generar_pdf: guardar datos del PDF
            if (name === 'generar_pdf' && functionResult.success && functionResult.data) {
              isGetPDF = true;
              pdfData = functionResult.data;
            }

            // ✅ AGREGAR RESULTADO AL HISTORIAL
            conversationHistory.push({
              role: "tool",
              tool_call_id: id,
              content: JSON.stringify(functionResult)
            });

            // Solo abortar ante errores JS reales (null/undefined/Error), no ante errores de negocio
            if (!functionResult || functionResult instanceof Error) {
              const errorMsg = functionResult.message || 'Ocurrió un error al procesar la solicitud.';
              console.error(`  ❌ Tool ${name} devolvió error:`, errorMsg);
              conversationHistory.push({ role: 'assistant', content: errorMsg });
              return {
                success: true,
                data: { conversationId, response: errorMsg, fileName: '', userId, senderName, originalMessage: messageContent },
                message: 'Mensaje procesado correctamente'
              };
            }

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
        console.log(`⏱️ [TOTAL] Procesamiento completo: ${Date.now() - _t0}ms`);

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
            response: isGetPDF ? pdfData.content : finalResponse,
            fileName: isGetPDF ? pdfData.name : "",
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
    toggleTyping(webhookData.token, webhookData.account_id, webhookData.conversation_id, 'off');
    sendMessage(webhookData.token, webhookData.account_id, webhookData.conversation_id, error.message);
    return {
      success: false,
      error: "Disculpa, tuve un problema técnico procesando tu mensaje.",
      details: error.message
    };
  }
  }); // fin runWithCrmContext
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
    const cacheKey = `hooks_crm_${account_id}`;
    const cached = getCached(cacheKey);
    if (cached) {
      console.log('⚡ getHooksCrm: usando cache');
      return cached;
    }

    let url = `${urlWA}api/v1/accounts/${account_id}/integrations/apps/daiko`;
    let config = {
      method: "get",
      url,
      headers: { api_access_token: token },
    };
    let data = (await getApiData(config)).data;
    setCache(cacheKey, data.hooks);
    return data.hooks;
}

const getOPENAI_APIKEY = async (token, account_id) => {
  const cacheKey = `openai_key_${account_id}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('⚡ getOPENAI_APIKEY: usando cache');
    return cached;
  }

  let url = `${urlWA}api/v1/accounts/${account_id}/integrations/apps/openai`;
  let config = {
    method: "get",
    url,
    headers: { api_access_token: token },
  };
  let data = (await getApiData(config)).data;
  setCache(cacheKey, data.hooks);
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
      if (item.content && item.content.includes(fuenteWeb)) { addMessage = false; }
    }
    if (idx == data.payload.length - 1) {
      messages.push({ role: 'system', content: contextStr });
    }
    if (!item.content) { continue; }
    if (addMessage || true) {
      messages.push({
        role: (item.message_type != 0 ? 'assistant' : 'user'),
        content: item.content
      });
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
    if (message.role != 'user' && (message.content.includes('conversación nueva') || message.content.includes('conversacion nueva') || message.content.includes('nueva conversación') || message.content.includes('nueva conversacion'))) {
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