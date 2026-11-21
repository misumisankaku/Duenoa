'use strict';

const ALLOWED_ORIGINS = new Set([
  'https://misumisankaku.github.io',
  'https://my-gamma-lyart.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
const COOKIE_NAME = 'duenoa_metrics_session';
const SESSION_MAX_AGE = 12 * 60 * 60;
const encoder = new TextEncoder();

function originAllowed(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin || ALLOWED_ORIGINS.has(origin);
}

function responseHeaders(request) {
  const headers = new Headers({
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  const origin = request.headers.get('Origin');
  if (origin && originAllowed(request)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function json(request, body, status = 200) {
  const headers = responseHeaders(request);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmacHex(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value)));
}

function constantTimeEqualHex(left, right) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  let mismatch = 0;
  for (let index = 0; index < 64; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(request) });
  if (!originAllowed(request)) return json(request, { error: 'origin_not_allowed' }, 403);
  if (request.method !== 'POST') return json(request, { error: 'method_not_allowed' }, 405);
  const origin = request.headers.get('Origin');
  if (!origin) return json(request, { error: 'origin_not_allowed' }, 403);

  let body;
  try { body = await request.json(); } catch { return json(request, { error: 'invalid_json' }, 400); }
  if (body?.logout === true) {
    const headers = responseHeaders(request);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Set-Cookie', COOKIE_NAME + '=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  const password = env.DUENOA_METRICS_PASSWORD;
  if (!password) return json(request, { error: 'metrics_auth_not_configured' }, 503);
  const supplied = await sha256Hex(String(body?.password || ''));
  const expected = await sha256Hex(password);
  if (!constantTimeEqualHex(supplied, expected)) {
    return json(request, { error: 'invalid_password' }, 401);
  }

  const expiry = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const signature = await hmacHex(password, 'duenoa-metrics-session-v1:' + expiry);
  const cookie = COOKIE_NAME + '=' + expiry + '.' + signature +
    '; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=' + SESSION_MAX_AGE;
  const headers = responseHeaders(request);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify({ ok: true, expiresIn: SESSION_MAX_AGE }), { status: 200, headers });
}
