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
        if (crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
          return { mobile, epicNo };
        }
      } catch (_) {}
    }
    return null;
  } catch {
    return null;
  }
}

// ── GET /upload/:token ────────────────────────────────────────────
router.get('/:token', (req, res) => {
  const info = verifyUploadToken(req.params.token);
  if (!info) {
    return res.status(410).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#111;color:#fff">
      <h2 style="color:#f5c842">⚠️ Link Expired</h2>
      <p>This link has expired or is invalid.<br>Please message the WhatsApp bot again to get a new link.</p>
    </body></html>`);
  }

  const TOKEN = req.params.token;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
<title>Upload Photo — WTL Member Card</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0d0d;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:20px 16px 40px}
  
  .header{text-align:center;margin-bottom:24px;padding-top:8px}
  .header h1{font-size:1.5rem;font-weight:700;color:#f5c842;margin-bottom:4px}
  .header p{font-size:.85rem;color:#888}

  /* ── Step 1: choose source ── */
  #step-choose{width:100%;max-width:400px}
  .choose-title{font-size:1rem;color:#ccc;text-align:center;margin-bottom:20px}
  .btn-row{display:flex;gap:12px;width:100%}
  .btn-src{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px 12px;border-radius:16px;border:2px solid #333;background:#1a1a1a;cursor:pointer;transition:border-color .2s,background .2s;font-size:.9rem;color:#ccc;font-weight:600}
  .btn-src:active{background:#252525}
  .btn-src.camera:hover,.btn-src.camera:active{border-color:#4fc3f7;color:#4fc3f7}
  .btn-src.gallery:hover,.btn-src.gallery:active{border-color:#f5c842;color:#f5c842}
  .btn-src svg{width:40px;height:40px}
  .btn-src.camera svg{stroke:#4fc3f7}
  .btn-src.gallery svg{stroke:#f5c842}
  .tip{margin-top:20px;padding:14px;background:#1a1a1a;border-radius:12px;font-size:.8rem;color:#777;line-height:1.6;text-align:left}
  .tip strong{color:#aaa}
  input[type=file]{display:none}

  /* ── Step 2: crop ── */
  #step-crop{display:none;width:100%;max-width:420px}
  .crop-label{font-size:.9rem;color:#aaa;text-align:center;margin-bottom:10px}
  .crop-wrap{width:100%;background:#000;border-radius:14px;overflow:hidden;position:relative}
  .crop-wrap img{display:block;max-width:100%}
  .crop-actions{display:flex;gap:10px;margin-top:14px}
  .btn-retake{flex:1;padding:13px;border:2px solid #444;background:transparent;color:#aaa;border-radius:12px;font-size:.9rem;font-weight:600;cursor:pointer}
  .btn-retake:active{background:#1a1a1a}
  .btn-generate{flex:2;padding:13px;background:#f5c842;color:#111;border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer;transition:opacity .2s}
  .btn-generate:disabled{opacity:.5;cursor:not-allowed}
  .btn-generate:active{opacity:.85}

  /* ── Step 3: progress / done ── */
  #step-done{display:none;width:100%;max-width:400px;text-align:center}
  .progress-box{padding:32px 20px;background:#1a1a1a;border-radius:16px}
  .spinner{width:48px;height:48px;border:4px solid rgba(245,200,66,.2);border-top-color:#f5c842;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}
  @keyframes spin{to{transform:rotate(360deg)}}
  .progress-text{color:#f5c842;font-weight:600;font-size:1rem}
  .success-box{padding:32px 20px;background:#0d2b0d;border-radius:16px;border:1px solid #2d5a2d}
  .success-icon{font-size:3rem;margin-bottom:12px}
  .success-title{font-size:1.2rem;font-weight:700;color:#6efb6e;margin-bottom:8px}
  .success-sub{font-size:.9rem;color:#5dc05d}
  .error-box{padding:24px 20px;background:#2b0d0d;border-radius:16px;border:1px solid #5a2d2d;margin-bottom:16px}
  .error-text{color:#f87;font-size:.9rem;margin-bottom:14px}
  .btn-retry{padding:12px 24px;background:#f5c842;color:#111;border:none;border-radius:10px;font-size:.9rem;font-weight:700;cursor:pointer}
</style>
</head>
<body>

<div class="header">
  <h1>📸 Upload Your Photo</h1>
  <p>We The Leaders — Digital Member ID Card</p>
</div>

<!-- Step 1: Choose source -->
<div id="step-choose">
  <p class="choose-title">How would you like to add your photo?</p>
  <div class="btn-row">
    <div class="btn-src camera" onclick="openCamera()">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
      Open Camera
    </div>
    <div class="btn-src gallery" onclick="openGallery()">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      Upload File
    </div>
  </div>
  <div class="tip">
    <strong>Tips for a good photo:</strong><br>
    • Face clearly visible, good lighting<br>
    • Plain or simple background<br>
    • No sunglasses or hat<br>
    • Portrait orientation preferred
  </div>
</div>

<!-- Hidden file inputs -->
<input type="file" id="input-camera"  accept="image/*" capture="user">
<input type="file" id="input-gallery" accept="image/*">

<!-- Step 2: Crop -->
<div id="step-crop">
  <p class="crop-label">Drag to reposition • Pinch to zoom</p>
  <div class="crop-wrap">
    <img id="crop-img" src="" alt="crop"/>
  </div>
  <div class="crop-actions">
    <button class="btn-retake" onclick="retake()">↩ Retake</button>
    <button class="btn-generate" id="btn-generate" onclick="submitPhoto()">Generate My Card ✨</button>
  </div>
</div>

<!-- Step 3: Done -->
<div id="step-done">
  <div id="progress-box" class="progress-box">
    <div class="spinner"></div>
    <div class="progress-text" id="progress-text">Uploading photo…</div>
  </div>
  <div id="success-box" class="success-box" style="display:none">
    <div class="success-icon">🎉</div>
    <div class="success-title">Card Generated!</div>
    <div class="success-sub">Check your WhatsApp — your Digital Member ID Card has been sent!</div>
  </div>
  <div id="error-box" class="error-box" style="display:none">
    <div class="error-text" id="error-text">Something went wrong.</div>
    <button class="btn-retry" onclick="retake()">Try Again</button>
  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js"></script>
<script>
const TOKEN = ${JSON.stringify(TOKEN)};
let cropper = null;

function openCamera() {
  document.getElementById('input-camera').value = '';
  document.getElementById('input-camera').click();
}
function openGallery() {
  document.getElementById('input-gallery').value = '';
  document.getElementById('input-gallery').click();
}

document.getElementById('input-camera').addEventListener('change', function() {
  if (this.files && this.files[0]) loadImage(this.files[0]);
});
document.getElementById('input-gallery').addEventListener('change', function() {
  if (this.files && this.files[0]) loadImage(this.files[0]);
});

function loadImage(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = document.getElementById('crop-img');
    img.src = e.target.result;

    // Destroy old cropper if any
    if (cropper) { cropper.destroy(); cropper = null; }

    document.getElementById('step-choose').style.display = 'none';
    document.getElementById('step-crop').style.display   = 'block';
    document.getElementById('step-done').style.display   = 'none';

    // Init Cropper.js after image loads
    img.onload = function() {
      cropper = new Cropper(img, {
        aspectRatio:   3 / 4,        // ID card photo ratio
        viewMode:      1,            // restrict crop box within canvas
        dragMode:      'move',       // move image, not crop box
        autoCropArea:  0.8,
        responsive:    true,
        restore:       false,
        guides:        true,
        center:        true,
        highlight:     false,
        cropBoxMovable:   true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        background: false,
      });
    };
    // Trigger onload if already loaded
    if (img.complete) img.onload();
  };
  reader.readAsDataURL(file);
}

function retake() {
  if (cropper) { cropper.destroy(); cropper = null; }
  document.getElementById('crop-img').src = '';
  document.getElementById('step-choose').style.display = 'block';
  document.getElementById('step-crop').style.display   = 'none';
  document.getElementById('step-done').style.display   = 'none';
  document.getElementById('success-box').style.display = 'none';
  document.getElementById('error-box').style.display   = 'none';
  document.getElementById('progress-box').style.display = 'block';
  document.getElementById('btn-generate').disabled = false;
}

async function submitPhoto() {
  if (!cropper) return;
  const btn = document.getElementById('btn-generate');
  btn.disabled = true;

  document.getElementById('step-crop').style.display = 'none';
  document.getElementById('step-done').style.display = 'block';
  document.getElementById('progress-box').style.display = 'block';
  document.getElementById('success-box').style.display  = 'none';
  document.getElementById('error-box').style.display    = 'none';
  document.getElementById('progress-text').textContent  = 'Cropping photo…';

  try {
    // Get cropped canvas at 600×800
    const croppedCanvas = cropper.getCroppedCanvas({ width: 600, height: 800, imageSmoothingQuality: 'high' });

    document.getElementById('progress-text').textContent = 'Uploading photo…';

    const blob = await new Promise((resolve, reject) => {
      croppedCanvas.toBlob(b => {
        if (b) resolve(b);
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/jpeg', 0.92);
    });

    document.getElementById('progress-text').textContent = 'Generating your ID card…';

    const form = new FormData();
    form.append('photo', blob, 'photo.jpg');

    const resp = await fetch('/upload/' + TOKEN, {
      method: 'POST',
      body:   form,
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error('Server error ' + resp.status + ': ' + txt.slice(0, 100));
    }

    const data = await resp.json();
    if (!data.success) throw new Error(data.message || 'Upload failed');

    document.getElementById('progress-box').style.display = 'none';
    document.getElementById('success-box').style.display  = 'block';

  } catch (err) {
    console.error('Upload error:', err);
    document.getElementById('progress-box').style.display = 'none';
    document.getElementById('error-box').style.display    = 'block';
    document.getElementById('error-text').textContent     = '❌ ' + (err.message || 'Upload failed. Please try again.');
    btn.disabled = false;
  }
}
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ── POST /upload/:token ───────────────────────────────────────────
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 15 * 1024 * 1024 },
});

router.post('/:token', upload.single('photo'), async (req, res) => {
  const info = verifyUploadToken(req.params.token);
  if (!info) return res.status(410).json({ success: false, message: 'Link expired. Message the bot again to get a new link.' });
  if (!req.file) return res.status(400).json({ success: false, message: 'No photo received.' });

  const { mobile, epicNo } = info;
  const waTo = mobile.length === 10 ? `91${mobile}` : mobile;

  let db;
  try { db = getDb(); } catch (e) {
    return res.status(500).json({ success: false, message: 'Database unavailable.' });
  }

  const pending = await db.collection('pending_registrations').findOne({ mobile });
  if (!pending) {
    return res.status(400).json({ success: false, message: 'No pending registration found. Please start again by messaging the bot.' });
  }

  // Respond immediately so the browser shows success UI
  res.json({ success: true, message: 'Photo received — generating your card now!' });

  // Card generation runs async — does not block the HTTP response
  setImmediate(async () => {
    try {
      await db.collection('pending_registrations').updateOne(
        { mobile }, { $set: { status: 'processing', photo_received_at: new Date() } },
      );

      await sendTextMessage(waTo, '⏳ Generating your Digital Member ID Card… please wait a moment.');

      const photoBuffer = req.file.buffer;
      const ptcCode     = 'PTC-' + crypto.randomBytes(4).toString('hex').toUpperCase();

      const voterData = {
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
            EPIC_NO:       epicNo,
            ptc_code:      ptcCode,
            photo_url:     photoUrl,
            card_url:      frontUrl,
            back_url:      backUrl,
            combined_url:  frontUrl,
            generated_at:  now,
            VOTER_NAME:    pending.voter_name    || '',
            ASSEMBLY_NAME: pending.assembly_name || '',
            DISTRICT_NAME: pending.district      || '',
            MOBILE_NO:     mobile,
            source:        'web_upload',
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
      await sendImageMessage(waTo, backUrl,
        '🪪 *Your Digital Member ID Card — BACK*\n\nWe The Leaders — Lead the Change');
      await sendTextMessage(waTo,
        `🎉 *Registration Complete!*\n\nWelcome to We The Leaders, *${pending.voter_name || 'Member'}*!\n\nYour PTC Code: *${ptcCode}*\n\nShare and invite others to join!`);

      console.log(`[Upload] Card generated & sent for ${mobile} / ${epicNo}`);
    } catch (err) {
      console.error(`[Upload] Card generation error for ${mobile}:`, err.message, err.stack);
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
