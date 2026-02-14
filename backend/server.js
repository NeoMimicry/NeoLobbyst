const express = require("express");
const bodyParser = require("body-parser");

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.post("/api/lobbies", (req, res) => {
  res.status(201).json({ ok: true });
});

app.post("/api/lobbies/:lobbyId/heartbeat", (req, res) => {
  res.json({ ok: true });
});

app.delete("/api/lobbies/:lobbyId", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/lobbies", (req, res) => {
  res.json({ ok: true, lobbies: [] });
});

app.post("/api/lobbies/:lobbyId/check-password", (req, res) => {
  res.json({ ok: true, valid: false });
});

app.listen(port, () => {
  console.log(`port ${port}`);
});