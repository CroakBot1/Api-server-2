const express = require("express");
const { exec } = require("child_process");
const cors = require("cors");
const ping = require("ping");

const app = express();
app.use(cors());
app.use(express.json());

let TV_IP = null;

// Helper function to run ADB command
function adb(cmd, res) {
  if (!TV_IP) return res.status(500).send("TV not connected yet");
  exec(`adb connect ${TV_IP} && ${cmd}`, (err) => {
    if (err) return res.status(500).send("Command failed");
    res.send("OK");
  });
}

// Scan local network for TVs (simple ping scan 192.168.1.1-254)
app.get("/scan", async (req, res) => {
  const baseIP = "192.168.1."; // Adjust to your LAN
  const promises = [];
  const devices = [];
  for (let i = 1; i <= 254; i++) {
    promises.push(
      ping.promise.probe(baseIP + i, { timeout: 1 }).then((info) => {
        if (info.alive) devices.push({ ip: baseIP + i });
      })
    );
  }
  await Promise.all(promises);
  res.send(devices);
});

// Connect to selected TV IP
app.post("/connect", (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).send("IP required");
  TV_IP = ip;
  res.send("Connected to " + TV_IP);
});

// Key command
app.post("/key", (req, res) => {
  const { code } = req.body;
  adb(`adb shell input keyevent ${code}`, res);
});

// Text input
app.post("/text", (req, res) => {
  const { text } = req.body;
  adb(`adb shell input text "${text}"`, res);
});

// Launch app
app.post("/app", (req, res) => {
  const { pkg } = req.body;
  adb(`adb shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, res);
});

// Tap coordinates
app.post("/tap", (req, res) => {
  const { x, y } = req.body;
  adb(`adb shell input tap ${x} ${y}`, res);
});

app.listen(3000, () => {
  console.log("Local Universal Remote Backend running on port 3000");
});
