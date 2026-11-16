'use strict';

const { createHash } = require('crypto');

const ALLOWED_ORIGINS = new Set([
  'https://misumisankaku.github.io',
  'https://my-gamma-lyart.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
const PLAYER_SET_KEY = 'duenoa:metrics:unique-player-hashes:v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

async function redisCommand(url, token, command) {
  const response = await fetch(url.replace(/\\/+$/, ''), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || 'Redis request failed');
  }
  return payload.result;
}

module.exports = async function playerMetric(req, res) {
  setHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }
  if (req.method === 'POST' && !origin) {
    return res.status(403).json({ error: 'origin_required' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return res.status(503).json({ error: 'storage_not_configured' });
  }

  try {
    if (req.method === 'GET') {
      const count = await redisCommand(url, token, ['SCARD', PLAYER_SET_KEY]);
      return res.status(200).json({
        metric: 'unique_browsers_that_started_a_game',
        uniquePlayers: Number(count) || 0,
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const id = String(body.id || '');
    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ error: 'invalid_player_id' });
    }

    const hashedId = createHash('sha256').update(id.toLowerCase()).digest('hex');
    const added = await redisCommand(url, token, ['SADD', PLAYER_SET_KEY, hashedId]);
    const count = await redisCommand(url, token, ['SCARD', PLAYER_SET_KEY]);
    return res.status(200).json({
      metric: 'unique_browsers_that_started_a_game',
      uniquePlayers: Number(count) || 0,
      firstGameFromBrowser: Number(added) === 1,
    });
  } catch (error) {
    console.error('Player metric request failed:', error);
    return res.status(500).json({ error: 'metric_unavailable' });
  }
};
