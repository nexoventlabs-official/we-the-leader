const { mongoose } = require('../db');
const otpSessionSchema = new mongoose.Schema({
  mobile:     { type: String, required: true, unique: true, index: true },
  otp:        { type: String },
  created_at: { type: Date, default: Date.now, expires: 600 },
  verified:   { type: Boolean, default: false },
  purpose:    { type: String },
}, { collection: 'otp_sessions' });
module.exports = mongoose.model('OtpSession', otpSessionSchema);
