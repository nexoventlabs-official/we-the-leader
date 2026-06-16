/**
 * Test: webhook bot logic — check DB → send login or registration flow
 * Run: node scripts/test-webhook-bot.js
 */
'use strict';
require('dotenv').config();

const express = require('express');
const http    = require('http');
const crypto  = require('crypto');

// ── Mock DB ──────────────────────────────────────────────────────
// Must be set up BEFORE requiring webhook (which imports getDb)
const sentMessages = [];

// Start with: 8106811285 NOT in DB (new user), others exist
let memberMobiles = new Set(['9876543210']);
let dupWamids     = new Set();

// Inject mock db module into require cache BEFORE loading webhook
const Module = require('module');
const path   = require('path');
const dbPath = path.resolve(__dirname, '../src/db.js');

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    getDb: () => {
      const collections = {
        processed_wamids: {
          insertOne: async ({ wamid }) => {
            if (dupWamids.has(wamid)) {
              const e = new Error('dup key');
              e.code = 11000;
              throw e;
            }
            dupWamids.add(wamid);
            return {};
          },
        },
        generated_voters: {
          findOne: async (q) => memberMobiles.has(q.MOBILE_NO)
            ? { _id: '1', MOBILE_NO: q.MOBILE_NO }
            : null,
        },
        generation_stats: {
          findOne: async () => null,
        },
      };
      return {
        collection: (name) => {
          if (!collections[name]) throw new Error(`Unknown collection: ${name}`);
          return collections[name];
        },
      };
    },
    getVoterDb:      () => { throw new Error('not needed'); },
    findVoterByEpic: async () => null,
    connectDB:       async () => {},
  },
};

// ── Mock WhatsApp service ────────────────────────────────────────
// Also inject before webhook loads
const waSvcPath = path.resolve(__dirname, '../src/services/whatsappService.js');
require.cache[waSvcPath] = {
  id: waSvcPath, filename: waSvcPath, loaded: true,
  exports: {
    sendFlowMessage: async (to, type) => {
      sentMessages.push({ to, type, via: 'flow' });
      console.log('  [MOCK WA] sendFlowMessage to', to, '→', type);
      return { success: true };
    },
    sendTextMessage: async (to, text) => {
      sentMessages.push({ to, text: text.slice(0, 60), via: 'text' });
      console.log('  [MOCK WA] sendTextMessage to', to, '→', text.slice(0, 60));
      return { success: true };
    },
  },
};

// ── Reload webhook with mocked deps ─────────────────────────────
delete require.cache[require.resolve('../src/routes/webhook')];
const webhookRouter = require('../src/routes/webhook');

const app = express();
// raw body for HMAC check
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/meta') {
    return express.raw({ type: 'application/json' })(req, res, next);
  }
  next();
});
app.use('/', webhookRouter);

// ── Helpers ──────────────────────────────────────────────────────
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || '';

function makePayload(from, text, wamid) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: '1023027240889685' },
          messages: [{
            id: wamid,
            from,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: text },
          }],
        },
      }],
    }],
  };
}

function post(server, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const sig  = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
    const port = server.address().port;
    const opts = {
      hostname: 'localhost', port,
      path: '/', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-hub-signature-256': sig,
      },
    };
    const req = http.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve(r.statusCode));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function assert(label, condition) {
  if (condition) {
    console.log('  ✅ PASS:', label);
  } else {
    console.log('  ❌ FAIL:', label);
    process.exitCode = 1;
  }
}

// ── Run tests ─────────────────────────────────────────────────────
(async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r)); // random port

  console.log('\n══ Test 1: New user (8106811285) sends "hi" → Registration flow ══');
  sentMessages.length = 0;
  const s1 = await post(server, makePayload('918106811285', 'hi', 'wamid_001'));
  await wait(400);
  assert('HTTP 200', s1 === 200);
  assert('Flow type is registration', sentMessages[0]?.via === 'flow' && sentMessages[0]?.type === 'registration');
  assert('Sent to correct number', sentMessages[0]?.to === '918106811285');

  console.log('\n══ Test 2: Existing member (9876543210) sends "hi" → Login flow ══');
  sentMessages.length = 0;
  const s2 = await post(server, makePayload('919876543210', 'hi', 'wamid_002'));
  await wait(400);
  assert('HTTP 200', s2 === 200);
  assert('Flow type is login', sentMessages[0]?.via === 'flow' && sentMessages[0]?.type === 'login');
  assert('Sent to correct number', sentMessages[0]?.to === '919876543210');

  console.log('\n══ Test 3: Duplicate wamid → silently ignored ══');
  sentMessages.length = 0;
  const s3 = await post(server, makePayload('918106811285', 'hi again', 'wamid_001')); // same wamid
  await wait(400);
  assert('HTTP 200', s3 === 200);
  assert('Nothing sent (deduplicated)', sentMessages.length === 0);

  console.log('\n══ Test 4: 8106811285 registers, then sends "hi" again → Login flow ══');
  memberMobiles.add('8106811285'); // now they are a member
  sentMessages.length = 0;
  const s4 = await post(server, makePayload('918106811285', 'hello', 'wamid_003'));
  await wait(400);
  assert('HTTP 200', s4 === 200);
  assert('Now gets login flow', sentMessages[0]?.via === 'flow' && sentMessages[0]?.type === 'login');

  server.close();
  console.log('\n══════════════════════════════════════════════');
  console.log(process.exitCode ? '  Some tests FAILED ❌' : '  All tests PASSED ✅');
  console.log('══════════════════════════════════════════════\n');
})();
