// server.js — upgraded (cache | retry | queue | dedupe + auto self-ping fix)
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { AbortController } from "abort-controller";
import rateLimit from "express-rate-limit";

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

/* ---------- Config ---------- */
const BASES = [
  "https://api.binance.com",
  "https://croak-express-gateway-henna.vercel.app",
  "https://croak-bot-proxy-three.vercel.app",
  "https://croak-pwa.vercel.app"
];

const API_RATE_LIMIT_PER_MIN = Number(process.env.API_RATE_LIMIT_PER_MIN) || 60;
const MAX_CONCURRENT_UPSTREAM = Number(process.env.MAX_CONCURRENT_UPSTREAM) || 5;
const DEFAULT_CACHE_TTL_MS = Number(process.env.DEFAULT_CACHE_TTL_MS) || 10_000; // 10s
const IN_FLIGHT_TTL_MS = 5_000; // coalescing window
const LOCAL_WHITELIST = (process.env.LOCAL_WHITELIST || "127.0.0.1,::1").split(",");

/* ---------- Rate limiter ---------- */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => (LOCAL_WHITELIST.includes(req.ip) ? API_RATE_LIMIT_PER_MIN * 10 : API_RATE_LIMIT_PER_MIN),
  message: { error: "Too many requests, slow down." },
});
app.use("/api", apiLimiter);
app.use("/prices", apiLimiter);

/* ---------- Utilities: cache & in-flight dedupe ---------- */
const cache = new Map();
const inFlight = new Map();

function setCache(key, data, ttl = DEFAULT_CACHE_TTL_MS) {
  cache.set(key, { data, expire: Date.now() + ttl });
}
function getCache(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() > v.expire) {
    cache.delete(key);
    return null;
  }
  return v.data;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (v.expire <= now) cache.delete(k);
  for (const [k, v] of inFlight) if (v.expire <= now) inFlight.delete(k);
}, 60_000);

/* ---------- safeJson & timedFetch ---------- */
async function safeJson(res) {
  const text = await res.text();
  if (!text || text.trim().startsWith("<")) {
    throw new Error(`Invalid upstream response (${text.slice(0, 200)})`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("❌ Not valid JSON:", text.slice(0, 200));
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

/* ---------- Retry queue & fetchWithRetry ---------- */
let activeRequests = 0;
const queue = [];
function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    processQueue();
  });
}
function processQueue() {
  if (activeRequests >= MAX_CONCURRENT_UPSTREAM || queue.length === 0) return;
  const { fn, resolve, reject } = queue.shift();
  activeRequests++;
  fn()
    .then((r) => resolve(r))
    .catch((e) => reject(e))
    .finally(() => {
      activeRequests--;
      setImmediate(processQueue);
    });
}

async function fetchWithRetry(url, { timeout = 8000 } = {}, retries = 3, baseDelay = 600) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await timedFetch(url, timeout);
      if (res.ok) return res;
      if (res.status >= 500 && res.status < 600) throw new Error(`Upstream HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = baseDelay * 2 ** attempt;
      console.warn(`⏳ fetchWithRetry: attempt ${attempt + 1}/${retries} after ${wait}ms -> ${url}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/* ---------- Base detection & rotation ---------- */
let currentBase = null;
let lastGoodBase = null;

async function detectBase() {
  for (const base of BASES) {
    try {
      const res = await timedFetch(`${base}/api/v3/ping`, 5000);
      if (res && res.ok) {
        console.log("✅ Using base:", base);
        return base;
      }
    } catch (err) {
      console.warn("❌ detectBase failed for", base, err.message);
    }
  }
  throw new Error("No working base found");
}

async function getBase() {
  if (currentBase) return currentBase;
  try {
    currentBase = await detectBase();
    lastGoodBase = currentBase;
  } catch (err) {
    console.warn("⚠️ detectBase failed; falling back to lastGoodBase:", lastGoodBase);
    if (lastGoodBase) return lastGoodBase;
    throw err;
  }
  return currentBase;
}

/* ---------- requestCached: coalesce + cache + queue ---------- */
async function requestCached(path, { cacheTtl = DEFAULT_CACHE_TTL_MS, timeout = 8000 } = {}) {
  const key = path;
  const cached = getCache(key);
  if (cached) return { from: "cache", data: cached };
  const infl = inFlight.get(key);
  if (infl && Date.now() < infl.expire) return infl.promise;

  const promise = (async () => {
    const result = await enqueue(async () => {
      let base = await getBase();
      let url = base + path;
      let resp;
      try {
        resp = await fetchWithRetry(url, { timeout }, 3, 600);
      } catch (err) {
        console.warn("⚠️ base failed, rotating and retrying:", err.message);
        currentBase = null;
        base = await getBase();
        url = base + path;
        resp = await fetchWithRetry(url, { timeout }, 2, 800);
      }

      if (!resp.ok) {
        const txt = await resp.text();
        const upstream = { status: resp.status, detail: txt.slice(0, 200), base };
        const e = new Error(`Upstream ${resp.status}`);
        e.upstream = upstream;
        throw e;
      }

      const data = await safeJson(resp);
      setCache(key, data, cacheTtl);
      return { from: "upstream", data };
    });
    return result;
  })();

  inFlight.set(key, { promise, expire: Date.now() + IN_FLIGHT_TTL_MS });
  promise.finally(() => setTimeout(() => inFlight.delete(key), 50));
  return promise;
}

/* ---------- Proxy route: /api/v3/* ---------- */
app.use("/api/v3/*", async (req, res) => {
  try {
    const path = req.originalUrl.replace(/^\/api/, "");
    const cacheTtl = path.includes("/klines")
      ? 5_000
      : path.includes("/ticker/price")
      ? 15_000
      : DEFAULT_CACHE_TTL_MS;

    const result = await requestCached(path, { cacheTtl, timeout: 8000 });
    res.json(result.data);
  } catch (err) {
    if (err.upstream) {
      console.error("❌ Upstream error:", err.upstream);
      return res.status(err.upstream.status || 502).json({
        error: "Upstream error",
        detail: err.upstream.detail,
        base: err.upstream.base,
      });
    }
    console.error("❌ Server error:", err.stack || err.message);
    res.status(500).json({ error: err.message, hint: "timeout, upstream, or fallback exhausted" });
  }
});

/* ---------- /prices endpoint (cached) ---------- */
app.get("/prices", async (req, res) => {
  try {
    const d = await requestCached("/api/v3/ticker/price", { cacheTtl: 15_000, timeout: 6000 });
    res.json(d.data);
  } catch (err) {
    console.error("❌ /prices error:", err.stack || err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------- Health & keep-alive ---------- */
app.get("/", (req, res) => {
  res.json({
    message: "API Proxy Running (cache+retry+queue)",
    endpoints: ["/prices", "/api/v3/..."],
    config: { API_RATE_LIMIT_PER_MIN, MAX_CONCURRENT_UPSTREAM, DEFAULT_CACHE_TTL_MS },
  });
});
app.get("/keep-alive", (req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

/* ---------- Self-ping ---------- */
const SELF_URL =
  process.env.SELF_URL ||
  "https://api-server-2-dkuk.onrender.com"; // ✅ force live Render URL by default

setInterval(async () => {
  try {
    const r = await fetch(`${SELF_URL}/keep-alive`);
    console.log("🔄 Self-ping:", r.status);
  } catch (err) {
    console.warn("❌ Self-ping failed:", err.message);
  }
}, 240000);

/* ---------- Start ---------- */
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
