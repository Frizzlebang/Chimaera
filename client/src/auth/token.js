// client/src/auth/token.js
export function getToken() {
  return localStorage.getItem("weave_token") || "";
}
export function setToken(token) {
  if (token) localStorage.setItem("weave_token", token);
}
export function getCampaignId() {
  return localStorage.getItem("weave_campaignId") || "";
}
export function setCampaignId(campaignId) {
  if (campaignId) localStorage.setItem("weave_campaignId", campaignId);
}
