// client/src/auth/devLogin.js
import { setAuth, setCampaign } from "./token.js";

/**
 * Step 9: single-step join using existing /api/dev/login
 * Body: { email, name, campaignSlug, role }
 * Returns: { token, (maybe campaignId via nested membership) }
 */
export async function devLogin({ email, name, campaignSlug, role }) {
  const res = await fetch("/api/dev/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name, campaignSlug, role }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`devLogin failed (${res.status}): ${text || "unknown error"}`);
  }

  const data = await res.json().catch(() => ({}));

  // Try several shapes for compatibility with current server
  const token =
    data?.token ||
    data?.jwt ||
    data?.access_token ||
    "";

  const campaignId =
    data?.campaignId ||
    data?.campaign?.id ||
    data?.membership?.campaign_id ||
    null;

  const user = {
    id: data?.user?.id || data?.sub || null,
    email,
    name,
  };

  setAuth({ token, user });
  setCampaign({ id: campaignId, slug: campaignSlug, name: data?.campaign?.name || data?.campaign?.title || null, role });

  return { token, campaignId };
}
