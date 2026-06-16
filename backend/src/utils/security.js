/**
 * Security utilities — ported from security_fixes.py
 * Uses Node.js crypto with PBKDF2-SHA256 matching Python's hashlib.pbkdf2_hmac
 */
const crypto = require('crypto');

/**
 * Hash a 4-digit PIN using PBKDF2-SHA256.
 * Returns "salt$hash" string — same format as Python.
 */
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex'); // 32-char hex = 16 bytes
  const hash = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}$${hash}`;
}

/**
 * Verify a PIN against its stored hash.
 */
function verifyPin(pin, hashed) {
  try {
    const [salt, storedHash] = hashed.split('$');
    if (!salt || !storedHash) return false;
    const hash = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
    // Constant-time comparison
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Track failed admin login attempts per IP — ported from LoginAttemptTracker class.
 */
class LoginAttemptTracker {
  constructor() {
    // { ip: [(timestamp, username), ...] }
    this.attempts = new Map();
  }

  recordAttempt(ip, username, success) {
    const now = Date.now() / 1000;
    if (!this.attempts.has(ip)) this.attempts.set(ip, []);

    // Clean attempts older than 1 hour
    let list = this.attempts.get(ip).filter(([ts]) => now - ts < 3600);

    if (!success) {
      list.push([now, username]);
    }
    this.attempts.set(ip, list);
  }

  isLocked(ip, maxAttempts = 5, lockoutMinutes = 15) {
    const list = this.attempts.get(ip);
    if (!list || list.length === 0) return { locked: false, retryAfter: null };

    const now = Date.now() / 1000;
    const lockoutSeconds = lockoutMinutes * 60;
    const recent = list.filter(([ts]) => now - ts < lockoutSeconds);

    if (recent.length >= maxAttempts) {
      const oldest = Math.min(...recent.map(([ts]) => ts));
      const retryAfter = Math.ceil(lockoutSeconds - (now - oldest)) + 1;
      return { locked: true, retryAfter };
    }
    return { locked: false, retryAfter: null };
  }

  reset(ip) {
    this.attempts.delete(ip);
  }
}

module.exports = { hashPin, verifyPin, LoginAttemptTracker };
