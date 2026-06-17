'use strict';

/**
 * WhatsApp Cloud API Webhook
 * GET  /api/webhook / /api/webhook/meta  -- Meta verification
 * POST /api/webhook / /api/webhook/meta  -- incoming messages
 *
 * Bot logic:
 *  - Existing member texts -> reply button "My Card" -> send front + back card images
 *  - New user texts -> send Registration Flow (EPIC -> confirm -> ask for photo)
 *  - User sends image + has pending_registrations -> generate card, send both sides
 *  - Pending user texts -> remind to send photo
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const axios   = require('axios');
const config  = require('../config');
const { getDb, findVoterByEpic } = require('../db');
const {
  sendTextMessage,
  sendReplyButtons,
  sendImageMessage,
  sendFlowMessage,
  sendCtaUrlMessage,
} = require('../services/whatsappService');
const { generateCard, generateBackCard } = require('../services/cardGenerator');
const { uploadPhoto, uploadCard, uploadBackCard } = require('../services/cloudinaryService');

const BTN_MY_CARD = 'btn_my_card';

function generateWtlCode() {
  return 'WTL-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ── Signature verification ────────────────────────────────────────
function verifySignature(rawBody, sigHeader) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const appSecret = config.whatsapp.appSecret;
  if (!appSecret) {
    console.warn('[Webhook] APP_SECRET not set -- skipping check');
    return config.nodeEnv !== 'production';
  }
  const expected = 'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
  } catch { return false; }
}

// ── Phone normalisation: "918106811285" -> "8106811285" ──────────
function normaliseMobile(from) {
  const d = String(from || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  return d;
}

// ── GET: Meta verification handshake ─────────────────────────────
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

// ── POST: incoming events ─────────────────────────────────────────
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
      if (value.statuses && value.statuses.length > 0) continue;
      for (const msg of value.messages || []) {
        await processMessage(msg).catch(err =>
          console.error('[Webhook] Message error (' + msg.id + '):', err.message),
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

  try {
    await db.collection('processed_wamids').insertOne({ wamid, ts: new Date() });
  } catch (err) {
    if (err.code === 11000) return;
    throw err;
  }

  const from   = msg.from;
  const mobile = normaliseMobile(from);
  const type   = msg.type;
  console.log('[Webhook] ' + type + ' from ' + from + ' (' + mobile + ')');

  if (type === 'interactive') {
    const intType = msg.interactive && msg.interactive.type;
    if (intType === 'button_reply') {
      const btnId = msg.interactive.button_reply && msg.interactive.button_reply.id;
      if (btnId === BTN_MY_CARD) await handleSendCard(from, mobile, db);
      return;
    }
    if (intType === 'nfm_reply') {
      await handleFlowReply(from, mobile, msg.interactive.nfm_reply, db);
      return;
    }
  }

  if (type === 'image') {
    await handleImageMessage(from, mobile, msg.image, db);
    return;
  }

  if (type === 'text') {
    const text = (msg.text && msg.text.body || '').trim();
    console.log('[Webhook] Text: "' + text.slice(0, 50) + '" from ' + mobile);
    await handleTextMessage(from, mobile, db);
    return;
  }

  console.log('[Webhook] Unhandled type: ' + type + ' from ' + from);
}

// ── Text: check DB -> reply button or registration flow ──────────
async function handleTextMessage(from, mobile, db) {
  try {
    const results = await Promise.all([
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

    const genDoc  = results[0];
    const statDoc = results[1];
    const pending = results[2];

    const isMember = Boolean(genDoc || statDoc);
    console.log('[Webhook] ' + mobile + ' -> isMember: ' + isMember + ', pending: ' + (pending && pending.status));

    if (isMember) {
      const name = (genDoc && genDoc.VOTER_NAME) || 'Member';
      await sendReplyButtons(
        from,
        'Hi *' + name + '*! Welcome to *We The Leaders*.\nTap the button below to receive your Digital Member ID Card instantly.',
        [{ id: BTN_MY_CARD, title: 'My Card' }],
        'We The Leaders',
        'Lead the Change',
      );
    } else if (pending && pending.status === 'awaiting_photo') {
      const { makeUploadToken } = require('./upload');
      const { sendCtaUrlMessage } = require('../services/whatsappService');
      const uploadUrl = `${config.baseUrl}/upload/${makeUploadToken(mobile, pending.epic_no)}`;
      const result = await sendCtaUrlMessage(
        from,
        '📸 Upload Your Photo',
        `Hi! We have your details (EPIC: *${pending.epic_no}*).\n\nTap the button below to upload your passport-size photo and generate your *Digital Member ID Card*.\n\n_You can also send your photo directly in this chat._`,
        'We The Leaders — Lead the Change',
        'Upload Photo',
        uploadUrl,
      );
      // Fallback to text if CTA fails
      if (!result.success) {
        await sendTextMessage(from,
          `Hi! We have your details (EPIC: ${pending.epic_no}).\n\nUpload your photo here:\n${uploadUrl}\n\nOr send your photo directly in this chat.`);
      }
    } else {
      console.log('[Webhook] Sending REGISTRATION flow to ' + from);
      const result = await sendFlowMessage(from, 'registration');
      if (!result.success) {
        await sendTextMessage(
          from,
          'Welcome to We The Leaders! Visit https://we-the-leader.vercel.app to verify your Voter ID and generate your free Digital Member ID Card.',
        );
      }
    }
  } catch (err) {
    console.error('[Webhook] handleTextMessage error (' + mobile + '):', err.message);
    try {
      await sendTextMessage(from, 'Welcome to We The Leaders! Visit https://we-the-leader.vercel.app to get your Digital Member ID Card.');
    } catch (e2) { /* ignore */ }
  }
}

// ── Image: download, generate card, send ─────────────────────────
async function handleImageMessage(from, mobile, imageInfo, db) {
  try {
    const pending = await db.collection('pending_registrations').findOne({ mobile });
    if (!pending || pending.status !== 'awaiting_photo') {
      console.log('[Webhook] Image from ' + mobile + ' -- no pending registration');
      await sendTextMessage(
        from,
        'Thanks for the photo! To register, please first send "hi" to start the registration process.',
      );
      return;
    }

    const epicNo = pending.epic_no;
    console.log('[Webhook] Photo received from ' + mobile + ' for EPIC ' + epicNo);

    await db.collection('pending_registrations').updateOne(
      { mobile },
      { $set: { status: 'processing', photo_received_at: new Date() } },
    );

    await sendTextMessage(from, 'Generating your Digital Member ID Card... Please wait a moment.');

    // Download photo from WhatsApp
    let photoBuffer;
    try {
      const mediaId = imageInfo.id;
      const ACCESS  = config.whatsapp.accessToken;
      const GRAPH   = 'https://graph.facebook.com/v22.0';

      const mediaResp = await axios.get(GRAPH + '/' + mediaId, {
        headers: { Authorization: 'Bearer ' + ACCESS },
      });
      const imgResp = await axios.get(mediaResp.data.url, {
        headers: { Authorization: 'Bearer ' + ACCESS },
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      photoBuffer = Buffer.from(imgResp.data);
      console.log('[Webhook] Photo downloaded: ' + Math.round(photoBuffer.length / 1024) + ' KB');
    } catch (e) {
      console.error('[Webhook] Photo download error:', e.message);
      await sendTextMessage(from, 'Could not download your photo. Please send it again.');
      await db.collection('pending_registrations').updateOne(
        { mobile }, { $set: { status: 'awaiting_photo' } },
      );
      return;
    }

    const wtlCode   = generateWtlCode();

    // Fetch voter from DB1 to get PART_NO (booth number)
    let partNo = '';
    try {
      const voterDoc = await findVoterByEpic(epicNo);
      if (voterDoc) partNo = String(voterDoc.PART_NO || voterDoc.part_no || '').trim();
    } catch (_) {}

    const voterData = {
      epic_no:       epicNo,
      EPIC_NO:       epicNo,
      name:          pending.voter_name    || '',
      VOTER_NAME:    pending.voter_name    || '',
      assembly_name: pending.assembly_name || '',
      ASSEMBLY_NAME: pending.assembly_name || '',
      district:      pending.district      || '',
      DISTRICT_NAME: pending.district      || '',
      part_no:       partNo,
      PART_NO:       partNo,
      booth:         partNo,
      mobile:        mobile,
      MOBILE_NO:     mobile,
      ptc_code:      wtlCode,
    };

    const frontBuffer = await generateCard(voterData, photoBuffer);
    const backBuffer  = await generateBackCard(voterData);

    const photoUrl = await uploadPhoto(photoBuffer,  epicNo);
    const frontUrl = await uploadCard(frontBuffer,   epicNo);
    const backUrl  = await uploadBackCard(backBuffer, epicNo);

    const now = new Date();

    await db.collection('generated_voters').updateOne(
      { EPIC_NO: epicNo },
      {
        $set: {
          EPIC_NO:       epicNo,
          ptc_code:      wtlCode,
          photo_url:     photoUrl,
          card_url:      frontUrl,
          back_url:      backUrl,
          combined_url:  frontUrl,
          generated_at:  now,
          VOTER_NAME:    pending.voter_name    || '',
          ASSEMBLY_NAME: pending.assembly_name || '',
          DISTRICT_NAME: pending.district      || '',
          PART_NO:       partNo,
          MOBILE_NO:     mobile,
          source:        'whatsapp',
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );

    await db.collection('pending_registrations').updateOne(
      { mobile },
      { $set: { status: 'completed', completed_at: now } },
    );

    console.log('[Webhook] Card generated for ' + mobile + ' / ' + epicNo);

    const frontCaption = [
      'Your Digital Member ID Card -- FRONT',
      'Name     : ' + (pending.voter_name    || ''),
      'EPIC No  : ' + epicNo,
      'Assembly : ' + (pending.assembly_name || ''),
      'WTL Code : ' + wtlCode,
      '',
      'We The Leaders -- Lead the Change',
    ].join('\n');

    await sendImageMessage(from, frontUrl, frontCaption);
    await new Promise(function(r) { setTimeout(r, 1000); });
    await sendImageMessage(from, backUrl, 'Your Digital Member ID Card -- BACK\n\nWe The Leaders -- Lead the Change');

    const welcomeName = pending.voter_name || 'Member';
    await sendTextMessage(
      from,
      'Registration Complete!\n\nWelcome to We The Leaders, ' + welcomeName + '!\n\nYour WTL Code: ' + wtlCode + '\n\nShare your referral and invite others to join!',
    );

  } catch (err) {
    console.error('[Webhook] handleImageMessage error (' + mobile + '):', err.message);
    try {
      await db.collection('pending_registrations').updateOne(
        { mobile }, { $set: { status: 'awaiting_photo' } },
      );
      await sendTextMessage(from, 'Card generation failed. Please send your photo again.');
    } catch (e2) { /* ignore */ }
  }
}

// ── "My Card" button -> send front + back ────────────────────────
async function handleSendCard(from, mobile, db) {
  try {
    const genDoc = await db.collection('generated_voters').findOne(
      { MOBILE_NO: mobile },
      { projection: { card_url: 1, back_url: 1, VOTER_NAME: 1, EPIC_NO: 1, ptc_code: 1 } },
    );

    const cardUrl = (genDoc && genDoc.card_url) || '';
    const backUrl = (genDoc && genDoc.back_url) || '';

    if (!cardUrl) {
      const pending = await db.collection('pending_registrations').findOne({ mobile });
      if (pending && pending.status === 'awaiting_photo') {
        await sendTextMessage(from, 'Please send your passport-size photo here to generate your card!');
      } else {
        await sendTextMessage(
          from,
          'Your card has not been generated yet.\n\nVisit https://we-the-leader.vercel.app to upload your photo and generate your Digital Member ID Card.',
        );
      }
      return;
    }

    const name    = (genDoc && genDoc.VOTER_NAME) || '';
    const epicNo  = (genDoc && genDoc.EPIC_NO)    || '';
    const wtlCode = (genDoc && genDoc.ptc_code)   || '';

    const parts = ['Your Digital Member ID Card -- FRONT'];
    if (name)    parts.push('Name     : ' + name);
    if (epicNo)  parts.push('EPIC No  : ' + epicNo);
    if (wtlCode) parts.push('WTL Code : ' + wtlCode);
    parts.push('');
    parts.push('We The Leaders -- Lead the Change');

    await sendImageMessage(from, cardUrl, parts.join('\n'));

    if (backUrl) {
      await new Promise(function(r) { setTimeout(r, 800); });
      await sendImageMessage(from, backUrl, 'Your Digital Member ID Card -- BACK\n\nWe The Leaders -- Lead the Change');
    }
  } catch (err) {
    console.error('[Webhook] handleSendCard error (' + mobile + '):', err.message);
    await sendTextMessage(from, 'Sorry, could not fetch your card right now. Please try again.').catch(function() {});
  }
}

// ── Flow completion (nfm_reply) ───────────────────────────────────
async function handleFlowReply(from, mobile, nfmReply, db) {
  var data;
  try { data = JSON.parse((nfmReply && nfmReply.response_json) || '{}'); }
  catch { console.warn('[Webhook] Invalid flow reply JSON from', from); return; }

  console.log('[Webhook] Flow reply from ' + mobile + ':', JSON.stringify(data).slice(0, 150));

  const epicNo = data.epic_no    || '';
  const name   = data.voter_name || '';

  if (epicNo) {
    const genDoc = await db.collection('generated_voters').findOne(
      { EPIC_NO: epicNo }, { projection: { card_url: 1 } },
    );
    if (genDoc && genDoc.card_url) {
      await handleSendCard(from, mobile, db);
      return;
    }
    const greeting = name ? 'Hi ' + name + '! ' : 'Hi! ';
    await sendTextMessage(
      from,
      greeting + 'Your voter details are confirmed.\n\nNow please send your passport-size photo in this chat to generate your Digital Member ID Card!',
    );
  }
}

module.exports = router;
