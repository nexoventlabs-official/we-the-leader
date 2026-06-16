/**
 * Dual-database setup
 * ─────────────────────────────────────────────────────────────────
 * DB1 — voter_db (DigitalOcean)   READ-ONLY  — 5.8 cr voter roll
 * DB2 — wetheleaders (Atlas)      READ/WRITE — generated cards,
 *        generation_stats, otp_sessions, volunteer/booth requests
 *
 * IMPORTANT: Never write to DB1. All writes must go to DB2.
 * Use getVoterDb() for EPIC lookups and getDb() for everything else.
 */

const mongoose = require('mongoose');
const config   = require('./config');

// ── Two separate Mongoose connections ────────────────────────────
const appConn   = mongoose.createConnection(); // DB2 — app data (Atlas)
const voterConn = mongoose.createConnection(); // DB1 — voter roll (DigitalOcean, read-only)

let appConnected   = false;
let voterConnected = false;

// ── Connect both DBs ─────────────────────────────────────────────
const connectDB = async () => {
  // ── DB2: App data (Atlas) — primary read/write connection ──────
  try {
    await appConn.openUri(config.mongoUri, {
      dbName:                   config.mongoDb,
      tls:                      true,
      tlsAllowInvalidCertificates: false,
      maxPoolSize:              50,
      minPoolSize:              5,
      serverSelectionTimeoutMS: 10000,
    });
    appConnected = true;
    console.log(`[DB2] App DB connected (db: ${config.mongoDb})`);
    setTimeout(() => ensureAppIndexes(), 1000);
  } catch (err) {
    console.error('[DB2] App DB connection error:', err.message);
    process.exit(1);
  }

  // ── DB1: Voter roll (DigitalOcean) — read-only ─────────────────
  if (!config.mongoVoterUrl) {
    console.warn('[DB1] MONGO_VOTER_URL not set — voter EPIC lookups will fail.');
    return;
  }
  try {
    await voterConn.openUri(config.mongoVoterUrl, {
      dbName:                   config.mongoVoterDbName,
      maxPoolSize:              10,
      minPoolSize:              2,
      serverSelectionTimeoutMS: 15000,
    });
    voterConnected = true;
    console.log(`[DB1] Voter DB connected (db: ${config.mongoVoterDbName}) — READ-ONLY`);
  } catch (err) {
    // Non-fatal: app still works, just EPIC validation will be unavailable
    console.error('[DB1] Voter DB connection error:', err.message);
  }
};

// ── Indexes for DB2 only (never touch DB1) ───────────────────────
async function ensureAppIndexes() {
  try {
    const db = appConn.db;

    await db.collection('generated_voters').createIndex({ EPIC_NO: 1 },        { unique: true, background: true });
    await db.collection('generated_voters').createIndex({ MOBILE_NO: 1 },      { background: true });
    await db.collection('generated_voters').createIndex({ ptc_code: 1 },        { unique: true, sparse: true, background: true });
    await db.collection('generated_voters').createIndex({ referred_by_ptc: 1 }, { background: true });

    await db.collection('generation_stats').createIndex({ epic_no: 1 },    { unique: true, background: true });
    await db.collection('generation_stats').createIndex({ auth_mobile: 1 }, { background: true });

    await db.collection('otp_sessions').createIndex({ mobile: 1 },     { unique: true, background: true });
    await db.collection('otp_sessions').createIndex({ created_at: 1 }, { expireAfterSeconds: 600, background: true });

    // Unique indexes prevent TOCTOU races on volunteer/booth requests
    await db.collection('volunteer_requests').createIndex(   { ptc_code: 1 }, { unique: true, background: true });
    await db.collection('booth_agent_requests').createIndex( { ptc_code: 1 }, { unique: true, background: true });

    // Deduplication for processed WhatsApp message IDs (TTL 24 h)
    await db.collection('processed_wamids').createIndex({ wamid: 1 },  { unique: true, background: true });
    await db.collection('processed_wamids').createIndex({ ts: 1 },     { expireAfterSeconds: 86400, background: true });

    // Generation locks for card generation race-condition guard (TTL 5 min)
    await db.collection('generation_locks').createIndex({ epic_no: 1 },     { unique: true, background: true });
    await db.collection('generation_locks').createIndex({ locked_until: 1 }, { expireAfterSeconds: 300, background: true });

    console.log('[DB2] MongoDB indexes ensured.');
  } catch (err) {
    console.warn('[DB2] Index setup warning:', err.message);
  }
}

/**
 * getDb() — returns DB2 (Atlas, app data). Use for ALL writes and
 * for reading generated_voters, generation_stats, otp_sessions,
 * volunteer_requests, booth_agent_requests.
 */
const getDb = () => {
  if (!appConnected) throw new Error('[DB2] App database not connected');
  return appConn.db;
};

/**
 * getVoterDb() — returns DB1 (DigitalOcean, voter roll). Use ONLY
 * for reading voter collections (EPIC validation). Never write.
 *
 * Data is sharded across assembly collections: ass_1 … ass_234
 */
const getVoterDb = () => {
  if (!voterConnected) throw new Error('[DB1] Voter database not connected');
  return voterConn.db;
};

/**
 * getVoterTotalCount() — sum estimatedDocumentCount across all
 * ass_* collections in DB1. Cached for 10 minutes.
 */
let _voterCountCache = null;
let _voterCountTime  = 0;
const VOTER_COUNT_TTL = 10 * 60 * 1000;

const getVoterTotalCount = async () => {
  if (_voterCountCache !== null && Date.now() - _voterCountTime < VOTER_COUNT_TTL) {
    return _voterCountCache;
  }
  if (!voterConnected) return 0;
  try {
    const db   = voterConn.db;
    const cols = await db.listCollections({ name: /^ass_\d+$/ }).toArray();
    let total  = 0;
    await Promise.all(
      cols.map(async (c) => {
        const n = await db.collection(c.name).estimatedDocumentCount();
        total  += n;
      })
    );
    _voterCountCache = total;
    _voterCountTime  = Date.now();
    // Only log in non-production to avoid leaking DB structure info
    if (config.nodeEnv !== 'production') {
      console.log(`[DB1] Total voter count across ${cols.length} collections: ${total.toLocaleString()}`);
    }
    return total;
  } catch (err) {
    console.warn('[DB1] getVoterTotalCount error:', err.message);
    return 0;
  }
};

/**
 * findVoterByEpic(epicNo) — search across all ass_* collections for
 * a voter with the given EPIC_NO. Returns the document or null.
 * Uses parallel fan-out instead of sequential search for performance.
 */
const findVoterByEpic = async (epicNo) => {
  if (!voterConnected) return null;
  const db   = voterConn.db;
  const cols = await db.listCollections({ name: /^ass_\d+$/ }).toArray();

  // Parallel fan-out — all collections queried simultaneously
  const results = await Promise.allSettled(
    cols.map(c => db.collection(c.name).findOne({ EPIC_NO: epicNo }))
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return null;
};

module.exports = { connectDB, getDb, getVoterDb, getVoterTotalCount, findVoterByEpic, mongoose: appConn };
