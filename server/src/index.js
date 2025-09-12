// server/src/index.js (ESM)
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import { Server } from "colyseus";

import { initSchema } from "../db/index.js"; // <-- DB bootstrap (ESM)
import { DemoRoom } from "./rooms/DemoRoom.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) Ensure DB schema exists
await initSchema();

// 2) Express static (serves /public built by client)
const app = express();
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("/health", (_req, res) => res.send("ok"));
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

// 3) Colyseus + HTTP
const server = http.createServer(app);
const gameServer = new Server({ server });
gameServer.define("demo", DemoRoom);

// 4) Listen
const port = process.env.PORT || 2567;
server.listen(port, () => {
  console.log(`[weave-demo] listening on http://localhost:${port}`);
  console.log(`[weave-demo] static served from ${publicDir}`);
});
