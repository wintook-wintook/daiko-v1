// daiko/src/handlers/chatHandler.js

// handlers/chatHandler.js
const OpenAI = require('openai');
const { functionDefinitions, executeFunctionCall } = require('../openai');
const { systemPrompt, openaiConfig } = require('../openai_prompt');
const UserContext = require('../utils/userContext');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function handleChat(userId, userMessage, conversationHistory = []) {
  try {
    // 1. Obtener contexto del usuario desde Redis
    const userContext = new UserContext(userId);
    const contextStr = await userContext.toSystemContext();
    
    // 2. Inyectar contexto en el system prompt
    const systemPromptWithContext = systemPrompt + contextStr;
    
    // 3. Llamar a OpenAI
    const response = await openai.chat.completions.create({
      model: openaiConfig.model,
      temperature: openaiConfig.temperature,
      messages: [
        { role: "system", content: systemPromptWithContext },
        ...conversationHistory,
        { role: "user", content: userMessage }
      ],
      tools: functionDefinitions,
      tool_choice: "auto"
    });

    const assistantMessage = response.choices[0].message;

    // 4. Si hay function calls, ejecutarlas
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      const toolCall = assistantMessage.tool_calls[0];
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);
      
      console.log(`📞 Function call: ${functionName}`, functionArgs);
      
      // Ejecutar función con userId para acceder a Redis
      const functionResult = await executeFunctionCall(functionName, functionArgs, userId);
      
      // Extender TTL del contexto (mantener sesión activa)
      await userContext.keepAlive();
      
      // 5. Segunda llamada a OpenAI con el resultado
      const secondResponse = await openai.chat.completions.create({
        model: openaiConfig.model,
        temperature: openaiConfig.temperature,
        messages: [
          { role: "system", content: systemPromptWithContext },
          ...conversationHistory,
          { role: "user", content: userMessage },
          assistantMessage,
          {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(functionResult)
          }
        ]
      });

      return {
        response: secondResponse.choices[0].message.content,
        functionCalled: functionName,
        functionResult: functionResult
      };
    }

    // 6. Si no hay function call, responder directamente
    await userContext.keepAlive();
    
    return {
      response: assistantMessage.content,
      functionCalled: null,
      functionResult: null
    };

  } catch (error) {
    console.error('❌ Error en handleChat:', error);
    throw error;
  }
}

module.exports = { handleChat };
/*
## 📊 **Estructura de Datos en Redis**

Redis Key: user:12345:context
├── nombre_usuario: "Carlos"
├── carrito_id: "cart_abc123"
├── ultima_categoria: "laptops"
├── preferencias: ["laptops", "accesorios", "monitores"]
├── created_at: "2025-01-15T10:30:00Z"
└── updated_at: "2025-01-15T11:45:00Z"

TTL: 86400 segundos (24 horas)
*/