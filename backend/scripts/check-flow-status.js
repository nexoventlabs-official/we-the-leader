/**
 * Check the publish status of all WhatsApp Flows configured in .env
 *
 * Usage:  node scripts/check-flow-status.js
 *
 * Reads:
 *   WHATSAPP_ACCESS_TOKEN
 *   WHATSAPP_FLOW_REGISTRATION_ID
 *   WHATSAPP_FLOW_LOGIN_ID
 */
require('dotenv').config();
const axios = require('axios');

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const GRAPH_VERSION = 'v22.0';

if (!ACCESS_TOKEN) {
  console.error('❌  WHATSAPP_ACCESS_TOKEN is not set in .env');
  process.exit(1);
}

const flows = [
  { name: 'Registration (SIGN_UP)', id: process.env.WHATSAPP_FLOW_REGISTRATION_ID, envKey: 'WHATSAPP_FLOW_REGISTRATION_ID' },
  { name: 'Login (SIGN_IN)',        id: process.env.WHATSAPP_FLOW_LOGIN_ID,         envKey: 'WHATSAPP_FLOW_LOGIN_ID'         },
];

async function getFlowStatus(flowId) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${flowId}`;
  const { data } = await axios.get(url, {
    params: { fields: 'id,name,status,validation_errors,endpoint_uri', access_token: ACCESS_TOKEN },
  });
  return data;
}

(async () => {
  console.log('\n══════════════════════════════════════════════');
  console.log('  WTL — WhatsApp Flow Status Check');
  console.log('══════════════════════════════════════════════\n');

  let allPublished = true;

  for (const flow of flows) {
    if (!flow.id) {
      console.warn(`⚠️   ${flow.name}: ${flow.envKey} is not set in .env — skipping`);
      allPublished = false;
      continue;
    }

    try {
      const info = await getFlowStatus(flow.id);
      const statusIcon = info.status === 'PUBLISHED' ? '✅' : info.status === 'DRAFT' ? '📝' : '⚠️ ';

      console.log(`${statusIcon}  ${flow.name}`);
      console.log(`    Flow ID   : ${info.id}`);
      console.log(`    Status    : ${info.status}`);
      console.log(`    Name      : ${info.name}`);
      if (info.endpoint_uri) console.log(`    Endpoint  : ${info.endpoint_uri}`);

      if (info.validation_errors && info.validation_errors.length > 0) {
        console.warn(`    ⚠️  Validation errors:`);
        console.warn(JSON.stringify(info.validation_errors, null, 4));
      }

      if (info.status !== 'PUBLISHED') allPublished = false;

    } catch (err) {
      const errData = err.response?.data?.error || err.message;
      console.error(`❌  ${flow.name} (${flow.id}): Failed to fetch status`);
      console.error('    Error:', JSON.stringify(errData, null, 4));
      allPublished = false;
    }
    console.log();
  }

  console.log('══════════════════════════════════════════════');
  if (allPublished) {
    console.log('✅  All flows are PUBLISHED and ready to use.\n');
  } else {
    console.log('⚠️   One or more flows are NOT published.');
    console.log('    Run:  node scripts/publish-flows.js  to publish them.\n');
  }
})();
