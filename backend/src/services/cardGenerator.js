/**
 * Card Generation Engine — We The Leaders
 * ==========================================
 * Front card : wtl_final_11.html (1576 × 998 px) — rendered website card template
 * Back card  : black_original1.png (1152 × 768 px) — used as-is (no QR, no T&C)
 * Combined   : front + back side-by-side
 *
 * Uses Puppeteer to render the live HTML card template and screenshot it.
 */

const path   = require('path');
const fs     = require('fs');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');
const QRCode    = require('qrcode');
const sharp = require('sharp');

// ── Asset paths ─────────────────────────────────────────────────
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const FRONT_TEMPLATE_PATH = path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'wtl_final_11.html');

function assetPath(name) {
  return path.join(ASSETS_DIR, name);
}

// ── Browser helper ────────────────────────────────────────────────
let _browser = null;

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;

  let executablePath;
  let launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
  ];

  // On Linux (Render/production) use @sparticuz/chromium which ships its own binary
  if (process.platform === 'linux') {
    try {
      // @sparticuz/chromium v3+ uses a default export
      const chromium = require('@sparticuz/chromium').default;
      chromium.graphicsMode = false;
      executablePath = await chromium.executablePath(); // returns Promise<string>
      launchArgs = [...chromium.args, '--no-zygote', '--single-process'];
      console.log(`[Card] Using @sparticuz/chromium: ${executablePath}`);
    } catch (e) {
      console.warn('[Card] @sparticuz/chromium not available, trying puppeteer:', e.message);
    }
  }

  // Windows / macOS dev OR Linux fallback: use puppeteer's bundled Chrome
  if (!executablePath) {
    try {
      const { executablePath: ep } = require('puppeteer');
      const p = ep();
      if (p && fs.existsSync(p)) {
        executablePath = p;
        console.log(`[Card] Using puppeteer bundled Chrome: ${executablePath}`);
      }
    } catch (_) {}
  }

  console.log(`[Card] Launching browser${executablePath ? '' : ' (puppeteer default)'}`);

  _browser = await puppeteer.launch({
    headless: true,
    executablePath: executablePath || undefined,
    args: launchArgs,
  });

  _browser.on('disconnected', () => {
    console.log('[Card] Browser disconnected — will relaunch on next request');
    _browser = null;
  });
  return _browser;
}

function inferImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return 'image/jpeg';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer.slice(0, 8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]))) return 'image/png';
  if (buffer.slice(0, 6).equals(Buffer.from([0x47,0x49,0x46,0x38,0x39,0x61])) || buffer.slice(0, 6).equals(Buffer.from([0x47,0x49,0x46,0x38,0x37,0x61]))) return 'image/gif';
  return 'image/jpeg';
}

// ── Helpers ──────────────────────────────────────────────────────
function clean(v, n = 120) {
  return String(v || '').trim().replace(/[{}$\\]/g, '').slice(0, n);
}

function toTitle(s) {
  return String(s || '').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// ─────────────────────────────────────────────────────────────────
//  FRONT CARD  —  wtl_final_11.html rendered as screenshot
// ─────────────────────────────────────────────────────────────────
async function generateCard(voter, photoBuffer = null) {
  const templatePath = FRONT_TEMPLATE_PATH;
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Front template not found: ${templatePath}`);
  }

  const epicNo   = clean(voter.epic_no || voter.EPIC_NO || '').toUpperCase();
  const rawName  = clean(voter.name || voter.VOTER_NAME || voter.voter_name || '');
  // Match web template: name shown UPPERCASE, stripped of trailing dashes/spaces
  const name     = rawName.replace(/[\s\-–—]+$/, '').replace(/\s+/g, ' ').trim().toUpperCase() || '-';
  const assembly = (clean(voter.assembly_name || voter.ASSEMBLY_NAME || '').trim().toUpperCase()) || '-';
  const booth    = clean(voter.part_no || voter.PART_NO || voter.booth || voter.booth_no || '') || '-';
  const district = (clean(voter.district || voter.DISTRICT || voter.DISTRICT_NAME || '').trim().toUpperCase()) || '-';
  const wtlCode  = clean(voter.wtl_code || voter.ptc_code || '');
  const memberId = wtlCode || `WTL-${epicNo.slice(-6)}`;

  // Generate QR code pointing to the verification URL for this EPIC
  const baseUrl  = process.env.BASE_URL || 'https://we-the-leader.onrender.com';
  const verifyUrl = `${baseUrl}/verify/${epicNo}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'M',
    width: 200,
    margin: 1,
    color: { dark: '#1a1a1a', light: '#f9f8f6' },
  });

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 1 });

    const templateUrl = pathToFileURL(templatePath).href;
    await page.goto(templateUrl, { waitUntil: 'networkidle2' });

    const photoDataUrl = photoBuffer
      ? `data:${inferImageMimeType(photoBuffer)};base64,${photoBuffer.toString('base64')}`
      : null;

    await page.evaluate(async ({ photoDataUrl, name, epicNo, assembly, booth, district, memberId, qrDataUrl }) => {
      const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
      };

      setText('v-name', name);
      setText('v-epic', epicNo);
      setText('v-asm', assembly);
      setText('v-booth', booth);
      setText('v-dist', district);
      setText('v-mid', memberId);
      setText('v-mid-big', memberId);

      // Update QR code image
      const qrImg = document.getElementById('qr-img');
      if (qrImg && qrDataUrl) {
        qrImg.src = qrDataUrl;
        await new Promise((resolve) => {
          if (qrImg.complete && qrImg.naturalWidth !== 0) return resolve();
          qrImg.onload  = () => resolve();
          qrImg.onerror = () => resolve();
        });
      }

      const photoImg = document.getElementById('member-photo-img');
      const svg = document.querySelector('#photo-box svg');
      const span = document.querySelector('#photo-box span');

      if (photoImg) {
        if (photoDataUrl) {
          photoImg.src = photoDataUrl;
          photoImg.style.display = 'block';
          if (svg) svg.style.display = 'none';
          if (span) span.style.display = 'none';
          await new Promise((resolve) => {
            if (photoImg.complete && photoImg.naturalWidth !== 0) return resolve();
            photoImg.onload = () => resolve();
            photoImg.onerror = () => resolve();
          });
        } else {
          photoImg.style.display = 'none';
          if (svg) svg.style.display = '';
          if (span) span.style.display = '';
        }
      }

      const wrap = document.querySelector('.card-wrap');
      if (wrap) {
        wrap.style.transform = 'none';
        wrap.style.marginBottom = '0';
      }

      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    }, { photoDataUrl, name, epicNo, assembly, booth, district, memberId, qrDataUrl });

    const cardHandle = await page.$('#card');
    if (!cardHandle) {
      throw new Error('Could not locate #card element in front template');
    }

    const screenshotBuffer = await cardHandle.screenshot({ type: 'png' });
    return screenshotBuffer;
  } finally {
    await page.close();
  }
}

// ─────────────────────────────────────────────────────────────────
//  BACK CARD  —  black_original1.png (1152 × 768) used as-is
// ─────────────────────────────────────────────────────────────────
async function generateBackCard(voter) {
  const backPath = assetPath('black_original1.png');

  if (fs.existsSync(backPath)) {
    return fs.promises.readFile(backPath);
  }

  // Fallback: plain dark card if image missing
  const fallback = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAARwAAAEyCAYAAAAph7fAAAAACXBIWXMAAAsTAAALEwEAmpwYAAAHQklEQVR4nO3dQXKjMBzG4e64weg3TsGo3Tspjd0Bz0B/HDg4RgDwQj1HYH5FJ8n4AsF1IiIiIiIiIiIiIiIiIiIiLsr6Q4u8Ua/QPq7d8z4J2SyRu9W14uZzFs4GaGtUN5c1Z+Bo0lo9rV3v4+0w7pD1b5D6V1a4zMzMzmmb1q8VqNQtPUnnrXVX8z7nu7+veb94Dg4ODg4ODg4ODg4ODg4Ojq1X8D0W8wXvV1m2m3dFtrpZ39+cqzP7D6uP7gXW+vJezn/qh+uHbX1+vpa1NBe/oEVy7vVq0L+P7z8Pzu/8BevP5YF0vjod2vY4z9m9P322a1N5/cQF7f0x+P7MfXjI+Ph00/rvvzrx68/Tq9+QcQHBwcHBwcHBwcHBwcHBwYr1/AN9thHjN0qj8AAAAASUVORK5CYII=',
    'base64'
  );
  return fallback;
}

// ─────────────────────────────────────────────────────────────────
//  COMBINED  —  front + back side by side
// ─────────────────────────────────────────────────────────────────
async function generateCombinedCard(frontBuffer, backBuffer) {
  const frontImage = sharp(frontBuffer);
  const backImage = sharp(backBuffer);

  const frontMetadata = await frontImage.metadata();
  const backMetadata  = await backImage.metadata();

  const scaledBackHeight = frontMetadata.height;
  const scaledBackWidth = Math.round((backMetadata.width * scaledBackHeight) / backMetadata.height);

  const resizedBack = await backImage.resize(scaledBackWidth, scaledBackHeight).toBuffer();
  const combinedWidth = frontMetadata.width + 20 + scaledBackWidth;

  return sharp({
    create: {
      width: combinedWidth,
      height: scaledBackHeight,
      channels: 3,
      background: '#111111',
    },
  })
    .composite([
      { input: frontBuffer, left: 0, top: 0 },
      { input: resizedBack, left: frontMetadata.width + 20, top: 0 },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
}

module.exports = { generateCard, generateBackCard, generateCombinedCard };
