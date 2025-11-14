const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require("crypto");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3005;

// Define allowed origins
const allowedOrigins = [
  'https://hco-config-payment-page-front-end.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001'
];

// CRITICAL: Set up CORS BEFORE any routes
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Handle preflight OPTIONS requests explicitly
app.options('*', cors());

app.use(express.json());

// Add dynamic headers to all responses
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

app.post('/', async (req, res) => {
  try {
    console.log('Received request body:', req.body);
    
    // Extract authentication credentials first
    const {
      merchantId = process.env.MERCHANT_ID,
      username = process.env.MASTERCARD_USERNAME,
      password = process.env.MASTERCARD_PASSWORD,
      apiBaseUrl = process.env.MASTERCARD_API_BASE_URL || "https://mtf.gateway.mastercard.com",
      apiVersion = process.env.API_VERSION || "73"
    } = req.body;

    // Validate required fields
    if (!merchantId || !username || !password) {
      return res.status(400).json({
        error: 'Missing required credentials',
        details: {
          merchantId: !merchantId ? 'Missing' : 'Present',
          username: !username ? 'Missing' : 'Present',
          password: !password ? 'Missing' : 'Present'
        }
      });
    }

    let postData;
    let orderid;
    
    // Check if this is advanced JSON mode
    if (req.body.apiOperation && req.body.order && req.body.interaction) {
      // Advanced JSON Mode - use the payload as provided
      console.log('Advanced JSON Mode detected');
      
      postData = {
        apiOperation: req.body.apiOperation,
        checkoutMode: req.body.checkoutMode,
        interaction: req.body.interaction,
        order: req.body.order
      };
      
      orderid = req.body.order.id;
      
      console.log('Advanced mode payload:', JSON.stringify(postData, null, 2));
      
    } else {
      // Simple Mode - construct payload from individual fields
      console.log('Simple Mode detected');
      
      const trxid = crypto.randomBytes(8).toString("hex");
      orderid = req.body.orderId || crypto.randomBytes(8).toString("hex");
      
      const {
        merchantName = process.env.MERCHANT_NAME || "JK Enterprises LLC",
        merchantUrl = process.env.MERCHANT_URL || "https://microsoft.com/",
        currency = process.env.CURRENCY || "USD",
        amount = process.env.DEFAULT_AMOUNT || "99.00",
        description = process.env.ORDER_DESCRIPTION || "Goods and Services",
        returnUrl = process.env.RETURN_URL || "https://hco-config-payment-page-front-end.vercel.app/ReceiptPage"
      } = req.body;

      console.log('Using simple mode configuration:', {
        merchantId: merchantId,
        merchantName: merchantName,
        merchantUrl: merchantUrl,
        currency: currency,
        amount: amount,
        description: description,
        returnUrl: returnUrl,
        apiBaseUrl: apiBaseUrl,
        apiVersion: apiVersion,
        orderId: orderid
      });
      
      // Create the payment session request body for simple mode
      postData = {
        "apiOperation": "INITIATE_CHECKOUT",
        "checkoutMode": "WEBSITE",
        "interaction": {
          "operation": "PURCHASE",
          "displayControl": {
            "billingAddress": "HIDE"
          },
          "merchant": { 
            "name": merchantName,
            "url": merchantUrl
          },
          "returnUrl": returnUrl
        },
        "order": {
          "currency": currency,
          "amount": amount,
          "id": orderid,
          "description": description
        }
      };
      
      console.log('Simple mode payload:', JSON.stringify(postData, null, 2));
    }

    // Create the Basic Auth token from username and password
    const authToken = Buffer.from(`${username}:${password}`).toString('base64');
    
    const axiosConfig = {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Authorization': `Basic ${authToken}`,
        "Accept": "application/json"
      },
      timeout: 30000
    };

    // Construct the API URL
    const apiUrl = `${apiBaseUrl}/api/rest/version/${apiVersion}/merchant/${merchantId}/session`;
    console.log('Making request to:', apiUrl);
    
    const response = await axios.post(apiUrl, postData, axiosConfig);
    
    console.log("RESPONSE RECEIVED Create: ", response.data.session.id);
    console.log("Full response:", JSON.stringify(response.data, null, 2));
    
    const sessionId = response.data.session.id;
    
    // Extract amount for response (FIX DEFECT 2)
    const amount = postData.order?.amount || '99.00';

    // Return proper JSON response
    res.json({ 
      sessionId: sessionId,
      orderId: orderid,
      amount: amount,
      status: 'success',
      mode: req.body.apiOperation ? 'advanced' : 'simple'
    });

  } catch (error) {
    console.error("Error details:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Headers:", error.response.headers);
      console.error("Data:", error.response.data);
      res.status(error.response.status).json({ 
        error: "API Error", 
        details: error.response.data,
        status: error.response.status
      });
    } else if (error.request) {
      console.error("Request:", error.request);
      res.status(500).json({ 
        error: "Network Error", 
        details: "No response received from Mastercard API"
      });
    } else {
      console.error("Error:", error.message);
      res.status(500).json({ 
        error: "Request Error", 
        details: error.message
      });
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: port,
    cors: 'enabled',
    allowedOrigins: allowedOrigins
  });
});

// Test endpoint to verify configuration
app.post('/test-config', (req, res) => {
  const {
    merchantId,
    username,
    password,
    apiBaseUrl,
    apiVersion
  } = req.body;

  res.json({
    message: 'Configuration received successfully',
    config: {
      merchantId: merchantId ? '✓ Provided' : '✗ Missing',
      username: username ? '✓ Provided' : '✗ Missing',
      password: password ? '✓ Provided (hidden)' : '✗ Missing',
      apiBaseUrl: apiBaseUrl || 'Using default',
      apiVersion: apiVersion || 'Using default'
    },
    constructedApiUrl: `${apiBaseUrl || 'https://mtf.gateway.mastercard.com'}/api/rest/version/${apiVersion || '73'}/merchant/${merchantId || 'MERCHANT_ID'}/session`,
    cors: 'Headers added to response'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    details: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    details: `Route ${req.method} ${req.path} not found`
  });
});

app.listen(port, () => {
  console.log(`🚀 Mastercard Checkout API Server running at http://localhost:${port}`);
  console.log(`📋 Health check available at http://localhost:${port}/health`);
  console.log(`🧪 Test config endpoint at http://localhost:${port}/test-config`);
  console.log('');
  console.log('CORS Configuration:');
  console.log('- Allowed Origins:', allowedOrigins.join(', '));
  console.log('- Methods: GET, POST, PUT, DELETE, OPTIONS');
  console.log('- Headers: Content-Type, Authorization, X-Requested-With');
  console.log('- Credentials: true');
});
