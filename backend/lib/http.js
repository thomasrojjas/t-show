const crypto = require('crypto');

function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && /^[a-zA-Z0-9._:-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

function apiError(res, status, code, message, meta) {
  const body = { success: false, code, message, requestId: res.req?.requestId };
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
}

function notFound(req, res) { return apiError(res, 404, 'ROUTE_NOT_FOUND', 'La ruta solicitada no existe.'); }

function errorHandler(error, req, res, _next) {
  const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500;
  const code = error.code && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'INTERNAL_ERROR';
  console.error(JSON.stringify({ level: 'error', requestId: req.requestId, method: req.method, path: req.path, code, status, message: error.message }));
  return apiError(res, status, code, status === 500 ? 'No pudimos completar la operación.' : error.message);
}

module.exports = { requestContext, securityHeaders, apiError, notFound, errorHandler };

