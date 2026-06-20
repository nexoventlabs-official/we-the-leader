'use strict';
/**
 * Photo Upload Route
 * GET  /upload/:token  — serves the upload/crop page
 * POST /upload/:token  — receives cropped photo, generates card, sends via WhatsApp
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const config  = require('../config');
const { getDb } = require('../db');
const { uploadPhoto, uploadCard, uploadBackCard } = require('../services/cloudinaryService');
const { generateCard, generateBackCard }          = require('../services/cardGenerator');
const { sendTextMessage, sendImageMessage }       = require('../services/whatsappService');

// ── Status page helper ────────────────────────────────────────────
function statusPage(title, message, bgColor, textColor) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>WTL Member Card</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0d0d;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.box{background:${bgColor};border-radius:16px;padding:36px 28px;max-width:380px;width:100%;text-align:center;border:1px solid ${textColor}33}
.icon{font-size:3rem;margin-bottom:16px}
h2{font-size:1.3rem;font-weight:700;color:${textColor};margin-bottom:14px}
p{font-size:.9rem;color:#aaa;line-height:1.7}
p strong{color:#ddd}
</style>
</head>
<body>
<div class="box">
  <div class="icon">${title.startsWith('⏳') ? '⏳' : title.startsWith('✅') ? '🎉' : 'ℹ️'}</div>
  <h2>${title.replace(/^[^\w\s]*\s*/, '')}</h2>
  <p>${message}</p>
</div>
</body>
</html>`;
}

// ── Token helpers ─────────────────────────────────────────────────
function makeUploadToken(mobile, epicNo) {
  const payload = `${mobile}:${epicNo}:${Math.floor(Date.now() / 3_600_000)}`;
  const sig     = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('hex').slice(0, 16);
  return Buffer.from(`${mobile}:${epicNo}:${sig}`).toString('base64url');
}

function verifyUploadToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts   = decoded.split(':');
    if (parts.length !== 3) return null;
    const [mobile, epicNo, sig] = parts;
    for (const hour of [0, -1]) {
      const payload  = `${mobile}:${epicNo}:${Math.floor(Date.now() / 3_600_000) + hour}`;
      const expected = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('hex').slice(0, 16);
      try {
        if (crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')))
          return { mobile, epicNo };
      } catch (_) {}
    }
    return null;
  } catch { return null; }
}

// ── GET /upload/:token ────────────────────────────────────────────
router.get('/:token', async (req, res) => {
  const info = verifyUploadToken(req.params.token);
  if (!info) {
    return res.status(410).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="font-family:sans-serif;text-align:center;padding:40px;background:#111;color:#fff">
<h2 style="color:#f5c842">⚠️ Link Expired</h2>
<p style="color:#aaa;margin-top:12px">Please message the WhatsApp bot again to get a new link.</p>
</body></html>`);
  }

  // ── Check current registration status before showing upload page ─
  const { mobile, epicNo } = info;
  try {
    const db = getDb();

    // Already has a generated card
    const genDoc = await db.collection('generated_voters').findOne(
      { EPIC_NO: epicNo }, { projection: { card_url: 1, VOTER_NAME: 1, wtl_code: 1 } },
    );
    if (genDoc && genDoc.card_url) {
      return res.send(statusPage(
        '✅ Already Registered!',
        `Your Digital Member ID Card has already been generated.<br><br>
         <strong>${genDoc.VOTER_NAME || ''}</strong><br>
         WTL Code: <strong>${genDoc.wtl_code || ''}</strong><br><br>
         Please check your WhatsApp — your card was sent there.<br>
         If you need it again, send <strong>"hi"</strong> to the WhatsApp bot.`,
        '#0a220a', '#5cf05c'
      ));
    }

    // Photo received, card is being generated right now
    const pending = await db.collection('pending_registrations').findOne(
      { mobile }, { projection: { status: 1, voter_name: 1 } },
    );
    if (pending && pending.status === 'processing') {
      return res.send(statusPage(
        '⏳ Generating Your Card...',
        `Hi <strong>${pending.voter_name || 'Member'}</strong>!<br><br>
         We already received your photo and your ID Card is being generated right now.<br><br>
         Please wait — it will be sent to your WhatsApp shortly.`,
        '#1a1a0a', '#f5c842'
      ));
    }

    if (pending && pending.status === 'completed') {
      return res.send(statusPage(
        '✅ Registration Complete!',
        `Hi <strong>${pending.voter_name || 'Member'}</strong>!<br><br>
         Your registration is complete and your Digital Member ID Card has been sent to your WhatsApp.<br><br>
         If you need it again, send <strong>"hi"</strong> to the WhatsApp bot.`,
        '#0a220a', '#5cf05c'
      ));
    }
  } catch (_) {
    // DB check failed — show upload page anyway
  }

  const TOKEN = req.params.token;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
<title>Upload Photo — WTL Member Card</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0d0d;color:#fff;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:20px 16px 48px}

h1{font-size:1.4rem;font-weight:700;color:#f5c842;margin-bottom:4px;margin-top:4px}
.sub{font-size:.8rem;color:#888;margin-bottom:28px}

/* ── STEP 1 ── */
#step-choose{width:100%;max-width:380px}
.pick-title{font-size:.95rem;color:#bbb;text-align:center;margin-bottom:18px}
.btn-row{display:flex;gap:12px}

/* LABEL wraps input — most reliable way in WebViews, no JS .click() */
label.pick-btn{
  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:10px;padding:26px 12px;border-radius:16px;border:2px solid #2a2a2a;
  background:#1a1a1a;cursor:pointer;font-size:.9rem;color:#bbb;font-weight:600;
  user-select:none;-webkit-user-select:none;transition:border-color .15s
}
label.pick-btn:active{background:#222;transform:scale(.97)}
label.pick-btn.cam{border-color:#1e3d4f}
label.pick-btn.cam:active{border-color:#4fc3f7;color:#4fc3f7}
label.pick-btn.gal{border-color:#3d3d10}
label.pick-btn.gal:active{border-color:#f5c842;color:#f5c842}
label.pick-btn svg{width:38px;height:38px;stroke-width:1.5}
label.pick-btn.cam svg{stroke:#4fc3f7}
label.pick-btn.gal svg{stroke:#f5c842}
/* Keep input accessible but invisible — NOT display:none (blocks WebView) */
label.pick-btn input{position:fixed;top:-9999px;left:-9999px;opacity:0;width:1px;height:1px}

.tips{margin-top:20px;background:#161616;border-radius:12px;padding:14px 16px;font-size:.78rem;color:#666;line-height:1.8}
.tips b{color:#888}

/* ── STEP 2: CROP ── */
#step-crop{display:none;width:100%;max-width:400px}
.crop-hint{font-size:.82rem;color:#666;text-align:center;margin-bottom:10px}

/* Canvas container — fixed aspect so no overflow */
#canvas-wrap{
  position:relative;width:100%;
  border-radius:14px;overflow:hidden;
  background:#000;touch-action:none;cursor:crosshair
}
#crop-canvas{display:block;width:100%;height:auto}

.crop-actions{display:flex;gap:10px;margin-top:14px}
.btn-retake{
  flex:1;padding:14px;border:2px solid #333;background:transparent;
  color:#aaa;border-radius:12px;font-size:.9rem;font-weight:600;cursor:pointer
}
.btn-retake:active{background:#1a1a1a}
#btn-gen{
  flex:2;padding:14px;background:#f5c842;color:#111;
  border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer
}
#btn-gen:disabled{opacity:.45;cursor:not-allowed}
#btn-gen:active{opacity:.8}

/* ── STEP 3 ── */
#step-done{display:none;width:100%;max-width:380px;text-align:center}
.prog-box{padding:36px 20px;background:#181818;border-radius:16px}
.spin{width:50px;height:50px;border:4px solid #2a2a2a;border-top-color:#f5c842;border-radius:50%;animation:spin .75s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}
.prog-txt{color:#f5c842;font-weight:600}
.ok-box{padding:36px 20px;background:#0a220a;border-radius:16px;border:1px solid #1e4a1e}
.ok-icon{font-size:3rem;margin-bottom:10px}
.ok-title{font-size:1.2rem;font-weight:700;color:#5cf05c;margin-bottom:8px}
.ok-sub{font-size:.88rem;color:#4ab84a;line-height:1.6}
.err-box{padding:24px 20px;background:#220a0a;border-radius:16px;border:1px solid #4a1e1e}
.err-txt{color:#f88;font-size:.9rem;margin-bottom:14px;line-height:1.5}
.btn-retry{padding:12px 28px;background:#f5c842;color:#111;border:none;border-radius:10px;font-size:.9rem;font-weight:700;cursor:pointer}
</style>
</head>
<body>

<h1>📸 Upload Your Photo</h1>
<p class="sub">We The Leaders — Digital Member ID Card</p>

<!-- STEP 1: pick source -->
<div id="step-choose">
  <p class="pick-title">Choose how to add your photo</p>
  <div class="btn-row">
    <label class="pick-btn cam">
      <input type="file" accept="image/*" capture="environment" id="inp-cam"/>
      <svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
      Camera
    </label>
    <label class="pick-btn gal">
      <input type="file" accept="image/*" id="inp-gal"/>
      <svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      Gallery
    </label>
  </div>
  <div class="tips">
    <b>Tips for a good photo</b><br>
    • Clear face, good lighting<br>
    • Plain or simple background<br>
    • No sunglasses or hat<br>
    • Portrait / vertical preferred
  </div>
</div>

<!-- STEP 2: crop -->
<div id="step-crop">
  <p class="crop-hint">Drag to move &nbsp;•&nbsp; The yellow box = your photo area</p>
  <div id="canvas-wrap">
    <canvas id="crop-canvas"></canvas>
  </div>
  <div class="crop-actions">
    <button class="btn-retake" id="btn-retake">↩ Retake</button>
    <button id="btn-gen">Generate Card ✨</button>
  </div>
</div>

<!-- STEP 3: done -->
<div id="step-done">
  <div id="prog-box" class="prog-box">
    <div class="spin"></div>
    <div class="prog-txt" id="prog-txt">Uploading photo…</div>
  </div>
  <div id="ok-box" class="ok-box" style="display:none">
    <div class="ok-icon">🎉</div>
    <div class="ok-title">Card Generated!</div>
    <div class="ok-sub">Check your WhatsApp —<br>your Digital Member ID Card has been sent!</div>
  </div>
  <div id="err-box" class="err-box" style="display:none">
    <div class="err-txt" id="err-txt">Something went wrong.</div>
    <button class="btn-retry" id="btn-retry">↩ Try Again</button>
  </div>
</div>

<script>
(function(){
  var TOKEN = ${JSON.stringify(TOKEN)};

  // ── State ────────────────────────────────────────────────────────
  var img       = null;   // loaded Image object
  var canvas    = document.getElementById('crop-canvas');
  var ctx       = canvas.getContext('2d');
  var RATIO     = 3/4;    // crop aspect ratio (portrait ID photo)

  // Crop box in canvas coords
  var cx=0, cy=0, cw=0, ch=0;
  // Drag state
  var drag=false, dx=0, dy=0, ocx=0, ocy=0;

  // ── Show / hide steps ────────────────────────────────────────────
  function show(id){
    ['step-choose','step-crop','step-done'].forEach(function(s){
      document.getElementById(s).style.display = s===id ? 'block' : 'none';
    });
  }

  // ── File inputs ──────────────────────────────────────────────────
  document.getElementById('inp-cam').addEventListener('change', function(){
    if(this.files && this.files[0]) loadFile(this.files[0]);
    this.value='';
  });
  document.getElementById('inp-gal').addEventListener('change', function(){
    if(this.files && this.files[0]) loadFile(this.files[0]);
    this.value='';
  });

  function loadFile(file){
    if(!file.type.startsWith('image/')){ alert('Please select an image.'); return; }
    var reader = new FileReader();
    reader.onload = function(e){
      var i = new Image();
      i.onload = function(){
        img = i;
        setupCanvas();
        show('step-crop');
      };
      i.onerror = function(){ alert('Could not load image.'); };
      i.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ── Canvas setup ─────────────────────────────────────────────────
  function setupCanvas(){
    // Canvas logical size = image size (draw 1:1)
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // Crop box: centred, 80% of the narrower dimension, 3:4 ratio
    var maxW = img.naturalWidth  * 0.8;
    var maxH = img.naturalHeight * 0.8;
    if(maxW / RATIO <= maxH){
      cw = maxW;
    } else {
      cw = maxH * RATIO;
    }
    ch = cw / RATIO;
    cx = (img.naturalWidth  - cw) / 2;
    cy = (img.naturalHeight - ch) / 2;

    draw();
  }

  // ── Draw ─────────────────────────────────────────────────────────
  function draw(){
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);

    // Draw image
    ctx.drawImage(img, 0, 0, W, H);

    // Dim everything outside crop box
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    // Top
    ctx.fillRect(0, 0, W, cy);
    // Bottom
    ctx.fillRect(0, cy+ch, W, H-(cy+ch));
    // Left
    ctx.fillRect(0, cy, cx, ch);
    // Right
    ctx.fillRect(cx+cw, cy, W-(cx+cw), ch);
    ctx.restore();

    // Crop box border
    ctx.save();
    ctx.strokeStyle = '#f5c842';
    ctx.lineWidth   = Math.max(2, W * 0.004);
    ctx.setLineDash([Math.max(6, W*0.01), Math.max(4, W*0.007)]);
    ctx.strokeRect(cx, cy, cw, ch);
    ctx.restore();

    // Corner handles
    var hs = Math.max(16, W * 0.03);
    ctx.save();
    ctx.strokeStyle = '#f5c842';
    ctx.lineWidth   = Math.max(3, W * 0.006);
    ctx.setLineDash([]);
    var corners = [[cx,cy],[cx+cw,cy],[cx,cy+ch],[cx+cw,cy+ch]];
    corners.forEach(function(c){
      var signX = (c[0]===cx ? 1 : -1);
      var signY = (c[1]===cy ? 1 : -1);
      ctx.beginPath();
      ctx.moveTo(c[0]+signX*hs, c[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(c[0], c[1]+signY*hs);
      ctx.stroke();
    });
    ctx.restore();
  }

  // ── Canvas → display scale ────────────────────────────────────────
  function scaleXY(clientX, clientY){
    var rect = canvas.getBoundingClientRect();
    var sx   = canvas.width  / rect.width;
    var sy   = canvas.height / rect.height;
    return { x: (clientX - rect.left)*sx, y: (clientY - rect.top)*sy };
  }

  // ── Drag handlers ─────────────────────────────────────────────────
  function onDown(clientX, clientY){
    var p = scaleXY(clientX, clientY);
    // Only start drag if inside crop box
    if(p.x>=cx && p.x<=cx+cw && p.y>=cy && p.y<=cy+ch){
      drag=true; dx=p.x-cx; dy=p.y-cy; ocx=cx; ocy=cy;
    }
  }
  function onMove(clientX, clientY){
    if(!drag) return;
    var p  = scaleXY(clientX, clientY);
    cx = Math.max(0, Math.min(canvas.width -cw, p.x-dx));
    cy = Math.max(0, Math.min(canvas.height-ch, p.y-dy));
    draw();
  }
  function onUp(){ drag=false; }

  canvas.addEventListener('mousedown',  function(e){ e.preventDefault(); onDown(e.clientX, e.clientY); });
  canvas.addEventListener('mousemove',  function(e){ e.preventDefault(); onMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup',    function(){ onUp(); });

  canvas.addEventListener('touchstart', function(e){ e.preventDefault(); if(e.touches[0]) onDown(e.touches[0].clientX, e.touches[0].clientY); }, {passive:false});
  canvas.addEventListener('touchmove',  function(e){ e.preventDefault(); if(e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY); }, {passive:false});
  canvas.addEventListener('touchend',   function(e){ e.preventDefault(); onUp(); }, {passive:false});

  // ── Retake ────────────────────────────────────────────────────────
  document.getElementById('btn-retake').addEventListener('click', function(){
    img=null;
    canvas.width=1; canvas.height=1;
    document.getElementById('btn-gen').disabled=false;
    document.getElementById('prog-box').style.display='block';
    document.getElementById('ok-box').style.display='none';
    document.getElementById('err-box').style.display='none';
    show('step-choose');
  });

  document.getElementById('btn-retry').addEventListener('click', function(){
    document.getElementById('btn-gen').disabled=false;
    document.getElementById('prog-box').style.display='block';
    document.getElementById('ok-box').style.display='none';
    document.getElementById('err-box').style.display='none';
    show('step-choose');
  });

  // ── Generate card ─────────────────────────────────────────────────
  document.getElementById('btn-gen').addEventListener('click', function(){
    if(!img){ alert('Please select a photo first.'); return; }
    var btn = this;
    btn.disabled = true;
    show('step-done');
    document.getElementById('prog-box').style.display='block';
    document.getElementById('ok-box').style.display='none';
    document.getElementById('err-box').style.display='none';
    document.getElementById('prog-txt').textContent='Cropping photo…';

    // Crop to 600×800 offscreen canvas
    var out   = document.createElement('canvas');
    out.width = 600; out.height = 800;
    var octx  = out.getContext('2d');
    octx.drawImage(img, cx, cy, cw, ch, 0, 0, 600, 800);

    document.getElementById('prog-txt').textContent='Uploading…';

    out.toBlob(function(blob){
      if(!blob){
        showErr('Could not process image. Please retake.', btn);
        return;
      }
      var form = new FormData();
      form.append('photo', blob, 'photo.jpg');

      document.getElementById('prog-txt').textContent='Generating your ID card…';

      fetch('/upload/'+TOKEN, { method:'POST', body:form })
        .then(function(r){ return r.text(); })
        .then(function(txt){
          var data;
          try{ data=JSON.parse(txt); } catch(e){ throw new Error('Server error: '+txt.slice(0,80)); }
          if(!data.success) throw new Error(data.message || 'Upload failed');
          document.getElementById('prog-box').style.display='none';
          // Already processing or done — show appropriate message
          if(data.already) {
            document.getElementById('ok-box').style.display='block';
            document.querySelector('.ok-title').textContent = data.message === 'already_processing' ? 'Card Being Generated!' : 'Already Done!';
            document.querySelector('.ok-sub').textContent   = data.displayMessage;
          } else {
            document.getElementById('ok-box').style.display='block';
          }
        })
        .catch(function(err){
          showErr(err.message || 'Upload failed. Please try again.', btn);
        });
    }, 'image/jpeg', 0.92);
  });

  function showErr(msg, btn){
    document.getElementById('prog-box').style.display='none';
    document.getElementById('err-box').style.display='block';
    document.getElementById('err-txt').textContent='❌ '+msg;
    if(btn) btn.disabled=false;
  }

})();
</script>
</body>
</html>`);
});

// ── POST /upload/:token ───────────────────────────────────────────
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/:token', upload.single('photo'), async (req, res) => {
  const info = verifyUploadToken(req.params.token);
  if (!info) return res.status(410).json({ success: false, message: 'Link expired. Message the bot again.' });
  if (!req.file) return res.status(400).json({ success: false, message: 'No photo received.' });

  const { mobile, epicNo } = info;
  const waTo = mobile.length === 10 ? `91${mobile}` : mobile;

  let db;
  try { db = getDb(); } catch (e) {
    return res.status(500).json({ success: false, message: 'Database unavailable.' });
  }

  const pending = await db.collection('pending_registrations').findOne({ mobile });
  if (!pending) {
    return res.status(400).json({
      success: false,
      message: 'No pending registration found. Please message the bot again to restart.',
    });
  }

  // ── Duplicate submission guard ────────────────────────────────
  // If already processing or completed, don't regenerate
  if (pending.status === 'processing') {
    return res.json({
      success: true,
      message: 'already_processing',
      already: true,
      displayMessage: 'Your photo was already received and your card is being generated. Please check WhatsApp shortly!',
    });
  }
  if (pending.status === 'completed') {
    const genDoc = await db.collection('generated_voters').findOne({ EPIC_NO: epicNo }, { projection: { card_url: 1 } });
    if (genDoc && genDoc.card_url) {
      return res.json({
        success: true,
        message: 'already_done',
        already: true,
        displayMessage: 'Your Digital Member ID Card has already been generated and sent to your WhatsApp!',
      });
    }
  }

  // Respond immediately so the browser shows the success screen
  res.json({ success: true, message: 'Photo received — generating your card now!' });

  // Run card generation asynchronously — never blocks the HTTP response
  setImmediate(async () => {
    try {
      await db.collection('pending_registrations').updateOne(
        { mobile }, { $set: { status: 'processing', photo_received_at: new Date() } },
      );

      await sendTextMessage(waTo, '⏳ Generating your Digital Member ID Card… please wait a moment.');

      const photoBuffer = req.file.buffer;
      const wtlCode     = 'WTL-' + crypto.randomBytes(4).toString('hex').toUpperCase();

      // Fetch voter from DB1 to get PART_NO (booth number)
      let partNo = '';
      try {
        const { findVoterByEpic } = require('../db');
        const voterDoc = await findVoterByEpic(epicNo);
        if (voterDoc) partNo = String(voterDoc.PART_NO || voterDoc.part_no || '').trim();
      } catch (_) {}

      const voterData = {
        epic_no:       epicNo,  EPIC_NO:       epicNo,
        name:          pending.voter_name    || '',
        VOTER_NAME:    pending.voter_name    || '',
        assembly_name: pending.assembly_name || '',
        ASSEMBLY_NAME: pending.assembly_name || '',
        district:      pending.district      || '',
        DISTRICT_NAME: pending.district      || '',
        part_no:       partNo,
        PART_NO:       partNo,
        booth:         partNo,
        mobile,        MOBILE_NO: mobile,
        wtl_code:      wtlCode,
      };

      const frontBuffer = await generateCard(voterData, photoBuffer);
      const backBuffer  = await generateBackCard(voterData);
      const photoUrl    = await uploadPhoto(photoBuffer, epicNo);
      const frontUrl    = await uploadCard(frontBuffer,  epicNo);
      const backUrl     = await uploadBackCard(backBuffer, epicNo);
      const now         = new Date();

      await db.collection('generated_voters').updateOne(
        { EPIC_NO: epicNo },
        {
          $set: {
            EPIC_NO: epicNo, wtl_code: wtlCode,
            photo_url: photoUrl, card_url: frontUrl, back_url: backUrl, combined_url: frontUrl,
            generated_at: now,
            VOTER_NAME:    pending.voter_name    || '',
            ASSEMBLY_NAME: pending.assembly_name || '',
            DISTRICT_NAME: pending.district      || '',
            PART_NO:       partNo,
            MOBILE_NO: mobile, source: 'web_upload',
          },
          $setOnInsert: { created_at: now },
        },
        { upsert: true },
      );

      await db.collection('pending_registrations').updateOne(
        { mobile }, { $set: { status: 'completed', completed_at: now } },
      );

      const frontCaption = [
        '🪪 *Your Digital Member ID Card — FRONT*',
        `👤 Name     : ${pending.voter_name    || ''}`,
        `🗳️  EPIC No  : ${epicNo}`,
        `🏛️  Assembly : ${pending.assembly_name || ''}`,
        `🔖 WTL Code : ${wtlCode}`,
        '', 'We The Leaders — Lead the Change',
      ].join('\n');

      await sendImageMessage(waTo, frontUrl, frontCaption);
      await new Promise(r => setTimeout(r, 1000));
      await sendImageMessage(waTo, backUrl, '🪪 *Your Digital Member ID Card — BACK*\n\nWe The Leaders — Lead the Change');
      await sendTextMessage(waTo,
        `🎉 *Registration Complete!*\n\nWelcome to We The Leaders, *${pending.voter_name || 'Member'}*!\n\nYour WTL Code: *${wtlCode}*\n\nShare and invite others to join!`);

      console.log(`[Upload] Card generated & sent for ${mobile} / ${epicNo}`);
    } catch (err) {
      console.error(`[Upload] Error for ${mobile}:`, err.message, err.stack);
      try {
        await db.collection('pending_registrations').updateOne(
          { mobile }, { $set: { status: 'awaiting_photo' } },
        );
        await sendTextMessage(waTo, '❌ Card generation failed. Please send your photo directly in WhatsApp chat.');
      } catch (_) {}
    }
  });
});

module.exports = { router, makeUploadToken };
