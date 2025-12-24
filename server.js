const express = require("express");
const { exec } = require("child_process");
const cors = require("cors");
const { Client } = require("node-ssdp");

const app = express();
app.use(cors());
app.use(express.json());

let TV_IP = null; // Will be auto-discovered

// SSDP Client
const client = new Client();
client.on("response", (headers, statusCode, rinfo) => {
  if (rinfo.address) {
    TV_IP = rinfo.address; // save first discovered TV IP
    console.log("Discovered TV:", TV_IP);
  }
});

// Scan for TVs every 10 seconds
setInterval(() => {
  client.search("urn:dial-multiscreen-org:service:dial:1"); // Common Android TV SSDP service
}, 10000);

// Helper function to execute ADB commands
function adb(cmd, res) {
  if (!TV_IP) return res.status(500).send("TV not discovered yet");
  exec(`adb connect ${TV_IP} && ${cmd}`, (err) => {
    if (err) return res.status(500).send("Command failed");
    res.send("OK");
  });
}

// Key event
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

// Get discovered TV IP
app.get("/discover", (req, res) => {
  if (!TV_IP) return res.status(404).send("No TV discovered yet");
  res.send({ ip: TV_IP });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Universal Remote Backend running with auto-discovery");
});
