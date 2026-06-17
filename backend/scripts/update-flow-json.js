'use strict';
/**
 * Update the registration flow JSON on Meta (without recreating the flow).
 * Usage: node scripts/update-flow-json.js
 */
require('dotenv').config();
const axios    = require('axios');
const FormData = require('form-data');
const fs       = require('fs');
const path     = require('path');

const ACCESS_TOKEN  = process.env.WHATSAPP_ACCESS_TOKEN;
const FLOW_ID       = process.env.WHATSAPP_FLOW_REGISTRATION_ID;
const GRAPH_VERSION = 'v22.0';
const GRAPH_ROOT    = `https://graph.facebook.com/${GRAPH_VERSION}`;
const AUTH          = { Authorization: `Bearer ${ACCESS_TOKEN}` };
const JSON_PATH     = path.join(__dirname, '../src/assets/flow_registration.json');

if (!ACCESS_TOKEN) { console.error('❌ WHATSAPP_ACCESS_TOKEN not set'); process.exit(1); }
if (!FLOW_ID)      { console.error('❌ WHATSAPP_FLOW_REGISTRATION_ID not set'); process.exit(1); }

(async () => {
  console.log(`\nUpdating flow ${FLOW_ID} with new JSON...\n`);

  // 1. Upload updated JSON
  const flowJson = fs.readFileSync(JSON_PATH, 'utf8');
  const fd = new FormData();
  fd.append('file', Buffer.from(flowJson), { filename: 'flow.json', contentType: 'application/json' });
  fd.append('name', 'flow.json');
  fd.append('asset_type', 'FLOW_JSON');

  try {
    const { data } = await axios.post(`${GRAPH_ROOT}/${FLOW_ID}/assets`, fd, {
      headers: { ...AUTH, ...fd.getHeaders() },
    });
    if (data?.validation_errors?.length) {
      console.error('❌ Validation errors:');
      console.error(JSON.stringify(data.validation_errors, null, 2));
      process.exit(1);
    }
    console.log('✅ JSON uploaded successfully');
  } catch (err) {
    console.error('❌ Upload failed:', JSON.stringify(err.response?.data || err.message, null, 2));
    process.exit(1);
  }

  // 2. Publish
  try {
    await axios.post(`${GRAPH_ROOT}/${FLOW_ID}/publish`, {}, { headers: AUTH });
    console.log('✅ Flow published successfully\n');
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.warn(`⚠️  Publish step: ${msg}`);
    console.log('   (Flow may already be published — this is often OK)\n');
  }

  // 3. Check status
  try {
    const { data } = await axios.get(`${GRAPH_ROOT}/${FLOW_ID}`, {
      headers: AUTH,
      params: { fields: 'id,name,status' },
    });
    console.log(`Flow status: ${data.status} — ${data.name} (${data.id})`);
  } catch (_) {}
})();
