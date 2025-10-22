// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;
const SELF_URL = "https://api-server-2-dkuk.onrender.com"; // your deployed link

// Allow all origins (public access)
app.use(cors());

// Root endpoint
app.get("/", (req, res) => {
  res.json({ message: "✅ Binance Relay API Server is running (no limit)" });
});

// ✅ Keep-alive ping endpoint (for external cron jobs)
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// List of Binance endpoints to relay
const relayEndpoints = [
  "/api/v3/ticker/price",
  "/api/v3/exchangeInfo",
  "/api/v3/depth",
  "/api/v3/klines",
  "/api/v3/ping"
];

// Relay handler — all requests under /api/*
app.use("/api", async (req, res) => {
  try {
    const targetUrl = `https://api.binance.com${req.originalUrl}`;
    console.log(`🔁 Relaying → ${targetUrl}`);

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.text();

    // Forward Binance headers if needed
    res.setHeader("Content-Type", "application/json");
    res.status(response.status).send(data);
  } catch (err) {
    console.error("❌ Relay error:", err.message);
    res.status(500).json({ error: "Failed to fetch from Binance" });
  }
});

// Optional: Self-ping every 5 minutes (only if not on Render free tier)
// This helps if hosted elsewhere like VPS
// setInterval(() => {
//   fetch(`${SELF_URL}/ping`)
//     .then(() => console.log("💓 Self-ping success"))
//     .catch(err => console.error("❌ Self-ping failed:", err.message));
// }, 5 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} (no limit mode)`);
});
