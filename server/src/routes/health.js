import express from "express";
import { pool } from "../db/pool.js"; // use your shared pool

const router = express.Router();

router.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      ok: true,
      db: "up",
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      db: "down",
      error: e.message,
    });
  }
});

export default router;
