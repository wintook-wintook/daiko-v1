// daiko/server.js

// package.json dependencies needed:
// npm install express openai cors dotenv uuid

const express = require ('express');
const cors = require ('cors');
const dotenv = require ('dotenv');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.use(require('./src/routes/webhook.js'));

// ===== SERVIDOR =====
const PORT = process.env.PORT || 3030;

app.listen(PORT, () => {
  console.log(`
🚀 Bot Vendedor ALEX ejecutándose en puerto ${PORT}

📋 Endpoints disponibles:
- POST /chat - Conversación principal
- POST /webhook/chatwoot - Webhook de Chatwoot
- GET /webhook/status - Status del webhook
- POST /webhook/test - Test del webhook

- POST /webhook/telegram
- POST /telegram/setup-webhook
- GET /telegram/bot-info
- POST /telegram/send-message
- POST /telegram/test
- GET /telegram/status

- GET /cart/:userId - Ver carrito
- GET /orders/:orderId - Consultar orden
- DELETE /conversations/:userId - Reiniciar conversación

🔧 Para probar:
curl -X POST http://localhost:${PORT}/chat \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hola, busco una laptop para trabajo", "userId": "test123"}'
  `);
});

// export default app;