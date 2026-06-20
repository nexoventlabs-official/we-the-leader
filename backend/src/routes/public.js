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
//  GET /verify/:epicNo  — browser gets HTML card page, API gets JSON
//  Also aliased at /api/verify/:epicNo
async function verifyVoterHandler(req, res) {
  try {
    const epicNo  = req.params.epicNo.trim().toUpperCase();
    const db      = getDb();

    const voterDoc = await findVoterByEpic(epicNo);
    let voter = voterDoc || null;
    if (!voter) {
      const genFallback = await db.collection('generated_voters').findOne({ EPIC_NO: epicNo });
      if (genFallback) voter = genFallback;
    }

    const genDoc = await db.collection('generated_voters').findOne({ EPIC_NO: epicNo }) || {};
    const stat   = await db.collection('generation_stats').findOne({ epic_no: epicNo }) || {};

    const name     = voter ? (voter.VOTER_NAME || `${voter.FM_NAME_EN || ''} ${voter.LASTNAME_EN || ''}`.trim() || '') : '';
    const assembly = voter?.ASSEMBLY_NAME || genDoc.ASSEMBLY_NAME || '';
    const district = voter?.DISTRICT || voter?.DISTRICT_NAME || genDoc.DISTRICT_NAME || '';
    const partNo   = String(voter?.PART_NO || genDoc.PART_NO || '');
    const cardUrl  = stat.card_url  || genDoc.card_url  || '';
    const photoUrl = stat.photo_url || genDoc.photo_url || '';
    const wtlCode  = genDoc.wtl_code || '';
    const isMember = Boolean(wtlCode);

    // ── If request is from a browser (QR scan), return HTML verify page ─
    const accept = req.headers['accept'] || '';
    const isApi  = req.path.startsWith('/api/') || accept.includes('application/json');

    if (!isApi) {
      const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Member Verification — We The Leaders</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0d0d;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px 48px}
.logo{font-size:1.1rem;font-weight:700;color:#f5c842;margin:16px 0 4px;letter-spacing:1px}
.tagline{font-size:.75rem;color:#666;margin-bottom:28px;letter-spacing:2px;text-transform:uppercase}
.card{width:100%;max-width:420px;background:#1a1a1a;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.5)}
.card-photo{width:100%;height:200px;object-fit:cover;object-position:top}
.no-photo{width:100%;height:160px;background:#222;display:flex;align-items:center;justify-content:center;color:#444;font-size:.9rem}
.card-body{padding:20px}
.badge{display:inline-flex;align-items:center;gap:6px;background:${isMember ? '#0a3a0a' : '#3a0a0a'};color:${isMember ? '#5cf05c' : '#f05c5c'};border:1px solid ${isMember ? '#1e6a1e' : '#6a1e1e'};border-radius:20px;padding:6px 14px;font-size:.8rem;font-weight:700;margin-bottom:16px}
.name{font-size:1.4rem;font-weight:700;color:#fff;margin-bottom:4px}
.epic{font-size:.8rem;color:#666;margin-bottom:16px;font-family:monospace}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2a2a2a;font-size:.85rem}
.row:last-child{border-bottom:none}
.row-label{color:#888}
.row-value{color:#ddd;font-weight:600;text-align:right;max-width:60%}
${cardUrl ? `.view-card{display:block;margin-top:20px;padding:14px;background:#f5c842;color:#111;border-radius:12px;font-size:.95rem;font-weight:700;text-align:center;text-decoration:none}` : ''}
.footer{margin-top:28px;font-size:.75rem;color:#444;text-align:center;line-height:1.8}
</style>
</head>
<body>
<div class="logo">WE THE LEADERS</div>
<div class="tagline">Lead the Change</div>
<div class="card">
  ${photoUrl ? `<img class="card-photo" src="${esc(photoUrl)}" alt="Member Photo"/>` : '<div class="no-photo">No photo</div>'}
  <div class="card-body">
    <div class="badge">${isMember ? '✅ Verified Member' : '⚠️ Not Yet Registered'}</div>
    <div class="name">${esc(name) || 'Unknown'}</div>
    <div class="epic">${esc(epicNo)}</div>
    ${assembly ? `<div class="row"><span class="row-label">Assembly</span><span class="row-value">${esc(assembly)}</span></div>` : ''}
    ${district ? `<div class="row"><span class="row-label">District</span><span class="row-value">${esc(district)}</span></div>` : ''}
    ${partNo   ? `<div class="row"><span class="row-label">Booth No</span><span class="row-value">${esc(partNo)}</span></div>` : ''}
    ${wtlCode  ? `<div class="row"><span class="row-label">WTL Code</span><span class="row-value">${esc(wtlCode)}</span></div>` : ''}
    ${cardUrl  ? `<a class="view-card" href="${esc(cardUrl)}" target="_blank">📥 View My ID Card</a>` : ''}
  </div>
</div>
<div class="footer">We The Leaders Foundation<br>Verified via QR Code</div>
</body>
</html>`;
      return res.setHeader('Content-Type','text/html').send(html);
    }

    // ── API JSON response ─────────────────────────────────────────
    const volReq = await db.collection('volunteer_requests').findOne({ epic_no: epicNo }, { sort: { requested_at: -1 } }) || {};
    const baReq  = await db.collection('booth_agent_requests').findOne({ epic_no: epicNo }, { sort: { requested_at: -1 } }) || {};
    const authMob = stat.auth_mobile || '';

    const out = {
      success: true, verified: Boolean(voter), epic_no: epicNo, name, assembly, district,
      age: voter?.AGE || '', gender: voter?.GENDER || '', part_no: partNo,
      wtl_code: wtlCode, photo_url: photoUrl, card_url: cardUrl,
      gen_count: stat.count || 0,
      last_generated: stat.last_generated ? String(stat.last_generated).slice(0,19).replace('T',' ') : '',
      auth_mobile_masked: authMob.length >= 4 ? `****${authMob.slice(-4)}` : '',
      is_member: isMember,
      volunteer_status: volReq.status || '',
      booth_agent_status: baReq.status || '',
    };
    if (!voter) { out.verified = false; out.message = 'Voter not found.'; }
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
      wtl_code:     genDoc.wtl_code   || '',
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
//  GET /refer/:wtlCode/:referralId  →  Python's referral_landing
router.get('/refer/:wtlCode/:referralId', async (req, res) => {
  try {
    const wtlCode = String(req.params.wtlCode || '').trim().toUpperCase();
    const referralId = String(req.params.referralId || '').trim().toUpperCase();
    const db  = getDb();
    const doc = await db.collection('generated_voters').findOne(
      { wtl_code: wtlCode, referral_id: referralId },
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
    const redirectUrl  = `${config.frontendUrl || config.baseUrl}/?ref=${wtlCode}&rid=${referralId}`;
    const bannerUrl    = `${config.baseUrl}/static/banner.jpg`;

    // Return HTML with OG meta tags + instant redirect (mirrors Python response)
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta property="og:title"       content="We The Leaders — Become a Member!">
  <meta property="og:description" content="${referrerName} invites you to join We The Leaders! Generate your free Digital Member ID Card now.">
  <meta property="og:image"       content="${bannerUrl}">
  <meta property="og:url"         content="${config.baseUrl}/refer/${wtlCode}/${referralId}">
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
