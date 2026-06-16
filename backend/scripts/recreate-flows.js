/**
 * Recreate WhatsApp Flows from scratch.
 *
 * Steps:
 *   1. Delete old Registration + Login flows from Meta
 *   2. Create new Registration flow  (category: SIGN_UP)
 *   3. Create new Login flow          (category: SIGN_IN)
 *   4. Upload flow JSONs to both
 *   5. Set endpoint_uri on both
 *   6. Publish both
 *   7. Save new IDs into .env
 *
 * Usage:  node scripts/recreate-flows.js
 *         npm run flow:recreate
 *
 * Required .env keys:
 *   WHATSAPP_ACCESS_TOKEN
 *   WHATSAPP_WABA_ID
 *   WHATSAPP_FLOW_REGISTRATION_ID   (old — will be deleted)
 *   WHATSAPP_FLOW_LOGIN_ID          (old — will be deleted)
 *   BASE_URL                        (e.g. https://we-the-leader.onrender.com)
 */
require('dotenv').config();
const axios    = require('axios');
const FormData = require('form-data');
const fs       = require('fs');
const path     = require('path');
const { setKeys } = require('./_envFile');

const ACCESS_TOKEN  = process.env.WHATSAPP_ACCESS_TOKEN;
const WABA_ID       = process.env.WHATSAPP_WABA_ID;
const BASE_URL      = (process.env.BASE_URL || '').replace(/\/+$/, '');
const GRAPH_VERSION = 'v22.0';
const GRAPH_ROOT    = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ── Validate required env ─────────────────────────────────────────
if (!ACCESS_TOKEN) { console.error('❌  WHATSAPP_ACCESS_TOKEN not set'); process.exit(1); }
if (!WABA_ID)       { console.error('❌  WHATSAPP_WABA_ID not set');       process.exit(1); }
if (!BASE_URL)      { console.error('❌  BASE_URL not set (e.g. https://we-the-leader.onrender.com)'); process.exit(1); }

const ENDPOINT_URI = `${BASE_URL}/api/webhook/flow`;
const AUTH         = { Authorization: `Bearer ${ACCESS_TOKEN}` };

// ── Flow definitions ──────────────────────────────────────────────
const flows = [
  {
    name     : 'WTL Member Registration',
    category : 'SIGN_UP',
    envKey   : 'WHATSAPP_FLOW_REGISTRATION_ID',
    oldId    : process.env.WHATSAPP_FLOW_REGISTRATION_ID,
    jsonPath : path.join(__dirname, '../src/assets/flow_registration.json'),
  },
  {
    name     : 'WTL Member Login',
    category : 'SIGN_IN',
    envKey   : 'WHATSAPP_FLOW_LOGIN_ID',
    oldId    : process.env.WHATSAPP_FLOW_LOGIN_ID,
    jsonPath : path.join(__dirname, '../src/assets/flow_login.json'),
  },
];

// ── API helpers ───────────────────────────────────────────────────

async function deleteFlow(flowId) {
  const { data } = await axios.delete(`${GRAPH_ROOT}/${flowId}`, {
    headers: AUTH,
  });
  return data;
}

async function createFlow(name, category) {
  const { data } = await axios.post(
    `${GRAPH_ROOT}/${WABA_ID}/flows`,
    { name, categories: [category] },
    { headers: AUTH }
  );
  return data; // { id }
}

async function uploadFlowJson(flowId, jsonPath) {
  const flowJson = fs.readFileSync(jsonPath, 'utf8');
  const fd = new FormData();
  fd.append('file', Buffer.from(flowJson), { filename: 'flow.json', contentType: 'application/json' });
  fd.append('name', 'flow.json');
  fd.append('asset_type', 'FLOW_JSON');

  const { data } = await axios.post(`${GRAPH_ROOT}/${flowId}/assets`, fd, {
    headers: { ...AUTH, ...fd.getHeaders() },
    maxContentLength: 10 * 1024 * 1024,
    maxBodyLength:    10 * 1024 * 1024,
  });
  return data;
}

async function setEndpointUri(flowId, uri) {
  const { data } = await axios.post(
    `${GRAPH_ROOT}/${flowId}`,
    { endpoint_uri: uri },
    { headers: AUTH }
  );
  return data;
}

async function publishFlow(flowId) {
  const { data } = await axios.post(
    `${GRAPH_ROOT}/${flowId}/publish`,
    {},
    { headers: AUTH }
  );
  return data;
}

async function getStatus(flowId) {
  const { data } = await axios.get(`${GRAPH_ROOT}/${flowId}`, {
    headers: AUTH,
    params: { fields: 'id,name,status,endpoint_uri' },
  });
  return data;
}

// ── Main ──────────────────────────────────────────────────────────
(async () => {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Annamalai — Recreate WhatsApp Flows');
  console.log('══════════════════════════════════════════════');
  console.log(`  Endpoint: ${ENDPOINT_URI}`);
  console.log(`  WABA    : ${WABA_ID}\n`);

  const newIds = {};

  for (const flow of flows) {
    console.log(`\n══ ${flow.name} ══`);

    // 1. Delete old flow
    if (flow.oldId) {
      process.stdout.write(`  🗑️  Deleting old flow ${flow.oldId}… `);
      try {
        await deleteFlow(flow.oldId);
        console.log('deleted ✅');
      } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        console.log(`skipped (${msg})`);
      }
    } else {
      console.log(`  ⚠️  No old ID in .env — skipping delete`);
    }

    // 2. Create new flow
    process.stdout.write(`  ➕ Creating new flow (${flow.category})… `);
    let newId;
    try {
      const res = await createFlow(flow.name, flow.category);
      newId = res.id;
      console.log(`created ✅  ID: ${newId}`);
    } catch (err) {
      console.log(`\n  ❌ Create failed: ${JSON.stringify(err.response?.data?.error || err.message)}`);
      continue;
    }

    // 3. Upload flow JSON
    process.stdout.write(`  📤 Uploading flow JSON… `);
    try {
      const uploadRes = await uploadFlowJson(newId, flow.jsonPath);
      if (uploadRes?.validation_errors?.length) {
        console.log('\n  ⚠️  Validation errors:');
        console.log(JSON.stringify(uploadRes.validation_errors, null, 4));
      } else {
        console.log('uploaded ✅');
      }
    } catch (err) {
      console.log(`\n  ❌ Upload failed: ${JSON.stringify(err.response?.data || err.message)}`);
      console.log(`  ℹ️  Flow ${newId} created but JSON not uploaded. Delete it manually and retry.`);
      continue;
    }

    // 4. Set endpoint URI
    process.stdout.write(`  🔗 Setting endpoint_uri… `);
    try {
      await setEndpointUri(newId, ENDPOINT_URI);
      console.log('set ✅');
    } catch (err) {
      console.log(`\n  ⚠️  Could not set endpoint: ${JSON.stringify(err.response?.data?.error || err.message)}`);
    }

    // 5. Publish
    process.stdout.write(`  🚀 Publishing… `);
    let published = false;
    try {
      await publishFlow(newId);
      console.log('PUBLISHED ✅');
      published = true;
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      console.log(`\n  ❌ Publish failed: ${JSON.stringify(errMsg)}`);
      console.log(`  ℹ️  Flow ${newId} created as DRAFT. Fix the issue and run: npm run flow:publish`);
    }

    // 6. Save ID to .env regardless of publish status
    newIds[flow.envKey] = newId;
    console.log(`  💾 ${flow.envKey}=${newId} → saved to .env`);
  }

  // 7. Write all new IDs to .env at once
  if (Object.keys(newIds).length > 0) {
    try {
      setKeys(newIds);
      console.log('\n  ✅ .env updated with new flow IDs');
    } catch (e) {
      console.log('\n  ⚠️  Could not update .env:', e.message);
      console.log('  Manually set these in .env:');
      for (const [k, v] of Object.entries(newIds)) {
        console.log(`    ${k}=${v}`);
      }
    }
  }

  // 8. Final status check
  console.log('\n══════════════════════════════════════════════');
  console.log('  Final Status');
  console.log('══════════════════════════════════════════════');
  for (const [envKey, flowId] of Object.entries(newIds)) {
    try {
      const info = await getStatus(flowId);
      const icon = info.status === 'PUBLISHED' ? '✅' : '📝';
      console.log(`  ${icon} ${envKey}`);
      console.log(`     ID     : ${info.id}`);
      console.log(`     Status : ${info.status}`);
      if (info.endpoint_uri) console.log(`     Endpoint: ${info.endpoint_uri}`);
    } catch (err) {
      console.log(`  ⚠️  Could not fetch status for ${flowId}`);
    }
  }

  console.log('\n══════════════════════════════════════════════');
  console.log('  Next steps:');
  console.log('  1. git add backend/.env && git commit -m "Update flow IDs" && git push');
  console.log('  2. Redeploy on Render (or set env vars in Render dashboard)');
  console.log('  3. npm run flow:subscribe   (subscribe WABA to webhook)\n');
})();
