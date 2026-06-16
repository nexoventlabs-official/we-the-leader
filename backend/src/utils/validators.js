/**
 * Input validation utilities — ported from security_fixes.py
 */

/**
 * Validate Indian mobile number (10 digits, starts with 6-9).
 * Returns {valid, value} where value is trimmed mobile on success or error message on fail.
 */
function validateMobile(mobile) {
  const s = String(mobile || '').trim();
  if (!s) return { valid: false, value: 'Mobile number is required' };
  if (!/^[6-9]\d{9}$/.test(s)) {
    return { valid: false, value: 'Invalid mobile number. Must be 10 digits starting with 6-9' };
  }
  return { valid: true, value: s };
}

/**
 * Validate EPIC number format (3 letters + 7 digits or flexible sanitized).
 */
function validateEpic(epic) {
  const s = String(epic || '').trim().toUpperCase();
  if (!s) return { valid: false, value: 'EPIC number is required' };
  if (!/^[A-Z]{3}\d{7}$/.test(s)) {
    if (s.length < 3 || s.length > 20) {
      return { valid: false, value: 'Invalid EPIC number format' };
    }
  }
  return { valid: true, value: s };
}

/**
 * Validate 4-digit PIN.
 */
function validatePin(pin) {
  const s = String(pin || '').trim();
  if (!s) return { valid: false, value: 'PIN is required' };
  if (!/^\d{4}$/.test(s)) return { valid: false, value: 'PIN must be exactly 4 digits' };
  return { valid: true, value: s };
}

/**
 * Validate 6-digit OTP.
 */
function validateOtp(otp) {
  const s = String(otp || '').trim();
  if (!s) return { valid: false, value: 'OTP is required' };
  if (!/^\d{6}$/.test(s)) return { valid: false, value: 'OTP must be exactly 6 digits' };
  return { valid: true, value: s };
}

/**
 * Sanitize search input — prevent ReDoS and injection.
 */
function sanitizeSearch(search, maxLength = 100) {
  if (!search) return '';
  return String(search)
    .slice(0, maxLength)
    .replace(/[^\w\s\-.,@]/g, '')
    .trim();
}

module.exports = { validateMobile, validateEpic, validatePin, validateOtp, sanitizeSearch };
