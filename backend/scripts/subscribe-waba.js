/**
 * Subscribe the Meta App to the WhatsApp Business Account (WABA)
 * so Meta forwards inbound messages/flow replies to our webhook.
 *
 * What it does:
 *   1. GET  /{waba-id}/subscribed_apps  — list current subscribers
 *   2. POST /{waba-id}/subscribed_apps  — subscribe with `messages` field
 *   3. GET again to confirm the subscription
 *
 * Usage:  node scripts/subscribe-waba.js
 *
 * Required .env keys:
 *   WHATSAPP_ACCESS_TOKEN
 *   WHATSAPP_WABA_ID
 */
require('dotenv').config();
const axios = require('axios');

const ACCESS_TOKEN  = process.env.WHATSAPP_ACCESS_TOKEN;
const WABA_ID       = process.env.WHATSAPP_WABA_ID;
const GRAPH_VERSION = 'v22.0';
const GRAPH_ROOT    = `https://graph.facebook.com/${GRAPH_VERSION}`;

if (!ACCESS_TOKEN) {
  console.error('❌  WHATSAPP_ACCESS_TOKEN is not set in .env');
  process.exit(1);
}
if (!WABA_ID) {
  console.error('❌  WHATSAPP_WABA_ID is not set in .env');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${ACCESS_TOKEN}` };

(async () => {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Annamalai — Subscribe WABA to Webhook');
  console.log('══════════════════════════════════════════════\n');

  // ── 1. Check current subscriptions ───────────────────────────────
  console.log('📋 Current subscribed apps:');
  try {
    const before = await axios.get(
      `${GRAPH_ROOT}/${WABA_ID}/subscribed_apps`,
      { headers }
    );
    const apps = before.data?.data || [];
    if (apps.length === 0) {
      console.log('   (none)');
    } else {
      apps.forEach(a =>
        console.log(`   • ${a.name || a.id}  —  fields: ${(a.subscribed_fields || []).join(', ')}`)
      );
    }
  } catch (err) {
    console.error('   ❌ Could not fetch subscriptions:',
      JSON.stringify(err.response?.data?.error || err.message, null, 4));
  }

  // ── 2. Subscribe app to messages ─────────────────────────────────
  console.log('\n🔗 Subscribing app to "messages" field…');
  try {
    const sub = await axios.post(
      `${GRAPH_ROOT}/${WABA_ID}/subscribed_apps`,
      { subscribed_fields: ['messages'] },
      { headers }
    );
    if (sub.data?.success) {
      console.log('   ✅ Subscribed successfully');
    } else {
      console.log('   ⚠️  Response:', JSON.stringify(sub.data));
    }
  } catch (err) {
    console.error('   ❌ Subscribe failed:',
      JSON.stringify(err.response?.data?.error || err.message, null, 4));
    process.exit(1);
  }

  // ── 3. Confirm subscription ───────────────────────────────────────
  console.log('\n📋 Confirmed subscriptions:');
  try {
    const after = await axios.get(
      `${GRAPH_ROOT}/${WABA_ID}/subscribed_apps`,
      { headers }
    );
    const apps = after.data?.data || [];
    if (apps.length === 0) {
      console.log('   ⚠️  No subscriptions found — something may have gone wrong.');
    } else {
      apps.forEach(a =>
        console.log(`   ✅ ${a.name || a.id}  —  fields: ${(a.subscribed_fields || []).join(', ')}`)
      );
    }
  } catch (err) {
    console.error('   ❌ Could not confirm subscriptions:',
      JSON.stringify(err.response?.data?.error || err.message, null, 4));
  }

  console.log('\n══════════════════════════════════════════════');
  console.log('  Done. Meta will now forward inbound messages');
  console.log('  and Flow replies to your webhook URL.');
  console.log('  Webhook: POST /api/webhook/meta\n');
})();
