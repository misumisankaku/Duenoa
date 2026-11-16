'use strict';

const { createHash, createHmac, timingSafeEqual } = require('crypto');

const ALLOWED_ORIGINS = new Set([
  'https://my-gamma-lyart.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
const COOKIE_NAME = 'duenoa_metrics_session';
const SESSION_MAX_AGE = 12 * 60 * 60;

function setHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

function signExpiry(password, expiry) {
  return createHmac('sha256', password)
    .update('duenoa-metrics-session-v1:' + expiry)
    .digest('hex');
}

module.exports = async function metricsAuth(req, res) {
  setHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  if (body.logout === true) {
    res.setHeader('Set-Cookie', COOKIE_NAME + '=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    return res.status(200).json({ ok: true });
  }

  const password = process.env.DUENOA_METRICS_PASSWORD;
  if (!password) {
    return res.status(503).json({ error: 'metrics_auth_not_configured' });
  }

  const supplied = createHash('sha256').update(String(body.password || '')).digest();
  const expected = createHash('sha256').update(password).digest();
  if (!timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'invalid_password' });
  }

  const expiry = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const signature = signExpiry(password, expiry);
  const cookie = COOKIE_NAME + '=' + expiry + '.' + signature +
    '; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=' + SESSION_MAX_AGE;
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ ok: true, expiresIn: SESSION_MAX_AGE });
};
