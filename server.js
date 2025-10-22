import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import https from "https";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ✅ Only use official Binance endpoint
const BASES = ["https://api.binance.com"];

// Helper: safe JSON parsing with clear logs
async function safeJson(res) {
  const text = await res.text();

  if (!res.ok) {
    console.error(`⚠️ Upstream HTTP ${res.status}:`, text.slice(0, 200));
    throw new Error(`Upstream ${res.status}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    console.error("❌ Invalid JSON from upstream:", text.slice(0, 200));
    throw new Error("Invalid JSON response from upstream");
  }
}

// Helper: fetch with timeout
async function timedFetch(url, ms = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// Main proxy handler
async function proxyRequest(path, ms = 8000) {
  const base = BASES[0];
  const url = base + path;
  console.log(`🔁 Proxying → ${url}`);

  const res = await timedFetch(url, ms);
  return await safeJson(res);
}

// ✅ Proxy all Binance API routes
app.use("/api/v3/*", async (req, res) => {
  try {
    const data = await proxyRequest(req.originalUrl);
    res.json(data);
  } catch (err) {
    console.error("❌ Proxy error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Simple price endpoint
app.get("/prices", async (req, res) => {
  try {
    const data = await proxyRequest("/api/v3/ticker/price");
    res.json(data);
  } catch (err) {
    console.error("❌ /prices error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Health check
app.get("/keep-alive", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ✅ Debug route — helps diagnose upstream issues
app.get("/debug", async (req, res) => {
  try {
    const resPing = await timedFetch("https://api.binance.com/api/v3/ping", 5000);
    res.json({
      status: resPing.ok ? "ok" : "failed",
      binanceStatus: resPing.status,
      region: process.env.RENDER_REGION || "local"
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to reach Binance", message: err.message });
  }
});

// 🔹 External keep-alive (optional)
const SELF_URL = process.env.SELF_URL || "https://api-server-2-dkuk.onrender.com";
setInterval(() => {
  https.get(`${SELF_URL}/keep-alive`, res => {
    console.log("🔄 Keep-alive:", res.statusCode);
  }).on("error", err => {
    console.error("❌ Keep-alive failed:", err.message);
  });
}, 5 * 60 * 1000); // every 5 min

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
