const axios = require('axios');
const maxRetries = 5
let delay = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}
let getApiData = async (config, retryCount = 1) => {
  try {
    let response = await axios(config);
    if (retryCount < 1) {
    }
    console.log({ fn: 'getApiData', url: config.url, data: config.data, response: response.data || response });
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