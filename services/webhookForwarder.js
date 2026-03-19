const axios = require('axios');

async function forward(url, payload) {
  try {
    const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    return { status: 'SUCCESS', responseCode: response.status };
  } catch (error) {
    return {
      status: 'FAILED',
      responseCode: error.response?.status || 0,
    };
  }
}

module.exports = { forward };
