// server/src/index.js (ESM)
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import http from "node:http";
import express from "express";
import pkg from "colyseus";
const { Server } = pkg;

import { pool } from "./db/pool.js";
import { initSchema } from "./db/index.js";
import { DemoRoom } from "./rooms/DemoRoom.js";
import devAuthRouter from "./routes/devAuth.js";

import authRouter from "./routes/auth.js";
import campaignsRouter from "./routes/campaigns.js";


// __dirname in ESM + env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

console.log("[env] loaded .env");
console.log("[DEBUG] DATABASE_URL =", process.env.DATABASE_URL);

// Express
const app = express();
app.set("trust proxy", 1);
app.use(express.json());

// --- CORS ---
const PROD_ORIGINS = [
  "https://weave.playweave.online",
];

// allow localhost:* and 127.0.0.1:* in dev
const DEV_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
// optional override to open everything in dev
const ALLOW_ALL = process.env.CORS_ALLOW_ALL === "1";

app.use(cors({
  credentials: true,
  origin(origin, cb) {
    if (ALLOW_ALL) return cb(null, true);            // explicit dev override
    if (!origin) return cb(null, true);              // curl, same-origin navs, ws upgrade probes

    if (PROD_ORIGINS.includes(origin)) return cb(null, true);
    if (DEV_ORIGIN_REGEX.test(origin)) return cb(null, true); // http://localhost:2567, :5173, etc.

    return cb(new Error("Not allowed by CORS"));
  }
}));

// preflight
app.options("*", cors());

// Ensure DB schema exists
await initSchema();

// Health
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up", time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, db: "down", error: e.message });
  }
});

// API routes BEFORE static/catch-all
app.use("/api/auth", authRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api", devAuthRouter); // keep the old one-step dev route for convenience

// Static & SPA catch-all
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("/health", (_req, res) => res.send("ok"));
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
