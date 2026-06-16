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
const flowRoutes    = require('./routes/flow');

const app = express();

// ── Trust proxy (Render + Cloudflare sit in front) ────────────────
// Required for secure cookies and correct req.ip behind a reverse proxy
app.set('trust proxy', 1);

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
      connectSrc: ["'self'", config.frontendUrl, config.baseUrl].filter(Boolean),
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

// ── CORS ──────────────────────────────────────────────────────────
// Meta webhook & flow endpoints are server-to-server — skip origin check.
// All other routes restrict to known origins in production.
const allowedOrigins = config.nodeEnv === 'development'
  ? ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000']
  : [
      config.baseUrl,
      config.frontendUrl,
      ...(config.extraOrigins || []),
    ].filter(Boolean);

const META_PATHS_RE = /^\/api\/webhook(\/flow)?(\/|$)/;

app.use((req, res, next) => {
  // Meta server-to-server paths — allow any origin, no credentials
  if (META_PATHS_RE.test(req.path)) {
    return cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] })(req, res, next);
  }
  // All other routes — enforce origin allowlist
  return cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials:    true,
    methods:        ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })(req, res, next);
});

// ────────────────────────────────────────────────────────────────
// Body-parsing order matters:
//
//  /api/webhook/flow  → express.json() (handled inside flow.js)
//  /api/webhook       → express.raw()  for HMAC-SHA256 on Meta messages
//
// The raw middleware MUST be scoped to the exact /api/webhook path
// (not /api/webhook/*) so it does NOT consume the body for /api/webhook/flow.
// ────────────────────────────────────────────────────────────────

// WhatsApp Flow endpoint — body parsed by express.json() inside flow.js
app.use('/api/webhook/flow', flowRoutes);

// WhatsApp message webhook — raw body required for HMAC-SHA256
// Use a path regex that matches /api/webhook exactly (no sub-paths like /flow)
app.use(/^\/api\/webhook$/, express.raw({ type: 'application/json' }));
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
    sameSite: 'none',   // required for cross-origin requests (Vercel → Render)
    secure:   true,     // sameSite=none requires secure=true
    maxAge:   86400 * 1000,
  },
  name: 'wtl.session',
}));

// ── Static files ──────────────────────────────────────────────────
// NOTE: Frontend is deployed separately on Vercel.
// The backend only serves assets from /static (e.g. banner images for OG tags).
const staticDir = path.join(__dirname, '../../../static');
if (require('fs').existsSync(staticDir)) {
  app.use('/static', express.static(staticDir, { maxAge: '7d' }));
}

// ── Health check endpoint (required by Render) ──────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────────
app.use('/api',   chatRoutes);
app.use('/admin', adminRoutes);
app.use('/',      publicRoutes);

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
