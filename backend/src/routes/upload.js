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

.header{text-align:center;margin-bottom:28px;padding-top:8px}
.header h1{font-size:1.5rem;font-weight:700;color:#f5c842;margin-bottom:4px}
.header p{font-size:.85rem;color:#888}

/* Step 1 */
#step-choose{width:100%;max-width:400px}
.choose-title{font-size:1rem;color:#ccc;text-align:center;margin-bottom:20px}
.btn-row{display:flex;gap:12px;width:100%}

/* KEY FIX: label acts as the button — wraps the file input directly */
.btn-label{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px 12px;border-radius:16px;border:2px solid #333;background:#1a1a1a;cursor:pointer;font-size:.9rem;color:#ccc;font-weight:600;transition:border-color .15s,background .15s;user-select:none;-webkit-user-select:none}
.btn-label:active{background:#252525;transform:scale(.97)}
.btn-label.camera{border-color:#2a4a5a}
.btn-label.camera:active,.btn-label.camera:focus-within{border-color:#4fc3f7;color:#4fc3f7}
.btn-label.gallery{border-color:#4a4a1a}
.btn-label.gallery:active,.btn-label.gallery:focus-within{border-color:#f5c842;color:#f5c842}
.btn-label svg{width:40px;height:40px}
.btn-label.camera svg{stroke:#4fc3f7}
.btn-label.gallery svg{stroke:#f5c842}

/* Hide input but keep it accessible (NOT display:none which blocks clicks in WebView) */
.btn-label input[type=file]{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;pointer-events:none}

.tip{margin-top:20px;padding:14px;background:#1a1a1a;border-radius:12px;font-size:.8rem;color:#777;line-height:1.7;text-align:left}
.tip strong{color:#aaa;display:block;margin-bottom:4px}

/* Step 2 */
#step-crop{display:none;width:100%;max-width:420px}
.crop-hint{font-size:.85rem;color:#888;text-align:center;margin-bottom:10px}
.crop-wrap{width:100%;background:#000;border-radius:14px;overflow:hidden}
.crop-wrap img{display:block;max-width:100%;max-height:60vh}
.crop-actions{display:flex;gap:10px;margin-top:14px}
.btn-retake{flex:1;padding:14px;border:2px solid #444;background:transparent;color:#aaa;border-radius:12px;font-size:.95rem;font-weight:600;cursor:pointer}
.btn-retake:active{background:#1a1a1a}
.btn-generate{flex:2;padding:14px;background:#f5c842;color:#111;border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer}
.btn-generate:disabled{opacity:.5;cursor:not-allowed}
.btn-generate:active{opacity:.85}

/* Step 3 */
#step-done{display:none;width:100%;max-width:400px;text-align:center}
.progress-box{padding:36px 20px;background:#1a1a1a;border-radius:16px}
.spinner{width:52px;height:52px;border:4px solid rgba(245,200,66,.15);border-top-color:#f5c842;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 18px}
@keyframes spin{to{transform:rotate(360deg)}}
.progress-text{color:#f5c842;font-weight:600;font-size:1rem}
.success-box{padding:36px 20px;background:#0d2b0d;border-radius:16px;border:1px solid #2d5a2d}
.success-icon{font-size:3.5rem;margin-bottom:12px}
.success-title{font-size:1.3rem;font-weight:700;color:#6efb6e;margin-bottom:8px}
.success-sub{font-size:.9rem;color:#5dc05d;line-height:1.5}
.error-box{padding:24px 20px;background:#2b0d0d;border-radius:16px;border:1px solid #5a2d2d}
.error-text{color:#f87;font-size:.9rem;margin-bottom:16px;line-height:1.5}
.btn-retry{padding:12px 28px;background:#f5c842;color:#111;border:none;border-radius:10px;font-size:.95rem;font-weight:700;cursor:pointer}
</style>
</head>
<body>

<div class="header">
  <h1>📸 Upload Your Photo</h1>
  <p>We The Leaders — Digital Member ID Card</p>
</div>

<!-- STEP 1: Choose source -->
<div id="step-choose">
  <p class="choose-title">Choose how to add your photo</p>
  <div class="btn-row">

    <!-- Camera button — label wraps input directly, no JS .click() needed -->
    <label class="btn-label camera">
      <input type="file" accept="image/*" capture="environment" id="input-camera"/>
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
      Camera
    </label>

    <!-- Gallery button -->
    <label class="btn-label gallery">
      <input type="file" accept="image/*" id="input-gallery"/>
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      Gallery
    </label>

  </div>
  <div class="tip">
    <strong>Tips for a good photo</strong>
    • Clear face, good lighting<br>
    • Plain or simple background<br>
    • No sunglasses or hat<br>
    • Portrait / vertical photo preferred
  </div>
</div>

<!-- STEP 2: Crop -->
<div id="step-crop">
  <p class="crop-hint">Drag to reposition &nbsp;•&nbsp; Pinch to zoom</p>
  <div class="crop-wrap">
    <img id="crop-img" src="" alt=""/>
  </div>
  <div class="crop-actions">
    <button class="btn-retake" onclick="retake()">↩ Retake</button>
    <button class="btn-generate" id="btn-generate" onclick="submitPhoto()">Generate Card ✨</button>
  </div>
</div>

<!-- STEP 3: Processing / Done -->
<div id="step-done">
  <div id="progress-box" class="progress-box">
    <div class="spinner"></div>
    <div class="progress-text" id="progress-text">Uploading photo…</div>
  </div>
  <div id="success-box" class="success-box" style="display:none">
    <div class="success-icon">🎉</div>
    <div class="success-title">Card Generated!</div>
    <div class="success-sub">Check your WhatsApp —<br>your Digital Member ID Card has been sent!</div>
  </div>
  <div id="error-box" class="error-box" style="display:none">
    <div class="error-text" id="error-text">Something went wrong. Please try again.</div>
    <button class="btn-retry" onclick="retake()">↩ Try Again</button>
  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js"></script>
<script>
const TOKEN = ${JSON.stringify(TOKEN)};
let cropper = null;

function onFileSelected(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = document.getElementById('crop-img');

    // Destroy previous cropper if any
    if (cropper) { try { cropper.destroy(); } catch(_){} cropper = null; }
    img.src = '';

    show('step-crop');

    // Set src and init cropper after paint
    requestAnimationFrame(function() {
      img.onload = function() {
        img.onload = null;
        try {
          cropper = new Cropper(img, {
            aspectRatio:      3 / 4,
            viewMode:         1,
            dragMode:         'move',
            autoCropArea:     0.85,
            responsive:       true,
            restore:          false,
            guides:           true,
            center:           true,
            highlight:        false,
            cropBoxMovable:   true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
            background:       false,
          });
        } catch(err) {
          showError('Could not load image. Please try a different photo.');
        }
      };
      img.src = e.target.result;
    });
  };
  reader.onerror = function() { showError('Could not read image file.'); };
  reader.readAsDataURL(file);
}

// Wire up both inputs
document.getElementById('input-camera').addEventListener('change', function() {
  if (this.files && this.files[0]) onFileSelected(this.files[0]);
  this.value = ''; // reset so same file can be re-selected
});
document.getElementById('input-gallery').addEventListener('change', function() {
  if (this.files && this.files[0]) onFileSelected(this.files[0]);
  this.value = '';
});

function retake() {
  if (cropper) { try { cropper.destroy(); } catch(_){} cropper = null; }
  document.getElementById('crop-img').src = '';
  document.getElementById('btn-generate').disabled = false;
  document.getElementById('progress-box').style.display = 'block';
  document.getElementById('success-box').style.display  = 'none';
  document.getElementById('error-box').style.display    = 'none';
  show('step-choose');
}

async function submitPhoto() {
  if (!cropper) { showError('No image loaded. Please go back and select a photo.'); return; }
  const btn = document.getElementById('btn-generate');
  btn.disabled = true;

  show('step-done');
  document.getElementById('progress-box').style.display = 'block';
  document.getElementById('success-box').style.display  = 'none';
  document.getElementById('error-box').style.display    = 'none';
  setProgress('Cropping photo…');

  try {
    const canvas = cropper.getCroppedCanvas({ width: 600, height: 800, imageSmoothingQuality: 'high' });
    if (!canvas) throw new Error('Crop failed. Please retake the photo.');

    setProgress('Uploading…');

    const blob = await new Promise(function(resolve, reject) {
      canvas.toBlob(function(b) {
        if (b) resolve(b); else reject(new Error('Could not process image.'));
      }, 'image/jpeg', 0.92);
    });

    setProgress('Generating your ID card…');

    const form = new FormData();
    form.append('photo', blob, 'photo.jpg');

    const resp = await fetch('/upload/' + TOKEN, { method: 'POST', body: form });
    const text = await resp.text();

    let data;
    try { data = JSON.parse(text); } catch(_) { throw new Error('Server error: ' + text.slice(0, 80)); }
    if (!data.success) throw new Error(data.message || 'Upload failed');

    document.getElementById('progress-box').style.display = 'none';
    document.getElementById('success-box').style.display  = 'block';

  } catch(err) {
    showError(err.message || 'Upload failed. Please try again.');
    btn.disabled = false;
  }
}

function show(id) {
  ['step-choose','step-crop','step-done'].forEach(function(s) {
    document.getElementById(s).style.display = s === id ? 'block' : 'none';
  });
}
function setProgress(msg) {
  document.getElementById('progress-text').textContent = msg;
}
function showError(msg) {
  document.getElementById('progress-box').style.display = 'none';
  document.getElementById('error-box').style.display    = 'block';
  document.getElementById('error-text').textContent     = '❌ ' + msg;
  show('step-done');
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
