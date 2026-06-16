/**
 * WhatsApp Flow Endpoint
 * ──────────────────────────────────────────────────────────────────
 * POST /api/webhook/flow
 *
 * Handles:
 *  1. Health check — Meta sends an encrypted ping to verify the endpoint
 *     is live before allowing publish. Decrypt → respond with version.
 *  2. data_exchange — Called when user submits a screen with
 *     on-click-action.name === "data_exchange".
 *
 * Encryption:
 *  - Meta encrypts the request body with the app's public key.
 *  - We decrypt with the private key (WHATSAPP_FLOW_PRIVATE_KEY).
 *  - Response is AES-128-GCM encrypted back using the aes_key + iv from payload.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/flows/guides/endpoint
 */
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const config  = require('../config');
const { getDb, findVoterByEpic } = require('../db');
const { sendOtp } = require('../services/smsService');
const { validateMobile, validateEpic, validateOtp } = require('../utils/validators');

// ── Decrypt helper ────────────────────────────────────────────────
function decryptRequest(body, privatePem) {
  const {
    encrypted_aes_key,
    encrypted_flow_data,
    initial_vector,
  } = body;

  // 1. Decrypt the AES key with our RSA private key
  const decryptedAesKey = crypto.privateDecrypt(
    {
      key: privatePem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encrypted_aes_key, 'base64')
  );

  // 2. Decrypt flow data with AES-128-GCM
  const flowDataBuffer = Buffer.from(encrypted_flow_data, 'base64');
  const ivBuffer       = Buffer.from(initial_vector, 'base64');

  // Last 16 bytes are the auth tag
  const TAG_LENGTH    = 16;
  const encryptedData = flowDataBuffer.slice(0, -TAG_LENGTH);
  const authTag       = flowDataBuffer.slice(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-128-gcm', decryptedAesKey, ivBuffer);
  decipher.setAuthTag(authTag);

  const decryptedData = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);

  return {
    decryptedBody:   JSON.parse(decryptedData.toString('utf8')),
    aesKeyBuffer:    decryptedAesKey,
    ivBuffer,
  };
}

// ── Encrypt helper ────────────────────────────────────────────────
function encryptResponse(responseObj, aesKeyBuffer, ivBuffer) {
  // Flip all bits of the IV for the response
  const flippedIv = Buffer.from(ivBuffer.map(b => ~b & 0xff));

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKeyBuffer, flippedIv);
  const data   = Buffer.from(JSON.stringify(responseObj), 'utf8');

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag       = cipher.getAuthTag();

  return Buffer.concat([encrypted, tag]).toString('base64');
}

// ── POST /api/webhook/flow ────────────────────────────────────────
router.post('/', express.json(), async (req, res) => {
  const privatePem = (config.whatsapp.flowPrivateKey || '').replace(/\\n/g, '\n');

  // If no private key configured, return 421 so Meta knows to skip encryption
  if (!privatePem) {
    // Unencrypted mode — for dev/testing only
    return handleUnencrypted(req, res);
  }

  try {
    const { decryptedBody, aesKeyBuffer, ivBuffer } = decryptRequest(req.body, privatePem);

    // Build response
    const responsePayload = await buildResponse(decryptedBody);

    // Encrypt and return
    const encrypted = encryptResponse(responsePayload, aesKeyBuffer, ivBuffer);
    return res.json({ encrypted_response: encrypted });
  } catch (err) {
    console.error('[FlowEndpoint] Decrypt/encrypt error:', err.message);
    return res.status(421).json({ error: 'decryption_failed' });
  }
});

// ── Unencrypted handler (dev / no key set) ────────────────────────
async function handleUnencrypted(req, res) {
  try {
    const body     = req.body || {};
    const response = await buildResponse(body);
    return res.json(response);
  } catch (err) {
    console.error('[FlowEndpoint] Unencrypted handler error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Core response builder ─────────────────────────────────────────
async function buildResponse(body) {
  const action = body.action;

  // Health check — Meta sends this to verify endpoint is live
  if (action === 'ping') {
    return {
      version: body.version || '3.0',
      data:    { status: 'active' },
    };
  }

  const screen  = body.screen;
  const data    = body.data || {};
  const payload = body.data?.['__payload__'] || data; // payload key varies

  // ── EPIC validation (Registration flow: EPIC_ENTRY screen) ───────
  if (screen === 'EPIC_ENTRY' || data.action === 'validate_epic') {
    return await handleValidateEpic(body);
  }

  // ── Send OTP (Login flow: MOBILE_INPUT screen) ───────────────────
  if (screen === 'MOBILE_INPUT' || data.action === 'send_otp') {
    return await handleSendOtp(body);
  }

  // ── Verify OTP (Login flow: OTP_VERIFY screen) ───────────────────
  if (screen === 'OTP_VERIFY' || data.action === 'verify_otp') {
    return await handleVerifyOtp(body);
  }

  // Unknown screen — return error screen
  return {
    version: body.version || '3.0',
    screen:  'ERROR',
    data:    { error_message: 'Unknown action' },
  };
}

// ── Validate EPIC (Registration flow) ────────────────────────────
async function handleValidateEpic(body) {
  const epic_no = (body.data?.epic_no || '').trim().toUpperCase();
  const mobile  = (body.data?.mobile  || '').trim();

  const { valid, value: epicNo } = validateEpic(epic_no);
  if (!valid) {
    return {
      version: body.version || '3.0',
      screen:  'EPIC_ENTRY',
      data: {
        error_message: 'Invalid EPIC format. Use 3 letters + 7 digits (e.g. ABC1234567)',
        mobile,
      },
    };
  }

  try {
    const voter = await findVoterByEpic(epicNo);
    if (!voter) {
      return {
        version: body.version || '3.0',
        screen:  'EPIC_ENTRY',
        data: {
          error_message: 'Voter not found. Please check your EPIC Number.',
          mobile,
        },
      };
    }

    const voterName    = voter.VOTER_NAME || `${voter.FM_NAME_EN || ''} ${voter.LASTNAME_EN || ''}`.trim();
    const assemblyName = voter.ASSEMBLY_NAME || '';
    const district     = voter.DISTRICT     || voter.DISTRICT_NAME || '';

    return {
      version: body.version || '3.0',
      screen:  'CONFIRM_DETAILS',
      data: {
        mobile,
        epic_no:       epicNo,
        voter_name:    voterName,
        assembly_name: assemblyName,
        district,
      },
    };
  } catch (err) {
    console.error('[FlowEndpoint] EPIC lookup error:', err.message);
    return {
      version: body.version || '3.0',
      screen:  'EPIC_ENTRY',
      data: {
        error_message: 'Server error. Please try again.',
        mobile,
      },
    };
  }
}

// ── Send OTP (Login flow) ─────────────────────────────────────────
async function handleSendOtp(body) {
  const mobile = (body.data?.mobile || '').trim().replace(/\D/g, '');

  const { valid, value: validMobile } = validateMobile(mobile);
  if (!valid) {
    return {
      version: body.version || '3.0',
      screen:  'MOBILE_INPUT',
      data: { error_message: 'Please enter a valid 10-digit mobile number.' },
    };
  }

  try {
    const db  = getDb();
    const doc = await db.collection('otp_sessions').findOne(
      { mobile: validMobile }, { projection: { created_at: 1 } }
    );

    if (doc?.created_at) {
      const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 1000;
      if (elapsed < 60) {
        const wait = Math.ceil(60 - elapsed);
        return {
          version: body.version || '3.0',
          screen:  'MOBILE_INPUT',
          data: { error_message: `Please wait ${wait}s before requesting another OTP.` },
        };
      }
    }

    const otp    = String(crypto.randomInt(100000, 1000000));
    const result = await sendOtp(validMobile, otp);

    if (!result.success) {
      return {
        version: body.version || '3.0',
        screen:  'MOBILE_INPUT',
        data: { error_message: 'Could not send OTP. Please try again.' },
      };
    }

    const otpHash = crypto.createHash('sha256').update(`${otp}:${validMobile}`).digest('hex');
    await db.collection('otp_sessions').updateOne(
      { mobile: validMobile },
      { $set: { otp_hash: otpHash, created_at: new Date(), verified: false, purpose: 'login' } },
      { upsert: true }
    );

    return {
      version: body.version || '3.0',
      screen:  'OTP_VERIFY',
      data:    { mobile: validMobile },
    };
  } catch (err) {
    console.error('[FlowEndpoint] SendOTP error:', err.message);
    return {
      version: body.version || '3.0',
      screen:  'MOBILE_INPUT',
      data: { error_message: 'Server error. Please try again.' },
    };
  }
}

// ── Verify OTP (Login flow) ───────────────────────────────────────
async function handleVerifyOtp(body) {
  const mobile = (body.data?.mobile || '').trim();
  const otp    = (body.data?.otp    || '').trim();

  const { valid: vm, value: validMobile } = validateMobile(mobile);
  const { valid: vo, value: validOtp    } = validateOtp(otp);

  if (!vm || !vo) {
    return {
      version: body.version || '3.0',
      screen:  'OTP_VERIFY',
      data: { mobile, error_message: 'Invalid mobile or OTP.' },
    };
  }

  try {
    const db  = getDb();
    const doc = await db.collection('otp_sessions').findOne({ mobile: validMobile });

    if (!doc || doc.purpose !== 'login') {
      return {
        version: body.version || '3.0',
        screen:  'OTP_VERIFY',
        data: { mobile, error_message: 'Invalid OTP. Please try again.' },
      };
    }

    const computed = crypto.createHash('sha256').update(`${validOtp}:${validMobile}`).digest('hex');
    let match = false;
    try {
      match = crypto.timingSafeEqual(
        Buffer.from(computed, 'hex'),
        Buffer.from(doc.otp_hash || '', 'hex')
      );
    } catch { match = false; }

    if (!match) {
      return {
        version: body.version || '3.0',
        screen:  'OTP_VERIFY',
        data: { mobile, error_message: 'Invalid OTP. Please try again.' },
      };
    }

    const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 1000;
    if (elapsed > 300) {
      return {
        version: body.version || '3.0',
        screen:  'OTP_VERIFY',
        data: { mobile, error_message: 'OTP expired. Please go back and request a new one.' },
      };
    }

    // Delete OTP after successful use
    await db.collection('otp_sessions').deleteOne({ mobile: validMobile });

    // Fetch card info if available
    const stat   = await db.collection('generation_stats').findOne({ auth_mobile: validMobile }) || {};
    const genDoc = await db.collection('generated_voters').findOne({ MOBILE_NO: validMobile })   || {};

    return {
      version: body.version || '3.0',
      screen:  'SUCCESS',
      data: {
        mobile:   validMobile,
        epic_no:  stat.epic_no  || genDoc.EPIC_NO  || '',
        card_url: stat.card_url || genDoc.card_url || '',
      },
    };
  } catch (err) {
    console.error('[FlowEndpoint] VerifyOTP error:', err.message);
    return {
      version: body.version || '3.0',
      screen:  'OTP_VERIFY',
      data: { mobile, error_message: 'Server error. Please try again.' },
    };
  }
}

module.exports = router;
