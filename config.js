require('dotenv').config({ path: '../.env' });

module.exports = {
  merchantId: process.env.MERCHANT_ID || 'TESTMIDtesting00',
  apiUsername: process.env.API_USERNAME || 'merchant.TESTMIDtesting00',
  apiPassword: process.env.API_PASSWORD || '9233298fcaa1c01f578759954343aca1',
  gatewayUrl: process.env.GATEWAY_URL || 'https://mtf.gateway.mastercard.com',
  apiVersion: process.env.API_VERSION || '100',
  port: process.env.PORT || 3001,

  backendPublicUrl: process.env.BACKEND_PUBLIC_URL || '',
  webhookTtlSeconds: parseInt(process.env.WEBHOOK_TTL_SECONDS || '1800', 10),

  get baseUrl() {
    return `${this.gatewayUrl}/api/rest/version/${this.apiVersion}/merchant/${this.merchantId}`;
  },

  get auth() {
    return {
      username: this.apiUsername,
      password: this.apiPassword,
    };
  },
};
