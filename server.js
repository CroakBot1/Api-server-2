// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// Allow all origins (public access)
app.use(cors());

// Root endpoint
app.get("/", (req, res) => {
  res.json({ message: "✅ Binance Relay API Server is running (no limit)" });
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} (no limit mode)`);
});
