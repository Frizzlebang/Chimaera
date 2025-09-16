// server/src/auth/acl.js
import { pool } from "../db/pool.js";

/**
 * Ensures user is still an active member of the campaign.
 * Throws on failure.
 */
export async function assertMember(campaignId, userId) {
  const { rows } = await pool.query(
    `select 1
       from membership
      where campaign_id = $1
        and user_id    = $2
        and is_active  = true
      limit 1`,
    [campaignId, userId]
  );
  if (!rows.length) throw new Error("not a member");
}
