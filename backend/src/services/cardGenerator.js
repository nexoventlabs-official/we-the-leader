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
const sharp = require('sharp');

// ── Asset paths ─────────────────────────────────────────────────
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const FRONT_TEMPLATE_PATH = path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'wtl_final_11.html');

function assetPath(name) {
  return path.join(ASSETS_DIR, name);
}

// ── Browser helper ────────────────────────────────────────────────
let _browser = null;

async function getChromePath() {
  // 1. Explicit env override
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;

  // 2. Puppeteer's own installed Chrome
  try {
    const { executablePath } = require('puppeteer');
    const p = executablePath();
    if (p && require('fs').existsSync(p)) return p;
  } catch (_) {}

  // 3. Common system Chrome paths (Linux / Render)
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ];
  for (const c of candidates) {
    if (require('fs').existsSync(c)) return c;
  }

  return null; // let Puppeteer try its default
}

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;

  const executablePath = await getChromePath();
  console.log(`[Card] Launching browser${executablePath ? ` (${executablePath})` : ' (puppeteer default)'}`);

  _browser = await puppeteer.launch({
    headless: 'new',
    executablePath: executablePath || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
    ],
  });

  _browser.on('disconnected', () => { _browser = null; });
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
  const name     = toTitle(rawName.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()) || '-';
  const assembly = toTitle(clean(voter.assembly_name || voter.ASSEMBLY_NAME || '')) || '-';
  const booth    = clean(voter.part_no || voter.PART_NO || voter.booth || voter.booth_no || '') || '-';
  const district = toTitle(clean(voter.district || voter.DISTRICT || voter.DISTRICT_NAME || '')) || '-';
  const ptcCode  = clean(voter.ptc_code || '');
  const memberId = ptcCode || `WTL-${epicNo.slice(-6)}`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 1 });

    const templateUrl = pathToFileURL(templatePath).href;
    await page.goto(templateUrl, { waitUntil: 'networkidle2' });

    const photoDataUrl = photoBuffer
      ? `data:${inferImageMimeType(photoBuffer)};base64,${photoBuffer.toString('base64')}`
      : null;

    await page.evaluate(async ({ photoDataUrl, name, epicNo, assembly, booth, district, memberId }) => {
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
    }, { photoDataUrl, name, epicNo, assembly, booth, district, memberId });

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
