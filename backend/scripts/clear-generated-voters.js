'use strict';
/**
 * Lists and deletes all documents in generated_voters collection (DB2 / Atlas).
 * Run: node scripts/clear-generated-voters.js
 * Pass --confirm to actually delete (dry-run by default).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB  = process.env.MONGO_DB || 'wetheleaders';
const CONFIRM   = process.argv.includes('--confirm');

async function main() {
  if (!MONGO_URI) { console.error('MONGO_URI not set'); process.exit(1); }

  const client = new MongoClient(MONGO_URI, { tls: true });
  await client.connect();
  const db = client.db(MONGO_DB);

  // ── Show what's there ─────────────────────────────────────────
  const docs = await db.collection('generated_voters')
    .find({}, { projection: { EPIC_NO: 1, VOTER_NAME: 1, MOBILE_NO: 1, generated_at: 1 } })
    .toArray();

  console.log(`\n[generated_voters] Found ${docs.length} document(s):\n`);
  docs.forEach((d, i) => {
    console.log(`  ${i + 1}. EPIC: ${d.EPIC_NO || '-'}  |  Name: ${d.VOTER_NAME || '-'}  |  Mobile: ${d.MOBILE_NO || '-'}  |  Generated: ${d.generated_at || '-'}`);
  });

  // ── Also show pending_registrations ──────────────────────────
  const pending = await db.collection('pending_registrations')
    .find({}, { projection: { epic_no: 1, voter_name: 1, mobile: 1, status: 1, updated_at: 1 } })
    .toArray();

  console.log(`\n[pending_registrations] Found ${pending.length} document(s):\n`);
  pending.forEach((d, i) => {
    console.log(`  ${i + 1}. EPIC: ${d.epic_no || '-'}  |  Name: ${d.voter_name || '-'}  |  Mobile: ${d.mobile || '-'}  |  Status: ${d.status}  |  Updated: ${d.updated_at || '-'}`);
  });

  if (!CONFIRM) {
    console.log('\n⚠️  DRY RUN — nothing deleted.');
    console.log('   Run with --confirm to delete all generated_voters AND pending_registrations.\n');
    await client.close();
    return;
  }

  // ── Delete ────────────────────────────────────────────────────
  const gvResult = await db.collection('generated_voters').deleteMany({});
  console.log(`\n✅ Deleted ${gvResult.deletedCount} document(s) from generated_voters.`);

  const prResult = await db.collection('pending_registrations').deleteMany({});
  console.log(`✅ Deleted ${prResult.deletedCount} document(s) from pending_registrations.\n`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
