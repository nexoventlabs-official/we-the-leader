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
 *     → send front + back card images directly
 *
 *   ANY text from a NEW user (not in DB)
 *     → send Registration Flow (ask EPIC → confirm → ask for photo)
 *
 *   Image from user with pending_registrations doc
 *     → download photo, generate card, upload, send front + back
 *
 *   Flow completion reply (nfm_reply)
 *     → prompt user to send photo if pending, else confirmation
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
const axios   = require('axios');
const config  = require('../config');
const { getDb } = require('../db');
const { findVoterByEpic } = require('../db');
const {
  sendTextMessage,
  sendReplyButtons,
  sendImageMessage,
  sendFlowMessage,
} = require('../services/whatsappService');
const { generateCard, generateBackCard } = require('../services/cardGenerator');
const { uploadPhoto, uploadCard, uploadBackCard } = require('../services/cloudinaryService');

// ── Button ID ─────────────────────────────────────────────────────
const BTN_MY_CARD = 'btn_my_card';

// ── Helper: generate ptc_code ─────────────────────────────────────
function generatePtcCode() {
  return 'PTC-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

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
  } catch { return false; }
}

// ── Phone normalisation: "918106811285" → "8106811285" ───────────
function normaliseMobile(from) {
  const d = String(from || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  return d;
}

// ── GET — Meta verification ───────────────────────────────────────
function handleVerification(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode !== 'subscribe') return res.status(403).json({ error: 'Invalid mode' });
  const stored = config.whatsapp.verifyToken;
  if (!stored) return res.status(500).json({ error: 'Webhook not configured' });
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(token || ''), Buffer.from(stored)); }
  catch { ok = false; }
  if (!ok) return res.status(403).json({ error: 'Token mismatch' });
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
    console.warn('[Webhook] Signature invalid');
    return res.sendStatus(403);
  }
  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.sendStatus(400); }
  res.sendStatus(200);
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
      if (value.statuses?.length) continue;
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
  catch { console.error('[Webhook] DB unavailable'); return; }

  // Deduplicate
  try {
    await db.collection('processed_wamids').insertOne({ wamid, ts: new Date() });
  } catch (err) {
    if (err.code === 11000) return;
    throw err;
  }

  const from   = msg.from;
  const mobile = normaliseMobile(from);
  const type   = msg.type;
  console.log(`[Webhook] ${type} from ${from} (${mobile})`);

  // ── Reply button tap ─────────────────────────────────────────
  if (type === 'interactive') {
    const intType = msg.interactive?.type;
    if (intType === 'button_reply') {
      const btnId = msg.interactive.button_reply?.id;
      if (btnId === BTN_MY_CARD) await handleSendCard(from, mobile, db);
      return;
    }
    if (intType === 'nfm_reply') {
      await handleFlowReply(from, mobile, msg.interactive.nfm_reply, db);
      return;
    }
  }

  // ── Image message — check if pending registration ────────────
  if (type === 'image') {
    await handleImageMessage(from, mobile, msg.image, db);
    return;
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

// ── Text: check DB → reply button or registration flow ───────────
async function handleTextMessage(from, mobile, db) {
  try {
    const [genDoc, statDoc, pending] = await Promise.all([
      db.collection('generated_voters').findOne(
        { MOBILE_NO: mobile },
        { projection: { VOTER_NAME: 1, EPIC_NO: 1 } },
      ),
      db.collection('generation_stats').findOne(
        { auth_mobile: mobile },
        { projection: { _id: 1 } },
      ),
      db.collection('pending_registrations').findOne(
        { mobile },
        { projection: { status: 1, epic_no: 1 } },
      ),
    ]);

    const isMember = Boolean(genDoc || statDoc);
    console.log(`[Webhook] ${mobile} → isMember: ${isMember}, pending: ${pending?.status}`);

    if (isMember) {
      // Existing member → reply button to get card
      const name = genDoc?.VOTER_NAME || 'Member';
      await sendReplyButtons(
        from,
        `Hi *${name}*! 👋\n\nWelcome to *We The Leaders*.\nTap the button below to receive your Digital Member ID Card instantly.`,
        [{ id: BTN_MY_CARD, title: 'My Card 🪪' }],
        'We The Leaders',
        'Lead the Change',
      );
    } else if (pending?.status === 'awaiting_photo') {
      // Pending registration — remind to send photo
      await sendTextMessage(
        from,
        `📸 Hi! We have your details (EPIC: ${pending.epic_no}).\n\nPlease send your *passport-size photo* here to generate your Digital Member ID Card.`,
      );
    } else {
      // New user → Registration Flow
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
      await sendTextMessage(from, 'Welcome to We The Leaders! 🎉\n\nVisit https://we-the-leader.vercel.app to get your Digital Member ID Card.');
    } catch { /* ignore */ }
  }
}

// ── Image: download, generate card, send ─────────────────────────
async function handleImageMessage(from, mobile, imageInfo, db) {
  try {
    // Check if there's a pending registration for this number
    const pending = await db.collection('pending_registrations').findOne({ mobile });
    if (!pending || pending.status !== 'awaiting_photo') {
      // Not waiting for a photo — treat as unknown
      console.log(`[Webhook] Image from ${mobile} — no pending registration`);
      await sendTextMessage(
        from,
        '📸 Thanks for the photo! To register, please first send "hi" to start the registration process.',
      );
      return;
    }

    const epicNo = pending.epic_no;
    console.log(`[Webhook] Photo received from ${mobile} for EPIC ${epicNo}`);

    // Mark as processing
    await db.collection('pending_registrations').updateOne(
      { mobile },
      { $set: { status: 'processing', photo_received_at: new Date() } },
    );

    await sendTextMessage(from, '⏳ Generating your Digital Member ID Card... Please wait a moment.');

    // Download photo from WhatsApp
    let photoBuffer;
    try {
      const mediaId  = imageInfo.id;
      const ACCESS   = config.whatsapp.accessToken;
      const GRAPH    = `https://graph.facebook.com/v22.0`;

      // Step 1: get media URL
      const { data: mediaData } = await axios.get(`${GRAPH}/${mediaId}`, {
        headers: { Authorization: `Bearer ${ACCESS}` },
      });
      // Step 2: download the actual image
      const imgResp = await axios.get(mediaData.url, {
        headers: { Authorization: `Bearer ${ACCESS}` },
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      photoBuffer = Buffer.from(imgResp.data);
      console.log(`[Webhook] Photo downloaded: ${Math.round(photoBuffer.length / 1024)} KB`);
    } catch (e) {
      console.error('[Webhook] Photo download error:', e.message);
      await sendTextMessage(from, '❌ Could not download your photo. Please send it again.');
      await db.collection('pending_registrations').updateOne(
        { mobile }, { $set: { status: 'awaiting_photo' } },
      );
      return;
    }

    // Build voter data (use voter name from pending if available)
    const ptcCode = generatePtcCode();
    const voterData = {
      epic_no:       epicNo,
      EPIC_NO:       epicNo,
      name:          pending.voter_name   || '',
      VOTER_NAME:    pending.voter_name   || '',
      assembly_name: pending.assembly_name || '',
      ASSEMBLY_NAME: pending.assembly_name || '',
      district:      pending.district     || '',
      DISTRICT_NAME: pending.district     || '',
      mobile:        mobile,
      MOBILE_NO:     mobile,
      ptc_code:      ptcCode,
    };

    // Generate cards
    const [frontBuffer, backBuffer] = await Promise.all([
      generateCard(voterData, photoBuffer),
      generateBackCard(voterData),
    ]);

    // Upload to Cloudinary
    const [photoUrl, frontUrl, backUrl] = await Promise.all([
      uploadPhoto(photoBuffer, epicNo),
      uploadCard(frontBuffer,  epicNo),
      uploadBackCard(backBuffer, epicNo),
    ]);

    const now = new Date();

    // Save to generated_voters
    await db.collection('generated_voters').updateOne(
      { EPIC_NO: epicNo },
      {
        $set: {
          EPIC_NO:       epicNo,
          ptc_code:      ptcCode,
          photo_url:     photoUrl,
          card_url:      frontUrl,
          back_url:      backUrl,
          combined_url:  frontUrl,
          generated_at:  now,
          VOTER_NAME:    pending.voter_name    || '',
          ASSEMBLY_NAME: pending.assembly_name || '',
          DISTRICT_NAME: pending.district      || '',
          MOBILE_NO:     mobile,
          source:        'whatsapp',
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );

    // Mark pending as done
    await db.collection('pending_registrations').updateOne(
      { mobile },
      { $set: { status: 'completed', completed_at: now } },
    );

    console.log(`[Webhook] Card generated for ${mobile} / ${epicNo}`);

    // Send front card
    const frontCaption = [
      '🪪 *Your Digital Member ID Card — FRONT*',
      `👤 Name     : ${pending.voter_name || ''}`,
      `🗳️  EPIC No  : ${epicNo}`,
      `🏛️  Assembly : ${pending.assembly_name || ''}`,
      `🔖 PTC Code : ${ptcCode}`,
      '',
      'We The Leaders — Lead the Change',
    ].join('\n');

    await sendImageMessage(from, frontUrl, frontCaption);
    await new Promise(r => setTimeout(r, 1000));
    await sendImageMessage(from, backUrl, '🪪 *Your Digital Member ID Card — BACK*\n\nWe The Leaders — Lead the Change');

    await sendTextMessage(
      from,
      `✅ *Registration Complete!*\n\nWelcome to We The Leaders, *${pending.voter_name || 'Member'}*!\n\nYour PTC Code: *${ptcCode}*\n\nShare your referral and invite others to join! 🎉`,
    );

  } catch (err) {
    console.error(`[Webhook] handleImageMessage error (${mobile}):`, err.message);
    try {
      await db.collection('pending_registrations').updateOne(
        { mobile }, { $set: { status: 'awaiting_photo' } },
      );
      await sendTextMessage(from, '❌ Card generation failed. Please send your photo again.');
    } catch { /* ignore */ }
  }
}

// ── "My Card" button → send front + back ─────────────────────────
async function handleSendCard(from, mobile, db) {
  try {
    const genDoc = await db.collection('generated_voters').findOne(
      { MOBILE_NO: mobile },
      { projection: { card_url: 1, back_url: 1, VOTER_NAME: 1, EPIC_NO: 1, ptc_code: 1 } },
    );

    const cardUrl = genDoc?.card_url || '';
    const backUrl = genDoc?.back_url || '';

    if (!cardUrl) {
      // Check if pending
      const pending = await db.collection('pending_registrations').findOne({ mobile });
      if (pending?.status === 'awaiting_photo') {
        await sendTextMessage(from, '📸 Please send your *passport-size photo* here to generate your card!');
      } else {
        await sendTextMessage(
          from,
          'Your card has not been generated yet.\n\nVisit https://we-the-leader.vercel.app to upload your photo and generate your Digital Member ID Card.',
        );
      }
      return;
    }

    const name    = genDoc?.VOTER_NAME || '';
    const epicNo  = genDoc?.EPIC_NO    || '';
    const ptcCode = genDoc?.ptc_code   || '';

    const frontCaption = [
      '🪪 *Your Digital Member ID Card — FRONT*',
      name    ? `👤 Name     : ${name}`    : '',
      epicNo  ? `🗳️  EPIC No  : ${epicNo}`  : '',
      ptcCode ? `🔖 PTC Code : ${ptcCode}` : '',
      '',
      'We The Leaders — Lead the Change',
    ].filter(Boolean).join('\n');

    await sendImageMessage(from, cardUrl, frontCaption);

    if (backUrl) {
      await new Promise(r => setTimeout(r, 800));
      await sendImageMessage(from, backUrl, '🪪 *Your Digital Member ID Card — BACK*\n\nWe The Leaders — Lead the Change');
    }
  } catch (err) {
    console.error(`[Webhook] handleSendCard error (${mobile}):`, err.message);
    await sendTextMessage(from, 'Sorry, could not fetch your card right now. Please try again.').catch(() => {});
  }
}

// ── Flow completion (nfm_reply) ───────────────────────────────────
async function handleFlowReply(from, mobile, nfmReply, db) {
  let data;
  try { data = JSON.parse(nfmReply.response_json || '{}'); }
  catch { console.warn('[Webhook] Invalid flow reply JSON from', from); return; }

  console.log(`[Webhook] Flow reply from ${mobile}:`, JSON.stringify(data).slice(0, 150));

  const epicNo = data.epic_no || '';
  const name   = data.voter_name || '';

  if (epicNo) {
    // Check if already a member
    const genDoc = await db.collection('generated_voters').findOne({ EPIC_NO: epicNo }, { projection: { card_url: 1 } });
    if (genDoc?.card_url) {
      // Card already exists — just send it
      await handleSendCard(from, mobile, db);
      return;
    }

    // Pending — prompt for photo
    await sendTextMessage(
      from,
      `👋 Hi ${name ? `*${name}*` : 'there'}! Your voter details are confirmed.\n\n📸 Now please send your *passport-size photo* in this chat to generate your Digital Member ID Card!`,
    );
  }
}

module.exports = router;
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
