/**
 * Regenerate and send front + back ID card to a WhatsApp number.
 *
 * Usage:
 *   node scripts/send-card-to-whatsapp.js 8106811285
 *   node scripts/send-card-to-whatsapp.js 9876543210
 *
 * Steps:
 *   1. Look up member by MOBILE_NO in generated_voters (DB2)
 *   2. Download their photo from Cloudinary
 *   3. Regenerate front card (fresh, with latest template)
 *   4. Regenerate back card
 *   5. Upload both to Cloudinary (overwrite)
 *   6. Update card_url + back_url in generated_voters
 *   7. Send front image to WhatsApp
 *   8. Send back image to WhatsApp
 */

'use strict';
require('dotenv').config();

const axios     = require('axios');
const mongoose  = require('mongoose');
const { generateCard, generateBackCard } = require('../src/services/cardGenerator');
const { uploadCard, uploadBackCard }      = require('../src/services/cloudinaryService');

const MOBILE  = (process.argv[2] || '8106811285').replace(/\D/g, '');
// WhatsApp wants country code prefix (no +)
const WA_TO   = MOBILE.length === 10 ? `91${MOBILE}` : MOBILE;

const ACCESS  = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const GRAPH   = 'https://graph.facebook.com/v22.0';
const HEADERS = { Authorization: `Bearer ${ACCESS}` };

// ── Send image via WhatsApp Cloud API ─────────────────────────────
async function sendWAImage(imageUrl, caption) {
  const { data } = await axios.post(
    `${GRAPH}/${PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to:    WA_TO,
      type:  'image',
      image: { link: imageUrl, caption },
    },
    { headers: HEADERS },
  );
  return data.messages?.[0]?.id;
}

// ── Main ──────────────────────────────────────────────────────────
(async () => {
  console.log('═'.repeat(55));
  console.log(`  Sending fresh ID card to WhatsApp: ${WA_TO}`);
  console.log('═'.repeat(55));

  // 1. Connect DB
  console.log('\n[1/8] Connecting to database...');
  const conn = await mongoose.createConnection(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || 'wetheleaders',
    serverSelectionTimeoutMS: 10000,
  }).asPromise();
  const db = conn.db;
  console.log('      ✅ Connected');

  // 2. Fetch member record
  console.log(`\n[2/8] Looking up mobile ${MOBILE}...`);
  const doc = await db.collection('generated_voters').findOne({ MOBILE_NO: MOBILE });
  if (!doc) {
    console.error(`      ❌ Mobile ${MOBILE} not found in generated_voters`);
    await conn.close();
    process.exit(1);
  }
  const epicNo = doc.EPIC_NO;
  console.log(`      ✅ Found: ${doc.VOTER_NAME} | EPIC: ${epicNo} | Assembly: ${doc.ASSEMBLY_NAME}`);

  // 3. Download photo from Cloudinary
  console.log('\n[3/8] Downloading member photo...');
  let photoBuffer = null;
  const photoUrl  = doc.photo_url;
  if (photoUrl) {
    try {
      const resp  = await axios.get(photoUrl, { responseType: 'arraybuffer', timeout: 15000 });
      photoBuffer = Buffer.from(resp.data);
      console.log(`      ✅ Photo downloaded (${Math.round(photoBuffer.length / 1024)} KB)`);
    } catch (e) {
      console.warn(`      ⚠️  Photo download failed: ${e.message} — using placeholder`);
    }
  } else {
    console.warn('      ⚠️  No photo_url found — using placeholder');
  }

  // 4. Generate fresh FRONT card
  console.log('\n[4/8] Generating fresh FRONT card...');
  const voterData = {
    epic_no:       epicNo,
    name:          doc.VOTER_NAME || '',
    assembly_name: doc.ASSEMBLY_NAME || '',
    district:      doc.DISTRICT_NAME || doc.DISTRICT || '',
    mobile:        doc.MOBILE_NO || '',
    wtl_code:      doc.wtl_code || doc.ptc_code || '',
  };
  const frontBuffer = await generateCard(voterData, photoBuffer);
  console.log(`      ✅ Front card generated (${Math.round(frontBuffer.length / 1024)} KB)`);

  // 5. Generate fresh BACK card
  console.log('\n[5/8] Generating fresh BACK card...');
  const backBuffer = await generateBackCard(voterData);
  console.log(`      ✅ Back card generated (${Math.round(backBuffer.length / 1024)} KB)`);

  // 6. Upload both to Cloudinary
  console.log('\n[6/8] Uploading to Cloudinary (overwrite)...');
  const [frontUrl, backUrl] = await Promise.all([
    uploadCard(frontBuffer, epicNo),
    uploadBackCard(backBuffer, epicNo),
  ]);
  console.log(`      ✅ Front: ${frontUrl}`);
  console.log(`      ✅ Back : ${backUrl}`);

  // 7. Update DB with new URLs
  console.log('\n[7/8] Updating database with new card URLs...');
  await db.collection('generated_voters').updateOne(
    { MOBILE_NO: MOBILE },
    { $set: { card_url: frontUrl, back_url: backUrl, generated_at: new Date() } },
  );
  console.log('      ✅ DB updated');

  // 8. Send to WhatsApp
  console.log(`\n[8/8] Sending to WhatsApp ${WA_TO}...`);

  // Front card
  const frontCaption = [
    '🪪 *Your Digital Member ID Card — FRONT*',
    `👤 Name     : ${doc.VOTER_NAME}`,
    `🗳️  EPIC No  : ${epicNo}`,
    `🏛️  Assembly : ${doc.ASSEMBLY_NAME}`,
    `🔖 WTL Code : ${doc.wtl_code || doc.ptc_code || 'N/A'}`,
    '',
    'We The Leaders — Lead the Change',
  ].join('\n');

  const frontMsgId = await sendWAImage(frontUrl, frontCaption);
  console.log(`      ✅ Front card sent  | msg ID: ${frontMsgId}`);

  // Small delay between messages
  await new Promise(r => setTimeout(r, 1000));

  // Back card
  const backCaption = '🪪 *Your Digital Member ID Card — BACK*\n\nWe The Leaders — Lead the Change';
  const backMsgId   = await sendWAImage(backUrl, backCaption);
  console.log(`      ✅ Back card sent   | msg ID: ${backMsgId}`);

  await conn.close();

  console.log('\n' + '═'.repeat(55));
  console.log('  ✅  Both cards delivered to WhatsApp successfully!');
  console.log('═'.repeat(55) + '\n');
})().catch(err => {
  const msg = err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message;
  console.error('\n❌  Fatal error:', msg);
  process.exit(1);
});
