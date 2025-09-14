// src/routes/devAuth.js
import express from "express";
import { pool } from "../db/pool.js";
import { signJwt } from "../auth/jwt.js"; // assumes you export signJwt({ sub, ... })

const router = express.Router();

/**
 * POST /api/dev/login
 * body: { email: string, name?: string, campaignSlug?: string, role?: 'owner'|'dm'|'player'|'viewer' }
 * returns: { token, user: { id, email, name }, campaign?: { id, slug, title }, membership?: { role } }
 */
router.post("/dev/login", async (req, res) => {
  const { email, name, campaignSlug, role } = req.body || {};

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Upsert user
    const userQ = await client.query(
      `INSERT INTO app_user (email, name)
       VALUES ($1, COALESCE($2, split_part($1,'@',1)))
       ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, app_user.name)
       RETURNING id, email, name`,
      [email, name || null]
    );
    const user = userQ.rows[0];

    let campaign = null;
    let finalRole = role || "owner";

    // 2) Optionally ensure campaign + membership
    if (campaignSlug) {
      const campQ = await client.query(
        `INSERT INTO campaign (slug, title, created_by)
         VALUES ($1, initcap(replace($1,'-',' ')), $2)
         ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
         RETURNING id, slug, title`,
        [campaignSlug, user.id]
      );
      campaign = campQ.rows[0];

      // default role safety
      if (!["owner", "dm", "player", "viewer"].includes(finalRole)) {
        finalRole = "owner";
      }

      await client.query(
        `INSERT INTO membership (user_id, campaign_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, campaign_id) DO UPDATE SET role = GREATEST(membership.role::text, EXCLUDED.role::text)::campaign_role`,
        [user.id, campaign.id, finalRole]
      );
    }

    await client.query("COMMIT");

    // 3) Sign JWT (include campaign_id when present)
    const token = signJwt({
      sub: user.id,
      email: user.email,
      name: user.name,
      campaign_id: campaign ? campaign.id : null, // Changed from undefined to null
    });

    // Always return campaignId, even if null
    // After you build `campaign`
    const response = {
      token,
      user,
      campaignId: campaign ? campaign.id : null,
    };

    if (campaign) {
      response.campaign = {
        id: campaign.id,
        slug: campaign.slug,
        title: campaign.title,
      };
      response.membership = { role: finalRole };
    }

    res.json(response);
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;