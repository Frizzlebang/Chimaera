// server/src/index.js (ESM)
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db/pool.js";
import cors from "cors";

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

// Express
const app = express();
app.set("trust proxy", 1);
app.use(express.json());

// allowedOrigins
const allowedOrigins = [
  "http://localhost:5173",
  "https://weave.playweave.online",
];

// server CORS / allowed origins
app.use(
  cors({
    origin(origin, cb) {
      // allow non-browser tools (no Origin header) and known origins
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// good practice for preflight
app.options("*", cors());
// Ensure DB schema exists
await initSchema();

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up", time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, db: "down", error: e.message });
  }
});

// API routes BEFORE static/catch-all
app.use("/api", devAuthRouter);

// Static & SPA catch-all (after /api routes)
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("/health", (_req, res) => res.send("ok")); // optional simple check
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

// Colyseus + HTTP
const httpServer = http.createServer(app);
const gameServer = new Server({ server: httpServer });

// Define rooms (per-campaign isolation)
gameServer.define("demo", DemoRoom).filterBy(["campaignId"]);

// Listen
const port = process.env.PORT || 2567;
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`[server] listening on 0.0.0.0:${port}`);
});