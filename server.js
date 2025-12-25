const express = require("express");
const { exec } = require("child_process");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Manual TV IP input (set dynamically via frontend)
let TV_IP = null;

// Set TV IP from frontend
app.post("/set-tv-ip", (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).send("IP required");
  TV_IP = ip;
  res.send("TV IP set to " + TV_IP);
});

// Helper function to run ADB command
function adb(cmd, res) {
  if (!TV_IP) return res.status(500).send("TV IP not set yet");
  exec(`adb connect ${TV_IP} && ${cmd}`, (err) => {
    if (err) return res.status(500).send("Command failed");
    res.send("OK");
  });
}

// Send key command
app.post("/key", (req, res) => {
  const { code } = req.body;
  adb(`adb shell input keyevent ${code}`, res);
});

// Send text input
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

app.listen(process.env.PORT || 3000, () => {
  console.log("Universal Remote Backend running");
});
