import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import rateLimit from "express-rate-limit";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const BASES = [
  "https://api.binance.com",
  "https://croak-express-gateway-henna.vercel.app",
  "https://croak-bot-proxy-three.vercel.app",
  "https://croak-pwa.vercel.app"
];

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Too many requests, slow down." }
});

app.use("/api", apiLimiter);
app.use("/prices", apiLimiter);

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("❌ Invalid JSON:", text.slice(0, 200));
    throw new Error("Invalid JSON response");
  }
}

async function timedFetch(url, ms = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

let currentBase = null;

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

async function getBase() {
  if (!currentBase) {
    currentBase = await detectBase();
  }
  return currentBase;
}

async function proxyRequest(path, ms = 8000) {
  let base = await getBase();
  let url = base + path;

  try {
    const res = await timedFetch(url, ms);
    return await safeJson(res);
  } catch {
    console.warn("⚠️ Base failed, rotating...");
    currentBase = null;
    base = await getBase();
    url = base + path;
    const res = await timedFetch(url, ms);
    return await safeJson(res);
  }
}

app.use("/api/v3/*", async (req, res) => {
  try {
    const data = await proxyRequest(req.originalUrl);
    res.json(data);
  } catch (err) {
    console.error("❌ Proxy error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/prices", async (req, res) => {
  try {
    const data = await proxyRequest("/api/v3/ticker/price");
    res.json(data);
  } catch (err) {
    console.error("❌ /prices error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.json({
    message: "API Proxy Server Running",
    keepalive: "/keep-alive",
    endpoints: ["/prices", "/api/v3/..."],
    limits: "60 requests/minute per IP"
  });
});

app.get("/keep-alive", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 🔹 Internal self-ping (already existing)
const SELF_URL = process.env.SELF_URL || `http://localhost:${PORT}`;
setInterval(async () => {
  try {
    const res = await fetch(`${SELF_URL}/keep-alive`);
    console.log("🔄 Self-ping:", res.status);
  } catch (err) {
    console.error("❌ Self-ping failed:", err.message);
  }
}, 240000);

// 🔹 External keep-alive ping to stay awake on free tier
import https from "https";

const EXTERNAL_SELF_URL = "https://api-server-2-dkuk.onrender.com";

setInterval(() => {
  https.get(`${EXTERNAL_SELF_URL}/keep-alive`, (res) => {
    console.log("🔄 External self-ping:", res.statusCode);
  }).on("error", (err) => {
    console.error("❌ External self-ping failed:", err.message);
  });
}, 5 * 60 * 1000); // every 5 minutes

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
