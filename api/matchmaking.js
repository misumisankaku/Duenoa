const ORIGINS = new Set([
  'https://misumisankaku.github.io',
  'https://my-gamma-lyart.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const QUEUE_KEY = 'duenoa:random-match:waiting';
const META_PREFIX = 'duenoa:random-match:player:';
const PAIR_PREFIX = 'duenoa:random-match:pair:';
const QUEUE_TTL_SECONDS = 180;
const PAIR_TTL_SECONDS = 90;

const MATCH_SCRIPT = `
local now = tonumber(ARGV[1])
local peerId = ARGV[2]
local queueTtl = tonumber(ARGV[3])
local pairTtl = tonumber(ARGV[4])
local metaPrefix = ARGV[5]
local pairPrefix = ARGV[6]
local myPairKey = pairPrefix .. peerId

local existingPair = redis.call('GET', myPairKey)
if existingPair then
  return {'matched', existingPair, tostring(redis.call('ZCARD', KEYS[1]))}
end

local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now - queueTtl)
for _, staleId in ipairs(expired) do
  redis.call('ZREM', KEYS[1], staleId)
  redis.call('DEL', metaPrefix .. staleId)
end

local candidates = redis.call('ZRANGE', KEYS[1], 0, 99)
for _, candidateId in ipairs(candidates) do
  if candidateId ~= peerId then
    local candidateMeta = redis.call('GET', metaPrefix .. candidateId)
    if candidateMeta then
      redis.call('ZREM', KEYS[1], candidateId)
      redis.call('DEL', metaPrefix .. candidateId)
      redis.call('SET', pairPrefix .. candidateId, cjson.encode({peerId = peerId, role = 'host'}), 'EX', pairTtl)
      redis.call('ZREM', KEYS[1], peerId)
      redis.call('DEL', metaPrefix .. peerId)
      return {'matched', cjson.encode({peerId = candidateId, role = 'guest'}), tostring(redis.call('ZCARD', KEYS[1]))}
    else
      redis.call('ZREM', KEYS[1], candidateId)
    end
  end
end

local score = redis.call('ZSCORE', KEYS[1], peerId)
if not score then
  score = now
  redis.call('ZADD', KEYS[1], now, peerId)
end
redis.call('SET', metaPrefix .. peerId, '1', 'EX', queueTtl + 30)
return {'waiting', tostring(redis.call('ZCARD', KEYS[1])), tostring(math.max(0, now - tonumber(score)))}
`;

const CANCEL_SCRIPT = `
local peerId = ARGV[1]
local metaPrefix = ARGV[2]
local pairPrefix = ARGV[3]
local pair = redis.call('GET', pairPrefix .. peerId)
if pair then
  local ok, decoded = pcall(cjson.decode, pair)
  if ok and decoded.peerId then
    redis.call('DEL', pairPrefix .. decoded.peerId)
  end
end
redis.call('DEL', pairPrefix .. peerId)
redis.call('ZREM', KEYS[1], peerId)
redis.call('DEL', metaPrefix .. peerId)
return {'cancelled', tostring(redis.call('ZCARD', KEYS[1]))}
`;

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

async function evaluate(script, keys, args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const response = await fetch(url.replace(/\/+$/, ''), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['EVAL', script, String(keys.length), ...keys, ...args.map(String)]),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || 'Redis request failed');
  return result.result;
}

module.exports = async function matchmaking(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (req.headers.origin && !ORIGINS.has(req.headers.origin)) return res.status(403).json({ error: 'origin_not_allowed' });

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return res.status(503).json({ error: 'storage_not_configured' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const action = body.action;
  const peerId = String(body.peerId || '');
  if (!['poll', 'cancel'].includes(action)) return res.status(400).json({ error: 'invalid_action' });
  if (!/^[a-zA-Z0-9_-]{3,100}$/.test(peerId)) return res.status(400).json({ error: 'invalid_peer_id' });

  try {
    if (action === 'cancel') {
      const [status, waitingCount] = await evaluate(CANCEL_SCRIPT, [QUEUE_KEY], [peerId, META_PREFIX, PAIR_PREFIX]);
      return res.status(200).json({ status, waitingCount: Number(waitingCount) || 0 });
    }

    const now = Date.now();
    const [status, payload, value] = await evaluate(MATCH_SCRIPT, [QUEUE_KEY], [
      now,
      peerId,
      QUEUE_TTL_SECONDS * 1000,
      PAIR_TTL_SECONDS,
      META_PREFIX,
      PAIR_PREFIX,
    ]);
    if (status === 'matched') {
      const pair = JSON.parse(payload);
      if (!pair.peerId || !['host', 'guest'].includes(pair.role)) throw new Error('Invalid match response');
      return res.status(200).json({ status, peerId: pair.peerId, role: pair.role, waitingCount: Number(value) || 0 });
    }
    return res.status(200).json({
      status: 'waiting',
      waitingCount: Number(payload) || 1,
      waitedMs: Number(value) || 0,
    });
  } catch (error) {
    console.error('Random matchmaking failed:', error);
    return res.status(503).json({ error: 'matchmaking_unavailable' });
  }
};

