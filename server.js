import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Root & ping
app.get("/", (req, res) => res.json({ message: "Binance Relay Running" }));
app.get("/ping", (req, res) => res.send("pong"));

// Relay handler
app.use("/api", async (req, res) => {
  try {
    const targetUrl = `https://api.binance.com${req.originalUrl}`;
    console.log(`🔁 Relaying → ${targetUrl}`);

    // Forward request to Binance with User-Agent header
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        "User-Agent": "Mozilla/5.0", // Binance often blocks requests without this
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();

    // Try to parse JSON, fallback to raw text
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    res.status(response.status).json(data);
  } catch (err) {
    console.error("❌ Relay error:", err.message);
    res.status(500).json({ error: "Failed to fetch from Binance" });
  }
});

app.listen(PORT, () => console.log(`🚀 Relay running on port ${PORT}`));
