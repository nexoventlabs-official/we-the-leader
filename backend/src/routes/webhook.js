/**
 * WhatsApp Cloud API Webhook
 * ──────────────────────────────────────────────────────────────────
 * GET  /api/webhook      — Meta verification handshake
 * GET  /api/webhook/meta — Meta verification handshake (alias)
 * POST /api/webhook      — incoming messages & status updates
 * POST /api/webhook/meta — incoming messages & status updates (alias)
 *
 * Bot logic (text messages):
 *   1. Normalise the sender's phone number → 10-digit mobile
 *   2. Look up generated_voters in DB2 (MONGO_URI) by MOBILE_NO
 *   3. Found   → send Login Flow  (member already registered)
 *      Not found → send Registration Flow
 *
 * Security:
 *   - X-Hub-Signature-256 HMAC validated before any processing
 *   - Messages deduplicated by wamid (MongoDB TTL collection)
 *   - Status/delivery updates silently acknowledged
 */

'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const config  = require('../config');
const { getDb }                           = require('../db');
const { sendTextMessage, sendFlowMessage } = require('../services/whatsappService');

// ── Signature verification ────────────────────────────────────────
function verifySignature(rawBody, sigHeader) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const appSecret = config.whatsapp.appSecret;
  if (!appSecret) {
    console.warn('[Webhook] WHATSAPP_APP_SECRET not set — skipping signature check');
    return config.nodeEnv !== 'production';
  }
  const expected = 'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Normalise phone number → 10-digit Indian mobile ──────────────
// Meta sends numbers like "918106811285" (91 + 10 digits)
function normaliseMobile(from) {
  const digits = String(from || '').replace(/\D/g, '');
  // Strip leading country code 91 if present and result is 12 digits
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2); // → 10 digits
  }
  if (digits.length === 10) return digits;
  return digits; // return as-is for non-Indian numbers
}

// ── GET — Meta verification handshake ────────────────────────────
function handleVerification(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe') return res.status(403).json({ error: 'Invalid mode' });

  const storedToken = config.whatsapp.verifyToken;
  if (!storedToken) {
    console.error('[Webhook] WHATSAPP_VERIFY_TOKEN not configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let tokenMatch = false;
  try {
    tokenMatch = crypto.timingSafeEqual(
      Buffer.from(token || ''),
      Buffer.from(storedToken),
    );
  } catch { tokenMatch = false; }

  if (!tokenMatch) {
    console.warn('[Webhook] Verification token mismatch');
    return res.status(403).json({ error: 'Token mismatch' });
  }

  console.log('[Webhook] Meta verification successful');
  return res.status(200).send(challenge);
}

router.get('/',     handleVerification);
router.get('/meta', handleVerification);

// ── POST — incoming events ────────────────────────────────────────
async function handleIncoming(req, res) {
  const rawBody   = req.body; // Buffer (express.raw in index.js)
  const sigHeader = req.headers['x-hub-signature-256'];

  if (!verifySignature(rawBody, sigHeader)) {
    console.warn('[Webhook] Invalid signature — rejected');
    return res.sendStatus(403);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }

  // Acknowledge immediately — Meta requires 200 within 20 s
  res.sendStatus(200);

  // Process async so we never block the HTTP response
  setImmediate(() =>
    processPayload(payload).catch(err =>
      console.error('[Webhook] Processing error:', err.message),
    ),
  );
}

router.post('/',     handleIncoming);
router.post('/meta', handleIncoming);

// ── Payload processor ─────────────────────────────────────────────
async function processPayload(payload) {
  if (payload.object !== 'whatsapp_business_account') return;

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      // Skip delivery/read receipts
      if (value.statuses?.length) continue;

      for (const msg of value.messages || []) {
        await processMessage(msg, value.metadata || {}).catch(err =>
          console.error(`[Webhook] Message error (wamid: ${msg.id}):`, err.message),
        );
      }
    }
  }
}

// ── Per-message handler ───────────────────────────────────────────
async function processMessage(msg, metadata) {
  const wamid = msg.id;
  if (!wamid) return;

  let db;
  try {
    db = getDb();
  } catch {
    console.error('[Webhook] DB unavailable — cannot process message');
    return;
  }

  // Deduplicate by wamid (unique index + TTL on processed_wamids)
  try {
    await db.collection('processed_wamids').insertOne({ wamid, ts: new Date() });
  } catch (err) {
    if (err.code === 11000) return; // Already processed
    throw err;
  }

  const from    = msg.from;   // e.g. "918106811285"
  const mobile  = normaliseMobile(from); // e.g. "8106811285"
  const msgType = msg.type;

  console.log(`[Webhook] Message from ${from} (mobile: ${mobile}) type: ${msgType}`);

  // ── Flow reply (nfm_reply) ───────────────────────────────────
  if (msgType === 'interactive' && msg.interactive?.type === 'nfm_reply') {
    await handleFlowReply(from, mobile, msg.interactive.nfm_reply, db);
    return;
  }

  // ── Text message — trigger smart flow ───────────────────────
  if (msgType === 'text') {
    const text = (msg.text?.body || '').trim().toLowerCase();
    console.log(`[Webhook] Text from ${mobile}: "${text.slice(0, 50)}"`);
    await handleTextMessage(from, mobile, text, db);
    return;
  }

  console.log(`[Webhook] Unhandled message type: ${msgType} from ${from}`);
}

// ── Smart bot: check DB → send correct flow ───────────────────────
async function handleTextMessage(from, mobile, text, db) {
  try {
    // Check if this mobile number is already a registered member
    // Check both MOBILE_NO field and auth_mobile in generation_stats
    const [genDoc, statDoc] = await Promise.all([
      db.collection('generated_voters').findOne(
        { MOBILE_NO: mobile },
        { projection: { _id: 1, MOBILE_NO: 1 } },
      ),
      db.collection('generation_stats').findOne(
        { auth_mobile: mobile },
        { projection: { _id: 1 } },
      ),
    ]);

    const isMember = Boolean(genDoc || statDoc);
    console.log(`[Webhook] Mobile ${mobile} → isMember: ${isMember}`);

    if (isMember) {
      // Already registered → send Login flow
      console.log(`[Webhook] Sending LOGIN flow to ${from}`);
      const result = await sendFlowMessage(from, 'login');
      if (!result.success) {
        // Fallback text if flow send fails
        await sendTextMessage(
          from,
          'Welcome back! Visit https://we-the-leader.vercel.app to access your Digital Member ID Card.',
        );
      }
    } else {
      // New user → send Registration flow
      console.log(`[Webhook] Sending REGISTRATION flow to ${from}`);
      const result = await sendFlowMessage(from, 'registration');
      if (!result.success) {
        // Fallback text if flow send fails
        await sendTextMessage(
          from,
          'Welcome to We The Leaders! 🎉\n\nVisit https://we-the-leader.vercel.app to verify your Voter ID and generate your free Digital Member ID Card.',
        );
      }
    }
  } catch (err) {
    console.error(`[Webhook] handleTextMessage error for ${mobile}:`, err.message);
    // Best-effort fallback
    try {
      await sendTextMessage(
        from,
        'Welcome to We The Leaders! 🎉\n\nVisit https://we-the-leader.vercel.app to get your Digital Member ID Card.',
      );
    } catch { /* ignore */ }
  }
}

// ── Flow reply handler ────────────────────────────────────────────
async function handleFlowReply(from, mobile, nfmReply, db) {
  let data;
  try {
    data = JSON.parse(nfmReply.response_json || '{}');
  } catch {
    console.warn('[Webhook] Invalid flow reply JSON from', from);
    return;
  }

  console.log(`[Webhook] Flow reply from ${mobile}:`, JSON.stringify(data).slice(0, 150));

  // The flow completed — send a confirmation message
  const epic  = data.epic_no  || '';
  const name  = data.voter_name || '';

  if (epic || name) {
    const greeting = name ? `Hi ${name}! ` : '';
    await sendTextMessage(
      from,
      `${greeting}✅ Your details have been received.\n\nVisit https://we-the-leader.vercel.app to complete your registration and download your Digital Member ID Card.`,
    ).catch(err => console.error('[Webhook] Flow reply text error:', err.message));
  }
}

module.exports = router;
