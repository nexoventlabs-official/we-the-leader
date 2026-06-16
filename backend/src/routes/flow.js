/**
 * WhatsApp Flows Data Endpoint
 * ─────────────────────────────────────────────────────────────────
 * POST /api/webhook/flow
 *
 * Registration flow (SIGN_UP):
 *   EPIC_ENTRY  → validate EPIC from DB1 → CONFIRM_DETAILS
 *   CONFIRM_DETAILS → save pending_registrations doc keyed by WA number
 *                   → SUCCESS screen ("send your photo in chat")
 *
 * Login flow (SIGN_IN):
 *   MOBILE_INPUT → send OTP via SMS → OTP_VERIFY
 *   OTP_VERIFY   → verify OTP → SUCCESS
 *
 * The WA sender's phone number (flow_token encodes it) is used as
 * the mobile number for registration — no OTP needed.
 *
 * Encryption: Meta AES-128-GCM + RSA-OAEP-SHA256
 * Response:   raw base64 string (NOT JSON wrapper)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const config  = require('../config');
const { getDb, findVoterByEpic } = require('../db');
const { sendOtp }  = require('../services/smsService');
const { validateEpic, validateMobile, validateOtp } = require('../utils/validators');

// ── Crypto helpers ────────────────────────────────────────────────

function decryptRequest(body, privatePem) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;
  const privateKey = crypto.createPrivateKey({ key: privatePem });
  let aesKeyBuffer;
  try {
    aesKeyBuffer = crypto.privateDecrypt(
      { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(encrypted_aes_key, 'base64'),
    );
  } catch (err) {
    console.error('[Flow] RSA decrypt failed:', err.message);
    const e = new Error('RSA decrypt failed');
    e.statusCode = 421;
    throw e;
  }
  const flowDataBuf = Buffer.from(encrypted_flow_data, 'base64');
  const ivBuf       = Buffer.from(initial_vector, 'base64');
  const TAG_LENGTH  = 16;
  const decipher    = crypto.createDecipheriv('aes-128-gcm', aesKeyBuffer, ivBuf);
  decipher.setAuthTag(flowDataBuf.subarray(-TAG_LENGTH));
  const decrypted = Buffer.concat([decipher.update(flowDataBuf.subarray(0, -TAG_LENGTH)), decipher.final()]);
  return {
    decryptedBody:       JSON.parse(decrypted.toString('utf-8')),
    aesKeyBuffer,
    initialVectorBuffer: ivBuf,
  };
}

function encryptResponse(obj, aesKeyBuffer, ivBuf) {
  const flipped = Buffer.from(ivBuf.map(b => ~b & 0xff));
  const cipher  = crypto.createCipheriv('aes-128-gcm', aesKeyBuffer, flipped);
  return Buffer.concat([
    cipher.update(JSON.stringify(obj), 'utf-8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}

// ── Signature check ───────────────────────────────────────────────

function isSignatureValid(rawBody, sigHeader) {
  const appSecret = config.whatsapp.appSecret;
  if (!appSecret) {
    console.warn('[Flow] WHATSAPP_APP_SECRET not set — skipping check');
    return true;
  }
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const hmac = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(sigHeader.slice('sha256='.length), 'utf-8'),
      Buffer.from(hmac, 'utf-8'),
    );
  } catch { return false; }
}

// ── Route ─────────────────────────────────────────────────────────

router.post(
  '/',
  express.json({
    verify: (req, _res, buf, enc) => { req.rawBody = buf?.toString(enc || 'utf-8'); },
  }),
  async (req, res) => {
    if (!isSignatureValid(req.rawBody || '', req.headers['x-hub-signature-256'])) {
      console.warn('[Flow] Signature invalid');
      return res.status(432).send();
    }

    const privatePem = (config.whatsapp.flowPrivateKey || '')
      .replace(/\\\\n/g, '\n').replace(/\\n/g, '\n').trim();

    if (!privatePem) return handleUnencrypted(req, res);

    let decryptedBody, aesKeyBuffer, initialVectorBuffer;
    try {
      ({ decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(req.body, privatePem));
    } catch (err) {
      return res.status(err.statusCode || 500).send();
    }

    console.log('[Flow] Body:', JSON.stringify(decryptedBody).slice(0, 150));

    let screenResponse;
    try {
      screenResponse = await buildResponse(decryptedBody);
    } catch (err) {
      console.error('[Flow] buildResponse error:', err.message);
      screenResponse = { data: { status: 'active' } }; // safe fallback for ping
    }

    return res.send(encryptResponse(screenResponse, aesKeyBuffer, initialVectorBuffer));
  },
);

// ── Unencrypted dev mode ──────────────────────────────────────────

async function handleUnencrypted(req, res) {
  const body = req.body || {};
  if (body.action === 'ping') return res.json({ data: { status: 'active' } });
  try {
    return res.json(await buildResponse(body));
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Core router ───────────────────────────────────────────────────

async function buildResponse(body) {
  const { action, screen, data = {}, flow_token = '' } = body;

  if (action === 'ping')  return { data: { status: 'active' } };
  if (data?.error)        return { data: { acknowledged: true } };
  if (action === 'INIT')  return { screen: screen || 'EPIC_ENTRY', data: { error_message: '', show_error: false } };

  if (action === 'data_exchange') {
    const cur = data.screen || screen;
    switch (cur) {
      case 'EPIC_ENTRY':      return handleEpicEntry(body);
      case 'CONFIRM_DETAILS': return handleConfirmDetails(body, flow_token);
      case 'MOBILE_INPUT':    return handleSendOtp(body);
      case 'OTP_VERIFY':      return handleVerifyOtp(body);
      default:
        return { screen: 'EPIC_ENTRY', data: { error_message: 'Unknown screen.', show_error: true } };
    }
  }

  return { data: { status: 'active' } };
}

// ── Registration: Step 1 — validate EPIC ─────────────────────────

async function handleEpicEntry(body) {
  const epic_no = ((body.data?.epic_no) || '').trim().toUpperCase();
  const { valid, value: epicNo } = validateEpic(epic_no);

  if (!valid) {
    return {
      screen: 'EPIC_ENTRY',
      data: { error_message: 'Invalid format. Use 3 letters + 7 digits (e.g. TNA1234567)', show_error: true },
    };
  }

  // Check if already registered
  try {
    const db = getDb();
    const existing = await db.collection('generated_voters').findOne(
      { EPIC_NO: epicNo }, { projection: { card_url: 1, VOTER_NAME: 1 } },
    );
    if (existing?.card_url) {
      return {
        screen: 'EPIC_ENTRY',
        data: {
          error_message: `${existing.VOTER_NAME || 'This EPIC'} is already registered. Your card was sent to this WhatsApp.`,
          show_error: true,
        },
      };
    }
  } catch (e) { /* non-fatal */ }

  // Lookup voter from DB1
  try {
    const voter = await findVoterByEpic(epicNo);
    if (!voter) {
      return {
        screen: 'EPIC_ENTRY',
        data: { error_message: 'EPIC not found. Please check your Voter ID card and try again.', show_error: true },
      };
    }

    const voterName    = voter.VOTER_NAME
      || `${voter.FM_NAME_EN || ''} ${voter.LASTNAME_EN || ''}`.trim()
      || 'Unknown';
    const assemblyName = voter.ASSEMBLY_NAME || voter.AC_NAME || '';
    const district     = voter.DISTRICT || voter.DISTRICT_NAME || '';

    return {
      screen: 'CONFIRM_DETAILS',
      data: { epic_no: epicNo, voter_name: voterName, assembly_name: assemblyName, district },
    };
  } catch (err) {
    console.error('[Flow] EPIC lookup error:', err.message);
    return {
      screen: 'EPIC_ENTRY',
      data: { error_message: 'Server error. Please try again.', show_error: true },
    };
  }
}

// ── Registration: Step 2 — confirm details, save pending ─────────
// flow_token format: "registration_{WA_number}_{timestamp}"

async function handleConfirmDetails(body, flowToken) {
  const epic_no      = (body.data?.epic_no      || '').trim().toUpperCase();
  const voter_name   = (body.data?.voter_name   || '').trim();
  const assembly_name = (body.data?.assembly_name || '').trim();
  const district     = (body.data?.district     || '').trim();

  // Extract WA mobile from flow_token: "registration_918106811285_1234567890"
  let waMobile = '';
  const parts = (flowToken || '').split('_');
  if (parts.length >= 2) {
    const raw = parts[1];
    // Strip country code 91 if 12 digits
    waMobile = (raw.length === 12 && raw.startsWith('91')) ? raw.slice(2) : raw;
  }

  try {
    const db = getDb();

    // Save pending_registrations — webhook will pick this up when user sends photo
    await db.collection('pending_registrations').updateOne(
      { mobile: waMobile || epic_no }, // fallback key if no mobile parsed
      {
        $set: {
          epic_no,
          voter_name,
          assembly_name,
          district,
          mobile:     waMobile,
          wa_number:  parts[1] || '',
          status:     'awaiting_photo',
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true },
    );

    console.log(`[Flow] Pending registration saved for ${waMobile || epic_no}`);

    return {
      screen: 'SUCCESS',
      data: { epic_no, voter_name },
    };
  } catch (err) {
    console.error('[Flow] handleConfirmDetails error:', err.message);
    return {
      screen: 'CONFIRM_DETAILS',
      data: {
        epic_no, voter_name, assembly_name, district,
      },
    };
  }
}

// ── Login: send OTP ───────────────────────────────────────────────

async function handleSendOtp(body) {
  const raw = (body.data?.mobile || '').trim().replace(/\D/g, '');
  const { valid, value: mobile } = validateMobile(raw);
  if (!valid) {
    return { screen: 'MOBILE_INPUT', data: { error_message: 'Enter a valid 10-digit mobile number.', show_error: true } };
  }

  try {
    const db  = getDb();
    const doc = await db.collection('otp_sessions').findOne({ mobile }, { projection: { created_at: 1 } });
    if (doc?.created_at) {
      const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 1000;
      if (elapsed < 60) {
        return { screen: 'MOBILE_INPUT', data: { error_message: `Wait ${Math.ceil(60 - elapsed)}s before requesting another OTP.`, show_error: true } };
      }
    }

    const otp    = String(crypto.randomInt(100000, 1000000));
    const result = await sendOtp(mobile, otp);
    if (!result.success) {
      return { screen: 'MOBILE_INPUT', data: { error_message: 'Could not send OTP. Please try again.', show_error: true } };
    }

    const otpHash = crypto.createHash('sha256').update(`${otp}:${mobile}`).digest('hex');
    await db.collection('otp_sessions').updateOne(
      { mobile },
      { $set: { otp_hash: otpHash, created_at: new Date(), verified: false, purpose: 'login' } },
      { upsert: true },
    );

    return { screen: 'OTP_VERIFY', data: { mobile, error_message: '', show_error: false } };
  } catch (err) {
    console.error('[Flow] SendOTP error:', err.message);
    return { screen: 'MOBILE_INPUT', data: { error_message: 'Server error. Please try again.', show_error: true } };
  }
}

// ── Login: verify OTP ─────────────────────────────────────────────

async function handleVerifyOtp(body) {
  const mobile = (body.data?.mobile || '').trim();
  const otp    = (body.data?.otp    || '').trim();
  const { valid: vm, value: validMobile } = validateMobile(mobile);
  const { valid: vo, value: validOtp    } = validateOtp(otp);

  if (!vm || !vo) {
    return { screen: 'OTP_VERIFY', data: { mobile, error_message: 'Invalid mobile or OTP.', show_error: true } };
  }

  try {
    const db  = getDb();
    const doc = await db.collection('otp_sessions').findOne({ mobile: validMobile });
    if (!doc || doc.purpose !== 'login') {
      return { screen: 'OTP_VERIFY', data: { mobile, error_message: 'OTP not found. Request a new one.', show_error: true } };
    }

    const computed = crypto.createHash('sha256').update(`${validOtp}:${validMobile}`).digest('hex');
    let match = false;
    try {
      match = crypto.timingSafeEqual(
        Buffer.from(computed,        'hex'),
        Buffer.from(doc.otp_hash || '', 'hex'),
      );
    } catch { match = false; }

    if (!match) return { screen: 'OTP_VERIFY', data: { mobile, error_message: 'Incorrect OTP. Try again.', show_error: true } };

    const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 1000;
    if (elapsed > 300) return { screen: 'OTP_VERIFY', data: { mobile, error_message: 'OTP expired. Go back and request a new one.', show_error: true } };

    await db.collection('otp_sessions').deleteOne({ mobile: validMobile });
    const stat   = await db.collection('generation_stats').findOne({ auth_mobile: validMobile }) || {};
    const genDoc = await db.collection('generated_voters').findOne({ MOBILE_NO: validMobile })   || {};

    return { screen: 'SUCCESS', data: { mobile: validMobile, epic_no: stat.epic_no || genDoc.EPIC_NO || '' } };
  } catch (err) {
    console.error('[Flow] VerifyOTP error:', err.message);
    return { screen: 'OTP_VERIFY', data: { mobile, error_message: 'Server error. Please try again.', show_error: true } };
  }
}

module.exports = router;
