const express = require("express");
const { exec } = require("child_process");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const TV_IP = "192.168.1.50"; // ILISI sa IP sa imong TV

function adb(cmd, res) {
  exec(`adb connect ${TV_IP} && ${cmd}`, (err) => {
    if (err) return res.status(500).send("Failed");
    res.send("OK");
  });
}

// BASIC KEYS
app.post("/key", (req, res) => {
  adb(`adb shell input keyevent ${req.body.code}`, res);
});

// TEXT INPUT
app.post("/text", (req, res) => {
  adb(`adb shell input text "${req.body.text}"`, res);
});

// APP LAUNCH
app.post("/app", (req, res) => {
  adb(`adb shell monkey -p ${req.body.pkg} -c android.intent.category.LAUNCHER 1`, res);
});

// MOUSE / TOUCH
app.post("/tap", (req, res) => {
  const { x, y } = req.body;
  adb(`adb shell input tap ${x} ${y}`, res);
});

app.listen(3000, () => {
  console.log("Universal Remote Backend running");
});
