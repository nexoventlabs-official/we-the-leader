/**
 * WhatsApp Flows Data Endpoint
 * ─────────────────────────────────────────────────────────────────
 * POST /api/webhook/flow
 *
 * Meta Flow requests are AES-128-GCM encrypted with a key that is
 * itself RSA-OAEP-SHA256 encrypted using the public key we uploaded
 * to Meta.  We decrypt with our private key, process the screen
 * action, then re-encrypt the response.
 *
 * CRITICAL — response format (per Meta official sample):
 *   res.send(base64string)   ← raw base64, NOT JSON wrapper
 *
 * Health-check ping response (decrypted ping body → encrypted back):
 *   { data: { status: "active" } }    ← no "version" field
 *
 * On RSA decrypt failure → return HTTP 421 so Meta refreshes its
 * cached public key.
 *
 * Ref: https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
 */

'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const config  = require('../config');
const { getDb, findVoterByEpic } = require('../db');
const { sendOtp }                = require('../services/smsService');
const { validateMobile, validateEpic, validateOtp } = require('../utils/validators');

// ── RSA + AES helpers (matching Meta's official Node.js sample) ───

/**
 * Decrypt an incoming Meta Flow request.
 * Returns { decryptedBody, aesKeyBuffer, initialVectorBuffer }
 * Throws FlowEndpointException(421) if RSA decryption fails.
 */
function decryptRequest(body, privatePem) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  // 1. RSA-OAEP-SHA256 decrypt the AES key
  const privateKey = crypto.createPrivateKey({ key: privatePem });
  let aesKeyBuffer;
  try {
    aesKeyBuffer = crypto.privateDecrypt(
      {
        key:     privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(encrypted_aes_key, 'base64'),
    );
  } catch (err) {
    console.error('[Flow] RSA decrypt failed:', err.message);
    // 421 → Meta will refresh its cached public key
    const e = new Error('Failed to decrypt AES key. Verify private key.');
    e.statusCode = 421;
    throw e;
  }

  // 2. AES-128-GCM decrypt the flow data
  const flowDataBuf = Buffer.from(encrypted_flow_data, 'base64');
  const ivBuf       = Buffer.from(initial_vector, 'base64');
  const TAG_LENGTH  = 16;
  const encData     = flowDataBuf.subarray(0, -TAG_LENGTH);
  const authTag     = flowDataBuf.subarray(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKeyBuffer, ivBuf);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encData), decipher.final()]);

  return {
    decryptedBody:       JSON.parse(decrypted.toString('utf-8')),
    aesKeyBuffer,
    initialVectorBuffer: ivBuf,
  };
}

/**
 * Encrypt our response object back to the client.
 * Returns a raw base64 string — send it directly with res.send().
 */
function encryptResponse(responseObj, aesKeyBuffer, initialVectorBuffer) {
  // Flip every bit of the IV for the response direction
  const flippedIv = Buffer.from(initialVectorBuffer.map(b => ~b & 0xff));

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKeyBuffer, flippedIv);
  return Buffer.concat([
    cipher.update(JSON.stringify(responseObj), 'utf-8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}

// ── Request signature verification ───────────────────────────────

function isSignatureValid(rawBody, sigHeader) {
  const appSecret = config.whatsapp.appSecret;
  if (!appSecret) {
    console.warn('[Flow] WHATSAPP_APP_SECRET not set — skipping signature check');
    return true; // allow in development
  }
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const sig  = sigHeader.slice('sha256='.length);
  const hmac = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(sig,  'utf-8'),
      Buffer.from(hmac, 'utf-8'),
    );
  } catch {
    return false;
  }
}

// ── POST /api/webhook/flow ────────────────────────────────────────

router.post(
  '/',
  // Store raw body for signature verification, then parse JSON
  express.json({
    verify: (req, _res, buf, encoding) => {
      req.rawBody = buf?.toString(encoding || 'utf-8');
    },
  }),
  async (req, res) => {
    // 1. Signature check
    if (!isSignatureValid(req.rawBody || '', req.headers['x-hub-signature-256'])) {
      console.warn('[Flow] Invalid request signature — rejected');
      return res.status(432).send();
    }

    // 2. Resolve private key (handle both \\n and \n in .env)
    const privatePem = (config.whatsapp.flowPrivateKey || '')
      .replace(/\\\\n/g, '\n')
      .replace(/\\n/g,   '\n')
      .trim();

    // 3. No private key → unencrypted mode (dev / plain health checks)
    if (!privatePem) {
      return handleUnencrypted(req, res);
    }

    // 4. Decrypt
    let decryptedBody, aesKeyBuffer, initialVectorBuffer;
    try {
      ({ decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(req.body, privatePem));
    } catch (err) {
      console.error('[Flow] Decrypt error:', err.message);
      const code = err.statusCode || 500;
      return res.status(code).send();
    }

    console.log('[Flow] Decrypted body:', JSON.stringify(decryptedBody).slice(0, 120));

    // 5. Build screen response
    let screenResponse;
    try {
      screenResponse = await buildResponse(decryptedBody);
    } catch (err) {
      console.error('[Flow] buildResponse error:', err.message);
      screenResponse = errorScreen(decryptedBody, 'Internal server error. Please try again.');
    }

    console.log('[Flow] Response:', JSON.stringify(screenResponse).slice(0, 120));

    // 6. Encrypt and send raw base64 (NOT wrapped in JSON)
    const encrypted = encryptResponse(screenResponse, aesKeyBuffer, initialVectorBuffer);
    return res.send(encrypted);
  },
);

// ── Unencrypted handler (dev mode / no private key) ──────────────

async function handleUnencrypted(req, res) {
  const body = req.body || {};
  // Plain ping
  if (body.action === 'ping') {
    return res.json({ data: { status: 'active' } });
  }
  try {
    const response = await buildResponse(body);
    return res.json(response);
  } catch (err) {
    console.error('[Flow] Unencrypted handler error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Core response builder ─────────────────────────────────────────

async function buildResponse(body) {
  const { action, screen, data = {} } = body;

  // ── Health check ──────────────────────────────────────────────
  if (action === 'ping') {
    return { data: { status: 'active' } };
  }

  // ── Client error notification ─────────────────────────────────
  if (data?.error) {
    console.warn('[Flow] Client error received:', data.error);
    return { data: { acknowledged: true } };
  }

  // ── INIT — flow opened for first time ─────────────────────────
  // Registration flow: start at WELCOME (navigate, no data_exchange)
  // Login flow: start at MOBILE_INPUT (navigate, no data_exchange)
  // INIT only fires for screens that use data_exchange on INIT.
  // Our flows use navigate for the first screen so INIT won't hit
  // but we handle it defensively.
  if (action === 'INIT') {
    // Return data for the first screen — both flows start with empty state
    return {
      screen: screen || 'MOBILE_INPUT',
      data:   { error_message: '' },
    };
  }

  // ── data_exchange ─────────────────────────────────────────────
  if (action === 'data_exchange') {
    const currentScreen = data.screen || screen;

    switch (currentScreen) {
      // Registration flow: EPIC_ENTRY — validate voter ID
      case 'EPIC_ENTRY':
        return handleValidateEpic(body);

      // Login flow: MOBILE_INPUT — send OTP
      case 'MOBILE_INPUT':
        return handleSendOtp(body);

      // Login flow: OTP_VERIFY — verify OTP
      case 'OTP_VERIFY':
        return handleVerifyOtp(body);

      default:
        console.error('[Flow] Unknown data_exchange screen:', currentScreen);
        return errorScreen(body, 'Unknown screen. Please restart.');
    }
  }

  console.error('[Flow] Unhandled action:', action, 'screen:', screen);
  return errorScreen(body, 'Unexpected request. Please restart the flow.');
}

// ── Screen helpers ────────────────────────────────────────────────

function errorScreen(body, message) {
  // Return user back to current screen with error message
  const current = body?.data?.screen || body?.screen;
  const safeScreen = ['MOBILE_INPUT', 'OTP_VERIFY', 'EPIC_ENTRY', 'CONFIRM_DETAILS'].includes(current)
    ? current
    : 'MOBILE_INPUT';
  return {
    screen: safeScreen,
    data:   { error_message: message },
  };
}

// ── Validate EPIC (Registration flow: EPIC_ENTRY) ─────────────────

async function handleValidateEpic(body) {
  const epic_no = ((body.data?.epic_no || body.data?.form?.epic_no) || '').trim().toUpperCase();
  const mobile  = (body.data?.mobile  || '').trim();

  const { valid, value: epicNo } = validateEpic(epic_no);
  if (!valid) {
    return {
      screen: 'EPIC_ENTRY',
      data: {
        error_message: 'Invalid EPIC format. Use 3 letters + 7 digits (e.g. TNA1234567)',
        mobile,
      },
    };
  }

  try {
    const voter = await findVoterByEpic(epicNo);
    if (!voter) {
      return {
        screen: 'EPIC_ENTRY',
        data: {
          error_message: 'Voter not found. Please check your EPIC Number.',
          mobile,
        },
      };
    }

    const voterName    = voter.VOTER_NAME
      || `${voter.FM_NAME_EN  || ''} ${voter.LASTNAME_EN  || ''}`.trim()
      || `${voter.FM_NAME_TAM || ''} ${voter.LASTNAME_TAM || ''}`.trim()
      || 'Unknown';
    const assemblyName = voter.ASSEMBLY_NAME || voter.AC_NAME || '';
    const district     = voter.DISTRICT || voter.DISTRICT_NAME || '';

    return {
      screen: 'CONFIRM_DETAILS',
      data: {
        mobile,
        epic_no:       epicNo,
        voter_name:    voterName,
        assembly_name: assemblyName,
        district,
      },
    };
  } catch (err) {
    console.error('[Flow] EPIC lookup error:', err.message);
    return {
      screen: 'EPIC_ENTRY',
      data: {
        error_message: 'Server error. Please try again.',
        mobile,
      },
    };
  }
}

// ── Send OTP (Login flow: MOBILE_INPUT) ───────────────────────────

async function handleSendOtp(body) {
  const raw    = (body.data?.mobile || body.data?.form?.mobile || '').trim().replace(/\D/g, '');
  const { valid, value: mobile } = validateMobile(raw);

  if (!valid) {
    return {
      screen: 'MOBILE_INPUT',
      data:   { error_message: 'Enter a valid 10-digit mobile number.' },
    };
  }

  try {
    const db  = getDb();
    const doc = await db.collection('otp_sessions').findOne(
      { mobile },
      { projection: { created_at: 1 } },
    );

    if (doc?.created_at) {
      const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 1000;
      if (elapsed < 60) {
        const wait = Math.ceil(60 - elapsed);
        return {
          screen: 'MOBILE_INPUT',
          data:   { error_message: `Please wait ${wait}s before requesting another OTP.` },
        };
      }
    }

    const otp    = String(crypto.randomInt(100000, 1000000));
    const result = await sendOtp(mobile, otp);

    if (!result.success) {
      return {
        screen: 'MOBILE_INPUT',
        data:   { error_message: 'Could not send OTP. Please try again.' },
      };
    }

    const otpHash = crypto.createHash('sha256').update(`${otp}:${mobile}`).digest('hex');
    await db.collection('otp_sessions').updateOne(
      { mobile },
      { $set: { otp_hash: otpHash, created_at: new Date(), verified: false, purpose: 'login' } },
      { upsert: true },
    );

    return {
      screen: 'OTP_VERIFY',
      data:   { mobile, error_message: '' },
    };
  } catch (err) {
    console.error('[Flow] SendOTP error:', err.message);
    return {
      screen: 'MOBILE_INPUT',
      data:   { error_message: 'Server error. Please try again.' },
    };
  }
}

// ── Verify OTP (Login flow: OTP_VERIFY) ───────────────────────────

async function handleVerifyOtp(body) {
  const mobile = (body.data?.mobile || '').trim();
  const otp    = (body.data?.otp || body.data?.form?.otp || '').trim();

  const { valid: vm, value: validMobile } = validateMobile(mobile);
  const { valid: vo, value: validOtp    } = validateOtp(otp);

  if (!vm || !vo) {
    return {
      screen: 'OTP_VERIFY',
      data:   { mobile, error_message: 'Invalid mobile or OTP format.' },
    };
  }

  try {
    const db  = getDb();
    const doc = await db.collection('otp_sessions').findOne({ mobile: validMobile });

    if (!doc || doc.purpose !== 'login') {
      return {
        screen: 'OTP_VERIFY',
        data:   { mobile, error_message: 'OTP not found. Please request a new one.' },
      };
    }

    const computed = crypto.createHash('sha256').update(`${validOtp}:${validMobile}`).digest('hex');
    let match = false;
    try {
      match = crypto.timingSafeEqual(
        Buffer.from(computed,        'hex'),
        Buffer.from(doc.otp_hash || '', 'hex'),
      );
    } catch { match = false; }

    if (!match) {
      return {
        screen: 'OTP_VERIFY',
        data:   { mobile, error_message: 'Incorrect OTP. Please try again.' },
      };
    }

    const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 1000;
    if (elapsed > 300) {
      return {
        screen: 'OTP_VERIFY',
        data:   { mobile, error_message: 'OTP expired. Go back and request a new one.' },
      };
    }

    // Invalidate OTP
    await db.collection('otp_sessions').deleteOne({ mobile: validMobile });

    // Look up member info
    const stat   = await db.collection('generation_stats').findOne({ auth_mobile: validMobile }) || {};
    const genDoc = await db.collection('generated_voters').findOne({ MOBILE_NO: validMobile })   || {};
    const epic   = stat.epic_no || genDoc.EPIC_NO || '';

    return {
      screen: 'SUCCESS',
      data: {
        mobile:  validMobile,
        epic_no: epic,
      },
    };
  } catch (err) {
    console.error('[Flow] VerifyOTP error:', err.message);
    return {
      screen: 'OTP_VERIFY',
      data:   { mobile, error_message: 'Server error. Please try again.' },
    };
  }
}

module.exports = router;
