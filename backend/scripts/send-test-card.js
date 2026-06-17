'use strict';
/**
 * Generate and send a test card to 8106811285 WITHOUT needing DB.
 * Uses local Puppeteer (Windows) where Chrome is available.
 *
 * Usage:  node scripts/send-test-card.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios   = require('axios');
const path    = require('path');
const { generateCard, generateBackCard } = require('../src/services/cardGenerator');
const { uploadCard, uploadBackCard }     = require('../src/services/cloudinaryService');

const WA_TO    = '918106811285';
const ACCESS   = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const GRAPH    = 'https://graph.facebook.com/v22.0';

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
    { headers: { Authorization: `Bearer ${ACCESS}` } },
  );
  return data.messages?.[0]?.id;
}

(async () => {
  console.log('═'.repeat(55));
  console.log('  Generating & sending TEST card to', WA_TO);
  console.log('═'.repeat(55));

  const voterData = {
    epic_no:       'TEST0000001',
    name:          'Test Member',
    VOTER_NAME:    'Test Member',
    assembly_name: 'Chennai Central',
    ASSEMBLY_NAME: 'Chennai Central',
    district:      'Chennai',
    DISTRICT_NAME: 'Chennai',
    mobile:        '8106811285',
    MOBILE_NO:     '8106811285',
    ptc_code:      'PTC-TESTCARD',
  };

  // Use a plain colour block as photo (no real photo needed for test)
  const sharp = require('sharp');
  const photoBuffer = await sharp({
    create: { width: 300, height: 400, channels: 3, background: { r: 180, g: 200, b: 220 } },
  }).jpeg().toBuffer();

  console.log('\n[1/4] Generating front card...');
  const frontBuffer = await generateCard(voterData, photoBuffer);
  console.log(`      ✅ Front card: ${Math.round(frontBuffer.length / 1024)} KB`);

  console.log('[2/4] Generating back card...');
  const backBuffer = await generateBackCard(voterData);
  console.log(`      ✅ Back card: ${Math.round(backBuffer.length / 1024)} KB`);

  console.log('[3/4] Uploading to Cloudinary...');
  const [frontUrl, backUrl] = await Promise.all([
    uploadCard(frontBuffer,  'TEST0000001'),
    uploadBackCard(backBuffer, 'TEST0000001'),
  ]);
  console.log(`      ✅ Front: ${frontUrl}`);
  console.log(`      ✅ Back : ${backUrl}`);

  console.log('[4/4] Sending to WhatsApp...');
  const fid = await sendWAImage(
    frontUrl,
    '🪪 *Digital Member ID Card — FRONT* (TEST)\n👤 Test Member\n🔖 PTC-TESTCARD\n\nWe The Leaders — Lead the Change',
  );
  console.log(`      ✅ Front sent: ${fid}`);

  await new Promise(r => setTimeout(r, 1000));

  const bid = await sendWAImage(
    backUrl,
    '🪪 *Digital Member ID Card — BACK* (TEST)\n\nWe The Leaders — Lead the Change',
  );
  console.log(`      ✅ Back sent: ${bid}`);

  console.log('\n' + '═'.repeat(55));
  console.log('  ✅  Test card delivered to', WA_TO);
  console.log('═'.repeat(55));
  process.exit(0);
})().catch(err => {
  console.error('\n❌  Error:', err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message);
  process.exit(1);
});
