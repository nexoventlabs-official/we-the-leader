/**
 * WhatsApp Cloud API Webhook
 * ──────────────────────────────────────────────────────────────────
 * GET  /api/webhook / /api/webhook/meta  — Meta verification
 * POST /api/webhook / /api/webhook/meta  — incoming messages
 *
 * Bot logic:
 *
 *   ANY text from an EXISTING member
 *     → send interactive message with "My Card 🪪" reply button
 *
 *   User taps "My Card 🪪" button (button_reply id = "btn_my_card")
 *     → fetch card_url from generated_voters
 *     → send card image directly (no login required)
 *
 *   ANY text from a NEW user (not in DB)
 *     → send Registration Flow
 *
 *   Flow completion reply (nfm_reply)
 *     → send confirmation text
 *
 * Security:
 *   - X-Hub-Signature-256 HMAC validated on every POST
 *   - wamid deduplication via MongoDB TTL collection
 *   - Status/delivery receipts silently ignored
 */

'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const config  = require('../config');
const { getDb } = require('../db');
const {
  sendTextMessage,
  sendReplyButtons,
  sendImageMessage,
  sendFlowMessage,
} = require('../services/whatsappService');

// ── Button ID constant ────────────────────────────────────────────
const BTN_MY_CARD = 'btn_my_card';

// ── Signature verification ────────────────────────────────────────
function verifySignature(rawBody, sigHeader) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const appSecret = config.whatsapp.appSecret;
  if (!appSecret) {
    console.warn('[Webhook] WHATSAPP_APP_SECRET not set — skipping check');
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

// ── Phone normalisation: "918106811285" → "8106811285" ───────────
function normaliseMobile(from) {
  const d = String(from || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  return d;
}

// ── GET — Meta verification handshake ────────────────────────────
function handleVerification(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe') return res.status(403).json({ error: 'Invalid mode' });

  const stored = config.whatsapp.verifyToken;
  if (!stored) {
    console.error('[Webhook] WHATSAPP_VERIFY_TOKEN not set');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(token || ''), Buffer.from(stored)); }
  catch { ok = false; }

  if (!ok) {
    console.warn('[Webhook] Verify token mismatch');
    return res.status(403).json({ error: 'Token mismatch' });
  }

  console.log('[Webhook] Meta verification OK');
  return res.status(200).send(challenge);
}

router.get('/',     handleVerification);
router.get('/meta', handleVerification);

// ── POST — incoming events ────────────────────────────────────────
async function handleIncoming(req, res) {
  const rawBody   = req.body;
  const sigHeader = req.headers['x-hub-signature-256'];

  if (!verifySignature(rawBody, sigHeader)) {
    console.warn('[Webhook] Signature invalid — rejected');
    return res.sendStatus(403);
  }

  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.sendStatus(400); }

  res.sendStatus(200); // ack immediately

  setImmediate(() =>
    processPayload(payload).catch(err =>
      console.error('[Webhook] Processing error:', err.message),
    ),
  );
}

router.post('/',     handleIncoming);
router.post('/meta', handleIncoming);

// ── Payload fan-out ───────────────────────────────────────────────
async function processPayload(payload) {
  if (payload.object !== 'whatsapp_business_account') return;

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      if (value.statuses?.length) continue; // skip delivery/read receipts

      for (const msg of value.messages || []) {
        await processMessage(msg).catch(err =>
          console.error(`[Webhook] Message error (${msg.id}):`, err.message),
        );
      }
    }
  }
}

// ── Per-message handler ───────────────────────────────────────────
async function processMessage(msg) {
  const wamid = msg.id;
  if (!wamid) return;

  let db;
  try { db = getDb(); }
  catch {
    console.error('[Webhook] DB unavailable');
    return;
  }

  // Deduplicate
  try {
    await db.collection('processed_wamids').insertOne({ wamid, ts: new Date() });
  } catch (err) {
    if (err.code === 11000) return; // already processed
    throw err;
  }

  const from   = msg.from;
  const mobile = normaliseMobile(from);
  const type   = msg.type;

  console.log(`[Webhook] ${type} from ${from} (${mobile})`);

  // ── Interactive: button_reply (user tapped a reply button) ──
  if (type === 'interactive') {
    const intType = msg.interactive?.type;

    if (intType === 'button_reply') {
      const btnId = msg.interactive.button_reply?.id;
      console.log(`[Webhook] Button tap: ${btnId} from ${mobile}`);

      if (btnId === BTN_MY_CARD) {
        await handleSendCard(from, mobile, db);
      }
      return;
    }

    // Flow completion reply
    if (intType === 'nfm_reply') {
      await handleFlowReply(from, mobile, msg.interactive.nfm_reply, db);
      return;
    }
  }

  // ── Text message ─────────────────────────────────────────────
  if (type === 'text') {
    const text = (msg.text?.body || '').trim();
    console.log(`[Webhook] Text: "${text.slice(0, 50)}" from ${mobile}`);
    await handleTextMessage(from, mobile, db);
    return;
  }

  console.log(`[Webhook] Unhandled type: ${type} from ${from}`);
}

// ── Text handler: check DB → reply button or registration flow ────
async function handleTextMessage(from, mobile, db) {
  try {
    const [genDoc, statDoc] = await Promise.all([
      db.collection('generated_voters').findOne(
        { MOBILE_NO: mobile },
        { projection: { VOTER_NAME: 1, EPIC_NO: 1 } },
      ),
      db.collection('generation_stats').findOne(
        { auth_mobile: mobile },
        { projection: { _id: 1 } },
      ),
    ]);

    const isMember = Boolean(genDoc || statDoc);
    console.log(`[Webhook] ${mobile} → isMember: ${isMember}`);

    if (isMember) {
      // ── Existing member: greet + show "My Card" button ──────
      const name = genDoc?.VOTER_NAME || 'Member';
      await sendReplyButtons(
        from,
        `Hi *${name}*! 👋\n\nWelcome to *We The Leaders*.\nTap the button below to receive your Digital Member ID Card instantly.`,
        [{ id: BTN_MY_CARD, title: 'My Card 🪪' }],
        'We The Leaders',
        'Lead the Change',
      );
    } else {
      // ── New user: send Registration Flow ─────────────────────
      console.log(`[Webhook] Sending REGISTRATION flow to ${from}`);
      const result = await sendFlowMessage(from, 'registration');
      if (!result.success) {
        await sendTextMessage(
          from,
          'Welcome to We The Leaders! 🎉\n\nVisit https://we-the-leader.vercel.app to verify your Voter ID and generate your free Digital Member ID Card.',
        );
      }
    }
  } catch (err) {
    console.error(`[Webhook] handleTextMessage error (${mobile}):`, err.message);
    try {
      await sendTextMessage(
        from,
        'Welcome to We The Leaders! 🎉\n\nVisit https://we-the-leader.vercel.app to get your Digital Member ID Card.',
      );
    } catch { /* ignore */ }
  }
}

// ── "My Card" button handler: fetch card URL → send image ─────────
async function handleSendCard(from, mobile, db) {
  try {
    // Fetch card from generated_voters (primary) or generation_stats (fallback)
    const [genDoc, statDoc] = await Promise.all([
      db.collection('generated_voters').findOne(
        { MOBILE_NO: mobile },
        { projection: { card_url: 1, VOTER_NAME: 1, EPIC_NO: 1, ptc_code: 1 } },
      ),
      db.collection('generation_stats').findOne(
        { auth_mobile: mobile },
        { projection: { card_url: 1, epic_no: 1 } },
      ),
    ]);

    const cardUrl  = genDoc?.card_url  || statDoc?.card_url  || '';
    const name     = genDoc?.VOTER_NAME || '';
    const epicNo   = genDoc?.EPIC_NO   || statDoc?.epic_no   || '';
    const ptcCode  = genDoc?.ptc_code  || '';

    if (!cardUrl) {
      console.warn(`[Webhook] No card URL found for ${mobile}`);
      await sendTextMessage(
        from,
        'Your card has not been generated yet.\n\nVisit https://we-the-leader.vercel.app to upload your photo and generate your Digital Member ID Card.',
      );
      return;
    }

    // Build a nice caption
    const lines = ['🪪 *Your Digital Member ID Card*'];
    if (name)    lines.push(`👤 Name    : ${name}`);
    if (epicNo)  lines.push(`🗳️ EPIC No  : ${epicNo}`);
    if (ptcCode) lines.push(`🔖 PTC Code: ${ptcCode}`);
    lines.push('');
    lines.push('We The Leaders — Lead the Change');
    const caption = lines.join('\n');

    console.log(`[Webhook] Sending card image to ${from}: ${cardUrl}`);
    const result = await sendImageMessage(from, cardUrl, caption);

    if (!result.success) {
      // Fallback: send link as text
      await sendTextMessage(
        from,
        `Your Digital Member ID Card:\n${cardUrl}`,
      );
    }
  } catch (err) {
    console.error(`[Webhook] handleSendCard error (${mobile}):`, err.message);
    await sendTextMessage(
      from,
      'Sorry, could not fetch your card right now. Please try again in a moment.',
    ).catch(() => {});
  }
}

// ── Flow completion reply ─────────────────────────────────────────
async function handleFlowReply(from, mobile, nfmReply, db) {
  let data;
  try { data = JSON.parse(nfmReply.response_json || '{}'); }
  catch {
    console.warn('[Webhook] Invalid flow reply JSON from', from);
    return;
  }

  console.log(`[Webhook] Flow reply from ${mobile}:`, JSON.stringify(data).slice(0, 150));

  const name   = data.voter_name || '';
  const epicNo = data.epic_no    || '';

  if (epicNo || name) {
    const greeting = name ? `Hi *${name}*! ` : '';
    await sendTextMessage(
      from,
      `${greeting}✅ Your details have been received.\n\nVisit https://we-the-leader.vercel.app to upload your photo and generate your *Digital Member ID Card*.`,
    ).catch(err => console.error('[Webhook] Flow reply text error:', err.message));
  }
}

module.exports = router;
