// server/src/routes/campaigns.js
import express from "express";
import { pool } from "../db/pool.js";
import { signJwt, verifyJwt } from "../auth/jwt.js";

const router = express.Router();

function getBearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}

const VALID_ROLES = new Set(["owner", "dm", "player", "viewer"]);

/**
 * POST /api/campaigns/join
 * headers: Authorization: Bearer <identity-token>
 * body: { campaignSlug: string, role?: 'owner'|'dm'|'player'|'viewer' }
 *
 * Ensures campaign + membership, then returns an upgraded JWT
 * that includes { campaign_id, role }.
 */
router.post("/join", async (req, res) => {
  const token = getBearer(req);
  if (!token) return res.status(401).json({ error: "missing bearer token" });

  let identity;
  try {
    identity = verifyJwt(token); // must at least have sub/email/name
  } catch (e) {
    return res.status(401).json({ error: "invalid token" });
  }

  const { campaignSlug, role } = req.body || {};
  if (!campaignSlug || typeof campaignSlug !== "string") {
    return res.status(400).json({ error: "campaignSlug required" });
  }

  // sanitize role (default to "owner" if explicitly requested; otherwise "player")
  let requestedRole = role && VALID_ROLES.has(role) ? role : "player";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Ensure campaign (upsert by slug)
    const campQ = await client.query(
      `INSERT INTO campaign (slug, title, created_by)
       VALUES ($1, initcap(replace($1,'-',' ')), $2)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
       RETURNING id, slug, title`,
      [campaignSlug, identity.sub]
    );
    const campaign = campQ.rows[0];

    // 2) Ensure membership (use same promotion logic you had in devAuth)
    await client.query(
      `INSERT INTO membership (user_id, campaign_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, campaign_id)
       DO UPDATE SET role = GREATEST(membership.role::text, EXCLUDED.role::text)::campaign_role`,
      [identity.sub, campaign.id, requestedRole]
    );

    await client.query("COMMIT");

    // 3) Upgrade token with campaign_id + role
    const upgraded = signJwt({
      sub: identity.sub,
      email: identity.email,
      name: identity.name,
      campaign_id: campaign.id,
      role: requestedRole,
    });

    res.json({
      token: upgraded,
      user: { id: identity.sub, email: identity.email, name: identity.name },
      campaign: { id: campaign.id, slug: campaign.slug, title: campaign.title },
      membership: { role: requestedRole },
    });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;
