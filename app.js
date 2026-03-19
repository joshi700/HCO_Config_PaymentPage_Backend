const express = require('express');
const cors = require('cors');
const config = require('./config');
const errorHandler = require('./middleware/errorHandler');

const checkoutRoutes = require('./routes/checkout');
const webhookRoutes = require('./routes/webhook');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root route
app.get('/', (req, res) => {
  res.json({
    service: 'HCO Webhook Demo Backend',
    status: 'running',
    endpoints: {
      health: '/api/health',
      checkout: 'POST /api/checkout',
      webhook: 'POST /api/webhook',
      webhookEvents: '/api/webhooks/:orderId',
    },
  });
});

// Routes
app.use('/api/checkout', checkoutRoutes);
app.use('/api', webhookRoutes);

// Health check — support both /health and /api/health
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    port: config.port,
  });
});
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    port: config.port,
  });
});

// Error handler
app.use(errorHandler);

// Only listen when not running on Vercel (Vercel uses the exported app)
if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`HCO Webhook Demo Server running on http://localhost:${config.port}`);
    console.log(`Merchant ID: ${config.merchantId}`);
    console.log(`Gateway: ${config.gatewayUrl}`);
  });
}

// Export for Vercel serverless
module.exports = app;
