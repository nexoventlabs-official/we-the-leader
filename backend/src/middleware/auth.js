/**
 * Admin authentication middleware.
 * Checks session.adminLoggedIn — mirrors Flask's before_admin.
 */
function requireAdminAuth(req, res, next) {
  if (req.session && req.session.adminLoggedIn) {
    return next();
  }

  // API routes → 401 JSON (same as Flask: request.is_json or path starts with /admin/api/)
  if (req.originalUrl.includes('/api/') || req.headers['content-type'] === 'application/json') {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please login.' });
  }

  // Page routes → redirect
  return res.redirect('/admin/login');
}

module.exports = { requireAdminAuth };
