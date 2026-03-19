const config = require('../config');

// In-memory stores (used for local dev; Vercel KV for production)
const eventsStore = new Map();     // orderId -> WebhookEvent[]
const forwardUrlStore = new Map(); // orderId -> string

async function addEvent(orderId, event) {
  if (!eventsStore.has(orderId)) {
    eventsStore.set(orderId, []);
  }
  eventsStore.get(orderId).push(event);

  // Auto-cleanup after TTL
  setTimeout(() => {
    const events = eventsStore.get(orderId);
    if (events) {
      const idx = events.findIndex((e) => e.id === event.id);
      if (idx !== -1) events.splice(idx, 1);
      if (events.length === 0) eventsStore.delete(orderId);
    }
  }, config.webhookTtlSeconds * 1000);
}

async function getEvents(orderId) {
  return eventsStore.get(orderId) || [];
}

async function updateEvent(orderId, eventId, updates) {
  const events = eventsStore.get(orderId) || [];
  const event = events.find((e) => e.id === eventId);
  if (event) {
    Object.assign(event, updates);
  }
}

async function setForwardUrl(orderId, url) {
  forwardUrlStore.set(orderId, url);
  setTimeout(() => forwardUrlStore.delete(orderId), config.webhookTtlSeconds * 1000);
}

async function getForwardUrl(orderId) {
  return forwardUrlStore.get(orderId) || null;
}

module.exports = { addEvent, getEvents, updateEvent, setForwardUrl, getForwardUrl };
