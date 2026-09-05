// daiko/src/routes/webhook.js

const express = require("express");
const app = express();

const { TELEGRAM_BOT_TOKEN, TELEGRAM_API_URL } = require("../config/telegram_config");
const {
  procesarMensajeTelegram,
  configurarWebhookTelegram,
  obtenerInfoBot,
  enviarMensajeTelegram,
} = require("../tools/telegram_tools");
// DEV0001 Integracion Whatsapp - 24 oct -Ini
//const { extraerDatosWebhook, procesarMensajeWebhook, enviarMensajeWebhook } = require('../tools/chatwoot');
const {
  extraerDatosWebhook,
  procesarMensajeWebhook,
  enviarMensajeWebhook,
  getHooksCrm,
} = require("../tools/chatwoot");
// DEV0001 Integracion Whatsapp - 24 oct -Fin
// ===== ENDPOINT WEBHOOK PARA TELEGRAM =====
app.post("/webhook/telegram", async (req, res) => {
  try {
    console.log(
      "📱 Webhook recibido de Telegram:",
      JSON.stringify(req.body, null, 2)
    );

    const update = req.body;
    console.log({ ln: 13 });
    // Validar que el update tenga contenido
    if (!update.message && !update.callback_query) {
      console.log({ ln: 16 });
      return res.json({
        success: true,
        message: "Update ignorado - no es mensaje ni callback_query",
      });
    }
    console.log({ ln: 22 });
    // Procesar el mensaje
    const result = await procesarMensajeTelegram(update);
    //console.log({result});
    // Telegram espera siempre un 200 OK
    res.json({
      success: true,
      message: "Update procesado",
      processed: result.success,
    });
  } catch (error) {
    console.error("❌ Error en endpoint webhook Telegram:", error);

    // Siempre devolver 200 OK a Telegram para evitar reintentos
    res.json({
      success: false,
      error: "Error interno procesando update",
      details: error.message,
    });
  }
});

// ===== ENDPOINT PARA CONFIGURAR WEBHOOK DE TELEGRAM =====
app.post("/telegram/setup-webhook", async (req, res) => {
  try {
    const { webhook_url } = req.body;

    if (!webhook_url) {
      return res.status(400).json({
        success: false,
        message: "webhook_url es requerido",
      });
    }

    const result = await configurarWebhookTelegram(webhook_url);

    res.json(result);
  } catch (error) {
    console.error("❌ Error configurando webhook:", error);
    res.status(500).json({
      success: false,
      error: "Error configurando webhook",
      details: error.message,
    });
  }
});

// ===== ENDPOINT PARA OBTENER INFO DEL BOT =====
app.get("/telegram/bot-info", async (req, res) => {
  try {
    const result = await obtenerInfoBot();
    res.json(result);
  } catch (error) {
    console.error("❌ Error obteniendo info del bot:", error);
    res.status(500).json({
      success: false,
      error: "Error obteniendo información del bot",
      details: error.message,
    });
  }
});

// ===== ENDPOINT PARA ENVIAR MENSAJE MANUAL =====
app.post("/telegram/send-message", async (req, res) => {
  try {
    const { chat_id, message, options } = req.body;

    if (!chat_id || !message) {
      return res.status(400).json({
        success: false,
        message: "chat_id y message son requeridos",
      });
    }

    const result = await enviarMensajeTelegram(chat_id, message, options);

    res.json(result);
  } catch (error) {
    console.error("❌ Error enviando mensaje:", error);
    res.status(500).json({
      success: false,
      error: "Error enviando mensaje",
      details: error.message,
    });
  }
});

// ===== ENDPOINT PARA TESTING DE TELEGRAM =====
app.post("/telegram/test", async (req, res) => {
  try {
    const testUpdate = {
      update_id: Math.floor(Math.random() * 1000000),
      message: {
        message_id: Math.floor(Math.random() * 1000),
        from: {
          id: 123456789,
          is_bot: false,
          first_name: "Test",
          username: "testuser",
          language_code: "es",
        },
        chat: {
          id: 123456789,
          first_name: "Test",
          username: "testuser",
          type: "private",
        },
        date: Math.floor(Date.now() / 1000),
        text: req.body.test_message || "Hola, busco una laptop",
      },
    };

    console.log("🧪 Testing Telegram con datos simulados");

    const result = await procesarMensajeTelegram(testUpdate);

    res.json({
      success: true,
      message: "Test de Telegram completado",
      test_data: testUpdate,
      result: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Error en test de Telegram",
      details: error.message,
    });
  }
});

// ===== ENDPOINT DE STATUS PARA TELEGRAM =====
app.get("/telegram/status", (req, res) => {
  res.json({
    success: true,
    message: "Telegram Bot endpoint activo",
    bot_token_configured:
      !!TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== "TU_BOT_TOKEN_AQUI",
    endpoints: {
      webhook: "/webhook/telegram - POST",
      setup_webhook: "/telegram/setup-webhook - POST",
      bot_info: "/telegram/bot-info - GET",
      send_message: "/telegram/send-message - POST",
      test: "/telegram/test - POST",
      status: "/telegram/status - GET",
    },
    conversations_active: conversations.size,
    timestamp: new Date().toISOString(),
  });
});

// ===== AQUÍ AGREGAR LOS NUEVOS ENDPOINTS DEL WEBHOOK =====
// ===== ENDPOINT WEBHOOK PARA CHATWOOT =====
app.post("/webhook/chatwoot", async (req, res) => {
  try {
    //console.log({token: req.query.token, account_id: req.body.account.id, conversation_id: req.body.conversation.id});
    const webhookData = req.body;
    webhookData.token = req.query.token;
    webhookData.instance_url = req.query.instance_url;
    const ahora = Date.now();
    const creadoEn = webhookData.created_at ? new Date(webhookData.created_at).getTime() : null;
    console.log(`[webhook] recibido${creadoEn ? ` | delay desde creación: ${ahora - creadoEn}ms` : ''}`);

    // Validar que el webhook tenga la estructura esperada
    if (!webhookData.event || !webhookData.conversation) {
      return res.status(400).json({
        success: false,
        message: "Formato de webhook inválido - falta event o conversation",
      });
    }

    // Solo procesar eventos de mensaje creado
    if (webhookData.event !== "message_created") {
      return res.json({
        success: true,
        message: `Evento ${webhookData.event} ignorado - solo procesamos message_created`,
      });
    }
    //DEV0001 Integracion Whatsapp - 24 oct -Ini
    console.log("Channel:", webhookData.conversation.channel);
    const hooks = await getHooksCrm(req.query.token, req.body.account.id, webhookData.instance_url);
    const inboxId = webhookData.conversation?.inbox_id;
    console.log("inbox_id:", inboxId);
    console.log("hooks", hooks);
    const hooksInboxIds = hooks
      .filter((hook) => hook.status === true && hook.inbox && hook.inbox.id)
      .map((hook) => hook.inbox.id);
    console.log("HOOKS --->");
    console.log(hooksInboxIds);

    const existe = hooksInboxIds.includes(inboxId);

    console.log(existe);
    if (!existe) {
      console.log("mensaje filtrado");
      return res.json({
        success: true,
        message: `Evento ignorado - solo procesamos bandeja de entrada integrados`,
      });
    }
    // Output: true (si existe) o false (si no existe)
    //if (!['Channel::Telegram'].includes(webhookData.conversation.channel)) {
    if (!["Channel::Telegram", "Channel::Whatsapp"].includes(webhookData.conversation.channel)) {
      //DEV0001 Integracion Whatsapp - 24 oct -Fin
      console.log("mensaje filtrado");
      return res.json({
        success: true,
        message: `Evento ${webhookData.event} ignorado - solo procesamos message_created`,
      });
    }

    // Procesar el mensaje
    Object.assign(webhookData, {
      token: req.query.token,
      account_id: req.body.account.id,
      conversation_id: req.body.conversation.id,
      _hooks: hooks,  // Pasar hooks pre-obtenidos para evitar HTTP redundante
    });
    const result = await procesarMensajeWebhook(webhookData);

    Object.assign(result, {
      token: req.query.token,
      account_id: req.body.account.id,
      conversation_id: req.body.conversation.id,
      instance_url: webhookData.instance_url,
    });
    // console.log({result});
    if (!result.success) {
      return res.status(500).json(result);
    }
    // console.log('📨 Webhook recibido de Chatwoot:', JSON.stringify(req.body, null, 2));

    // Aquí puedes agregar código para enviar la respuesta de vuelta a Chatwoot
    // usando su API si es necesario

    const result2 = await enviarMensajeWebhook(result);

    res.json({
      success: true,
      message: "Webhook procesado exitosamente",
      data: {
        conversationId: result.data.conversationId,
        response: result.data.response,
        processed: true,
      },
    });
  } catch (error) {
    console.error("❌ Error en endpoint webhook:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor procesando webhook",
      details: error.message,
    });
  }
});

// ===== ENDPOINT PARA VERIFICAR STATUS DEL WEBHOOK =====
app.get("/webhook/status", (req, res) => {
  res.json({
    success: true,
    message: "Webhook endpoint activo",
    endpoints: {
      webhook: "/webhook/chatwoot - POST",
      chat: "/chat - POST",
      status: "/webhook/status - GET",
    },
    conversations_active: conversations.size,
    timestamp: new Date().toISOString(),
  });
});

// ===== ENDPOINT PARA TESTING DEL WEBHOOK =====
app.post("/webhook/test", async (req, res) => {
  // Datos de ejemplo para testing
  const testWebhookData = {
    account: { id: 416, name: "IA" },
    additional_attributes: {},
    content: req.body.test_message || "Hola, quiero buscar una laptop",
    content_attributes: {},
    content_type: "text",
    conversation: {
      assignee_id: 681,
      contact_inbox: { source_id: "test-source-id" },
      id: 999999,
      inbox_id: 1045,
      status: "open",
    },
    created_at: new Date().toISOString(),
    id: Math.floor(Math.random() * 1000000),
    inbox: { id: 1045, name: "Test Inbox" },
    message_type: "incoming",
    sender: {
      id: 123456,
      identifier: null,
      name: "Test User",
      email: null,
    },
    event: "message_created",
  };

  console.log("🧪 Testing webhook con datos simulados");

  try {
    const result = await procesarMensajeWebhook(testWebhookData);

    res.json({
      success: true,
      message: "Test de webhook completado",
      test_data: testWebhookData,
      result: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Error en test de webhook",
      details: error.message,
    });
  }
});
// ===== FIN DE LOS NUEVOS ENDPOINTS DEL WEBHOOK =====

module.exports = app;
