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
    // Signature check is optional for flow endpoint — encryption is the
    // primary security mechanism. Meta's publish health check does NOT
    // send x-hub-signature-256, only runtime data_exchange calls do.
    // If sig header is present, validate it; if absent, allow through.
    const sigHeader = req.headers['x-hub-signature-256'];
    if (sigHeader && !isSignatureValid(req.rawBody || '', sigHeader)) {
      console.warn('[Flow] Invalid request signature — rejected');
      return res.status(432).send();
    }

    const privatePem = (config.whatsapp.flowPrivateKey || '')
      .replace(/\\\\n/g, '\n').replace(/\\n/g, '\n').trim();

    if (!privatePem) {
      console.error('[Flow] ⚠️  WHATSAPP_FLOW_PRIVATE_KEY not set in env');
      return handleUnencrypted(req, res);
    }

    // If body lacks encryption fields → unencrypted ping (Meta publish health check)
    const body = req.body || {};
    if (!body.encrypted_aes_key || !body.encrypted_flow_data) {
      console.log('[Flow] Unencrypted request (no encrypted fields) — handling as plain');
      return handleUnencrypted(req, res);
    }

    let decryptedBody, aesKeyBuffer, initialVectorBuffer;
    try {
      ({ decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(body, privatePem));
    } catch (err) {
      console.error('[Flow] Decrypt error:', err.message, err.stack);
      // 421 → Meta will refresh cached public key
      // For any other error return 200 with active so Meta doesn't mark endpoint down
      if (err.statusCode === 421) return res.status(421).send();
      return res
        .set('Content-Type', 'application/json')
        .json({ encrypted_response: encryptResponse({ data: { status: 'active' } }, 
          crypto.randomBytes(16), crypto.randomBytes(16)) });
    }

    console.log('[Flow] Body:', JSON.stringify(decryptedBody).slice(0, 150));

    let screenResponse;
    try {
      screenResponse = await buildResponse(decryptedBody);
    } catch (err) {
      console.error('[Flow] buildResponse error:', err.message, 'Stack:', err.stack);
      screenResponse = { data: { status: 'active' } }; // safe fallback for ping
    }

    // WhatsApp Flows requires the response body to be the raw base64-encoded
    // encrypted string — NOT a JSON wrapper like { encrypted_response: "..." }
    try {
      const encryptedResp = encryptResponse(screenResponse, aesKeyBuffer, initialVectorBuffer);
      console.log(`[Flow] Encrypted response size: ${encryptedResp.length} bytes`);
      return res
        .set('Content-Type', 'text/plain')
        .status(200)
        .send(encryptedResp);
    } catch (err) {
      console.error('[Flow] Encryption error:', err.message, 'Response was:', JSON.stringify(screenResponse).slice(0, 200));
      // Last-ditch fallback — encrypt a safe active payload
      try {
        const fallback = encryptResponse({ data: { status: 'active' } }, aesKeyBuffer, initialVectorBuffer);
        return res.set('Content-Type', 'text/plain').status(200).send(fallback);
      } catch (_) {
        return res.status(500).send();
      }
    }
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
  } catch (e) { 
    console.warn('[Flow] Check existing EPIC error (non-fatal):', e.message);
  }

  // Lookup voter from DB1 with timeout handling
  try {
    console.log(`[Flow] Looking up EPIC: ${epicNo}`);
    const voter = await findVoterByEpic(epicNo);
    
    if (!voter) {
      console.log(`[Flow] EPIC not found in DB1: ${epicNo}`);
      return {
        screen: 'EPIC_ENTRY',
        data: { error_message: 'EPIC not found. Please check your Voter ID card and try again.', show_error: true },
      };
    }

    // Build voter name — strip trailing punctuation/spaces from partial name fields
    const rawName = (voter.VOTER_NAME
      || `${voter.FM_NAME_EN || ''} ${voter.LASTNAME_EN || ''}`.trim()
      || `${voter.FM_NAME_V1 || ''} ${voter.LASTNAME_V1 || ''}`.trim()
      || 'Unknown').trim().replace(/[\s\-–—]+$/, '').trim();
    const voterName    = (rawName || 'Unknown').slice(0, 100);

    // Assembly and district — WhatsApp Flow TextBody cannot be empty string,
    // so always fall back to a non-empty placeholder
    const rawAssembly  = (voter.ASSEMBLY_NAME || voter.AC_NAME || '').trim().slice(0, 100);
    const rawDistrict  = (voter.DISTRICT || voter.DISTRICT_NAME || '').trim().slice(0, 100);
    const assemblyName = rawAssembly  || 'N/A';
    const district     = rawDistrict  || 'N/A';

    console.log(`[Flow] EPIC found: ${epicNo} → name="${voterName}" assembly="${assemblyName}" district="${district}"`);
    
    const responsePayload = {
      screen: 'CONFIRM_DETAILS',
      data: { epic_no: epicNo, voter_name: voterName, assembly_name: assemblyName, district },
    };
    
    console.log(`[Flow] Returning CONFIRM_DETAILS:`, JSON.stringify(responsePayload));
    
    return responsePayload;
  } catch (err) {
    console.error('[Flow] EPIC lookup error:', err.message, 'Stack:', err.stack);
    // Check if it's a timeout — provide a more helpful message
    if (err.message?.includes('timeout') || err.message?.includes('ECONNREFUSED') || err.message?.includes('not connected')) {
      return {
        screen: 'EPIC_ENTRY',
        data: { 
          error_message: 'Database is busy. Please wait a moment and try again.', 
          show_error: true 
        },
      };
    }
    return {
      screen: 'EPIC_ENTRY',
      data: { error_message: 'Server error. Please try again.', show_error: true },
    };
  }
}

// ── Registration: Step 2 — confirm details, save pending ─────────
// flow_token format: "registration_{WA_number}_{timestamp}"

async function handleConfirmDetails(body, flowToken) {
  const epic_no       = (body.data?.epic_no       || '').trim().toUpperCase();
  const voter_name    = (body.data?.voter_name    || '').trim();
  const assembly_name = (body.data?.assembly_name || '').trim();
  const district      = (body.data?.district      || '').trim();

  // Extract WA number from flow_token: "registration_918106811285_1234567890"
  let waMobile = '';
  let waNumber = '';
  const parts = (flowToken || '').split('_');
  if (parts.length >= 2) {
    const raw = parts[1];
    waNumber  = raw;
    // Strip country code 91 if 12 digits to get local 10-digit mobile
    waMobile  = (raw.length === 12 && raw.startsWith('91')) ? raw.slice(2) : raw;
  }

  try {
    const db = getDb();

    // Save pending_registrations — webhook will pick this up when user sends photo
    await db.collection('pending_registrations').updateOne(
      { mobile: waMobile || epic_no },
      {
        $set: {
          epic_no,
          voter_name,
          assembly_name,
          district,
          mobile:     waMobile,
          wa_number:  waNumber,
          status:     'awaiting_photo',
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true },
    );

    console.log(`[Flow] Pending registration saved for ${waMobile || epic_no}`);

    // Send photo-prompt message immediately after confirmation.
    // Sends a web upload link (crop + upload page) so the user can upload
    // their photo via browser even if Puppeteer/Chrome is unavailable on server.
    const waTo = waNumber || ('91' + waMobile);
    if (waTo) {
      const { sendTextMessage } = require('../services/whatsappService');
      const { makeUploadToken } = require('./upload');
      const displayName = voter_name || 'Member';
      const uploadUrl = `${require('../config').baseUrl}/upload/${makeUploadToken(waMobile, epic_no)}`;
      setImmediate(async () => {
        try {
          await sendTextMessage(
            waTo,
            `✅ *Details Confirmed!*\n\nHi *${displayName}*! Your voter details have been verified.\n\nTo generate your *Digital Member ID Card*, tap the link below to upload your passport-size photo:\n\n📸 *${uploadUrl}*\n\nOr simply send your photo directly in this chat.\n\n📌 *Tips for a good photo:*\n• Clear face, good lighting\n• Plain background preferred\n• No sunglasses`,
          );
          console.log(`[Flow] Photo-prompt + upload link sent to ${waTo}`);
        } catch (err) {
          console.error(`[Flow] Could not send photo-prompt to ${waTo}:`, err.message);
        }
      });
    }

    return {
      screen: 'SUCCESS',
      data: { epic_no, voter_name },
    };
  } catch (err) {
    console.error('[Flow] handleConfirmDetails error:', err.message);
    return {
      screen: 'CONFIRM_DETAILS',
      data: { epic_no, voter_name, assembly_name, district },
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
