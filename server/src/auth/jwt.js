import jwt from "jsonwebtoken";

const { JWT_SECRET, JWT_ISS="weave", JWT_AUD="weave-client" } = process.env;

export function signJwt(payload, opts={}) {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: "HS256",
    issuer: JWT_ISS,
    audience: JWT_AUD,
    expiresIn: opts.expiresIn ?? "12h",
  });
}

export function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: JWT_ISS,
    audience: JWT_AUD,
  });
}

import { query } from "../db/index.js";

/**
 * Throws if the user is not an active member of the campaign.
 * Expects a Membership table like:
 *   membership(campaign_id uuid, user_id uuid, role text, is_active boolean default true, ...)
 */
export async function assertMember(campaignId, userId) {
  if (!campaignId || !userId) throw new Error("missing campaign / user");

  const { rows } = await query(
    `select 1
       from membership
      where campaign_id = $1
        and user_id = $2
        and coalesce(is_active, true) = true
      limit 1`,
    [campaignId, userId]
  );

  if (rows.length === 0) {
    throw new Error("membership required");
  }
}
