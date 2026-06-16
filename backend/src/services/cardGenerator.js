/**
 * Card Generation Engine — We The Leaders
 * ==========================================
 * Front card : front1.png  (1581 × 995 px) — overlay photo + text
 * Back card  : black_original1.png (1152 × 768 px) — used as-is (no QR, no T&C)
 * Combined   : front + back side-by-side
 *
 * Uses @napi-rs/canvas (Node v24 compatible, no native gyp build needed).
 */

const path   = require('path');
const fs     = require('fs');
const config = require('../config');

// ── Asset paths ─────────────────────────────────────────────────
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function assetPath(name) {
  return path.join(ASSETS_DIR, name);
}

// ── Canvas (lazy-loaded) ─────────────────────────────────────────
let _canvas          = null;
let _fontsRegistered = false;

function getCanvas() {
  if (!_canvas) _canvas = require('@napi-rs/canvas');
  return _canvas;
}

function ensureFonts() {
  if (_fontsRegistered) return;
  const { GlobalFonts } = getCanvas();
  const fonts = [
    { file: 'Montserrat-ExtraBold.ttf', family: 'Montserrat'     },
    { file: 'Outfit-Bold.ttf',          family: 'Outfit'          },
    { file: 'PlusJakartaSans-Bold.ttf', family: 'PlusJakartaSans' },
  ];
  for (const f of fonts) {
    const p = assetPath(f.file);
    if (fs.existsSync(p)) {
      try { GlobalFonts.registerFromPath(p, f.family); }
      catch (e) { console.warn(`Font skip (${f.file}):`, e.message); }
    }
  }
  _fontsRegistered = true;
}

// ── Helpers ──────────────────────────────────────────────────────
function clean(v, n = 120) {
  return String(v || '').trim().replace(/[{}$\\]/g, '').slice(0, n);
}

function toTitle(s) {
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/** Fit-and-center photo into destination rect, clipped to rounded rect */
function drawFittedPhoto(ctx, img, dx, dy, dw, dh, radius = 0) {
  const scale = Math.max(dw / img.width, dh / img.height);
  const nw    = img.width  * scale;
  const nh    = img.height * scale;
  const sx    = dx - (nw - dw) / 2;
  const sy    = dy - (nh - dh) * 0.20; // shift up 20% for face focus

  ctx.save();
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, radius);
    ctx.clip();
  }
  ctx.drawImage(img, sx, sy, nw, nh);
  ctx.restore();
}

/** Placeholder silhouette when no photo */
function drawPlaceholder(ctx, dx, dy, dw, dh, radius = 0) {
  ctx.save();
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, radius);
    ctx.clip();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(dx, dy, dw, dh);
  // head
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  const cx = dx + dw / 2, cy = dy + dh * 0.37, cr = dw * 0.22;
  ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
  // body
  ctx.beginPath();
  ctx.moveTo(dx + dw * 0.10, dy + dh);
  ctx.lineTo(dx + dw * 0.90, dy + dh);
  ctx.lineTo(dx + dw * 0.78, dy + dh * 0.60);
  ctx.lineTo(dx + dw * 0.22, dy + dh * 0.60);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** Shrink font size until text fits maxWidth */
function fitFont(ctx, text, maxWidth, baseSize, family) {
  let size = baseSize;
  ctx.font = `bold ${size}px "${family}",Arial,sans-serif`;
  while (size > 10 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `bold ${size}px "${family}",Arial,sans-serif`;
  }
  return size;
}

// ─────────────────────────────────────────────────────────────────
//  FRONT CARD  —  front1.png (1581 × 995)
// ─────────────────────────────────────────────────────────────────
/**
 * Layout (px on 1581×995):
 *
 *  Photo box   : bottom-left  x=55,  y=530, w=220, h=275, r=10
 *  Name        : x=300, y=128, bold black, size=52
 *  Field rows  : x=300, y=210  — label(dark-grey) + value(black)
 *  Row gap     : 62px
 */
async function generateCard(voter, photoBuffer = null) {
  ensureFonts();
  const { createCanvas, loadImage } = getCanvas();

  const W = 1581, H = 995;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // 1. Draw background template
  const bgPath = assetPath('front.jpeg');
  if (fs.existsSync(bgPath)) {
    const bg = await loadImage(bgPath);
    ctx.drawImage(bg, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, W, H);
  }

  // 2. Photo — passport ratio 75×95, moved down to align with placeholder
  const PX = 148, PY = 330, PW = 240, PH = 304, PR = 8;
  if (photoBuffer) {
    try {
      const photoImg = await loadImage(photoBuffer);
      drawFittedPhoto(ctx, photoImg, PX, PY, PW, PH, PR);
    } catch (e) {
      console.warn('Photo load error:', e.message);
      drawPlaceholder(ctx, PX, PY, PW, PH, PR);
    }
  } else {
    drawPlaceholder(ctx, PX, PY, PW, PH, PR);
  }

  // ── Text fields (all bold black) ───────────────────────────────
  const epicNo   = clean(voter.epic_no   || voter.EPIC_NO        || '').toUpperCase();
  const rawName  = clean(voter.name || voter.VOTER_NAME  || voter.voter_name || '');
  // Replace hyphens with space so hyphenated names render cleanly on the card
  const name     = toTitle(rawName.replace(/-/g, ' ').replace(/\s+/g, ' ').trim());
  const assembly = toTitle(clean(voter.assembly_name || voter.ASSEMBLY_NAME || ''));
  const district = toTitle(clean(voter.district || voter.DISTRICT || voter.DISTRICT_NAME || ''));
  const gender   = clean(voter.gender    || voter.GENDER         || '');
  const mobile   = clean(voter.mobile    || voter.MOBILE_NO      || '');
  const ptcCode  = clean(voter.ptc_code  || '');
  const memberId = ptcCode || `WTL-${epicNo.slice(-6)}`;

  ctx.textBaseline = 'top';

  // ── Name ────────────────────────────────────────────────────────
  // Start well below the header block (header ends ~y=320 on 1581×995)
  const TEXT_X = 420;   // shifted right, clear of photo
  const MAX_W  = 840;   // safe width before leader image starts

  fitFont(ctx, name, MAX_W, 50, 'Outfit');
  ctx.fillStyle = '#111111';
  ctx.fillText(name, TEXT_X, 405);

  // ── Rows ────────────────────────────────────────────────────────
  const rows = [
    { label: 'EPIC NO',   value: epicNo    },
    { label: 'ASSEMBLY',  value: assembly  },
    { label: 'DISTRICT',  value: district  },
    { label: 'MEMBER ID', value: memberId  },
  ];
  if (gender) rows.push({ label: 'GENDER',  value: toTitle(gender) });
  if (mobile) rows.push({ label: 'MOBILE',  value: mobile });

  let rowY       = 475;
  const ROW_GAP  = 72;
  const LBL_SZ   = 21;
  const VAL_SZ   = 38;
  const LBL_COL  = 190;
  const COLON_GAP = 16;

  for (const row of rows) {
    if (rowY > H - 110) break;

    // Label — dark grey, vertically centered with value
    // Value is VAL_SZ=38, Label is LBL_SZ=21 → offset = (38-21)/2 = 8.5
    const lblOffset = Math.round((VAL_SZ - LBL_SZ) / 2);
    ctx.font      = `bold ${LBL_SZ}px "Outfit",Arial,sans-serif`;
    ctx.fillStyle = '#555555';
    ctx.fillText(row.label, TEXT_X, rowY + lblOffset);

    // Colon — same vertical center as label
    ctx.fillText(':', TEXT_X + LBL_COL, rowY + lblOffset);

    // Value — bold black, baseline at rowY
    const valX = TEXT_X + LBL_COL + COLON_GAP;
    fitFont(ctx, row.value, MAX_W - LBL_COL - COLON_GAP, VAL_SZ, 'PlusJakartaSans');
    ctx.fillStyle = '#111111';
    ctx.fillText(row.value, valX, rowY);

    rowY += ROW_GAP;
  }

  return canvas.toBuffer('image/jpeg', 95);
}

// ─────────────────────────────────────────────────────────────────
//  BACK CARD  —  black_original1.png (1152 × 768) used as-is
// ─────────────────────────────────────────────────────────────────
async function generateBackCard(voter) {
  const { createCanvas, loadImage } = getCanvas();

  const backPath = assetPath('black_original1.png');

  if (fs.existsSync(backPath)) {
    // Load the image and return it directly as JPEG
    const img    = await loadImage(backPath);
    const W = img.width, H = img.height;
    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    return canvas.toBuffer('image/jpeg', 95);
  }

  // Fallback: plain dark card if image missing
  const W = 1152, H = 768;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  ctx.font      = 'bold 48px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'center';
  ctx.fillText('WE THE LEADERS', W / 2, H / 2);
  return canvas.toBuffer('image/jpeg', 95);
}

// ─────────────────────────────────────────────────────────────────
//  COMBINED  —  front + back side by side
// ─────────────────────────────────────────────────────────────────
async function generateCombinedCard(frontBuffer, backBuffer) {
  const { createCanvas, loadImage } = getCanvas();

  const [frontImg, backImg] = await Promise.all([
    loadImage(frontBuffer),
    loadImage(backBuffer),
  ]);

  // Scale back to match front height
  const FW = frontImg.width, FH = frontImg.height;
  const BH = FH;
  const BW = Math.round(backImg.width * (BH / backImg.height));

  const GAP = 20;
  const TW  = FW + GAP + BW;

  const canvas = createCanvas(TW, FH);
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, TW, FH);

  ctx.drawImage(frontImg, 0,        0, FW, FH);
  ctx.drawImage(backImg,  FW + GAP, 0, BW, BH);

  return canvas.toBuffer('image/jpeg', 95);
}

module.exports = { generateCard, generateBackCard, generateCombinedCard };
