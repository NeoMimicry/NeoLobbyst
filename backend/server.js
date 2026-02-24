require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { createClient } = require('redis');
const Joi = require('joi');
const crypto = require('crypto');
const basicAuth = require('express-basic-auth');

const app = express();
const port = process.env.PORT || 3000;

// Trust proxy - required when behind Cloudflare/Nginx
app.set('trust proxy', true);

// Redis client
let redisClient;
(async () => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  redisClient = createClient({
    url: redisUrl
  });
  
  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  await redisClient.connect();
  console.log('Connected to Redis');
})();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));
app.use(express.json({ limit: '10kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  // Use Cloudflare's CF-Connecting-IP header for real user IP
  keyGenerator: (req) => {
    return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
  }
});
app.use(limiter);

// Logging middleware
app.use((req, res, next) => {
  // Get real IP from Cloudflare or X-Forwarded-For
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - IP: ${ip}`);
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

// Generate API key for client
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

// Verify JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Helper functions for Redis
async function saveLobby(lobbyId, lobbyData) {
  const key = `lobby:${lobbyId}`;
  await redisClient.set(key, JSON.stringify(lobbyData), {
    EX: 300 // 5 minutes TTL
  });
  await redisClient.sAdd('lobbies:active', lobbyId);
}

async function getLobby(lobbyId) {
  const key = `lobby:${lobbyId}`;
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
}

async function deleteLobby(lobbyId) {
  const key = `lobby:${lobbyId}`;
  await redisClient.del(key);
  await redisClient.sRem('lobbies:active', lobbyId);
}

async function getAllLobbies() {
  const lobbyIds = await redisClient.sMembers('lobbies:active');
  const lobbies = [];
  
  for (const lobbyId of lobbyIds) {
    const lobby = await getLobby(lobbyId);
    if (lobby) {
      // Don't expose password
      const { password, ...publicLobby } = lobby;
      lobbies.push(publicLobby);
    } else {
      // Clean up stale reference
      await redisClient.sRem('lobbies:active', lobbyId);
    }
  }
  
  return lobbies;
}

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Admin Panel with Basic Auth
const adminAuth = basicAuth({
  users: { 
    [process.env.ADMIN_USERNAME || 'admin']: process.env.ADMIN_PASSWORD || 'admin' 
  },
  challenge: true,
  realm: 'NeoLobbyst Admin Panel'
});

// Admin dashboard HTML
app.get('/admin', adminAuth, (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NeoLobbyst Admin Panel</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: '#3b82f6',
            secondary: '#8b5cf6',
          }
        }
      }
    }
  </script>
</head>
<body class="bg-gray-900 text-gray-100">
  <div class="min-h-screen">
    <!-- Header -->
    <header class="bg-gray-800 border-b border-gray-700">
      <div class="container mx-auto px-4 py-4">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-primary">NeoLobbyst</h1>
            <p class="text-sm text-gray-400">Admin Panel</p>
          </div>
          <div class="flex items-center gap-4">
            <div class="text-right">
              <p class="text-sm text-gray-400">Logged in as</p>
              <p class="font-semibold">${process.env.ADMIN_USERNAME || 'admin'}</p>
            </div>
            <button onclick="logout()" class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition">
              Logout
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="container mx-auto px-4 py-8">
      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-400 mb-1">Active Lobbies</p>
              <p class="text-3xl font-bold text-primary" id="activeLobbies">-</p>
            </div>
            <div class="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
              </svg>
            </div>
          </div>
        </div>

        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-400 mb-1">Total Players</p>
              <p class="text-3xl font-bold text-green-500" id="totalPlayers">-</p>
            </div>
            <div class="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path>
              </svg>
            </div>
          </div>
        </div>

        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-400 mb-1">Redis Keys</p>
              <p class="text-3xl font-bold text-purple-500" id="redisKeys">-</p>
            </div>
            <div class="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"></path>
              </svg>
            </div>
          </div>
        </div>

        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-400 mb-1">Server Status</p>
              <p class="text-3xl font-bold text-green-500">●</p>
              <p class="text-xs text-gray-400 mt-1">Online</p>
            </div>
            <div class="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M12 5l7 7-7 7"></path>
              </svg>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="bg-gray-800 rounded-lg p-6 border border-gray-700 mb-8">
        <h2 class="text-xl font-bold mb-4">Admin Actions</h2>
        <div class="flex flex-wrap gap-3">
          <button onclick="refreshData()" class="px-4 py-2 bg-primary hover:bg-blue-600 rounded-lg font-medium transition flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            Refresh Data
          </button>
          <button onclick="cleanupInactive()" class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded-lg font-medium transition flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
            Cleanup Inactive
          </button>
          <button onclick="clearAllLobbies()" class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            Clear All Lobbies
          </button>
        </div>
      </div>

      <!-- Lobbies Table -->
      <div class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <div class="p-6 border-b border-gray-700">
          <h2 class="text-xl font-bold">Active Lobbies</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-gray-700/50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Lobby ID</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Host</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Region</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Players</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Password</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Version</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Last Heartbeat</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody id="lobbiesTable" class="divide-y divide-gray-700">
              <tr>
                <td colspan="8" class="px-6 py-8 text-center text-gray-400">
                  <div class="flex flex-col items-center gap-2">
                    <svg class="w-12 h-12 text-gray-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                    </svg>
                    <p>Loading lobbies...</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  </div>

  <script>
    let autoRefresh = true;

    async function fetchStats() {
      try {
        const response = await fetch('/admin/api/stats');
        const data = await response.json();
        
        document.getElementById('activeLobbies').textContent = data.activeLobbies;
        document.getElementById('totalPlayers').textContent = data.totalPlayers;
        document.getElementById('redisKeys').textContent = data.redisKeys;
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    }

    async function fetchLobbies() {
      try {
        const response = await fetch('/admin/api/lobbies');
        const data = await response.json();
        
        const tbody = document.getElementById('lobbiesTable');
        
        if (data.lobbies.length === 0) {
          tbody.innerHTML = \`
            <tr>
              <td colspan="8" class="px-6 py-8 text-center text-gray-400">
                <div class="flex flex-col items-center gap-2">
                  <svg class="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
                  </svg>
                  <p>No active lobbies</p>
                </div>
              </td>
            </tr>
          \`;
          return;
        }
        
        tbody.innerHTML = data.lobbies.map(lobby => {
          const lastHeartbeat = new Date(lobby.lastHeartbeat);
          const timeSince = Math.floor((Date.now() - lobby.lastHeartbeat) / 1000);
          const timeStr = timeSince < 60 ? \`\${timeSince}s ago\` : \`\${Math.floor(timeSince / 60)}m ago\`;
          
          return \`
            <tr class="hover:bg-gray-700/50 transition">
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="font-mono text-sm text-primary">\${lobby.lobbyId}</span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="font-medium">\${lobby.hostName}</span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-400 rounded">\${lobby.region}</span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="font-medium">\${lobby.playerCount}/\${lobby.maxPlayers}</span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                \${lobby.hasPassword 
                  ? '<span class="px-2 py-1 text-xs font-medium bg-yellow-500/20 text-yellow-400 rounded">Yes</span>'
                  : '<span class="px-2 py-1 text-xs font-medium bg-gray-600 text-gray-400 rounded">No</span>'
                }
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="text-sm text-gray-400">\${lobby.version}</span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="text-sm text-gray-400">\${timeStr}</span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <button onclick="deleteLobby('\${lobby.lobbyId}')" class="text-red-400 hover:text-red-300 transition">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                  </svg>
                </button>
              </td>
            </tr>
          \`;
        }).join('');
      } catch (error) {
        console.error('Error fetching lobbies:', error);
      }
    }

    async function refreshData() {
      await Promise.all([fetchStats(), fetchLobbies()]);
    }

    async function deleteLobby(lobbyId) {
      if (!confirm(\`Delete lobby \${lobbyId}?\`)) return;
      
      try {
        const response = await fetch(\`/admin/api/lobbies/\${lobbyId}\`, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          await refreshData();
        } else {
          alert('Failed to delete lobby');
        }
      } catch (error) {
        console.error('Error deleting lobby:', error);
        alert('Error deleting lobby');
      }
    }

    async function cleanupInactive() {
      if (!confirm('Cleanup all inactive lobbies?')) return;
      
      try {
        const response = await fetch('/admin/api/cleanup', {
          method: 'POST'
        });
        
        const data = await response.json();
        alert(\`Cleaned up \${data.removed} inactive lobbies\`);
        await refreshData();
      } catch (error) {
        console.error('Error cleaning up:', error);
        alert('Error cleaning up lobbies');
      }
    }

    async function clearAllLobbies() {
      if (!confirm('⚠️ WARNING: This will delete ALL lobbies! Are you sure?')) return;
      if (!confirm('This action cannot be undone. Continue?')) return;
      
      try {
        const response = await fetch('/admin/api/lobbies/all', {
          method: 'DELETE'
        });
        
        const data = await response.json();
        alert(\`Deleted \${data.removed} lobbies\`);
        await refreshData();
      } catch (error) {
        console.error('Error clearing lobbies:', error);
        alert('Error clearing lobbies');
      }
    }

    function logout() {
      // Basic Auth logout trick
      fetch('/admin', {
        headers: {
          'Authorization': 'Basic ' + btoa('logout:logout')
        }
      }).then(() => {
        window.location.href = '/';
      });
    }

    // Initial load
    refreshData();

    // Auto-refresh every 5 seconds
    setInterval(() => {
      if (autoRefresh) {
        refreshData();
      }
    }, 5000);
  </script>
</body>
</html>
  `);
});

// Admin API endpoints
app.get('/admin/api/stats', adminAuth, async (req, res) => {
  try {
    const lobbyIds = await redisClient.sMembers('lobbies:active');
    let totalPlayers = 0;
    
    for (const lobbyId of lobbyIds) {
      const lobby = await getLobby(lobbyId);
      if (lobby) {
        totalPlayers += lobby.playerCount || 0;
      }
    }
    
    const keys = await redisClient.keys('*');
    
    res.json({
      activeLobbies: lobbyIds.length,
      totalPlayers,
      redisKeys: keys.length
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/admin/api/lobbies', adminAuth, async (req, res) => {
  try {
    const lobbyIds = await redisClient.sMembers('lobbies:active');
    const lobbies = [];
    
    for (const lobbyId of lobbyIds) {
      const lobby = await getLobby(lobbyId);
      if (lobby) {
        // Include password status but not the actual password
        const { password, ...lobbyData } = lobby;
        lobbies.push(lobbyData);
      }
    }
    
    res.json({ lobbies });
  } catch (error) {
    console.error('Error fetching lobbies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/admin/api/lobbies/:lobbyId', adminAuth, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    await deleteLobby(lobbyId);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting lobby:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/admin/api/cleanup', adminAuth, async (req, res) => {
  try {
    const lobbyIds = await redisClient.sMembers('lobbies:active');
    const now = Date.now();
    const timeout = parseInt(process.env.LOBBY_MAX_INACTIVE_MS) || 60000;
    let removed = 0;
    
    for (const lobbyId of lobbyIds) {
      const lobby = await getLobby(lobbyId);
      if (lobby && (now - lobby.lastHeartbeat) > timeout) {
        await deleteLobby(lobbyId);
        removed++;
      }
    }
    
    res.json({ ok: true, removed });
  } catch (error) {
    console.error('Error cleaning up:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/admin/api/lobbies/all', adminAuth, async (req, res) => {
  try {
    const lobbyIds = await redisClient.sMembers('lobbies:active');
    
    for (const lobbyId of lobbyIds) {
      await deleteLobby(lobbyId);
    }
    
    res.json({ ok: true, removed: lobbyIds.length });
  } catch (error) {
    console.error('Error clearing lobbies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get API key (for initial client setup)
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

// Register new lobby
app.post('/api/lobbies', authenticate, async (req, res) => {
  try {
    const { error, value } = schemas.registerLobby.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const { lobbyId, hostName, region, maxPlayers, hasPassword, version, password } = value;
    
    // Check if lobby already exists
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

// Send heartbeat
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
    
    // Verify ownership
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

// Delete lobby
app.delete('/api/lobbies/:lobbyId', authenticate, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    
    const lobby = await getLobby(lobbyId);
    if (!lobby) {
      return res.status(404).json({ error: 'Lobby not found' });
    }
    
    // Verify ownership
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

// Get all lobbies
app.get('/api/lobbies', authenticate, async (req, res) => {
  try {
    const lobbies = await getAllLobbies();
    res.json({ ok: true, lobbies });
  } catch (err) {
    console.error('Error getting lobbies:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check password
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

// Cleanup inactive lobbies
setInterval(async () => {
  try {
    const lobbyIds = await redisClient.sMembers('lobbies:active');
    const now = Date.now();
    const timeout = parseInt(process.env.LOBBY_MAX_INACTIVE_MS) || 60000;
    
    for (const lobbyId of lobbyIds) {
      const lobby = await getLobby(lobbyId);
      if (lobby && (now - lobby.lastHeartbeat) > timeout) {
        console.log(`Cleaning up inactive lobby: ${lobbyId}`);
        await deleteLobby(lobbyId);
      }
    }
  } catch (err) {
    console.error('Error in cleanup task:', err);
  }
}, 30000); // Run every 30 seconds

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await redisClient.quit();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`NeoLobbyst server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
