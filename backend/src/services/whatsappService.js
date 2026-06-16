/**
 * WhatsApp Cloud API — outbound message helpers
 * ─────────────────────────────────────────────────────────────────
 * sendTextMessage(to, text)              — plain text reply
 * sendReplyButtons(to, body, buttons)    — interactive reply buttons
 * sendImageMessage(to, imageUrl, caption)— send an image by URL
 * sendFlowMessage(to, flowType)          — interactive flow (registration)
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

function phoneId() {
  return config.whatsapp.phoneNumberId;
}

function checkConfig() {
  if (!phoneId() || !config.whatsapp.accessToken) {
    console.error('[WA] WHATSAPP_PHONE_NUMBER_ID or ACCESS_TOKEN not configured');
    return false;
  }
  return true;
}

// ── Plain text message ────────────────────────────────────────────
async function sendTextMessage(to, text) {
  if (!checkConfig()) return { success: false, error: 'WhatsApp not configured' };
  try {
    const { data } = await axios.post(
      `${BASE}/${phoneId()}/messages`,
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
    const e = err.response?.data?.error || err.message;
    console.error(`[WA] sendTextMessage to ${to} failed:`, JSON.stringify(e));
    return { success: false, error: e };
  }
}

// ── Interactive reply buttons ─────────────────────────────────────
/**
 * @param {string} to
 * @param {string} bodyText   — main message body
 * @param {Array}  buttons    — max 3, each: { id: string, title: string }
 * @param {string} [header]   — optional header text
 * @param {string} [footer]   — optional footer text
 */
async function sendReplyButtons(to, bodyText, buttons, header, footer) {
  if (!checkConfig()) return { success: false, error: 'WhatsApp not configured' };
  try {
    const interactive = {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map(b => ({
          type:  'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    };
    if (header) interactive.header = { type: 'text', text: header };
    if (footer) interactive.footer = { text: footer };

    const { data } = await axios.post(
      `${BASE}/${phoneId()}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type: 'interactive',
        interactive,
      },
      { headers: authHeaders() },
    );
    console.log(`[WA] Reply buttons sent to ${to}:`, data?.messages?.[0]?.id);
    return { success: true, data };
  } catch (err) {
    const e = err.response?.data?.error || err.message;
    console.error(`[WA] sendReplyButtons to ${to} failed:`, JSON.stringify(e));
    return { success: false, error: e };
  }
}

// ── Send image by URL ─────────────────────────────────────────────
async function sendImageMessage(to, imageUrl, caption) {
  if (!checkConfig()) return { success: false, error: 'WhatsApp not configured' };
  try {
    const { data } = await axios.post(
      `${BASE}/${phoneId()}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type: 'image',
        image: {
          link:    imageUrl,
          caption: caption || '',
        },
      },
      { headers: authHeaders() },
    );
    console.log(`[WA] Image sent to ${to}:`, data?.messages?.[0]?.id);
    return { success: true, data };
  } catch (err) {
    const e = err.response?.data?.error || err.message;
    console.error(`[WA] sendImageMessage to ${to} failed:`, JSON.stringify(e));
    return { success: false, error: e };
  }
}

// ── WhatsApp Flow message (registration only) ─────────────────────
async function sendFlowMessage(to, flowType) {
  if (!checkConfig()) return { success: false, error: 'WhatsApp not configured' };

  const isLogin = flowType === 'login';
  const startScreen = isLogin ? 'MOBILE_INPUT' : 'EPIC_ENTRY';
  const flowId  = isLogin
    ? config.whatsapp.flows.loginId
    : config.whatsapp.flows.registrationId;

  if (!flowId) {
    console.error(`[WA] Flow ID not configured for type: ${flowType}`);
    return { success: false, error: `Flow ID missing for ${flowType}` };
  }

  const flowToken  = `${flowType}_${to}_${Date.now()}`;
  const headerText = isLogin ? 'Welcome Back! 👋' : 'Join We The Leaders! 🎉';
  const bodyText   = isLogin
    ? 'You are already a registered member. Tap below to log in and access your Digital Member ID Card.'
    : 'You are not yet registered. Tap below to verify your Voter ID and generate your free Digital Member ID Card.';
  const ctaLabel   = isLogin ? 'Open My Card' : 'Get Member Card';

  try {
    const { data } = await axios.post(
      `${BASE}/${phoneId()}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'flow',
          header: { type: 'text', text: headerText },
          body:   { text: bodyText },
          footer: { text: 'We The Leaders — Lead the Change' },
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_token:           flowToken,
              flow_id:              flowId,
              flow_cta:             ctaLabel,
              flow_action:          'navigate',
              flow_action_payload: {
                screen: startScreen,
              },
            },
          },
        },
      },
      { headers: authHeaders() },
    );
    const msgId = data?.messages?.[0]?.id;
    console.log(`[WA] Flow (${flowType}) sent to ${to}: ${msgId}`);
    return { success: true, data, flowToken };
  } catch (err) {
    const e = err.response?.data?.error || err.message;
    console.error(`[WA] sendFlowMessage (${flowType}) to ${to} failed:`, JSON.stringify(e));
    return { success: false, error: e };
  }
}

module.exports = { sendTextMessage, sendReplyButtons, sendImageMessage, sendFlowMessage };

