'use strict';
/**
 * Regenerate card for a specific mobile, using real photo + booth from DB.
 * Usage: node scripts/regen-card.js 8106811285
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios    = require('axios');
const mongoose = require('mongoose');
const { generateCard, generateBackCard } = require('../src/services/cardGenerator');
const { uploadCard, uploadBackCard }     = require('../src/services/cloudinaryService');

const MOBILE   = (process.argv[2] || '8106811285').replace(/\D/g, '');
const WA_TO    = MOBILE.length === 10 ? `91${MOBILE}` : MOBILE;
const ACCESS   = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const GRAPH    = 'https://graph.facebook.com/v22.0';
const HEADERS  = { Authorization: `Bearer ${ACCESS}` };

async function sendWAImage(imageUrl, caption) {
  const { data } = await axios.post(`${GRAPH}/${PHONE_ID}/messages`, {
    messaging_product: 'whatsapp', recipient_type: 'individual',
    to: WA_TO, type: 'image', image: { link: imageUrl, caption },
  }, { headers: HEADERS });
  return data.messages?.[0]?.id;
}

(async () => {
  console.log(`\nRegenerating card for mobile ${MOBILE}...`);
  const conn = await mongoose.createConnection(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || 'wetheleaders', serverSelectionTimeoutMS: 10000,
  }).asPromise();
  const db = conn.db;

  const doc = await db.collection('generated_voters').findOne({ MOBILE_NO: MOBILE });
  if (!doc) { console.error('No record found for', MOBILE); await conn.close(); process.exit(1); }

  const epicNo = doc.EPIC_NO;
  console.log(`Found: ${doc.VOTER_NAME} | EPIC: ${epicNo} | PART_NO: ${doc.PART_NO || 'MISSING'}`);

  // Download photo
  let photoBuffer = null;
  if (doc.photo_url) {
    const resp = await axios.get(doc.photo_url, { responseType: 'arraybuffer', timeout: 15000 });
    photoBuffer = Buffer.from(resp.data);
    console.log(`Photo: ${Math.round(photoBuffer.length/1024)} KB`);
  }

  const voterData = {
    epic_no:       epicNo,       EPIC_NO:       epicNo,
    name:          doc.VOTER_NAME    || '', VOTER_NAME:    doc.VOTER_NAME    || '',
    assembly_name: doc.ASSEMBLY_NAME || '', ASSEMBLY_NAME: doc.ASSEMBLY_NAME || '',
    district:      doc.DISTRICT_NAME || '', DISTRICT_NAME: doc.DISTRICT_NAME || '',
    part_no:       doc.PART_NO       || '', PART_NO:       doc.PART_NO       || '',
    booth:         doc.PART_NO       || '',
    mobile: MOBILE, MOBILE_NO: MOBILE,
    wtl_code: doc.wtl_code || doc.ptc_code || '',
  };

  console.log('Generating front card...');
  const frontBuffer = await generateCard(voterData, photoBuffer);
  console.log('Generating back card...');
  const backBuffer  = await generateBackCard(voterData);

  console.log('Uploading to Cloudinary...');
  const [frontUrl, backUrl] = await Promise.all([
    uploadCard(frontBuffer, epicNo),
    uploadBackCard(backBuffer, epicNo),
  ]);
  console.log('Front:', frontUrl);
  console.log('Back :', backUrl);

  await db.collection('generated_voters').updateOne(
    { EPIC_NO: epicNo },
    { $set: { card_url: frontUrl, back_url: backUrl, generated_at: new Date() } }
  );
  console.log('DB updated.');

  // Send to WhatsApp
  const frontCaption = [
    '🪪 *Your Digital Member ID Card — FRONT* (Updated)',
    `👤 Name     : ${doc.VOTER_NAME}`,
    `🗳️  EPIC No  : ${epicNo}`,
    `🏛️  Assembly : ${doc.ASSEMBLY_NAME}`,
    `🔖 WTL Code : ${doc.wtl_code || doc.ptc_code || ''}`,
    '', 'We The Leaders — Lead the Change',
  ].join('\n');

  const fid = await sendWAImage(frontUrl, frontCaption);
  console.log('Front sent:', fid);
  await new Promise(r => setTimeout(r, 1000));
  const bid = await sendWAImage(backUrl, '🪪 *Your Digital Member ID Card — BACK*\n\nWe The Leaders — Lead the Change');
  console.log('Back sent:', bid);

  await conn.close();
  console.log('\nDone ✅');
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
