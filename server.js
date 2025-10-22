// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { AbortController } from "abort-controller";
import rateLimit from "express-rate-limit"; // ✅ new

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🔹 Bases (Binance + your fallbacks)
const BASES = [
  "https://api.binance.com",
  "https://croak-express-gateway-henna.vercel.app",
  "https://croak-bot-proxy-three.vercel.app",
  "https://croak-pwa.vercel.app"
];

// 🔹 Rate limiter (per IP)
// Example: max 60 requests per minute per IP (tweak as needed)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute window
  max: 60,              // limit each IP to 60 requests per minute
  message: { error: "Too many requests, slow down." }
});

// Apply limiter only to API routes (not keep-alive)
app.use("/api", apiLimiter);
app.use("/prices", apiLimiter);

// 🔹 Helper: safe JSON parse
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("❌ Not valid JSON:", text.slice(0, 200));
    throw new Error("Invalid JSON response");
  }
}

// 🔹 Timed fetch (with AbortController)
async function timedFetch(url, ms = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// 🔹 Detect first working base
async function detectBase() {
  for (let base of BASES) {
    try {
      const res = await timedFetch(`${base}/api/v3/ping`, 5000);
      if (res.ok) {
        console.log("✅ Using base:", base);
        return base;
      }
    } catch (err) {
      console.error("❌ Failed base:", base, err.message);
    }
  }
  throw new Error("No working base found.");
}

// 🔹 Cache current base (auto-rotate if fail)
let currentBase = null;

async function getBase() {
  if (!currentBase) {
    currentBase = await detectBase();
  }
  return currentBase;
}

// 🔹 Generic proxy handler for Binance REST API
app.use("/api/v3/*", async (req, res) => {
  try {
    let base = await getBase();
    let targetUrl = base + req.originalUrl;

    let resp;
    try {
      resp = await timedFetch(targetUrl, 8000);
    } catch (err) {
      console.warn("⚠️ Base failed, rotating...");
      currentBase = null;
      base = await getBase();
      targetUrl = base + req.originalUrl;
      resp = await timedFetch(targetUrl, 8000);
    }

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`❌ Upstream error [${resp.status}]:`, errText.slice(0, 200));
      return res.status(resp.status).send(errText);
    }

    const data = await safeJson(resp);
    res.json(data);
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Shortcut for /prices
app.get("/prices", async (req, res) => {
  try {
    let base = await getBase();
    const resp = await timedFetch(`${base}/api/v3/ticker/price`, 8000);
    const data = await safeJson(resp);
    res.json(data);
  } catch (err) {
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
