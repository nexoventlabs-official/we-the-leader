/**
 * Public routes — mirrors Flask verify_voter, referral_landing, health, etc.
 */
const express = require('express');
const router  = express.Router();
const config  = require('../config');
const { getDb, getVoterDb, findVoterByEpic } = require('../db');
const { publicVerifyLimiter } = require('../middleware/rateLimiter');

// ── Root route — returns API status ────────────────────────────────
router.get('/', async (req, res) => {
  let dbStatus = 'unknown';
  let voterDbStatus = 'unknown';
  try {
    const db = getDb();
    await db.command({ ping: 1 });
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }
  try {
    const vdb = getVoterDb();
    await vdb.command({ ping: 1 });
    voterDbStatus = 'connected';
  } catch {
    voterDbStatus = 'disconnected';
  }

  res.json({
    success:   true,
    service:   'We The Leaders — API Server',
    tagline:   'Lead the Change',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
    status: {
      api:      'online',
      app_db:   dbStatus,
      voter_db: voterDbStatus,
    },
    endpoints: {
      health:          'GET  /health',
      verify_voter:    'GET  /api/verify/:epicNo',
      card_data:       'GET  /api/card/:epicNo',
      send_otp:        'POST /api/send-otp',
      verify_otp:      'POST /api/verify-otp',
      generate_card:   'POST /api/generate-card',
      admin_login:     'POST /admin/api/login',
      admin_stats:     'GET  /admin/api/stats',
      webhook:         'POST /api/webhook',
    },
  });
});

// ── Health check ─────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  let dbStatus = 'unknown';
  let voterDbStatus = 'unknown';
  try { const db = getDb(); await db.command({ ping: 1 }); dbStatus = 'connected'; } catch { dbStatus = 'disconnected'; }
  try { const vdb = getVoterDb(); await vdb.command({ ping: 1 }); voterDbStatus = 'connected'; } catch { voterDbStatus = 'disconnected'; }

  const healthy = dbStatus === 'connected';
  res.status(healthy ? 200 : 503).json({
    success:   healthy,
    status:    healthy ? 'healthy' : 'degraded',
    service:   'We The Leaders API',
    timestamp: new Date().toISOString(),
    env:       config.nodeEnv,
    checks: {
      api:      'ok',
      app_db:   dbStatus,
      voter_db: voterDbStatus,
    },
  });
});

// ── Cronjob ping (keep-alive for hosting) ────────────────────────
router.get('/cronjob', (req, res) => res.send('OK'));

// ── Verify voter by EPIC (for QR code scanning) ──────────────────
//  GET /verify/:epicNo  →  matches Python's /verify/<epic_no>
//  Also aliased at /api/verify/:epicNo
async function verifyVoterHandler(req, res) {
  try {
    const epicNo  = req.params.epicNo.trim().toUpperCase();
    const db      = getDb();       // DB2 — app data

    // Primary lookup from DB1 across all ass_* collections (read-only)
    const voterDoc = await findVoterByEpic(epicNo);

    // Fallback: check generated_voters in DB2 if not in voter roll
    let voter = null;

    if (voterDoc) {
      voter = voterDoc;
    } else {
      const genFallback = await db.collection('generated_voters').findOne({ EPIC_NO: epicNo });
      if (genFallback) { voter = genFallback; }
    }

    const stat   = await db.collection('generation_stats').findOne({ epic_no: epicNo })  || {};
    const genDoc = await db.collection('generated_voters').findOne({ EPIC_NO: epicNo })   || {};
    const volReq = await db.collection('volunteer_requests')
      .findOne({ epic_no: epicNo }, { sort: { requested_at: -1 } }) || {};
    const baReq  = await db.collection('booth_agent_requests')
      .findOne({ epic_no: epicNo }, { sort: { requested_at: -1 } }) || {};

    const name     = voter
      ? (voter.VOTER_NAME || `${voter.FM_NAME_EN || ''} ${voter.LASTNAME_EN || ''}`.trim() || '')
      : '';
    const authMob  = stat.auth_mobile || '';

    const out = {
      success:              true,
      verified:             Boolean(voter),
      epic_no:              epicNo,
      name,
      assembly:             voter?.ASSEMBLY_NAME || '',
      district:             voter?.DISTRICT      || voter?.DISTRICT_NAME || '',
      age:                  voter?.AGE           || '',
      gender:               voter?.GENDER        || '',
      part_no:              String(voter?.PART_NO || ''),
      ptc_code:             genDoc.ptc_code  || '',
      photo_url:            stat.photo_url   || genDoc.photo_url   || '',
      card_url:             stat.card_url    || genDoc.card_url    || '',
      gen_count:            stat.count       || 0,
      last_generated:       stat.last_generated ? String(stat.last_generated).slice(0, 19).replace('T', ' ') : '',
      auth_mobile_masked:   authMob.length >= 4 ? `****${authMob.slice(-4)}` : '',
      is_member:            Boolean(genDoc.ptc_code),
      volunteer_status:     volReq.status  || '',
      booth_agent_status:   baReq.status   || '',
    };

    if (!voter) {
      out.verified = false;
      out.message  = 'Voter not found.';
    }

    return res.json(out);
  } catch (err) {
    console.error('verify error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

router.get('/verify/:epicNo',     publicVerifyLimiter, verifyVoterHandler);
router.get('/api/verify/:epicNo', publicVerifyLimiter, verifyVoterHandler);

// ── Get card data ─────────────────────────────────────────────────
router.get('/api/card/:epicNo', async (req, res) => {
  try {
    const epicNo = req.params.epicNo.trim().toUpperCase();
    const db     = getDb();

    const stat   = await db.collection('generation_stats').findOne({ epic_no: epicNo })  || {};
    const genDoc = await db.collection('generated_voters').findOne({ EPIC_NO: epicNo })   || {};

    const cardUrl = stat.card_url   || genDoc.card_url   || '';
    if (!cardUrl) {
      return res.status(404).json({ success: false, message: 'Card not found.' });
    }

    const voterDoc = await findVoterByEpic(epicNo);
    const voter = voterDoc || genDoc;

    const name = voter
      ? (voter.VOTER_NAME || `${voter.FM_NAME_EN || ''} ${voter.LASTNAME_EN || ''}`.trim() || '')
      : '';

    return res.json({
      success:      true,
      card_url:     cardUrl,
      back_url:     stat.back_url     || genDoc.back_url     || '',
      combined_url: stat.combined_url || genDoc.combined_url || '',
      photo_url:    stat.photo_url    || genDoc.photo_url    || '',
      ptc_code:     genDoc.ptc_code   || '',
      gen_count:    stat.count        || 0,
      name,
      epic_no:      epicNo,
      assembly_name: voter?.ASSEMBLY_NAME || '',
      district:      voter?.DISTRICT      || voter?.DISTRICT_NAME || '',
      part_no:       String(voter?.PART_NO || ''),
    });
  } catch (err) {
    console.error('card error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── WhatsApp channel redirect ─────────────────────────────────────
router.get('/api/whatsapp-channel', (req, res) => {
  if (config.whatsappChannelUrl) return res.redirect(config.whatsappChannelUrl);
  return res.status(404).json({ success: false, message: 'WhatsApp channel not configured.' });
});

// ── Referral landing  ─────────────────────────────────────────────
//  GET /refer/:ptcCode/:referralId  →  Python's referral_landing
router.get('/refer/:ptcCode/:referralId', async (req, res) => {
  try {
    const { ptcCode, referralId } = req.params;
    const db  = getDb();
    const doc = await db.collection('generated_voters').findOne(
      { ptc_code: ptcCode, referral_id: referralId },
      { projection: { VOTER_NAME: 1, FM_NAME_EN: 1, LASTNAME_EN: 1 } }
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Invalid referral link.' });
    }

    const name = doc.VOTER_NAME ||
                 `${doc.FM_NAME_EN || ''} ${doc.LASTNAME_EN || ''}`.trim() ||
                 'A We The Leaders Member';
    // HTML-escape the name before embedding in OG meta tags
    const escapeHtml = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const referrerName = escapeHtml(name);
    const redirectUrl  = `${config.baseUrl}/?ref=${ptcCode}&rid=${referralId}`;
    const bannerUrl    = `${config.baseUrl}/static/banner.jpg`;

    // Return HTML with OG meta tags + instant redirect (mirrors Python response)
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta property="og:title"       content="We The Leaders — Become a Member!">
  <meta property="og:description" content="${referrerName} invites you to join We The Leaders! Generate your free Digital Member ID Card now.">
  <meta property="og:image"       content="${bannerUrl}">
  <meta property="og:url"         content="${config.baseUrl}/refer/${ptcCode}/${referralId}">
  <meta name="twitter:card"       content="summary_large_image">
  <meta name="twitter:title"      content="We The Leaders — Become a Member!">
  <meta name="twitter:image"      content="${bannerUrl}">
  <meta http-equiv="refresh"      content="0;url=${redirectUrl}">
  <title>We The Leaders — Join Now!</title>
</head>
<body style="font-family:sans-serif;text-align:center;padding:40px;">
  <h2>We The Leaders</h2>
  <p><em>Lead the Change</em></p>
  <p>Redirecting… <a href="${redirectUrl}">Click here</a> if not redirected.</p>
  <script>window.location.href="${redirectUrl}";</script>
</body>
</html>`;

    return res.send(html);
  } catch (err) {
    console.error('referral error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── Robots.txt ────────────────────────────────────────────────────
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${config.baseUrl}/sitemap.xml\n`
  );
});

// ── Sitemap.xml ───────────────────────────────────────────────────
router.get('/sitemap.xml', (req, res) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${config.baseUrl}/</loc><lastmod>2026-03-07</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>`;
  res.type('application/xml').send(xml);
});

module.exports = router;
