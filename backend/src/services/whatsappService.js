/**
 * WhatsApp Cloud API — outbound message helpers
 * ─────────────────────────────────────────────────────────────────
 * sendTextMessage(to, text)          — plain text reply
 * sendFlowMessage(to, flowId, type)  — interactive flow message
 *   type: 'registration' | 'login'
 *
 * All functions return { success, data } or { success: false, error }
 */

'use strict';

const axios  = require('axios');
const config = require('../config');

const GRAPH_VERSION = 'v22.0';
const BASE          = `https://graph.facebook.com/${GRAPH_VERSION}`;

function authHeaders() {
  return { Authorization: `Bearer ${config.whatsapp.accessToken}` };
}

// ── Send a plain text message ─────────────────────────────────────
async function sendTextMessage(to, text) {
  const phoneId = config.whatsapp.phoneNumberId;
  if (!phoneId || !config.whatsapp.accessToken) {
    console.error('[WA] WHATSAPP_PHONE_NUMBER_ID or ACCESS_TOKEN not configured');
    return { success: false, error: 'WhatsApp not configured' };
  }

  try {
    const { data } = await axios.post(
      `${BASE}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      },
      { headers: authHeaders() },
    );
    console.log(`[WA] Text sent to ${to}:`, data?.messages?.[0]?.id);
    return { success: true, data };
  } catch (err) {
    const errData = err.response?.data?.error || err.message;
    console.error(`[WA] sendTextMessage to ${to} failed:`, JSON.stringify(errData));
    return { success: false, error: errData };
  }
}

// ── Send a WhatsApp Flow message ──────────────────────────────────
/**
 * @param {string} to          — recipient phone number (with country code, no +)
 * @param {'registration'|'login'} flowType
 */
async function sendFlowMessage(to, flowType) {
  const phoneId = config.whatsapp.phoneNumberId;
  if (!phoneId || !config.whatsapp.accessToken) {
    console.error('[WA] WHATSAPP_PHONE_NUMBER_ID or ACCESS_TOKEN not configured');
    return { success: false, error: 'WhatsApp not configured' };
  }

  const isLogin        = flowType === 'login';
  const flowId         = isLogin
    ? config.whatsapp.flows.loginId
    : config.whatsapp.flows.registrationId;

  if (!flowId) {
    console.error(`[WA] Flow ID not configured for type: ${flowType}`);
    return { success: false, error: `Flow ID missing for ${flowType}` };
  }

  // flow_token — unique per session; use timestamp + phone for traceability
  const flowToken = `${flowType}_${to}_${Date.now()}`;

  // Header + body text vary by flow type
  const headerText = isLogin
    ? 'Welcome Back! 👋'
    : 'Join We The Leaders! 🎉';

  const bodyText = isLogin
    ? 'You are already a registered member. Tap below to log in and access your Digital Member ID Card.'
    : 'You are not yet registered. Tap below to verify your Voter ID and generate your free Digital Member ID Card.';

  const ctaLabel = isLogin ? 'Open My Card' : 'Get Member Card';

  try {
    const { data } = await axios.post(
      `${BASE}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'flow',
          header: {
            type: 'text',
            text: headerText,
          },
          body: {
            text: bodyText,
          },
          footer: {
            text: 'We The Leaders — Lead the Change',
          },
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_token:           flowToken,
              flow_id:              flowId,
              flow_cta:             ctaLabel,
              flow_action:          'navigate',
              flow_action_payload: {
                screen: isLogin ? 'MOBILE_INPUT' : 'WELCOME',
                data:   {},
              },
            },
          },
        },
      },
      { headers: authHeaders() },
    );

    const msgId = data?.messages?.[0]?.id;
    console.log(`[WA] Flow message (${flowType}) sent to ${to}: ${msgId}`);
    return { success: true, data, flowToken };
  } catch (err) {
    const errData = err.response?.data?.error || err.message;
    console.error(`[WA] sendFlowMessage (${flowType}) to ${to} failed:`, JSON.stringify(errData));
    return { success: false, error: errData };
  }
}

module.exports = { sendTextMessage, sendFlowMessage };
