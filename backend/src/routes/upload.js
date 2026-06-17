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

// ── Token helpers — HMAC-SHA256(mobile:epic) signed with SESSION_SECRET ──
function makeUploadToken(mobile, epicNo) {
  const payload = `${mobile}:${epicNo}:${Math.floor(Date.now() / 3_600_000)}`; // 1-hour bucket
  const sig     = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('hex').slice(0, 16);
  return Buffer.from(`${mobile}:${epicNo}:${sig}`).toString('base64url');
}

function verifyUploadToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts   = decoded.split(':');
    if (parts.length !== 3) return null;
    const [mobile, epicNo, sig] = parts;
    // Accept current hour and previous hour (handles boundary)
    for (const hour of [0, -1]) {
      const payload  = `${mobile}:${epicNo}:${Math.floor(Date.now() / 3_600_000) + hour}`;
      const expected = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('hex').slice(0, 16);
      if (crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
        return { mobile, epicNo };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── GET /upload/:token  — serve HTML upload page ──────────────────
router.get('/:token', (req, res) => {
  const info = verifyUploadToken(req.params.token);
  if (!info) return res.status(410).send('<h2>Link expired or invalid. Please message the WhatsApp bot again.</h2>');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Upload Your Photo — WTL Member Card</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Barlow',sans-serif;background:#111;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
  .card{background:#1a1a1a;border-radius:16px;padding:32px 24px;width:100%;max-width:420px;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.5)}
  h1{font-size:1.4rem;font-weight:700;margin-bottom:4px;color:#f5c842}
  .sub{font-size:.9rem;color:#aaa;margin-bottom:24px}
  #drop-zone{border:2px dashed #444;border-radius:12px;padding:32px 16px;cursor:pointer;transition:border-color .2s;margin-bottom:16px;position:relative;overflow:hidden;background:#222}
  #drop-zone:hover,#drop-zone.drag-over{border-color:#f5c842}
  #drop-zone p{color:#888;font-size:.95rem}
  #drop-zone img{display:none;width:100%;border-radius:8px;object-fit:cover}
  #file-input{display:none}
  #crop-area{display:none;margin-bottom:16px;position:relative;background:#000;border-radius:12px;overflow:hidden;touch-action:none}
  #crop-canvas{display:block;width:100%;border-radius:12px}
  .crop-overlay{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;border-radius:12px;box-shadow:inset 0 0 0 9999px rgba(0,0,0,0.5)}
  #crop-frame{position:absolute;border:2px solid #f5c842;border-radius:4px;cursor:move}
  #btn-upload{display:none;width:100%;padding:14px;background:#f5c842;color:#111;font-size:1rem;font-weight:700;border:none;border-radius:10px;cursor:pointer;transition:opacity .2s}
  #btn-upload:hover{opacity:.85}
  #btn-upload:disabled{opacity:.5;cursor:not-allowed}
  #progress{display:none;margin-top:16px;color:#f5c842;font-weight:600}
  .spinner{display:inline-block;width:18px;height:18px;border:3px solid rgba(245,200,66,.3);border-top-color:#f5c842;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px}
  @keyframes spin{to{transform:rotate(360deg)}}
  #success{display:none;margin-top:20px;padding:20px;background:#1d3a1d;border-radius:12px;color:#6efb6e;font-weight:600}
  #error-msg{display:none;margin-top:12px;color:#f87;font-size:.9rem}
</style>
</head>
<body>
<div class="card">
  <h1>📸 Upload Your Photo</h1>
  <p class="sub">We The Leaders — Digital Member ID Card</p>

  <div id="drop-zone" onclick="document.getElementById('file-input').click()">
    <img id="preview"/>
    <p id="drop-text">Tap here to select your photo<br/><small>Passport-size photo recommended</small></p>
  </div>
  <input type="file" id="file-input" accept="image/*" capture="user"/>

  <div id="crop-area">
    <canvas id="crop-canvas"></canvas>
    <div class="crop-overlay"></div>
    <div id="crop-frame"></div>
  </div>

  <button id="btn-upload" onclick="submitPhoto()">Generate My ID Card</button>
  <div id="progress"><span class="spinner"></span><span id="progress-text">Uploading…</span></div>
  <div id="success">✅ Card generated! Check your WhatsApp — your ID card has been sent.</div>
  <div id="error-msg"></div>
</div>

<script>
const TOKEN = ${JSON.stringify(req.params.token)};
let croppedBlob = null;
let originalFile = null;

// ── File select ─────────────────────────────────────────────────
document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  originalFile = file;
  showCropper(file);
});

// ── Drag-over styling ────────────────────────────────────────────
const dz = document.getElementById('drop-zone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) { originalFile = file; showCropper(file); }
});

// ── Simple crop (drag rect on canvas) ────────────────────────────
let img = new Image();
let canvas, ctx;
// Card photo ratio ≈ 3:4 (portrait)
const RATIO = 3 / 4;
let cropX, cropY, cropW, cropH;
let dragging = false, dragStartX, dragStartY, origCropX, origCropY;

function showCropper(file) {
  const url = URL.createObjectURL(file);
  img.onload = () => {
    document.getElementById('crop-area').style.display = 'block';
    canvas = document.getElementById('crop-canvas');
    const maxW = Math.min(360, window.innerWidth - 48);
    const scale = maxW / img.width;
    canvas.width  = Math.round(img.width  * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.style.width  = canvas.width  + 'px';
    canvas.style.height = canvas.height + 'px';
    ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // Init crop rect centre of image, 3:4 ratio
    cropW = Math.min(canvas.width * 0.7, canvas.height * 0.7 * RATIO);
    cropH = cropW / RATIO;
    cropX = (canvas.width  - cropW) / 2;
    cropY = (canvas.height - cropH) / 2;
    drawCropFrame();
    document.getElementById('drop-zone').style.display = 'none';
    document.getElementById('btn-upload').style.display = 'block';
    prepareCrop();
  };
  img.src = url;
}

function drawCropFrame() {
  const frame = document.getElementById('crop-frame');
  const rect  = canvas.getBoundingClientRect();
  const scaleX = rect.width  / canvas.width;
  const scaleY = rect.height / canvas.height;
  frame.style.left   = (cropX * scaleX) + 'px';
  frame.style.top    = (cropY * scaleY) + 'px';
  frame.style.width  = (cropW * scaleX) + 'px';
  frame.style.height = (cropH * scaleY) + 'px';
  frame.style.display = 'block';
}

// ── Drag crop frame ───────────────────────────────────────────────
function prepareCrop() {
  const frame = document.getElementById('crop-frame');
  const area  = document.getElementById('crop-area');

  function onStart(e) {
    dragging = true;
    const touch = e.touches ? e.touches[0] : e;
    const rect  = canvas.getBoundingClientRect();
    dragStartX = touch.clientX - rect.left;
    dragStartY = touch.clientY - rect.top;
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    dragStartX *= scaleX; dragStartY *= scaleY;
    origCropX = cropX; origCropY = cropY;
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    const touch = e.touches ? e.touches[0] : e;
    const rect  = canvas.getBoundingClientRect();
    let mx = touch.clientX - rect.left;
    let my = touch.clientY - rect.top;
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    mx *= scaleX; my *= scaleY;
    cropX = Math.max(0, Math.min(canvas.width  - cropW, origCropX + mx - dragStartX));
    cropY = Math.max(0, Math.min(canvas.height - cropH, origCropY + my - dragStartY));
    drawCropFrame();
    e.preventDefault();
  }
  function onEnd() { dragging = false; }

  frame.addEventListener('mousedown',  onStart);
  frame.addEventListener('touchstart', onStart, {passive:false});
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, {passive:false});
  window.addEventListener('mouseup',   onEnd);
  window.addEventListener('touchend',  onEnd);
}

// ── Crop to blob ──────────────────────────────────────────────────
function getCroppedBlob() {
  return new Promise(resolve => {
    const out = document.createElement('canvas');
    // Output 600x800 (3:4)
    out.width  = 600;
    out.height = 800;
    const octx = out.getContext('2d');
    const scaleX = img.width  / canvas.width;
    const scaleY = img.height / canvas.height;
    octx.drawImage(img,
      cropX * scaleX, cropY * scaleY, cropW * scaleX, cropH * scaleY,
      0, 0, 600, 800
    );
    out.toBlob(resolve, 'image/jpeg', 0.92);
  });
}

// ── Submit ────────────────────────────────────────────────────────
async function submitPhoto() {
  const btn = document.getElementById('btn-upload');
  btn.disabled = true;
  document.getElementById('progress').style.display = 'block';
  document.getElementById('progress-text').textContent = 'Cropping photo…';
  document.getElementById('error-msg').style.display = 'none';

  try {
    const blob = await getCroppedBlob();
    document.getElementById('progress-text').textContent = 'Uploading & generating card…';
    const form = new FormData();
    form.append('photo', blob, 'photo.jpg');

    const resp = await fetch('/upload/' + TOKEN, { method: 'POST', body: form });
    const data = await resp.json();

    if (data.success) {
      document.getElementById('progress').style.display = 'none';
      document.getElementById('crop-area').style.display = 'none';
      btn.style.display = 'none';
      document.getElementById('success').style.display = 'block';
    } else {
      throw new Error(data.message || 'Upload failed');
    }
  } catch (err) {
    document.getElementById('progress').style.display = 'none';
    btn.disabled = false;
    const em = document.getElementById('error-msg');
    em.textContent = '❌ ' + err.message;
    em.style.display = 'block';
  }
}
</script>
</body>
</html>`;

  res.send(html);
});

// ── POST /upload/:token  — receive photo, generate card, send WA ─
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
    return res.status(500).json({ success: false, message: 'DB unavailable.' });
  }

  // Check pending registration
  const pending = await db.collection('pending_registrations').findOne({ mobile });
  if (!pending) {
    return res.status(400).json({ success: false, message: 'No pending registration found. Please start again by messaging the bot.' });
  }

  res.json({ success: true, message: 'Photo received — generating your card now!' });

  // Async card generation — do not block response
  setImmediate(async () => {
    try {
      await db.collection('pending_registrations').updateOne(
        { mobile }, { $set: { status: 'processing', photo_received_at: new Date() } },
      );

      await sendTextMessage(waTo, '⏳ Generating your Digital Member ID Card… please wait a moment.');

      const photoBuffer = req.file.buffer;
      const ptcCode     = 'PTC-' + require('crypto').randomBytes(4).toString('hex').toUpperCase();
      const voterData   = {
        epic_no:       epicNo,
        EPIC_NO:       epicNo,
        name:          pending.voter_name    || '',
        VOTER_NAME:    pending.voter_name    || '',
        assembly_name: pending.assembly_name || '',
        ASSEMBLY_NAME: pending.assembly_name || '',
        district:      pending.district      || '',
        DISTRICT_NAME: pending.district      || '',
        mobile,
        MOBILE_NO:     mobile,
        ptc_code:      ptcCode,
      };

      const frontBuffer = await generateCard(voterData, photoBuffer);
      const backBuffer  = await generateBackCard(voterData);
      const photoUrl    = await uploadPhoto(photoBuffer,  epicNo);
      const frontUrl    = await uploadCard(frontBuffer,   epicNo);
      const backUrl     = await uploadBackCard(backBuffer, epicNo);

      const now = new Date();
      await db.collection('generated_voters').updateOne(
        { EPIC_NO: epicNo },
        {
          $set: {
            EPIC_NO: epicNo, ptc_code: ptcCode, photo_url: photoUrl,
            card_url: frontUrl, back_url: backUrl, combined_url: frontUrl,
            generated_at: now, VOTER_NAME: pending.voter_name || '',
            ASSEMBLY_NAME: pending.assembly_name || '', DISTRICT_NAME: pending.district || '',
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
        `🔖 PTC Code : ${ptcCode}`,
        '',
        'We The Leaders — Lead the Change',
      ].join('\n');

      await sendImageMessage(waTo, frontUrl, frontCaption);
      await new Promise(r => setTimeout(r, 1000));
      await sendImageMessage(waTo, backUrl, '🪪 *Your Digital Member ID Card — BACK*\n\nWe The Leaders — Lead the Change');
      await sendTextMessage(waTo,
        `🎉 *Registration Complete!*\n\nWelcome to We The Leaders, *${pending.voter_name || 'Member'}*!\n\nYour PTC Code: *${ptcCode}*\n\nShare and invite others to join!`,
      );

      console.log(`[Upload] Card generated & sent for ${mobile} / ${epicNo}`);
    } catch (err) {
      console.error(`[Upload] Card generation error for ${mobile}:`, err.message);
      try {
        await db.collection('pending_registrations').updateOne(
          { mobile }, { $set: { status: 'awaiting_photo' } },
        );
        await sendTextMessage(waTo, '❌ Card generation failed. Please send your photo again in WhatsApp chat.');
      } catch (_) {}
    }
  });
});

module.exports = { router, makeUploadToken };
