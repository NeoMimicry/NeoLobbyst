require("dotenv").config();

const requiredEnvVars = ["JWT_SECRET", "API_KEY_SECRET"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`ERROR: Missing required environment variable: ${envVar}`);
    console.error("Please check your .env file or set the environment variable.");
    process.exit(1);
  }
}

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const { createClient } = require("redis");
const Joi = require("joi");
const crypto = require("crypto");

const app = express();
const port = process.env.PORT || 3000;

// Redis client
let redisClient;
(async () => {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  redisClient = createClient({
    url: redisUrl
  });

  redisClient.on("error", (err) => console.error("Redis Client Error", err));
  await redisClient.connect();
  console.log("Connected to Redis");
})();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"]
  })
);
app.use(express.json({ limit: "10kb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - IP: ${req.ip}`);
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
    password: Joi.string().max(100).allow("", null),
    lobbyName: Joi.string().max(100).allow("", null),
    isPublic: Joi.boolean().default(true),
    source: Joi.string().valid("neolobbyst", "steam").default("neolobbyst")
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
  const signature = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(`${data}:${signature}`).toString("base64");
}

// Verify API key
function verifyApiKey(apiKey) {
  try {
    const decoded = Buffer.from(apiKey, "base64").toString("utf-8");
    const [clientId, timestamp, signature] = decoded.split(":");

    const secret = process.env.API_KEY_SECRET;
    const data = `${clientId}:${timestamp}`;
    const expectedSignature = crypto.createHmac("sha256", secret).update(data).digest("hex");

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
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({ error: "API key required" });
  }

  const verified = verifyApiKey(apiKey);
  if (!verified) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  req.clientId = verified.clientId;
  next();
};

// Generate JWT token
function generateToken(clientId) {
  return jwt.sign({ clientId, type: "client" }, process.env.JWT_SECRET, {
    expiresIn: "24h"
  });
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
  await redisClient.sAdd("lobbies:active", lobbyId);
}

async function getLobby(lobbyId) {
  const key = `lobby:${lobbyId}`;
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
}

async function deleteLobby(lobbyId) {
  const key = `lobby:${lobbyId}`;
  await redisClient.del(key);
  await redisClient.sRem("lobbies:active", lobbyId);
}

async function getAllLobbies() {
  const lobbyIds = await redisClient.sMembers("lobbies:active");
  const lobbies = [];

  for (const lobbyId of lobbyIds) {
    const lobby = await getLobby(lobbyId);
    if (lobby) {
      // Don't expose password
      const { password, ...publicLobby } = lobby;
      lobbies.push(publicLobby);
    } else {
      // Clean up stale reference
      await redisClient.sRem("lobbies:active", lobbyId);
    }
  }

  return lobbies;
}

// API Routes

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Get API key (for initial client setup)
app.post("/api/auth/register", (req, res) => {
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
app.post("/api/lobbies", authenticate, async (req, res) => {
  try {
    const { error, value } = schemas.registerLobby.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { lobbyId, hostName, region, maxPlayers, hasPassword, version, password, lobbyName, isPublic, source } =
      value;

    // Check if lobby already exists
    const existing = await getLobby(lobbyId);
    if (existing) {
      return res.status(409).json({ error: "Lobby already exists" });
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
      clientId: req.clientId,
      lobbyName: lobbyName || `Lobby ${lobbyId.slice(0, 8)}`,
      isPublic,
      source: source || "neolobbyst"
    };

    await saveLobby(lobbyId, lobbyData);

    res.status(201).json({ ok: true, lobbyId });
  } catch (err) {
    console.error("Error registering lobby:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Send heartbeat
app.post("/api/lobbies/:lobbyId/heartbeat", authenticate, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    const { error, value } = schemas.heartbeat.validate(req.body);

    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const lobby = await getLobby(lobbyId);
    if (!lobby) {
      return res.status(404).json({ error: "Lobby not found" });
    }

    // Verify ownership
    if (lobby.clientId !== req.clientId) {
      return res.status(403).json({ error: "Not authorized to update this lobby" });
    }

    lobby.playerCount = value.playerCount;
    lobby.lastHeartbeat = Date.now();

    await saveLobby(lobbyId, lobby);

    res.json({ ok: true });
  } catch (err) {
    console.error("Error sending heartbeat:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete lobby
app.delete("/api/lobbies/:lobbyId", authenticate, async (req, res) => {
  try {
    const { lobbyId } = req.params;

    const lobby = await getLobby(lobbyId);
    if (!lobby) {
      return res.status(404).json({ error: "Lobby not found" });
    }

    // Verify ownership
    if (lobby.clientId !== req.clientId) {
      return res.status(403).json({ error: "Not authorized to delete this lobby" });
    }

    await deleteLobby(lobbyId);

    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting lobby:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all lobbies
app.get("/api/lobbies", authenticate, async (req, res) => {
  try {
    const lobbies = await getAllLobbies();
    res.json({ ok: true, lobbies });
  } catch (err) {
    console.error("Error getting lobbies:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Check password
app.post("/api/lobbies/:lobbyId/check-password", authenticate, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    const { error, value } = schemas.checkPassword.validate(req.body);

    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const lobby = await getLobby(lobbyId);
    if (!lobby) {
      return res.status(404).json({ error: "Lobby not found" });
    }

    const valid = lobby.password === value.password;

    res.json({ ok: true, valid });
  } catch (err) {
    console.error("Error checking password:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Cleanup inactive lobbies
setInterval(async () => {
  try {
    const lobbyIds = await redisClient.sMembers("lobbies:active");
    const now = Date.now();
    const timeout = parseInt(process.env.LOBBY_MAX_INACTIVE_MS) || 60000;

    for (const lobbyId of lobbyIds) {
      const lobby = await getLobby(lobbyId);
      if (lobby && now - lobby.lastHeartbeat > timeout) {
        console.log(`Cleaning up inactive lobby: ${lobbyId}`);
        await deleteLobby(lobbyId);
      }
    }
  } catch (err) {
    console.error("Error in cleanup task:", err);
  }
}, 30000); // Run every 30 seconds

// Error handling
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing server...");
  await redisClient.quit();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`NeoLobbyst server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
