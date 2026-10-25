import express from "express";
import { createServer } from "node:http";

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Serve public static assets
app.use(express.static("public"));

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ ok: true, mode: "serverless-webrtc-static" });
});

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile("index.html", { root: "public" });
});

server.listen(PORT, () => {
  console.log(`Grid Thief dev server active at http://localhost:${PORT}`);
});
