// daiko/src/utils/functions.js

const axios = require('axios');
const maxRetries = 5
let delay = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}
let getApiData = async (config, retryCount = 1) => {
  try {
    if (!config.timeout) {
      config.timeout = 10000; // 10 segundos default
    }
    let response = await axios(config);
    if (retryCount < 1) {
    }
    if (config.url.includes('/api/Daiko/')) {
      console.log({ fn: 'getApiData', config, url: config.url, data: config.data, response: response.data || response });
    }
    return response;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      if (retryCount < maxRetries) {
        await delay(500);
        return getApiData(config, retryCount + 1); // Reintento recursivo
      } else {
        throw new Error(`Error: Se alcanzó el número máximo de intentos (${maxRetries}). Código 401 Unauthorized.`);
      }
    } else {
      throw new Error(error.message);
    }
  }
};

module.exports = {
  getApiData,
};