require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';

// ── Startup secret validations ────────────────────────────────────
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be set in .env');
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set and at least 32 characters long');
}

if (nodeEnv === 'production' && !process.env.BASE_URL) {
  throw new Error('BASE_URL must be set in production');
}

const config = {
  port:    process.env.PORT    || 5000,
  nodeEnv,

  // ── DB2: App data (Atlas) — writes happen here ──────────────────
  mongoUri: process.env.MONGO_URI || '',
  mongoDb:  process.env.MONGO_DB  || 'wetheleaders',

  // ── DB1: Voter roll (DigitalOcean) — READ-ONLY ──────────────────
  mongoVoterUrl:    process.env.MONGO_VOTER_URL    || '',
  mongoVoterDbName: process.env.MONGO_VOTER_DB_NAME || 'voter_db',

  cloudinary: {
    cloudName:   process.env.CLOUDINARY_CLOUD_NAME  || '',
    apiKey:      process.env.CLOUDINARY_API_KEY      || '',
    apiSecret:   process.env.CLOUDINARY_API_SECRET   || '',
    photoFolder: process.env.CLOUDINARY_PHOTO_FOLDER || 'member_photos',
    cardsFolder: process.env.CLOUDINARY_CARDS_FOLDER || 'generated_cards',
  },

  admin: {
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  },

  smsApiKey:          process.env.SMS_API_KEY          || '',
  whatsappChannelUrl: process.env.WHATSAPP_CHANNEL_URL || '',

  // WhatsApp Cloud API
  whatsapp: {
    verifyToken:    process.env.WHATSAPP_VERIFY_TOKEN    || '',
    appId:          process.env.WHATSAPP_APP_ID           || '',
    appSecret:      process.env.WHATSAPP_APP_SECRET       || '',
    accessToken:    process.env.WHATSAPP_ACCESS_TOKEN     || '',
    phoneNumberId:  process.env.WHATSAPP_PHONE_NUMBER_ID  || '',
    wabaId:         process.env.WHATSAPP_WABA_ID          || '',
    // RSA private key for decrypting WhatsApp Flow requests (optional)
    // Set WHATSAPP_FLOW_PRIVATE_KEY in .env (newlines as \n)
    flowPrivateKey: process.env.WHATSAPP_FLOW_PRIVATE_KEY || '',
    flows: {
      registrationId: process.env.WHATSAPP_FLOW_REGISTRATION_ID || '',
      loginId:        process.env.WHATSAPP_FLOW_LOGIN_ID        || '',
    },
  },

  baseUrl:       process.env.BASE_URL       || 'http://localhost:5000',
  frontendUrl:   process.env.FRONTEND_URL   || '',
  // Comma-separated list of extra allowed CORS origins e.g. preview deploy URLs
  extraOrigins:  process.env.EXTRA_ORIGINS
    ? process.env.EXTRA_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : [],
  sessionSecret: process.env.SESSION_SECRET,
};

module.exports = config;
