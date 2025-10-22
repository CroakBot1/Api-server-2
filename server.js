// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import rateLimit from "express-rate-limit";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🔹 Bases (Binance + fallbacks)
const BASES = [
  "https://api.binance.com",
  "https://croak-express-gateway-henna.vercel.app",
  "https://croak-bot-proxy-three.vercel.app",
  "https://croak-pwa.vercel.app"
];

// 🔹 Rate limiter (per IP)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // max 60 requests per IP per window
  message: { error: "Too many requests, slow down." }
});

// Apply limiter to API routes
app.use("/api", apiLimiter);
app.use("/prices", apiLimiter);

// 🔹 Helper: safe JSON parse
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("❌ Invalid JSON:", text.slice(0, 200));
    throw new Error("Invalid JSON response");
  }
}

// 🔹 Timed fetch with AbortController (Node 25+ built-in)
async function timedFetch(url, ms = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// 🔹 Cache current working base
let currentBase = null;

// 🔹 Detect first working base
async function detectBase() {
  for (const base of BASES) {
    try {
      const res = await timedFetch(`${base}/api/v3/ping`, 5000);
      if (res.ok) {
        console.log("✅ Using base:", base);
        return base;
      }
    } catch (err) {
      console.warn("❌ Base failed:", base, err.message);
    }
  }
  throw new Error("No working base found.");
}

// 🔹 Get base (with caching)
async function getBase() {
  if (!currentBase) {
    currentBase = await detectBase();
  }
  return currentBase;
}

// 🔹 Generic proxy helper with automatic base rotation
async function proxyRequest(path, ms = 8000) {
  let base = await getBase();
  let url = base + path;

  try {
    const res = await timedFetch(url, ms);
    return await safeJson(res);
  } catch (err) {
    console.warn("⚠️ Base failed, rotating...");
    currentBase = null;           // force rotation
    base = await getBase();
    url = base + path;
    const res = await timedFetch(url, ms);
    return await safeJson(res);
  }
}

// 🔹 API proxy route
app.use("/api/v3/*", async (req, res) => {
  try {
    const data = await proxyRequest(req.originalUrl);
    res.json(data);
  } catch (err) {
    console.error("❌ Proxy error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Shortcut /prices route
app.get("/prices", async (req, res) => {
  try {
    const data = await proxyRequest("/api/v3/ticker/price");
    res.json(data);
  } catch (err) {
    console.error("❌ /prices error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Root route
app.get("/", (req, res) => {
  res.json({
    message: "API Proxy Server Running",
    keepalive: "/keep-alive",
    endpoints: ["/prices", "/api/v3/..."],
    limits: "60 requests/minute per IP"
  });
});

// 🔹 Keep-alive
app.get("/keep-alive", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 🔹 Self-ping every 4 minutes
const SELF_URL = process.env.SELF_URL || `http://localhost:${PORT}`;
setInterval(async () => {
  try {
    const res = await fetch(`${SELF_URL}/keep-alive`);
    console.log("🔄 Self-ping:", res.status);
  } catch (err) {
    console.error("❌ Self-ping failed:", err.message);
  }
}, 240000);

// 🔹 Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
