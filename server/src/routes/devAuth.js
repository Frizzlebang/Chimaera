import express from "express";
import { signJwt } from "../auth/jwt.js";
import { pool } from "../db/pool.js"; // your pg pool

const router = express.Router();

/**
 * POST /api/dev/login
 * body: { email, name, campaignSlug }
 * returns: { token }
 */
router.post("/dev/login", async (req, res) => {
  const { email, name, campaignSlug } = req.body ?? {};
  if (!email || !name || !campaignSlug) return res.status(400).json({error:"missing fields"});

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: urows } = await client.query(
      `insert into app_user (email, name)
       values ($1,$2)
       on conflict (email) do update set name=excluded.name
       returning id`, [email, name]
    );
    const userId = urows[0].id;

    const { rows: crows } = await client.query(
      `insert into campaign (slug, title)
       values ($1, initcap(replace($1,'-',' ')))
       on conflict (slug) do update set title=campaign.title
       returning id`, [campaignSlug]
    );
    const campaignId = crows[0].id;

    await client.query(
      `insert into membership (user_id, campaign_id, role)
       values ($1,$2,'owner')
       on conflict do nothing`, [userId, campaignId]
    );

    await client.query("COMMIT");

    const token = signJwt({
      sub: userId,
      email,
      name,
      campaign_id: campaignId,
      campaign_slug: campaignSlug,
      roles: ["owner"],
      // room-level gating convenience
      perms: { join_demo: true }
    });
    res.json({ token });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({error: e.message});
  } finally {
    client.release();
  }
});

export default router;
