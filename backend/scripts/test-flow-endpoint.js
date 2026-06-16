/**
 * Test the flow endpoint with both plain and encrypted health-check pings.
 * Decrypts the server's response to verify the inner content.
 *
 * Usage:  node scripts/test-flow-endpoint.js [url]
 *   url defaults to https://we-the-leader.onrender.com/api/webhook/flow
 */
require("dotenv").config();
const crypto = require("crypto");
const axios = require("axios");

const DEFAULT_URL = "https://we-the-leader.onrender.com/api/webhook/flow";
const url = process.argv[2] || DEFAULT_URL;

// ── Load private key ──────────────────────────────────────────────
const privatePem = (process.env.WHATSAPP_FLOW_PRIVATE_KEY || "")
  .replace(/\\\\n/g, "\n")
  .replace(/\\n/g, "\n");

if (!privatePem) {
  console.error("❌  WHATSAPP_FLOW_PRIVATE_KEY not set in .env");
  process.exit(1);
}

let privKey, pubKey;
try {
  privKey = crypto.createPrivateKey(privatePem);
  pubKey = crypto.createPublicKey(privKey);
} catch (e) {
  console.error("❌  Failed to parse WHATSAPP_FLOW_PRIVATE_KEY:", e.message);
  process.exit(1);
}

// ── Build encrypted ping — returns body + key material for decrypting response ──
function buildEncryptedPing() {
  const aesKey = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);

  const encAesKey = crypto.publicEncrypt(
    {
      key: pubKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey,
  );

  const payload = JSON.stringify({ version: "3.0", action: "ping" });
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, iv);
  const enc = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    body: {
      encrypted_aes_key: encAesKey.toString("base64"),
      encrypted_flow_data: Buffer.concat([enc, tag]).toString("base64"),
      initial_vector: iv.toString("base64"),
    },
    aesKey,
    iv,
  };
}

// ── Decrypt the server's encrypted_response ───────────────────────
function decryptServerResponse(encryptedBase64, aesKey, iv) {
  // Server flips all IV bits before encrypting the response
  const flippedIv = Buffer.from(iv.map((b) => ~b & 0xff));
  const encBuf = Buffer.from(encryptedBase64, "base64");
  const TAG_LEN = 16;
  const tag = encBuf.slice(-TAG_LEN);
  const ciphertext = encBuf.slice(0, -TAG_LEN);

  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, flippedIv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

// ── Run tests ─────────────────────────────────────────────────────
(async () => {
  console.log(`\n  Endpoint: ${url}\n`);

  // Test 1: Unencrypted ping
  console.log("── Test 1: Unencrypted ping ──────────────────────");
  try {
    const r = await axios.post(url, { version: "3.0", action: "ping" });
    console.log(`  HTTP ${r.status}  →  ${JSON.stringify(r.data)}`);
    const ok = r.data?.data?.status === "active";
    console.log(ok ? "  ✅ PASS" : '  ❌ FAIL — expected data.status="active"');
  } catch (e) {
    console.log(
      `  ❌ HTTP ${e.response?.status}  ${JSON.stringify(e.response?.data || e.message)}`,
    );
  }

  // Test 2: Encrypted ping — decrypt and verify inner response
  console.log("\n── Test 2: Encrypted ping (as Meta sends) ────────");
  try {
    const { body, aesKey, iv } = buildEncryptedPing();
    const r = await axios.post(url, body);
    console.log(`  HTTP ${r.status}`);

    if (!r.data?.encrypted_response) {
      console.log(
        "  ❌ FAIL — no encrypted_response in body:",
        JSON.stringify(r.data),
      );
      return;
    }

    // Decrypt the response and verify its content
    let inner;
    try {
      inner = decryptServerResponse(r.data.encrypted_response, aesKey, iv);
      console.log("  Decrypted response:", JSON.stringify(inner));
    } catch (decErr) {
      console.log("  ❌ FAIL — could not decrypt response:", decErr.message);
      return;
    }

    const ok = inner?.data?.status === "active";
    console.log(
      ok
        ? '  ✅ PASS — server decrypted correctly and returned status="active"'
        : '  ❌ FAIL — expected decrypted data.status="active"',
    );
  } catch (e) {
    console.log(
      `  ❌ HTTP ${e.response?.status}  ${JSON.stringify(e.response?.data || e.message)}`,
    );
  }

  console.log("");
})();
