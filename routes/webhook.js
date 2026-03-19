const express = require('express');
const { v4: uuidv4 } = require('uuid');
const webhookStore = require('../services/webhookStore');
const webhookForwarder = require('../services/webhookForwarder');

const router = express.Router();

// Receive webhook from Mastercard Gateway — single endpoint
router.post('/webhook', async (req, res) => {
  // Extract orderId from the webhook payload body
  const orderId = req.body.order?.id || req.body.orderId || 'UNKNOWN';
  console.log(`Webhook received for order ${orderId}:`, JSON.stringify(req.body, null, 2));

  const eventId = uuidv4();

  // Extract event type from payload
  let eventType = 'WEBHOOK_RECEIVED';
  if (req.body.transaction?.type) {
    eventType = req.body.transaction.type;
  } else if (req.body.result) {
    eventType = req.body.result;
  } else if (req.body.order?.status) {
    eventType = `ORDER_${req.body.order.status}`;
  }

  const webhookEvent = {
    id: eventId,
    orderId,
    type: eventType,
    payload: req.body,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
      'x-notification-secret': req.headers['x-notification-secret'] || null,
      'x-notification-id': req.headers['x-notification-id'] || null,
      'x-notification-attempt': req.headers['x-notification-attempt'] || null,
    },
    receivedAt: new Date().toISOString(),
  };

  try {
    await webhookStore.addEvent(orderId, webhookEvent);

    // Forward if configured
    const forwardUrl = await webhookStore.getForwardUrl(orderId);
    if (forwardUrl) {
      webhookEvent.forwardUrl = forwardUrl;
      const result = await webhookForwarder.forward(forwardUrl, req.body);
      webhookEvent.forwardStatus = result.status;
      webhookEvent.forwardResponseCode = result.responseCode;
      await webhookStore.updateEvent(orderId, eventId, {
        forwardUrl,
        forwardStatus: result.status,
        forwardResponseCode: result.responseCode,
      });
      console.log(`Webhook forwarded to ${forwardUrl}: ${result.status} ${result.responseCode}`);
    }
  } catch (err) {
    console.error('Error storing/forwarding webhook:', err.message);
  }

  // Always return 200 to acknowledge receipt
  res.status(200).json({ received: true, eventId });
});

// Poll for webhook events
router.get('/webhooks/:orderId', async (req, res) => {
  const { orderId } = req.params;
  try {
    const events = await webhookStore.getEvents(orderId);
    res.json({ orderId, webhooks: events, count: events.length });
  } catch (err) {
    console.error('Error fetching webhooks:', err.message);
    res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
});

module.exports = router;
