// server/src/index.js (ESM)
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db/pool.js";

// Create __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

console.log("[env] loaded .env");
console.log("[DEBUG] DATABASE_URL =", process.env.DATABASE_URL);

// --- core imports ---
import http from "node:http";
import express from "express";
import pkg from "colyseus";
const { Server } = pkg;

import { initSchema } from "./db/index.js";
import { DemoRoom } from "./rooms/DemoRoom.js";
import devAuthRouter from "./routes/devAuth.js";


// 1) Ensure DB schema exists
await initSchema();

// 2) Express
const app = express();
app.set("trust proxy", 1);
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up", time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, db: "down", error: e.message });
  }
});

// 3) API routes BEFORE static/catch-all
app.use("/api", devAuthRouter);

// 4) Static & SPA catch-all
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("/health", (_req, res) => res.send("ok"));
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

// 5) Colyseus + HTTP
const server = http.createServer(app);
const gameServer = new Server({ server });

// Per-campaign isolation: ensure 1 room "demo" per campaignId bucket
gameServer
  .define("demo", DemoRoom)
  .filterBy(["campaignId"]);

// 6) Listen
const port = process.env.PORT || 2567;
server.listen(port, () => {
  console.log(`[weave-demo] listening on http://localhost:${port}`);
  console.log(`[weave-demo] static served from ${publicDir}`);
});