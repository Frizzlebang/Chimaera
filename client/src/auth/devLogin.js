// client/src/auth/devLogin.js
import { setToken, setCampaignId } from "./token";

export async function devLogin({
  email = "dev@example.com",
  name = "Dev",
  campaignSlug = "demo-campaign",
  role = "owner",
} = {}) {
  console.log("🔍 devLogin called with:", { email, name, campaignSlug, role });
  
  const res = await fetch("/api/dev/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name, campaignSlug, role }),
  });

  // Handle both shapes: {token} or {token, campaign:{id}} etc.
  const data = await res.json();
  console.log("🔍 Backend response:", data);
  
  const token = data?.token || data?.accessToken || "";
  const campaignId =
    data?.campaignId ||
    data?.campaign?.id ||
    data?.membership?.campaign_id ||
    "";

  console.log("🔍 Extracted values:", { token: !!token, campaignId });

  setToken(token);
  if (campaignId) {
    setCampaignId(campaignId);
    console.log("✅ Campaign ID set:", campaignId);
  } else {
    console.error("❌ No campaign ID found in response");
  }

  return { token, campaignId };
}