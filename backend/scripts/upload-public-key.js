/**
 * Upload the RSA public key to Meta for WhatsApp Flow encryption.
 *
 * Meta uses this public key to encrypt flow requests sent to your endpoint.
 * Your endpoint decrypts them using the matching private key (WHATSAPP_FLOW_PRIVATE_KEY).
 *
 * Run this whenever you regenerate your RSA keypair.
 *
 * Usage:  node scripts/upload-public-key.js
 *
 * Required .env keys:
 *   WHATSAPP_ACCESS_TOKEN
 *   WHATSAPP_PHONE_NUMBER_ID
 *   WHATSAPP_FLOW_PRIVATE_KEY   (to derive the public key from)
 */
require('dotenv').config();
const axios  = require('axios');
const crypto = require('crypto');

const ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const GRAPH_VERSION   = 'v22.0';

if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
  console.error('❌  WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be set in .env');
  process.exit(1);
}

// Derive public key from the private key in .env
// Handle both single-escaped (\n) and double-escaped (\\n) newlines
const privatePem = (process.env.WHATSAPP_FLOW_PRIVATE_KEY || '')
  .replace(/\\\\n/g, '\n')  // double-escaped: \\n → newline
  .replace(/\\n/g, '\n');   // single-escaped: \n  → newline
if (!privatePem) {
  console.error('❌  WHATSAPP_FLOW_PRIVATE_KEY is not set in .env');
  process.exit(1);
}

let publicKeyPem;
try {
  const privKey = crypto.createPrivateKey(privatePem);
  const pubKey  = crypto.createPublicKey(privKey);
  publicKeyPem  = pubKey.export({ type: 'spki', format: 'pem' });
  console.log('✅  Public key derived from private key');
} catch (err) {
  console.error('❌  Failed to parse WHATSAPP_FLOW_PRIVATE_KEY:', err.message);
  process.exit(1);
}

(async () => {
  console.log('\n══════════════════════════════════════════════');
  console.log('  WTL — Upload Public Key to Meta');
  console.log('══════════════════════════════════════════════\n');

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/whatsapp_business_encryption`;

  try {
    const params = new URLSearchParams();
    params.append('business_public_key', publicKeyPem.trim());

    const { data } = await axios.post(url, params.toString(), {
      headers: {
        Authorization  : `Bearer ${ACCESS_TOKEN}`,
        'Content-Type' : 'application/x-www-form-urlencoded',
      },
    });

    console.log('✅  Public key uploaded successfully');
    console.log('    Response:', JSON.stringify(data));
  } catch (err) {
    const errData = err.response?.data?.error || err.message;
    console.error('❌  Upload failed:', JSON.stringify(errData, null, 4));
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════');
  console.log('  Now run: node scripts/publish-flows.js\n');
})();
