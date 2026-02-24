// Serverless версия для Vercel/Netlify/Cloudflare
// Использует Upstash Redis (serverless-friendly)

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const crypto = require('crypto');

const app = express();

// Upstash Redis REST API (работает в serverless)
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Redis client через REST API
const redis = {
  async set(key, value, options = {}) {
    const commands = ['SET', key, value];
    if (options.EX) commands.push('EX', options.EX);
    
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/${commands.join('/')}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
    });
    return response.json();
  },
  
  async get(key) {
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/GET/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
    });
    const data = await response.json();
    return data.result;
  },
  
  async del(key) {
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/DEL/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
    });
    return response.json();
  },
  
  async sAdd(key, member) {
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/SADD/${key}/${member}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
    });
    return response.json();
  },
  
  async sRem(key, member) {
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/SREM/${key}/${member}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
    });
    return response.json();
  },
  
  async sMembers(key) {
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/SMEMBERS/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
    });
    const data = await response.json();
    return data.result || [];
  }
};

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));
app.use(express.json({ limit: '10kb' }));

// Simple in-memory rate limiting (per deployment)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 100;

function checkRateLimit(ip) {
  const now = Date.now();
  const userLimit = rateLimitMap.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
  
  if (now > userLimit.resetTime) {
    userLimit.count = 0;
    userLimit.resetTime = now + RATE_LIMIT_WINDOW;
  }
  
  userLimit.count++;
  rateLimitMap.set(ip, userLimit);
  
  return userLimit.count <= RATE_LIMIT_MAX;
}

// Rate limiting middleware
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.ip;
  
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests, please try again later' });
  }
  
  next();
});

// Validation schemas
const schemas = {
  registerLobby: Joi.object({
    lobbyId: Joi.string().max(100).required(),
    hostName: Joi.string().max(50).required(),
    region: Joi.string().max(20).required(),
    maxPlayers: Joi.number().integer().min(1).max(100).required(),
    hasPassword: Joi.boolean().required(),
    version: Joi.string().max(20).required(),
    password: Joi.string().max(100).allow('', null)
  }),
  
  heartbeat: Joi.object({
    playerCount: Joi.number().integer().min(0).max(100).required()
  }),
  
  checkPassword: Joi.object({
    password: Joi.string().max(100).required()
  })
};

// Generate API key
function generateApiKey(clientId) {
  const secret = process.env.API_KEY_SECRET;
  const timestamp = Date.now();
  const data = `${clientId}:${timestamp}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return Buffer.from(`${data}:${signature}`).toString('base64');
}

// Verify API key
function verifyApiKey(apiKey) {
  try {
    const decoded = Buffer.from(apiKey, 'base64').toString('utf-8');
    const [clientId, timestamp, signature] = decoded.split(':');
    
    const secret = process.env.API_KEY_SECRET;
    const data = `${clientId}:${timestamp}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(data).digest('hex');
    
    if (signature !== expectedSignature) {
      return null;
    }
    
    return { clientId, timestamp: parseInt(timestamp) };
  } catch (err) {
    return null;
  }
}

// Authentication middleware
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  const verified = verifyApiKey(apiKey);
  if (!verified) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  req.clientId = verified.clientId;
  next();
};

// Generate JWT token
function generateToken(clientId) {
  return jwt.sign(
    { clientId, type: 'client' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

// Helper functions
async function saveLobby(lobbyId, lobbyData) {
  const key = `lobby:${lobbyId}`;
  await redis.set(key, JSON.stringify(lobbyData), { EX: 300 }); // 5 min TTL
  await redis.sAdd('lobbies:active', lobbyId);
}

async function getLobby(lobbyId) {
  const key = `lobby:${lobbyId}`;
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

async function deleteLobby(lobbyId) {
  const key = `lobby:${lobbyId}`;
  await redis.del(key);
  await redis.sRem('lobbies:active', lobbyId);
}

async function getAllLobbies() {
  const lobbyIds = await redis.sMembers('lobbies:active');
  const lobbies = [];
  
  for (const lobbyId of lobbyIds) {
    const lobby = await getLobby(lobbyId);
    if (lobby) {
      const { password, ...publicLobby } = lobby;
      lobbies.push(publicLobby);
    } else {
      await redis.sRem('lobbies:active', lobbyId);
    }
  }
  
  return lobbies;
}

// Routes

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/api/auth/register', (req, res) => {
  const clientId = crypto.randomUUID();
  const apiKey = generateApiKey(clientId);
  const token = generateToken(clientId);
  
  res.json({
    ok: true,
    clientId,
    apiKey,
    token
  });
});

app.post('/api/lobbies', authenticate, async (req, res) => {
  try {
    const { error, value } = schemas.registerLobby.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const { lobbyId, hostName, region, maxPlayers, hasPassword, version, password } = value;
    
    const existing = await getLobby(lobbyId);
    if (existing) {
      return res.status(409).json({ error: 'Lobby already exists' });
    }
    
    const lobbyData = {
      lobbyId,
      hostName,
      region,
      maxPlayers,
      hasPassword,
      version,
      password: hasPassword ? password : null,
      playerCount: 1,
      createdAt: Date.now(),
      lastHeartbeat: Date.now(),
      clientId: req.clientId
    };
    
    await saveLobby(lobbyId, lobbyData);
    
    res.status(201).json({ ok: true, lobbyId });
  } catch (err) {
    console.error('Error registering lobby:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/lobbies/:lobbyId/heartbeat', authenticate, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    const { error, value } = schemas.heartbeat.validate(req.body);
    
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const lobby = await getLobby(lobbyId);
    if (!lobby) {
      return res.status(404).json({ error: 'Lobby not found' });
    }
    
    if (lobby.clientId !== req.clientId) {
      return res.status(403).json({ error: 'Not authorized to update this lobby' });
    }
    
    lobby.playerCount = value.playerCount;
    lobby.lastHeartbeat = Date.now();
    
    await saveLobby(lobbyId, lobby);
    
    res.json({ ok: true });
  } catch (err) {
    console.error('Error sending heartbeat:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/lobbies/:lobbyId', authenticate, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    
    const lobby = await getLobby(lobbyId);
    if (!lobby) {
      return res.status(404).json({ error: 'Lobby not found' });
    }
    
    if (lobby.clientId !== req.clientId) {
      return res.status(403).json({ error: 'Not authorized to delete this lobby' });
    }
    
    await deleteLobby(lobbyId);
    
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting lobby:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/lobbies', authenticate, async (req, res) => {
  try {
    const lobbies = await getAllLobbies();
    res.json({ ok: true, lobbies });
  } catch (err) {
    console.error('Error getting lobbies:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/lobbies/:lobbyId/check-password', authenticate, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    const { error, value } = schemas.checkPassword.validate(req.body);
    
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const lobby = await getLobby(lobbyId);
    if (!lobby) {
      return res.status(404).json({ error: 'Lobby not found' });
    }
    
    const valid = lobby.password === value.password;
    
    res.json({ ok: true, valid });
  } catch (err) {
    console.error('Error checking password:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Export for serverless
module.exports = app;
