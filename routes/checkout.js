const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const webhookStore = require('../services/webhookStore');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    console.log('Received checkout request:', JSON.stringify(req.body, null, 2));

    // Extract credentials from request body (with env var fallbacks)
    const merchantId = req.body.merchantId || config.merchantId;
    const username = req.body.username || config.apiUsername;
    const password = req.body.password || config.apiPassword;
    const apiBaseUrl = req.body.apiBaseUrl || config.gatewayUrl;
    const apiVersion = req.body.apiVersion || config.apiVersion;

    if (!merchantId || !username || !password) {
      return res.status(400).json({
        error: 'Missing required credentials',
        details: {
          merchantId: !merchantId ? 'Missing' : 'Present',
          username: !username ? 'Missing' : 'Present',
          password: !password ? 'Missing' : 'Present',
        },
      });
    }

    let postData;
    let orderid;

    // Check if advanced JSON mode
    if (req.body.apiOperation && req.body.order && req.body.interaction) {
      console.log('Advanced JSON Mode detected');
      postData = {
        apiOperation: req.body.apiOperation,
        checkoutMode: req.body.checkoutMode,
        interaction: req.body.interaction,
        order: req.body.order,
      };
      orderid = req.body.order.id;
    } else {
      // Simple mode
      console.log('Simple Mode detected');
      orderid = req.body.orderId || crypto.randomBytes(8).toString('hex');

      const {
        merchantName = 'GJ Enterprises LLC',
        merchantUrl = 'https://microsoft.com/',
        currency = 'USD',
        amount,
        description = 'Goods and Services',
        returnUrl,
      } = req.body;

      if (!amount) {
        return res.status(400).json({
          error: 'Missing required field: amount',
          details: 'The cart total amount must be provided',
        });
      }

      const effectiveReturnUrl = returnUrl || `${req.headers.origin || 'http://localhost:5173'}/ReceiptPage`;

      postData = {
        apiOperation: 'INITIATE_CHECKOUT',
        checkoutMode: req.body.checkoutMode || 'WEBSITE',
        interaction: {
          operation: 'PURCHASE',
          displayControl: { billingAddress: 'HIDE' },
          merchant: { name: merchantName, url: merchantUrl },
          returnUrl: effectiveReturnUrl,
        },
        order: {
          currency,
          amount,
          id: orderid,
          description,
        },
      };
    }

    // Set webhook notificationUrl — single endpoint, orderId comes from payload body
    if (config.backendPublicUrl && config.backendPublicUrl.startsWith('https://')) {
      const notificationUrl = `${config.backendPublicUrl}/api/webhook`;
      postData.order.notificationUrl = notificationUrl;
      console.log('Webhook notificationUrl set:', notificationUrl);
    } else if (postData.order.notificationUrl && postData.order.notificationUrl.startsWith('https://')) {
      console.log('Webhook notificationUrl from frontend:', postData.order.notificationUrl);
    } else {
      // No valid HTTPS notificationUrl available — remove to prevent gateway rejection
      delete postData.order.notificationUrl;
      console.log('No HTTPS notificationUrl available — removed from payload.');
      console.log('Set BACKEND_PUBLIC_URL env var or add notificationUrl to your JSON config.');
    }

    // Store forwarding URL if provided
    if (req.body.webhookForwardUrl) {
      await webhookStore.setForwardUrl(orderid, req.body.webhookForwardUrl);
    }

    console.log('Final payload:', JSON.stringify(postData, null, 2));

    // Call Mastercard API
    const authToken = Buffer.from(`${username}:${password}`).toString('base64');
    const apiUrl = `${apiBaseUrl}/api/rest/version/${apiVersion}/merchant/${merchantId}/session`;

    console.log('Calling Mastercard API:', apiUrl);

    const response = await axios.post(apiUrl, postData, {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Authorization: `Basic ${authToken}`,
        Accept: 'application/json',
      },
      timeout: 30000,
    });

    const sessionId = response.data.session.id;
    console.log('Session created:', sessionId);

    res.json({
      sessionId,
      orderId: orderid,
      amount: postData.order.amount,
      status: 'success',
      mode: req.body.apiOperation ? 'advanced' : 'simple',
      notificationUrl: postData.order.notificationUrl,
    });
  } catch (error) {
    console.error('Checkout error:', error.message);
    if (error.response) {
      res.status(error.response.status).json({
        error: 'API Error',
        details: error.response.data,
        status: error.response.status,
      });
    } else if (error.request) {
      res.status(500).json({
        error: 'Network Error',
        details: 'No response received from Mastercard API',
      });
    } else {
      res.status(500).json({
        error: 'Request Error',
        details: error.message,
      });
    }
  }
});

module.exports = router;
