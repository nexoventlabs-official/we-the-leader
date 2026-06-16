/**
 * Check and publish WhatsApp Flows for the Annamalai Membership project.
 *
 * What it does:
 *   1. Fetches current status of REGISTRATION and LOGIN flows from Meta
 *   2. If a flow is DRAFT:
 *      a. Uploads the latest local flow JSON
 *      b. Updates the endpoint_uri (so Meta can call our server for data_exchange)
 *      c. Publishes the flow
 *   3. If already PUBLISHED → skips (no changes)
 *
 * Usage:  node scripts/publish-flows.js
 *         npm run flow:publish
 *
 * Required .env keys:
 *   WHATSAPP_ACCESS_TOKEN
 *   WHATSAPP_FLOW_REGISTRATION_ID
 *   WHATSAPP_FLOW_LOGIN_ID
 *   BASE_URL                        (e.g. https://your-backend.onrender.com)
 */
require("dotenv").config();
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const GRAPH_VERSION = "v22.0";
const GRAPH_ROOT = `https://graph.facebook.com/${GRAPH_VERSION}`;
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");

if (!ACCESS_TOKEN) {
  console.error("❌  WHATSAPP_ACCESS_TOKEN is not set in .env");
  process.exit(1);
}

// Flow definitions — id + local JSON asset path
const flows = [
  {
    name: "Registration (SIGN_UP)",
    id: process.env.WHATSAPP_FLOW_REGISTRATION_ID,
    envKey: "WHATSAPP_FLOW_REGISTRATION_ID",
    jsonPath: path.join(__dirname, "../src/assets/flow_registration.json"),
  },
  {
    name: "Login (SIGN_IN)",
    id: process.env.WHATSAPP_FLOW_LOGIN_ID,
    envKey: "WHATSAPP_FLOW_LOGIN_ID",
    jsonPath: path.join(__dirname, "../src/assets/flow_login.json"),
  },
];

// ── Helpers ──────────────────────────────────────────────────────

async function getStatus(flowId) {
  const { data } = await axios.get(`${GRAPH_ROOT}/${flowId}`, {
    params: {
      fields: "id,name,status,validation_errors,endpoint_uri",
      access_token: ACCESS_TOKEN,
    },
  });
  return data;
}

async function uploadFlowJson(flowId, jsonPath) {
  const flowJson = fs.readFileSync(jsonPath, "utf8");
  const fd = new FormData();
  fd.append("file", Buffer.from(flowJson), {
    filename: "flow.json",
    contentType: "application/json",
  });
  fd.append("name", "flow.json");
  fd.append("asset_type", "FLOW_JSON");

  const { data } = await axios.post(`${GRAPH_ROOT}/${flowId}/assets`, fd, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      ...fd.getHeaders(),
    },
    maxContentLength: 10 * 1024 * 1024,
    maxBodyLength: 10 * 1024 * 1024,
  });
  return data;
}

async function updateEndpointUri(flowId, endpointUri) {
  const { data } = await axios.post(
    `${GRAPH_ROOT}/${flowId}`,
    { endpoint_uri: endpointUri },
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
  );
  return data;
}

async function publishFlow(flowId) {
  const { data } = await axios.post(
    `${GRAPH_ROOT}/${flowId}/publish`,
    {},
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
  );
  return data;
}

// ── Main ─────────────────────────────────────────────────────────

(async () => {
  console.log("\n══════════════════════════════════════════════");
  console.log("  Annamalai — Publish WhatsApp Flows");
  console.log("══════════════════════════════════════════════\n");

  const endpointUri = BASE_URL ? `${BASE_URL}/api/webhook/flow` : null;
  if (endpointUri) {
    console.log(`  Flow endpoint: ${endpointUri}`);
  } else {
    console.warn("  ⚠️  BASE_URL not set — endpoint_uri will not be updated.");
    console.warn("       Set BASE_URL in .env to your live backend URL.\n");
  }

  for (const flow of flows) {
    console.log(`\n──── ${flow.name} ────`);

    if (!flow.id) {
      console.warn(`  ⚠️  ${flow.envKey} is not set in .env — skipping`);
      continue;
    }

    // 1. Fetch current status
    let info;
    try {
      info = await getStatus(flow.id);
      const icon = info.status === "PUBLISHED" ? "✅" : "📝";
      console.log(`  ${icon} Flow ID  : ${info.id}`);
      console.log(`     Status  : ${info.status}`);
      if (info.endpoint_uri) console.log(`     Endpoint: ${info.endpoint_uri}`);
    } catch (err) {
      console.error(
        `  ❌ Could not fetch status:`,
        JSON.stringify(err.response?.data?.error || err.message),
      );
      continue;
    }

    // 2. Already published — nothing to do
    if (info.status === "PUBLISHED") {
      console.log("  ✅ Already PUBLISHED — no action needed");
      continue;
    }

    // 3. Upload latest JSON
    if (!fs.existsSync(flow.jsonPath)) {
      console.error(`  ❌ Local JSON not found: ${flow.jsonPath}`);
      continue;
    }

    console.log(
      `  📤 Uploading flow JSON from ${path.basename(flow.jsonPath)}…`,
    );
    try {
      const uploadRes = await uploadFlowJson(flow.id, flow.jsonPath);
      if (uploadRes?.validation_errors?.length) {
        console.warn("  ⚠️  Validation errors — fix before publishing:");
        console.warn(JSON.stringify(uploadRes.validation_errors, null, 4));
        continue;
      }
      console.log("  ✅ JSON uploaded successfully");
    } catch (err) {
      console.error(
        "  ❌ JSON upload failed:",
        JSON.stringify(err.response?.data || err.message),
      );
      continue;
    }

    // 4. Update endpoint URI (needed for data_exchange screens)
    if (endpointUri) {
      console.log(`  🔗 Setting endpoint_uri to ${endpointUri}…`);
      try {
        await updateEndpointUri(flow.id, endpointUri);
        console.log("  ✅ Endpoint URI updated");
      } catch (err) {
        console.warn(
          "  ⚠️  Could not update endpoint_uri:",
          JSON.stringify(err.response?.data?.error || err.message),
        );
        console.warn(
          "       Continuing — endpoint may already be set in Meta dashboard.",
        );
      }
    }

    // 5. Publish
    console.log("  🚀 Publishing flow…");
    try {
      await publishFlow(flow.id);
      console.log("  ✅ Flow PUBLISHED successfully");
    } catch (err) {
      console.error(
        "  ❌ Publish failed:",
        JSON.stringify(err.response?.data || err.message),
      );
      console.log(
        "  ℹ️  Flow remains as DRAFT. Fix any errors in Meta Flow Builder and retry.\n",
      );
    }
  }

  console.log("\n══════════════════════════════════════════════");
  console.log("  Done.");
  console.log("  Next: npm run flow:subscribe  (to wire up the webhook)");
  console.log("  Check: npm run flow:status\n");
})();
