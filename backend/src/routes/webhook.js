/**
 * WhatsApp Cloud API Webhook
 * ──────────────────────────────────────────────────────────────────
 * GET  /api/webhook/meta  — verification handshake
 * POST /api/webhook/meta  — incoming messages & status updates
 *
 * SECURITY:
 *  - Raw body (Buffer) is required for HMAC-SHA256 — registered in
 *    index.js BEFORE express.json() via express.raw().
 *  - X-Hub-Signature-256 validated with crypto.timingSafeEqual.
 *  - Messages deduplicated by wamid (MongoDB TTL collection).
 *  - Status update objects are silently acknowledged and ignored.
 *  - Freetext / unexpected message types are handled gracefully.
 *  - Health-check ping returns immediately without any DB access.
 */
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const config  = require('../config');
const { getDb } = require('../db');

// ── Signature verification helper ────────────────────────────────
function verifySignature(rawBody, sigHeader) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const appSecret = config.whatsapp.appSecret;
  if (!appSecret) {
    console.warn('[Webhook] WHATSAPP_APP_SECRET not set — skipping signature check');
    return config.nodeEnv !== 'production'; // allow in dev only
  }
  const expected = 'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(sigHeader),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// ── GET /api/webhook  AND  /api/webhook/meta — Meta verification handshake ──
function handleVerification(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe') {
    return res.status(403).json({ error: 'Invalid mode' });
  }

  const storedToken = config.whatsapp.verifyToken;
  if (!storedToken) {
    console.error('[Webhook] WHATSAPP_VERIFY_TOKEN not configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Constant-time comparison — prevents timing attacks
  let tokenMatch = false;
  try {
    tokenMatch = crypto.timingSafeEqual(
      Buffer.from(token  || ''),
      Buffer.from(storedToken)
    );
  } catch {
    tokenMatch = false;
  }

  if (!tokenMatch) {
    console.warn('[Webhook] Verification token mismatch');
    return res.status(403).json({ error: 'Token mismatch' });
  }

  console.log('[Webhook] Meta verification successful');
  return res.status(200).send(challenge);
}

// Handle both /api/webhook (root) and /api/webhook/meta
router.get('/',     handleVerification);
router.get('/meta', handleVerification);

// ── POST /api/webhook  AND  /api/webhook/meta — incoming events ──
async function handleIncoming(req, res) {
  // req.body is a Buffer (express.raw middleware in index.js)
  const rawBody  = req.body;
  const sigHeader = req.headers['x-hub-signature-256'];

  // 1. Validate signature — reject immediately if invalid
  if (!verifySignature(rawBody, sigHeader)) {
    console.warn('[Webhook] Invalid signature — request rejected');
    return res.sendStatus(403);
  }

  // 2. Parse body
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }

  // 3. Acknowledge immediately — Meta requires a 200 within 20 s
  res.sendStatus(200);

  // 4. Process asynchronously so we never block the response
  setImmediate(() => processPayload(payload).catch(err => {
    console.error('[Webhook] Processing error:', err.message);
  }));
}

// Handle both /api/webhook (root) and /api/webhook/meta
router.post('/',     handleIncoming);
router.post('/meta', handleIncoming);

// ── Async payload processor ───────────────────────────────────────
async function processPayload(payload) {
  if (payload.object !== 'whatsapp_business_account') return;

  const entries = payload.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const value = change.value || {};

      // Ignore status updates (delivery receipts, read receipts)
      if (value.statuses && value.statuses.length > 0) continue;

      const messages = value.messages || [];
      for (const msg of messages) {
        await processMessage(msg, value.metadata || {}).catch(err => {
          console.error(`[Webhook] Message processing error (wamid: ${msg.id}):`, err.message);
        });
      }
    }
  }
}

// ── Per-message handler with wamid deduplication ─────────────────
async function processMessage(msg, metadata) {
  const wamid = msg.id;
  if (!wamid) return;

  let db;
  try {
    db = getDb();
  } catch {
    // DB not connected — can't deduplicate; log and skip
    console.error('[Webhook] DB not available for deduplication');
    return;
  }

  // Deduplicate: insert wamid; if duplicate key → already processed
  try {
    await db.collection('processed_wamids').insertOne({
      wamid,
      ts: new Date(),
    });
  } catch (err) {
    if (err.code === 11000) {
      // Already processed — Meta retry, silently skip
      return;
    }
    throw err;
  }

  const from    = msg.from;   // sender phone number
  const msgType = msg.type;   // 'text', 'interactive', 'image', etc.

  // Handle Flow reply (interactive / nfm_reply)
  if (msgType === 'interactive' && msg.interactive?.type === 'nfm_reply') {
    await handleFlowReply(from, msg.interactive.nfm_reply, db);
    return;
  }

  // Handle plain text messages — acknowledge gracefully, do not crash
  if (msgType === 'text') {
    const text = msg.text?.body || '';
    console.log(`[Webhook] Text message from ${from}: "${text.slice(0, 30)}..."`);
    // TODO: implement bot response logic here
    return;
  }

  // Unknown message type — log and ignore (never crash)
  console.log(`[Webhook] Unhandled message type: ${msgType} from ${from}`);
}

// ── WhatsApp Flow reply handler ───────────────────────────────────
async function handleFlowReply(from, nfmReply, db) {
  let data;
  try {
    data = JSON.parse(nfmReply.response_json || '{}');
  } catch {
    console.warn('[Webhook] Invalid flow reply JSON from', from);
    return;
  }
  console.log(`[Webhook] Flow reply from ${from}:`, JSON.stringify(data).slice(0, 100));
  // TODO: implement flow response handling here
}

module.exports = router;
