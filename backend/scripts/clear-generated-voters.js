'use strict';
/**
 * Lists and deletes all documents in generated_voters + pending_registrations (DB2 / Atlas)
 * AND removes their images from Cloudinary.
 * Run: node scripts/clear-generated-voters.js          — dry run (shows what will be deleted)
 *      node scripts/clear-generated-voters.js --confirm — actually deletes
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;

const MONGO_URI   = process.env.MONGO_URI;
const MONGO_DB    = process.env.MONGO_DB || 'wetheleaders';
const CONFIRM     = process.argv.includes('--confirm');

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

const PHOTO_FOLDER = process.env.CLOUDINARY_PHOTO_FOLDER || 'member_photos';
const CARDS_FOLDER = process.env.CLOUDINARY_CARDS_FOLDER || 'generated_cards';

async function deleteCloudinaryAsset(publicId, folder) {
  const fullId = `${folder}/${publicId}`;
  try {
    const result = await cloudinary.uploader.destroy(fullId, { resource_type: 'image', invalidate: true });
    return { id: fullId, result: result.result };
  } catch (e) {
    return { id: fullId, result: `error: ${e.message}` };
  }
}

async function main() {
  if (!MONGO_URI) { console.error('MONGO_URI not set'); process.exit(1); }

  const client = new MongoClient(MONGO_URI, { tls: true });
  await client.connect();
  const db = client.db(MONGO_DB);

  // ── Show generated_voters ─────────────────────────────────────
  const docs = await db.collection('generated_voters')
    .find({}, { projection: { EPIC_NO: 1, VOTER_NAME: 1, MOBILE_NO: 1, generated_at: 1, photo_url: 1, card_url: 1, back_url: 1 } })
    .toArray();

  console.log(`\n[generated_voters] Found ${docs.length} document(s):\n`);
  docs.forEach((d, i) => {
    console.log(`  ${i + 1}. EPIC: ${d.EPIC_NO || '-'}  |  Name: ${d.VOTER_NAME || '-'}  |  Mobile: ${d.MOBILE_NO || '-'}  |  Generated: ${d.generated_at || '-'}`);
    if (d.photo_url) console.log(`       Photo  : ${d.photo_url}`);
    if (d.card_url)  console.log(`       Card   : ${d.card_url}`);
    if (d.back_url)  console.log(`       Back   : ${d.back_url}`);
  });

  // ── Show pending_registrations ────────────────────────────────
  const pending = await db.collection('pending_registrations')
    .find({}, { projection: { epic_no: 1, voter_name: 1, mobile: 1, status: 1, updated_at: 1 } })
    .toArray();

  console.log(`\n[pending_registrations] Found ${pending.length} document(s):\n`);
  pending.forEach((d, i) => {
    console.log(`  ${i + 1}. EPIC: ${d.epic_no || '-'}  |  Name: ${d.voter_name || '-'}  |  Mobile: ${d.mobile || '-'}  |  Status: ${d.status}  |  Updated: ${d.updated_at || '-'}`);
  });

  if (!CONFIRM) {
    console.log('\n⚠️  DRY RUN — nothing deleted.');
    console.log('   Run with --confirm to delete all records AND Cloudinary assets.\n');
    await client.close();
    return;
  }

  // ── Delete Cloudinary assets ──────────────────────────────────
  if (docs.length > 0) {
    console.log('\n🗑️  Deleting Cloudinary assets...');
    for (const d of docs) {
      const epicId = (d.EPIC_NO || '').toUpperCase().replace(/[/\\]/g, '_');
      if (!epicId) continue;

      const results = await Promise.all([
        deleteCloudinaryAsset(epicId, PHOTO_FOLDER),           // photo
        deleteCloudinaryAsset(epicId, CARDS_FOLDER),           // front card
        deleteCloudinaryAsset(`${epicId}_back`, CARDS_FOLDER), // back card
      ]);
      results.forEach(r => console.log(`     ${r.result === 'ok' ? '✅' : '⚠️ '} ${r.id} → ${r.result}`));
    }
  }

  // ── Delete DB records ─────────────────────────────────────────
  const gvResult = await db.collection('generated_voters').deleteMany({});
  console.log(`\n✅ Deleted ${gvResult.deletedCount} document(s) from generated_voters.`);

  const prResult = await db.collection('pending_registrations').deleteMany({});
  console.log(`✅ Deleted ${prResult.deletedCount} document(s) from pending_registrations.\n`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
