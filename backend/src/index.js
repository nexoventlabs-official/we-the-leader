/**
 * We The Leaders — Express API Server
 * =====================================
 * Node.js port of Flask app.py
 * Lead the Change
 */
require('dotenv').config();

const express    = require('express');
const session    = require('express-session');
const MongoStore = require('connect-mongo');
const cors       = require('cors');
const helmet     = require('helmet');
const crypto     = require('crypto');
const path       = require('path');
const config     = require('./config');
const { connectDB } = require('./db');

// ── Route modules ─────────────────────────────────────────────────
const chatRoutes    = require('./routes/chat');
const adminRoutes   = require('./routes/admin');
const publicRoutes  = require('./routes/public');
const webhookRoutes = require('./routes/webhook');

const app = express();

// ── Warn if insecure cookie in non-production ─────────────────────
if (config.nodeEnv !== 'production') {
  console.warn('⚠️  NODE_ENV is not production — secure cookies disabled, CSP relaxed');
}

// ── Security headers ───────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: config.nodeEnv === 'production' ? {
    directives: {
      defaultSrc: ["'self'", 'https://res.cloudinary.com'],
      imgSrc:     ["'self'", 'https://res.cloudinary.com', 'data:'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
      connectSrc: ["'self'"],
    },
  } : false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options',        'DENY');
  res.setHeader('X-XSS-Protection',       '1; mode=block');
  res.setHeader('Referrer-Policy',        'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',     'geolocation=(), microphone=(), camera=()');

  if (req.path.startsWith('/static/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (req.path.startsWith('/admin') || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
    res.setHeader('Pragma',  'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// ── CORS — reject unknown origins in production ───────────────────
const allowedOrigins = config.nodeEnv === 'development'
  ? ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000']
  : [config.baseUrl];

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin (no Origin header) and server-to-server calls
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // Reject all other origins — never silently allow in production
    cb(new Error(`Origin ${origin} not allowed by CORS`), false);
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ────────────────────────────────────────────────────────────────
// IMPORTANT: WhatsApp webhook route uses raw body for HMAC-SHA256.
// Register it BEFORE express.json() so the raw body is preserved.
// ────────────────────────────────────────────────────────────────
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use('/api/webhook', webhookRoutes);

// ── Body parsers (all other routes) ──────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Sessions with MongoDB store ───────────────────────────────────
app.use(session({
  secret:            config.sessionSecret,
  resave:            false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl:       config.mongoUri,
    dbName:         config.mongoDb,
    collectionName: 'sessions',
    ttl:            86400,
    autoRemove:     'native',
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure:   config.nodeEnv === 'production',
    maxAge:   86400 * 1000,
  },
  name: 'wtl.session',
}));

// ── Static files ──────────────────────────────────────────────────
const frontendDist = path.join(__dirname, '../public');
const staticDir    = path.join(__dirname, '../../../static');

if (require('fs').existsSync(frontendDist) && config.nodeEnv === 'production') {
  app.use(express.static(frontendDist, { maxAge: '1y', etag: true }));
}
if (require('fs').existsSync(staticDir)) {
  app.use('/static', express.static(staticDir, { maxAge: '7d' }));
}

// ── API Routes ────────────────────────────────────────────────────
app.use('/api',   chatRoutes);
app.use('/admin', adminRoutes);
app.use('/',      publicRoutes);

// ── SPA fallback (production) ─────────────────────────────────────
if (config.nodeEnv === 'production' && require('fs').existsSync(frontendDist)) {
  const indexHtml = path.join(frontendDist, 'index.html');
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    res.sendFile(indexHtml);
  });
}

// ── 404 fallback ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ── Global error handler — never leak stack traces ────────────────
app.use((err, req, res, _next) => {
  const correlationId = crypto.randomUUID();
  if (config.nodeEnv === 'production') {
    console.error(`[${correlationId}] Unhandled error: ${err.message}`);
  } else {
    console.error(`[${correlationId}]`, err);
  }
  res.status(500).json({ success: false, message: 'Internal server error', ref: correlationId });
});

// ── Start server ─────────────────────────────────────────────────
async function startServer() {
  await connectDB();

  app.listen(config.port, () => {
    console.log('─────────────────────────────────────────');
    console.log('  WE THE LEADERS — Lead the Change');
    console.log(`  API server running on port ${config.port}`);
    console.log(`  Environment : ${config.nodeEnv}`);
    console.log(`  Base URL    : ${config.baseUrl}`);
    console.log('─────────────────────────────────────────');
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
