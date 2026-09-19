const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const webhookStore = require('../services/webhookStore');

const router = express.Router();

// Passwords live server-side only; the frontend's merchant profiles carry just
// the merchant id. Each merchant's password is read from
// GATEWAY_PASSWORD_<MERCHANT ID> (e.g. GATEWAY_PASSWORD_GJMIDTESTING), and the
// default merchant also falls back to API_PASSWORD.
function serverPasswordFor(merchantId) {
  const perMerchant = process.env[`GATEWAY_PASSWORD_${String(merchantId || '').toUpperCase()}`];
  const fallback = merchantId === config.merchantId ? config.apiPassword : '';
  return perMerchant || fallback || undefined;
}

// Contact details the hosted page shows as a merchant footer, and sample payer
// data for the read-only customer, billing and shipping boxes. Plain ASCII
// only: the hosted UI mis-renders some non-ASCII characters.
const MERCHANT_CONTACT = {
  email: 'support@example.com',
  phone: '+1 555 010 0199',
  address: { line1: '100 Example Street', line2: 'Suite 400', line3: 'St Louis, MO 63102', line4: 'United States' },
};
const SAMPLE_CUSTOMER = { firstName: 'Sample', lastName: 'Payer', email: 'sample.payer@example.com', mobilePhone: '+1 5557891238' };
const SAMPLE_ADDRESS = {
  street: '11 N 4th St', street2: 'Apt 2B', city: 'St Louis', stateProvince: 'MO', postcodeZip: '63102', country: 'USA',
};

router.post('/', async (req, res) => {
  try {
    // The request body is not logged: it can carry a typed-in password.

    // Empty strings count as missing. A password typed into the Custom profile
    // wins; otherwise the server supplies the one for that merchant.
    const given = (v) => (typeof v === 'string' ? v.trim() : v) || undefined;
    const merchantId = given(req.body.merchantId) || config.merchantId;
    const username = given(req.body.username) || config.apiUsername;
    const password = given(req.body.password) || serverPasswordFor(merchantId);
    const apiBaseUrl = given(req.body.apiBaseUrl) || config.gatewayUrl;
    const apiVersion = given(req.body.apiVersion) || config.apiVersion;

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
      // The payer objects render as the shipping, customer and billing boxes.
      // They were previously dropped here without any error.
      for (const key of ['customer', 'billing', 'shipping']) {
        if (req.body[key]) postData[key] = req.body[key];
      }
      orderid = req.body.order.id;
    } else {
      // Simple mode
      console.log('Simple Mode detected');
      orderid = req.body.orderId || crypto.randomBytes(8).toString('hex');

      const {
        merchantName = 'GJ Enterprises LLC',
        merchantUrl = 'https://www.example.com',
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
          displayControl: { billingAddress: 'READ_ONLY', customerEmail: 'READ_ONLY', shipping: 'READ_ONLY' },
          merchant: { ...MERCHANT_CONTACT, name: merchantName, url: merchantUrl },
          locale: 'en_US',
          returnUrl: effectiveReturnUrl,
        },
        order: {
          currency,
          amount,
          id: orderid,
          description: `Order ${orderid} - ${description}`,
          itemAmount: amount,
          taxAmount: '0.00',
          item: [{ name: description, quantity: 1, unitPrice: amount }],
        },
        customer: SAMPLE_CUSTOMER,
        billing: { address: SAMPLE_ADDRESS },
        shipping: { contact: { firstName: SAMPLE_CUSTOMER.firstName, lastName: SAMPLE_CUSTOMER.lastName }, address: SAMPLE_ADDRESS },
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
      // Lets the page draw an order summary in embedded mode, where Mastercard
      // renders only the payment form.
      order: postData.order,
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
