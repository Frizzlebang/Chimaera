// client/src/auth/token.js

const AUTH_KEY = "weave.auth";
const CAMPAIGN_KEY = "weave.campaign";

// --- Storage helpers ---
export function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); }
  catch { return null; }
}
export function setAuth(auth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth || null));
}
export function getCampaign() {
  try { return JSON.parse(localStorage.getItem(CAMPAIGN_KEY) || "null"); }
  catch { return null; }
}
export function setCampaign(camp) {
  localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(camp || null));
}
export function clearAll() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(CAMPAIGN_KEY);
}

// --- Token helpers ---
export function getToken() {
  const a = getAuth();
  return a?.token || "";
}

export function maskedToken() {
  const t = getToken();
  if (!t) return "";
  return `${t.slice(0, 12)}…${t.slice(-6)}`;
}

// UX-only `exp` check. Server is still authoritative.
export function isTokenExpired(token) {
  if (!token) return true;
  try {
    const b64 = token.split(".")[1];
    const json = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json);
    const exp = typeof payload.exp === "number" ? payload.exp : 0;
    const now = Math.floor(Date.now() / 1000);
    return exp > 0 && exp <= now;
  } catch {
    return true;
  }
}
