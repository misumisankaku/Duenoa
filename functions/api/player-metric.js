'use strict';

const ALLOWED_ORIGINS = new Set([
  'https://misumisankaku.github.io',
  'https://my-gamma-lyart.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
const PLAYER_SET_KEY = 'duenoa:metrics:unique-player-hashes:v1';
const DAILY_PREFIX = 'duenoa:metrics:unique-player-additions:v1:';
const SESSION_COOKIE = 'duenoa_metrics_session';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

function originAllowed(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin || ALLOWED_ORIGINS.has(origin);
}

function responseHeaders(request) {
  const headers = new Headers({
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function hasValidMetricsSession(request, password) {
  const cookie = String(request.headers.get('Cookie') || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(SESSION_COOKIE + '='));
  if (!cookie) return false;
  const value = cookie.slice(SESSION_COOKIE.length + 1);
  const separator = value.indexOf('.');
  if (separator < 1) return false;
  const expiry = Number(value.slice(0, separator));
  const supplied = value.slice(separator + 1);
  if (!Number.isInteger(expiry) || expiry <= Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(password, 'duenoa-metrics-session-v1:' + expiry);
  return constantTimeEqualHex(supplied, expected);
}

async function redisCommand(url, token, command) {
  const response = await fetch(url.replace(/\/+$/, ''), {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || 'Redis request failed');
  return payload.result;
}

function jstDate(offsetDays) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day) + (offsetDays || 0),
  ));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(request) });
  if (!originAllowed(request)) return json(request, { error: 'origin_not_allowed' }, 403);
  if (request.method === 'POST' && !request.headers.get('Origin')) {
    return json(request, { error: 'origin_required' }, 403);
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json(request, { error: 'method_not_allowed' }, 405);
  }
  const password = env.DUENOA_METRICS_PASSWORD;
  if (request.method === 'GET') {
    if (!password) return json(request, { error: 'metrics_auth_not_configured' }, 503);
    if (!await hasValidMetricsSession(request, password)) {
      return json(request, { error: 'authentication_required' }, 401);
    }
  }
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) return json(request, { error: 'storage_not_configured' }, 503);

  try {
    if (request.method === 'GET') {
      const dates = Array.from({ length: 30 }, (_, index) => jstDate(index - 29));
      const keys = dates.map(date => DAILY_PREFIX + date);
      const [count, values] = await Promise.all([
        redisCommand(url, token, ['SCARD', PLAYER_SET_KEY]),
        redisCommand(url, token, ['MGET', ...keys]),
      ]);
      const total = Number(count) || 0;
      const dailyCounts = dates.map((_, index) => Math.max(0, Number(values && values[index]) || 0));
      const observedInWindow = dailyCounts.reduce((sum, value) => sum + value, 0);
      let cumulative = Math.max(0, total - observedInWindow);
      const series = dates.map((date, index) => {
        const newPlayers = dailyCounts[index];
        cumulative += newPlayers;
        return { date, newPlayers, uniquePlayers: cumulative };
      });
      return json(request, {
        metric: 'unique_browsers_that_started_a_game',
        uniquePlayers: total,
        timezone: 'Asia/Tokyo',
        days: 30,
        series,
      });
    }

    let body;
    try { body = await request.json(); } catch { return json(request, { error: 'invalid_json' }, 400); }
    const id = String(body?.id || '');
    if (!UUID_PATTERN.test(id)) return json(request, { error: 'invalid_player_id' }, 400);
    const hashedId = await sha256Hex(id.toLowerCase());
    const dayKey = DAILY_PREFIX + jstDate(0);
    const script = 'local added = redis.call("SADD", KEYS[1], ARGV[1]); if added == 1 then redis.call("INCR", KEYS[2]); end; return added';
    const added = await redisCommand(url, token, ['EVAL', script, 2, PLAYER_SET_KEY, dayKey, hashedId]);
    return json(request, { recorded: true, firstGameFromBrowser: Number(added) === 1 });
  } catch (error) {
    console.error('Player metric request failed:', error);
    return json(request, { error: 'metric_unavailable' }, 500);
  }
}
