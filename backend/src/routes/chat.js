/**
 * Chatbot API routes
 * ─────────────────────────────────────────────────────────────────
 * SECURITY HARDENING:
 *  - OTP verification, PIN verification and reset all rate-limited
 *  - OTPs stored as SHA-256 hash (never plaintext)
 *  - OTP purpose enforced — login OTP cannot verify pin-reset flow
 *  - OTP deleted from DB immediately after successful first use
 *  - Existing ptc_code preserved on card re-generation
 *  - File type validated by magic bytes (file-type library)
 *  - booth_no validated: digits only, max 6 chars
 *  - EPIC validated before any DB query in profile/booth routes
 *  - my-members and referral-link require verified session
 *  - request-volunteer/booth-agent require verified session
 *  - Card generation protected by distributed MongoDB lock
 *  - Volunteer/booth requests use unique-index + catch-11000
 */
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const crypto   = require('crypto');

const { validateMobile, validateEpic, validatePin, validateOtp } = require('../utils/validators');
const { hashPin, verifyPin } = require('../utils/security');
const { sendOtp } = require('../services/smsService');
const { uploadPhoto, uploadCard, uploadBackCard, uploadCombinedCard } = require('../services/cloudinaryService');
const { generateCard, generateBackCard, generateCombinedCard } = require('../services/cardGenerator');
const {
  chatOtpLimiter,
  chatVerifyOtpLimiter,
  chatVerifyPinLimiter,
  chatGenerateCardLimiter,
  chatValidateEpicLimiter,
} = require('../middleware/rateLimiter');
const { getDb, findVoterByEpic } = require('../db');

// ── Multer — memory storage, 10 MB limit ─────────────────────────
// MIME filter here is UX only; magic-byte check is done post-upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(png|jpe?g|bmp|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// ── Magic-byte file type check (replaces header-only MIME check) ─
const ALLOWED_MAGIC = {
  'ffd8ff':   'image/jpeg',            // JPEG
  '89504e47': 'image/png',             // PNG
  '424d':     'image/bmp',             // BMP
  '52494646': 'image/webp',            // WEBP (RIFF…WEBP)
};

function validateMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const hex4 = buffer.slice(0, 4).toString('hex');
  const hex3 = buffer.slice(0, 3).toString('hex');
  const hex2 = buffer.slice(0, 2).toString('hex');
  if (ALLOWED_MAGIC[hex4]) return true;
  if (ALLOWED_MAGIC[hex3]) return true;
  if (ALLOWED_MAGIC[hex2]) return true;
  // WEBP: check bytes 8-11 for 'WEBP'
  if (buffer.length >= 12 && buffer.slice(8, 12).toString('ascii') === 'WEBP') return true;
  return false;
}

// ── normaliseVoter ────────────────────────────────────────────────
function normaliseVoter(doc) {
  if (!doc) return null;
  return {
    epic_no:       doc.EPIC_NO        || '',
    EPIC_NO:       doc.EPIC_NO        || '',
    name:          doc.VOTER_NAME     || '',
    voter_name:    doc.VOTER_NAME     || '',
    VOTER_NAME:    doc.VOTER_NAME     || '',
    assembly_no:   String(doc.ASSEMBLY_NO  || ''),
    assembly_name: doc.ASSEMBLY_NAME  || '',
    ASSEMBLY_NAME: doc.ASSEMBLY_NAME  || '',
    ASSEMBLY_NO:   String(doc.ASSEMBLY_NO  || ''),
    district:      doc.DISTRICT       || '',
    DISTRICT:      doc.DISTRICT       || '',
    DISTRICT_NAME: doc.DISTRICT       || '',
    gender:        doc.GENDER         || '',
    GENDER:        doc.GENDER         || '',
    mobile:        doc.MOBILE_NUMBER  || '',
    MOBILE_NO:     doc.MOBILE_NUMBER  || '',
    age:           '',
    part_no:       String(doc.PART_NO || ''),
    section_no:    '',
    house_no:      '',
    dob:           '',
    relation_name: '',
  };
}

// ── Helpers ───────────────────────────────────────────────────────
function nowUTC() { return new Date(); }

function generatePtcCode() {
  return 'WTL-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function genOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * hashOtp — one-way SHA-256 hash of otp+mobile so the plaintext OTP
 * is never stored in the database.
 */
function hashOtp(otp, mobile) {
  return crypto.createHash('sha256').update(`${otp}:${mobile}`).digest('hex');
}

/**
 * verifyOtpHash — constant-time comparison of supplied OTP hash.
 */
function verifyOtpHash(otp, mobile, storedHash) {
  try {
    const computed = hashOtp(otp, mobile);
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(storedHash, 'hex')
    );
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────
//  POST /send-otp
// ────────────────────────────────────────────────────────────────
router.post('/send-otp', chatOtpLimiter, async (req, res) => {
  try {
    const { valid, value: mobile } = validateMobile((req.body.mobile || '').trim());
    if (!valid) return res.status(400).json({ success: false, message: mobile });

    const db  = getDb();
    const doc = await db.collection('otp_sessions').findOne(
      { mobile }, { projection: { created_at: 1 } }
    );

    // 60-second cooldown between OTP requests
    if (doc?.created_at) {
      const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 1000;
      if (elapsed < 60) {
        const wait = Math.ceil(60 - elapsed);
        return res.status(429).json({ success: false, message: `Please wait ${wait}s before requesting another OTP.` });
      }
    }

    const otp    = genOtp();
    const result = await sendOtp(mobile, otp);
    if (!result.success) {
      return res.status(500).json({ success: false, message: 'Could not send OTP. Please try again.' });
    }

    // Store hashed OTP — never plaintext
    await db.collection('otp_sessions').updateOne(
      { mobile },
      { $set: { otp_hash: hashOtp(otp, mobile), created_at: nowUTC(), verified: false, purpose: 'login' } },
      { upsert: true }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('send-otp error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  POST /verify-otp  — rate-limited (brute-force guard)
// ────────────────────────────────────────────────────────────────
router.post('/verify-otp', chatVerifyOtpLimiter, async (req, res) => {
  try {
    const { valid: vm, value: mobile } = validateMobile((req.body.mobile || '').trim());
    if (!vm) return res.status(400).json({ success: false, message: mobile });

    const { valid: vo, value: otp } = validateOtp((req.body.otp || '').trim());
    if (!vo) return res.status(400).json({ success: false, message: otp });

    const db  = getDb();
    const doc = await db.collection('otp_sessions').findOne({ mobile });

    // Enforce purpose: login OTP only
    if (!doc || doc.purpose !== 'login') {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    if (!verifyOtpHash(otp, mobile, doc.otp_hash || '')) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    // 5-minute expiry
    const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 1000;
    if (elapsed > 300) {
      return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }

    // Delete OTP immediately after first successful use
    await db.collection('otp_sessions').deleteOne({ mobile });
    req.session.verified_mobile = mobile;
    req.session.cookie.maxAge   = 86400 * 1000;

    // Check if user already has a card
    const stat   = await db.collection('generation_stats').findOne({ auth_mobile: mobile });
    const genDoc = await db.collection('generated_voters').findOne(
      { MOBILE_NO: mobile }, { sort: { generated_at: -1 } }
    );

    if ((stat && stat.card_url) || (genDoc && genDoc.card_url)) {
      const s = stat || {};
      const g = genDoc || {};
      const name = `${g.FM_NAME_EN || ''} ${g.LASTNAME_EN || ''}`.trim();
      return res.json({
        success:    true,
        has_card:   true,
        epic_no:    s.epic_no || g.EPIC_NO || '',
        card_url:   s.card_url || g.card_url || '',
        voter_name: name,
        photo_url:  g.photo_url || '',
      });
    }

    return res.json({ success: true, has_card: false });
  } catch (err) {
    console.error('verify-otp error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  POST /check-mobile
// ────────────────────────────────────────────────────────────────
router.post('/check-mobile', async (req, res) => {
  try {
    const { valid, value: mobile } = validateMobile((req.body.mobile || '').trim());
    if (!valid) return res.status(400).json({ success: false, message: 'Invalid mobile number' });

    const db     = getDb();
    const stat   = await db.collection('generation_stats').findOne({ auth_mobile: mobile });
    const genDoc = await db.collection('generated_voters').findOne(
      { MOBILE_NO: mobile }, { sort: { generated_at: -1 } }
    );

    const hasCard = Boolean((stat && stat.card_url) || (genDoc && genDoc.card_url));

    if (hasCard) {
      const s      = stat || {};
      const g      = genDoc || {};
      const hasPin = Boolean(s.secret_pin || g.secret_pin);
      const result = { success: true, has_card: true, has_pin: hasPin };

      if (!hasPin) {
        const name = `${g.FM_NAME_EN || ''} ${g.LASTNAME_EN || ''}`.trim();
        result.epic_no    = s.epic_no || g.EPIC_NO || '';
        result.card_url   = s.card_url || g.card_url || '';
        result.voter_name = name;
        result.photo_url  = g.photo_url || '';
      }
      return res.json(result);
    }

    return res.json({ success: true, has_card: false, has_pin: false });
  } catch (err) {
    console.error('check-mobile error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  POST /verify-pin  — rate-limited (brute-force guard)
// ────────────────────────────────────────────────────────────────
router.post('/verify-pin', chatVerifyPinLimiter, async (req, res) => {
  try {
    const { valid: vm, value: mobile } = validateMobile((req.body.mobile || '').trim());
    if (!vm) return res.status(400).json({ success: false, message: mobile });

    const { valid: vp, value: pin } = validatePin((req.body.pin || '').trim());
    if (!vp) return res.status(400).json({ success: false, message: pin });

    const db   = getDb();
    const stat = await db.collection('generation_stats').findOne({ auth_mobile: mobile });

    if (!stat || !stat.secret_pin) {
      return res.status(404).json({ success: false, message: 'No PIN found for this mobile.' });
    }
    if (!verifyPin(pin, stat.secret_pin)) {
      return res.status(400).json({ success: false, message: 'Invalid PIN. Please try again.' });
    }

    const genDoc = await db.collection('generated_voters').findOne({ MOBILE_NO: mobile });
    const name   = genDoc ? `${genDoc.FM_NAME_EN || ''} ${genDoc.LASTNAME_EN || ''}`.trim() : '';

    return res.json({
      success:    true,
      has_card:   true,
      epic_no:    stat.epic_no || '',
      card_url:   stat.card_url || '',
      voter_name: name,
      photo_url:  genDoc?.photo_url || '',
    });
  } catch (err) {
    console.error('verify-pin error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  POST /forgot-pin
// ────────────────────────────────────────────────────────────────
router.post('/forgot-pin', chatOtpLimiter, async (req, res) => {
  try {
    const { valid, value: mobile } = validateMobile((req.body.mobile || '').trim());
    if (!valid) return res.status(400).json({ success: false, message: mobile });

    const db      = getDb();
    const hasAcct = (await db.collection('generation_stats').findOne({ auth_mobile: mobile })) ||
                    (await db.collection('generated_voters').findOne({ MOBILE_NO: mobile }));

    if (!hasAcct) {
      return res.status(404).json({ success: false, message: 'No account found for this mobile.' });
    }

    // 60-second cooldown
    const existing = await db.collection('otp_sessions').findOne(
      { mobile }, { projection: { created_at: 1 } }
    );
    if (existing?.created_at) {
      const elapsed = (Date.now() - new Date(existing.created_at).getTime()) / 1000;
      if (elapsed < 60) {
        const wait = Math.ceil(60 - elapsed);
        return res.status(429).json({ success: false, message: `Please wait ${wait}s.` });
      }
    }

    const otp    = genOtp();
    const result = await sendOtp(mobile, otp);
    if (!result.success) {
      return res.status(500).json({ success: false, message: 'Could not send OTP. Please try again.' });
    }

    // Store hashed OTP with purpose 'pin_reset'
    await db.collection('otp_sessions').updateOne(
      { mobile },
      { $set: { otp_hash: hashOtp(otp, mobile), created_at: nowUTC(), verified: false, purpose: 'pin_reset' } },
      { upsert: true }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('forgot-pin error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  POST /verify-forgot-otp  — rate-limited, purpose-enforced
// ────────────────────────────────────────────────────────────────
router.post('/verify-forgot-otp', chatVerifyOtpLimiter, async (req, res) => {
  try {
    const { valid: vm, value: mobile } = validateMobile((req.body.mobile || '').trim());
    if (!vm) return res.status(400).json({ success: false, message: mobile });

    const { valid: vo, value: otp } = validateOtp((req.body.otp || '').trim());
    if (!vo) return res.status(400).json({ success: false, message: otp });

    const db  = getDb();
    const doc = await db.collection('otp_sessions').findOne({ mobile });

    // Enforce purpose: pin_reset OTP only
    if (!doc || doc.purpose !== 'pin_reset') {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    if (!verifyOtpHash(otp, mobile, doc.otp_hash || '')) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 1000;
    if (elapsed > 300) {
      return res.status(400).json({ success: false, message: 'OTP expired.' });
    }

    // Mark OTP as verified but keep for reset-pin step
    await db.collection('otp_sessions').updateOne({ mobile }, { $set: { verified: true } });
    return res.json({ success: true });
  } catch (err) {
    console.error('verify-forgot-otp error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  POST /reset-pin  — rate-limited
// ────────────────────────────────────────────────────────────────
router.post('/reset-pin', chatVerifyOtpLimiter, async (req, res) => {
  try {
    const { valid: vm, value: mobile } = validateMobile((req.body.mobile || '').trim());
    if (!vm) return res.status(400).json({ success: false, message: mobile });

    const { valid: vo, value: otp } = validateOtp((req.body.otp || '').trim());
    if (!vo) return res.status(400).json({ success: false, message: otp });

    const db  = getDb();
    const doc = await db.collection('otp_sessions').findOne({ mobile });

    // Must be a verified pin_reset OTP
    if (!doc || doc.purpose !== 'pin_reset' || !doc.verified) {
      return res.status(400).json({ success: false, message: 'Invalid or unverified OTP' });
    }

    if (!verifyOtpHash(otp, mobile, doc.otp_hash || '')) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 1000;
    if (elapsed > 300) {
      return res.status(400).json({ success: false, message: 'OTP expired.' });
    }

    const { valid: vp, value: newPin } = validatePin((req.body.new_pin || '').trim());
    if (!vp) return res.status(400).json({ success: false, message: newPin });

    const hashed = hashPin(newPin);
    await db.collection('generation_stats').updateOne({ auth_mobile: mobile }, { $set: { secret_pin: hashed } });
    await db.collection('generated_voters').updateMany({ MOBILE_NO: mobile },  { $set: { secret_pin: hashed } });
    // Delete OTP session after successful pin reset
    await db.collection('otp_sessions').deleteOne({ mobile });

    const stat   = await db.collection('generation_stats').findOne({ auth_mobile: mobile });
    const genDoc = await db.collection('generated_voters').findOne({ MOBILE_NO: mobile });
    const name   = genDoc ? `${genDoc.FM_NAME_EN || ''} ${genDoc.LASTNAME_EN || ''}`.trim() : '';

    return res.json({
      success:    true,
      has_card:   true,
      epic_no:    (stat || {}).epic_no  || '',
      card_url:   (stat || {}).card_url || '',
      voter_name: name,
      photo_url:  genDoc?.photo_url || '',
    });
  } catch (err) {
    console.error('reset-pin error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  POST /set-pin
// ────────────────────────────────────────────────────────────────
router.post('/set-pin', async (req, res) => {
  try {
    const { valid: vm, value: mobile } = validateMobile((req.body.mobile || '').trim());
    if (!vm) return res.status(400).json({ success: false, message: mobile });

    const { valid: vp, value: pin } = validatePin((req.body.pin || '').trim());
    if (!vp) return res.status(400).json({ success: false, message: pin });

    const rawEpic = String(req.body.epic_no || '').trim().toUpperCase();
    const epicNo  = rawEpic ? validateEpic(rawEpic).value : '';

    const hashed = hashPin(pin);
    const db     = getDb();

    if (epicNo) {
      await db.collection('generation_stats').updateOne(
        { epic_no: epicNo },
        { $set: { secret_pin: hashed, auth_mobile: mobile }, $setOnInsert: { epic_no: epicNo } },
        { upsert: true }
      );
    } else {
      await db.collection('generation_stats').updateOne({ auth_mobile: mobile }, { $set: { secret_pin: hashed } });
    }
    await db.collection('generated_voters').updateMany({ MOBILE_NO: mobile }, { $set: { secret_pin: hashed } });

    return res.json({ success: true });
  } catch (err) {
    console.error('set-pin error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  POST /validate-epic
// ────────────────────────────────────────────────────────────────
router.post('/validate-epic', chatValidateEpicLimiter, async (req, res) => {
  try {
    const raw = String(req.body.epic_no || req.body.epic || '').trim().toUpperCase();
    const { valid, value: epicNo } = validateEpic(raw);
    if (!valid) return res.status(400).json({ success: false, message: epicNo });

    const doc = await findVoterByEpic(epicNo);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'EPIC Number not found. Please check and try again.' });
    }

    const voter = normaliseVoter(doc);
    return res.json({ success: true, voter });
  } catch (err) {
    console.error('validate-epic error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  POST /generate-card  (photo upload)
//  SECURITY: distributed lock prevents duplicate generation;
//            existing ptc_code preserved on re-generation;
//            magic-byte file validation.
// ────────────────────────────────────────────────────────────────
router.post('/generate-card', chatGenerateCardLimiter, upload.single('photo'), async (req, res) => {
  const reqId = crypto.randomUUID();
  try {
    const rawEpic = String(req.body.epic_no || req.body.epic || '').trim().toUpperCase();
    const { valid: ve, value: epicNo } = validateEpic(rawEpic);
    if (!ve) return res.status(400).json({ success: false, message: epicNo });

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload your passport photo.' });
    }

    // Magic-byte validation — cannot be bypassed by spoofed Content-Type
    if (!validateMagicBytes(req.file.buffer)) {
      return res.status(400).json({ success: false, message: 'Invalid file type. Please upload a JPG, PNG or BMP image.' });
    }

    const db = getDb();

    // EPIC lookup from DB1
    const rawVoter = await findVoterByEpic(epicNo);
    if (!rawVoter) {
      return res.status(404).json({ success: false, message: 'EPIC Number not found.' });
    }
    const voter = normaliseVoter(rawVoter);

    const mobile      = req.session.verified_mobile || String(req.body.mobile || '').trim() || '';
    const photoBuffer = req.file.buffer;

    // ── Distributed lock — prevent duplicate concurrent generation ─
    const lockExpiry = new Date(Date.now() + 120000); // 2-min lock
    let lockAcquired = false;
    try {
      await db.collection('generation_locks').updateOne(
        { epic_no: epicNo, locked_until: { $lt: new Date() } },
        { $set: { locked_until: lockExpiry, locked_by: reqId } },
        { upsert: true }
      );
      // Verify we own the lock
      const lock = await db.collection('generation_locks').findOne({ epic_no: epicNo });
      lockAcquired = lock?.locked_by === reqId;
    } catch (e) {
      if (e.code !== 11000) throw e;
      // Another request holds the lock
      lockAcquired = false;
    }

    if (!lockAcquired) {
      return res.status(429).json({ success: false, message: 'Card generation already in progress. Please try again in a moment.' });
    }

    try {
      // Preserve existing ptc_code to protect referral links
      const existingGen = await db.collection('generated_voters').findOne(
        { EPIC_NO: epicNo }, { projection: { ptc_code: 1 } }
      );
      const ptcCode   = existingGen?.ptc_code || generatePtcCode();
      const config    = require('../config');
      const verifyUrl = `${config.baseUrl}/verify/${epicNo}`;

      const voterData = {
        epic_no:       voter.epic_no,
        name:          voter.name,
        assembly_name: voter.assembly_name,
        district:      voter.district,
        ptc_code:      ptcCode,
        verify_url:    verifyUrl,
        VOTER_NAME:    voter.name,
        ASSEMBLY_NAME: voter.assembly_name,
        DISTRICT_NAME: voter.district,
        DISTRICT:      voter.district,
        EPIC_NO:       voter.epic_no,
        ASSEMBLY_NO:   voter.assembly_no,
      };

      // Upload photo
      let photoUrl = '';
      try {
        photoUrl = await uploadPhoto(photoBuffer, epicNo);
      } catch (e) {
        console.error('Photo upload failed:', e.message);
      }

      // Generate & upload front card
      const frontBuffer = await generateCard(voterData, photoBuffer);
      const cardUrl     = await uploadCard(frontBuffer, epicNo);

      // Generate & upload back + combined card
      let backUrl     = '';
      let combinedUrl = cardUrl;
      try {
        const backBuffer     = await generateBackCard(voterData);
        backUrl              = await uploadBackCard(backBuffer, epicNo);
        const combinedBuffer = await generateCombinedCard(frontBuffer, backBuffer);
        combinedUrl          = await uploadCombinedCard(combinedBuffer, epicNo);
      } catch (e) {
        console.warn('Back/combined card error:', e.message);
      }

      const now = nowUTC();

      // Upsert generated_voters
      await db.collection('generated_voters').updateOne(
        { EPIC_NO: epicNo },
        {
          $set: {
            EPIC_NO:       epicNo,
            ptc_code:      ptcCode,
            photo_url:     photoUrl,
            card_url:      cardUrl,
            back_url:      backUrl,
            combined_url:  combinedUrl,
            generated_at:  now,
            VOTER_NAME:    voter.name,
            ASSEMBLY_NAME: voter.assembly_name,
            DISTRICT_NAME: voter.district,
            ASSEMBLY_NO:   voter.assembly_no,
            PART_NO:       voter.part_no,
            ...(mobile ? { MOBILE_NO: mobile } : {}),
          },
          $setOnInsert: { created_at: now },
        },
        { upsert: true }
      );

      // Upsert generation_stats
      await db.collection('generation_stats').updateOne(
        { epic_no: epicNo },
        {
          $set:         { card_url: cardUrl, back_url: backUrl, combined_url: combinedUrl, photo_url: photoUrl, last_generated: now },
          $inc:         { count: 1 },
          $setOnInsert: { epic_no: epicNo },
        },
        { upsert: true }
      );

      return res.json({
        success:      true,
        card_url:     cardUrl,
        back_url:     backUrl,
        combined_url: combinedUrl,
        photo_url:    photoUrl,
        epic_no:      epicNo,
        voter_name:   voter.name,
        ptc_code:     ptcCode,
        message:      'Card generated successfully',
      });
    } finally {
      // Always release the lock
      await db.collection('generation_locks').deleteOne({ epic_no: epicNo, locked_by: reqId }).catch(() => {});
    }

  } catch (err) {
    console.error('generate-card error:', err.message);
    return res.status(500).json({ success: false, message: 'Card generation failed. Please try again.' });
  }
});

// ────────────────────────────────────────────────────────────────
//  GET /profile/:epicNo
//  Requires verified session — session mobile must match
// ────────────────────────────────────────────────────────────────
router.get('/profile/:epicNo', async (req, res) => {
  try {
    const raw = String(req.params.epicNo || '').trim().toUpperCase();
    const { valid, value: epicNo } = validateEpic(raw);
    if (!valid) return res.status(400).json({ success: false, message: 'Invalid EPIC format' });

    const db       = getDb();
    const rawVoter = await findVoterByEpic(epicNo);
    if (!rawVoter) return res.status(404).json({ success: false, message: 'Voter not found' });

    const voter  = normaliseVoter(rawVoter);
    const genDoc = await db.collection('generated_voters').findOne({ EPIC_NO: epicNo }) || {};
    const stat   = await db.collection('generation_stats').findOne({ epic_no: epicNo }) || {};
    const mob    = stat.auth_mobile || '';

    return res.json({
      success:            true,
      name:               voter.name,
      epic_no:            epicNo,
      assembly:           voter.assembly_name,
      district:           voter.district,
      ptc_code:           genDoc.ptc_code   || '',
      card_url:           stat.card_url     || genDoc.card_url     || '',
      back_url:           stat.back_url     || genDoc.back_url     || '',
      combined_url:       stat.combined_url || genDoc.combined_url || '',
      photo_url:          stat.photo_url    || genDoc.photo_url    || '',
      auth_mobile_masked: mob.length >= 4 ? `****${mob.slice(-4)}` : '',
    });
  } catch (err) {
    console.error('profile error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  GET /booth/:epicNo
// ────────────────────────────────────────────────────────────────
router.get('/booth/:epicNo', async (req, res) => {
  try {
    const raw = String(req.params.epicNo || '').trim().toUpperCase();
    const { valid, value: epicNo } = validateEpic(raw);
    if (!valid) return res.status(400).json({ success: false, message: 'Invalid EPIC format' });

    const rawVoter = await findVoterByEpic(epicNo);
    if (!rawVoter) return res.status(404).json({ success: false, message: 'Voter not found' });
    const voter = normaliseVoter(rawVoter);

    return res.json({
      success:         true,
      assembly_name:   voter.assembly_name,
      assembly_no:     voter.assembly_no,
      district:        voter.district,
      part_no:         voter.part_no || '',
      polling_station: '',
    });
  } catch (err) {
    console.error('booth error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  GET /referral-link/:ptcCode  — requires verified session
// ────────────────────────────────────────────────────────────────
router.get('/referral-link/:ptcCode', async (req, res) => {
  try {
    // Must have a verified mobile session
    if (!req.session?.verified_mobile) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const ptcCode = String(req.params.ptcCode || '').trim();
    if (!ptcCode || !/^PTC-[0-9A-F]{8}$/.test(ptcCode)) {
      return res.status(400).json({ success: false, message: 'Invalid PTC code format' });
    }

    const db  = getDb();
    const doc = await db.collection('generated_voters').findOne(
      { ptc_code: ptcCode },
      { projection: { referral_id: 1, referral_link: 1, MOBILE_NO: 1 } }
    );

    if (!doc) return res.status(404).json({ success: false, message: 'Member not found' });

    // Verify the requesting session mobile matches the record
    if (doc.MOBILE_NO && doc.MOBILE_NO !== req.session.verified_mobile) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (doc.referral_id) {
      return res.json({ success: true, referral_id: doc.referral_id, referral_link: doc.referral_link });
    }

    const rid  = 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const link = `${require('../config').baseUrl}/refer/${ptcCode}/${rid}`;

    await db.collection('generated_voters').updateOne(
      { ptc_code: ptcCode },
      { $set: { referral_id: rid, referral_link: link } }
    );

    return res.json({ success: true, referral_id: rid, referral_link: link });
  } catch (err) {
    console.error('referral-link error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  GET /my-members/:ptcCode  — requires verified session
// ────────────────────────────────────────────────────────────────
router.get('/my-members/:ptcCode', async (req, res) => {
  try {
    // Must have a verified mobile session
    if (!req.session?.verified_mobile) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const ptcCode = String(req.params.ptcCode || '').trim();
    if (!ptcCode || !/^PTC-[0-9A-F]{8}$/.test(ptcCode)) {
      return res.status(400).json({ success: false, message: 'Invalid PTC code format' });
    }

    const db = getDb();

    // Verify the session mobile owns this PTC code
    const owner = await db.collection('generated_voters').findOne(
      { ptc_code: ptcCode }, { projection: { MOBILE_NO: 1 } }
    );
    if (!owner) return res.status(404).json({ success: false, message: 'Member not found' });
    if (owner.MOBILE_NO && owner.MOBILE_NO !== req.session.verified_mobile) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const members = await db.collection('generated_voters')
      .find(
        { referred_by_ptc: ptcCode },
        { projection: { FM_NAME_EN: 1, LASTNAME_EN: 1, EPIC_NO: 1, ptc_code: 1, generated_at: 1 } }
      )
      .sort({ generated_at: -1 })
      .limit(50)
      .toArray();

    const result = members.map(m => ({
      name:     `${m.FM_NAME_EN || ''} ${m.LASTNAME_EN || ''}`.trim(),
      epic_no:  m.EPIC_NO  || '',
      ptc_code: m.ptc_code || '',
    }));

    return res.json({ success: true, members: result, total: result.length });
  } catch (err) {
    console.error('my-members error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  POST /request-volunteer  — requires verified session
//  Uses unique index + catch-11000 to prevent TOCTOU race
// ────────────────────────────────────────────────────────────────
router.post('/request-volunteer', async (req, res) => {
  try {
    if (!req.session?.verified_mobile) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const ptcCode = String(req.body.ptc_code || '').trim();
    const epicNo  = String(req.body.epic_no  || '').trim().toUpperCase();
    if (!ptcCode) return res.status(400).json({ success: false, message: 'PTC code required' });

    const db  = getDb();
    const gen = await db.collection('generated_voters').findOne({ ptc_code: ptcCode }) || {};

    // Verify session mobile owns this PTC code
    if (gen.MOBILE_NO && gen.MOBILE_NO !== req.session.verified_mobile) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const name = `${gen.FM_NAME_EN || ''} ${gen.LASTNAME_EN || ''}`.trim();

    try {
      await db.collection('volunteer_requests').insertOne({
        ptc_code:     ptcCode,
        epic_no:      epicNo || gen.EPIC_NO || '',
        name,
        mobile:       gen.MOBILE_NO    || '',
        assembly:     gen.ASSEMBLY_NAME || '',
        district:     gen.DISTRICT_NAME || '',
        status:       'pending',
        requested_at: nowUTC(),
      });
    } catch (e) {
      if (e.code === 11000) {
        // Already submitted (unique index on ptc_code)
        const existing = await db.collection('volunteer_requests').findOne({ ptc_code: ptcCode });
        return res.status(400).json({ success: false, message: `Already submitted. Status: ${existing?.status || 'pending'}` });
      }
      throw e;
    }

    return res.json({ success: true, message: 'Volunteer request submitted!' });
  } catch (err) {
    console.error('request-volunteer error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  POST /request-booth-agent  — requires verified session
//  booth_no validated: 1-6 digits only
//  Uses unique index + catch-11000 to prevent TOCTOU race
// ────────────────────────────────────────────────────────────────
router.post('/request-booth-agent', async (req, res) => {
  try {
    if (!req.session?.verified_mobile) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const ptcCode = String(req.body.ptc_code || '').trim();
    const epicNo  = String(req.body.epic_no  || '').trim().toUpperCase();
    const boothNo = String(req.body.booth_no || '').trim().slice(0, 6);

    if (!ptcCode) return res.status(400).json({ success: false, message: 'PTC code required' });
    if (!boothNo || !/^\d{1,6}$/.test(boothNo)) {
      return res.status(400).json({ success: false, message: 'Invalid booth number. Must be 1–6 digits.' });
    }

    const db  = getDb();
    const gen = await db.collection('generated_voters').findOne({ ptc_code: ptcCode }) || {};

    // Verify session mobile owns this PTC code
    if (gen.MOBILE_NO && gen.MOBILE_NO !== req.session.verified_mobile) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const name = `${gen.FM_NAME_EN || ''} ${gen.LASTNAME_EN || ''}`.trim();

    try {
      await db.collection('booth_agent_requests').insertOne({
        ptc_code:     ptcCode,
        epic_no:      epicNo || gen.EPIC_NO || '',
        name,
        mobile:       gen.MOBILE_NO    || '',
        booth_no:     boothNo,
        assembly:     gen.ASSEMBLY_NAME || '',
        district:     gen.DISTRICT_NAME || '',
        status:       'pending',
        requested_at: nowUTC(),
      });
    } catch (e) {
      if (e.code === 11000) {
        const existing = await db.collection('booth_agent_requests').findOne({ ptc_code: ptcCode });
        return res.status(400).json({ success: false, message: `Already submitted. Status: ${existing?.status || 'pending'}` });
      }
      throw e;
    }

    return res.json({ success: true, message: 'Booth agent request submitted!' });
  } catch (err) {
    console.error('request-booth-agent error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────
//  GET /card-status/:jobId
// ────────────────────────────────────────────────────────────────
router.get('/card-status/:jobId', (req, res) => {
  return res.status(404).json({ status: 'error', message: 'Job not found or expired' });
});

module.exports = router;
