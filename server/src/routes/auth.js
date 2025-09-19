// server/src/routes/auth.js
import express from "express";
import { pool } from "../db/pool.js";
import { signJwt } from "../auth/jwt.js";

const router = express.Router();

/**
 * POST /api/auth/dev-login
 * body: { email: string, name?: string }
 * returns: { token, user: { id, email, name } }
 *
 * Issues an identity-only JWT (no campaign_id, no role).
 */
router.post("/dev-login", async (req, res) => {
  const { email, name } = req.body || {};
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userQ = await client.query(
      `INSERT INTO app_user (email, name)
       VALUES ($1, COALESCE($2, split_part($1,'@',1)))
       ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, app_user.name)
       RETURNING id, email, name`,
      [email, name || null]
    );
    const user = userQ.rows[0];

    await client.query("COMMIT");

    const token = signJwt({
      sub: user.id,
      email: user.email,
      name: user.name,
      // NOTE: no campaign_id, no role on this identity token
    });

    res.json({ token, user });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;
