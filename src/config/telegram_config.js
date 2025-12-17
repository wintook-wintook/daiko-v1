// daiko/src/config/telegram_config.js

require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;


module.exports = {
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_API_URL
  };