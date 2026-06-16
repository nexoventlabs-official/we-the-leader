/**
 * Cloudinary upload service — mirrors Python's upload_photo_to_cloudinary
 * and upload_card_to_cloudinary.
 */
const cloudinary = require('cloudinary').v2;
const config = require('../config');

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key:    config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
  secure:     true,
});

/**
 * Upload a Buffer to Cloudinary.
 * @param {Buffer} buffer
 * @param {string} publicId - filename (no folder prefix)
 * @param {string} folder   - Cloudinary folder
 * @returns {Promise<string>} secure_url
 */
function uploadBuffer(buffer, publicId, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id:     publicId,
        folder:        folder,
        overwrite:     true,
        invalidate:    true,
        resource_type: 'image',
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

/** Upload member passport photo. */
async function uploadPhoto(buffer, epicNo) {
  const id = epicNo.toUpperCase().replace(/[/\\]/g, '_');
  return uploadBuffer(buffer, id, config.cloudinary.photoFolder);
}

/** Upload generated front card. */
async function uploadCard(buffer, epicNo) {
  const id = epicNo.toUpperCase().replace(/[/\\]/g, '_');
  return uploadBuffer(buffer, id, config.cloudinary.cardsFolder);
}

/** Upload generated back card (public_id = {epicNo}_back). */
async function uploadBackCard(buffer, epicNo) {
  const id = `${epicNo.toUpperCase().replace(/[/\\]/g, '_')}_back`;
  return uploadBuffer(buffer, id, config.cloudinary.cardsFolder);
}

/** Upload combined front+back card (public_id = {epicNo}_combined). */
async function uploadCombinedCard(buffer, epicNo) {
  const id = `${epicNo.toUpperCase().replace(/[/\\]/g, '_')}_combined`;
  return uploadBuffer(buffer, id, config.cloudinary.cardsFolder);
}

/**
 * Fetch Cloudinary usage stats (for admin external-stats).
 */
async function getUsageStats() {
  try {
    const usage = await cloudinary.api.usage();
    return String(Math.round((usage.credits?.usage || 0) * 100) / 100);
  } catch {
    return 'N/A';
  }
}

module.exports = { uploadPhoto, uploadCard, uploadBackCard, uploadCombinedCard, getUsageStats };
