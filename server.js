// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// Allow CORS (para ma-access sa front-end)
app.use(cors());

// Root endpoint
app.get("/", (req, res) => {
  res.json({ message: "✅ Binance Relay API Server is running" });
});

// Relay endpoints
const relayEndpoints = [
  "/api/v3/ticker/price",
  "/api/v3/exchangeInfo",
  "/api/v3/depth",
  "/api/v3/klines",
  "/api/v3/ping"
];

// Proxy handler
app.use("/api", async (req, res) => {
  try {
    const targetUrl = `https://api.binance.com${req.originalUrl}`;
    console.log(`🔁 Relaying → ${targetUrl}`);

    const response = await fetch(targetUrl);
    const data = await response.json();

    res.json(data);
  } catch (err) {
    console.error("❌ Relay error:", err.message);
    res.status(500).json({ error: "Failed to fetch from Binance" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
