const rateLimit = require('express-rate-limit');

/**
 * Factory for creating rate limiters.
 * @param {number} maxRequests  - max requests allowed in window
 * @param {number} windowSeconds - window duration in seconds
 */
function createRateLimiter(maxRequests, windowSeconds) {
  return rateLimit({
    windowMs: windowSeconds * 1000,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message: `Rate limit exceeded. Try again in ${Math.ceil(windowSeconds / 60)} minute(s).`,
      });
    },
  });
}

// Admin login — 5 attempts per 15 min
const adminLoginLimiter = createRateLimiter(5, 15 * 60);

// OTP send (send-otp, forgot-pin) — 3 sends per 5 min
const chatOtpLimiter = createRateLimiter(3, 5 * 60);

// OTP / PIN verification — 5 attempts per 15 min (brute-force guard)
const chatVerifyOtpLimiter = createRateLimiter(5, 15 * 60);
const chatVerifyPinLimiter = createRateLimiter(5, 15 * 60);

// Card generation — 5 per 5 min
const chatGenerateCardLimiter = createRateLimiter(5, 5 * 60);

// EPIC validation — 10 per 60 s
const chatValidateEpicLimiter = createRateLimiter(10, 60);

// Public verify endpoint — 10 per minute (enumeration guard)
const publicVerifyLimiter = createRateLimiter(10, 60);

module.exports = {
  createRateLimiter,
  adminLoginLimiter,
  chatOtpLimiter,
  chatVerifyOtpLimiter,
  chatVerifyPinLimiter,
  chatGenerateCardLimiter,
  chatValidateEpicLimiter,
  publicVerifyLimiter,
};
