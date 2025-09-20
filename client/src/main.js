import { devLogin } from "./auth/devLogin.js";
import {
  getAuth, setAuth, getCampaign, setCampaign,
  getToken, isTokenExpired, clearAll
} from "./auth/token.js";
import { joinDemoRoom } from "./net/joinDemo.js";
import "./tailwind.css";

// ------- DOM -------
const form = document.getElementById("joinForm");
const emailEl = document.getElementById("email");
const nameEl = document.getElementById("name");
const slugEl = document.getElementById("campaignSlug");
const roleEl = document.getElementById("role");
const joinBtn = document.getElementById("joinBtn");
const logoutBtn = document.getElementById("logoutBtn");
const banner = document.getElementById("sessionBanner");
const authInfo = document.getElementById("authInfo");
const connDot = document.getElementById("connDot");
const playersTable = document.getElementById("players").querySelector("tbody");
const logBox = document.getElementById("log");

// ------- State machine -------
const STATE = {
  LOGGED_OUT: "logged_out",
  LOGGING_IN: "logging_in",
  AUTHENTICATED: "authd",
  CAMPAIGN_SELECTED: "campaign_selected",
  ROOM_CONNECTED: "connected",
  EXPIRED: "expired",
};

let room = null;

// Prefer upgraded token from Dev Dock if present and valid
function maybeAdoptUpgradedToken() {
  try {
    const upgraded = localStorage.getItem("JWT_UPGRADED");
    if (!upgraded) return;

    if (!isTokenExpired(upgraded)) {
      const auth = getAuth() || {};
      // Only replace if different, so we don't thrash storage unnecessarily
      if (auth.token !== upgraded) {
        setAuth({ ...auth, token: upgraded });
        log("Adopted upgraded token from Dev Dock.");
      }
    }
  } catch { /* noop */ }
}

function setDot(state) {
  connDot.className = "status dot--" + state;

  const statusText = connDot.querySelector(".status-text");
  if (statusText) {
    switch (state) {
      case STATE.LOGGED_OUT:       statusText.textContent = "disconnected"; break;
      case STATE.LOGGING_IN:       statusText.textContent = "connecting";   break;
      case STATE.AUTHENTICATED:    statusText.textContent = "authenticated";break;
      case STATE.CAMPAIGN_SELECTED:statusText.textContent = "ready";        break;
      case STATE.ROOM_CONNECTED:   statusText.textContent = "connected";    break;
      case STATE.EXPIRED:          statusText.textContent = "expired";      break;
      default:                     statusText.textContent = "unknown";
    }
  }
}

function setBanner(msg, type) {
  if (!msg) {
    banner.classList.add("hidden");
    banner.textContent = "";
    return;
  }
  banner.className = "banner " + (type || "");
  banner.textContent = msg;
  banner.classList.remove("hidden");
}

function log(msg) {
  const now = new Date().toLocaleTimeString();
  logBox.textContent = `[${now}] ${msg}\n` + logBox.textContent;
}

// ------- Guarded action -------
async function guarded(action) {
  const token = getToken();
  if (isTokenExpired(token)) {
    setDot(STATE.EXPIRED);
    setBanner("Session expired — please re-join.", "expired");
    throw new Error("SESSION_EXPIRED");
  }
  return action();
}

// ------- UI helpers -------
function hydrateFromStorage() {
  // If Dev Dock already upgraded the token, adopt it
  maybeAdoptUpgradedToken();

  const auth = getAuth();
  const camp = getCampaign();
  if (auth?.user?.email) emailEl.value = auth.user.email;
  if (auth?.user?.name) nameEl.value = auth.user.name;
  if (camp?.slug) slugEl.value = camp.slug;
  if (camp?.role) roleEl.value = camp.role;

  if (auth?.token) {
    if (isTokenExpired(auth.token)) {
      setDot(STATE.EXPIRED);
      setBanner("Session expired — please re-join.", "expired");
      authInfo.textContent = "";
    } else {
      setDot(STATE.AUTHENTICATED);
      authInfo.textContent = `Signed in as ${auth.user?.name || "?"} • token active`;
    }
  } else {
    setDot(STATE.LOGGED_OUT);
    authInfo.textContent = "";
  }
}

function clearRoster() {
  playersTable.innerHTML = `<tr class="empty-state"><td colspan="4">No players connected</td></tr>`;
}

function renderRoster(state) {
  if (!state?.players) return;
  const entries = Array.from(state.players).map(([id, p]) => p);
  if (!entries.length) {
    clearRoster();
    return;
  }
  playersTable.innerHTML = entries.map(p =>
    `<tr>
      <td>${escapeHtml(p.name || "—")}</td>
      <td>${p.hp ?? "—"}</td>
      <td>${p.xp ?? "—"}</td>
      <td>${escapeHtml(p.role || "—")}</td>
    </tr>`
  ).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[m]
  ));
}

// ------- Events -------
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailEl.value.trim();
  const name = nameEl.value.trim();
  const campaignSlug = slugEl.value.trim();
  const role = roleEl.value;

  if (!email || !name || !campaignSlug || !role) {
    setBanner("Please fill all fields.", "error");
    return;
  }

  try {
    joinBtn.disabled = true;
    setBanner("");
    setDot(STATE.LOGGING_IN);

    // Step 9 (legacy single-step for the public form):
    // POST /api/dev/login (includes slug + role)
    const { token, campaignId } = await devLogin({ email, name, campaignSlug, role });

    // Persist auth + campaign
    const auth = getAuth() || {};
    const camp = getCampaign() || {};
    setAuth({ ...auth, user: { email, name, id: auth?.user?.id || null }, token });
    setCampaign({ ...camp, slug: campaignSlug, role, id: campaignId || camp.id || null });

    if (isTokenExpired(token)) {
      setDot(STATE.EXPIRED);
      setBanner("Session expired — please re-join.", "expired");
      return;
    }

    setDot(STATE.CAMPAIGN_SELECTED);
    authInfo.textContent = `Signed in as ${name} (${role}) • ${campaignSlug}`;

    // Join room (guarded)
    await guarded(async () => {
      room = await joinDemoRoom();

      clearRoster();
      setDot(STATE.ROOM_CONNECTED);
      setBanner("");

      // Wire state updates for roster
      room.onStateChange((state) => renderRoster(state));

      // Surface room errors
      room.onError((code, message) => {
        setBanner(`Room error ${code}: ${message}`, "error");
        log(`Room error ${code}: ${message}`);
      });
      room.onMessage("error", (m) => {
        setBanner(`Op rejected: ${m?.reason ?? "unknown"}`, "error");
        log(`Op rejected: ${JSON.stringify(m)}`);
      });

      // Wire ops buttons — include user id so server knows the target (self)
      document.querySelectorAll(".op").forEach((btn) => {
        btn.onclick = () => {
          const kind = btn.dataset.kind;
          const val = parseInt(btn.dataset.val, 10);
          if (Number.isNaN(val)) return;

          const authNow = getAuth();
          const uid = authNow?.user?.id || null;

          const payload = {
            type: kind === "hp" ? "HP_ADD" : "XP_ADD",
            amount: val,
            id: uid, // ensure self-target present for ACL checks
          };

          room.send("op", payload);
          log(`Sent ${payload.type} ${val > 0 ? "+" : ""}${val} (id=${uid ?? "?"})`);
        };
      });
    });

  } catch (err) {
    console.error(err);
    if (err?.message === "SESSION_EXPIRED") return;
    setDot(STATE.LOGGED_OUT);
    setBanner(`Join failed: ${err.message || "unknown error"}`, "error");
  } finally {
    joinBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", () => {
  if (room) {
    try { room.leave(true); } catch {}
    room = null;
  }
  clearAll();
  clearRoster();
  emailEl.value = "";
  nameEl.value = "";
  slugEl.value = "demo-campaign";
  roleEl.value = "owner";
  setDot(STATE.LOGGED_OUT);
  setBanner("");
  authInfo.textContent = "";
  log("Logged out.");
});

// ------- Boot -------
hydrateFromStorage();
clearRoster();

// ------- Dev Dock Mount (Fixed) -------
(() => {
  // Safe reads (avoid ReferenceErrors and give clear logs)
  const viteEnv = (typeof import.meta !== "undefined" && import.meta.env) || {};
  const FLAG = (viteEnv.VITE_DEVTOOLS ?? "0") === "1";
  
  // Safe localStorage check with fallback
  let LOCAL = false;
  try {
    LOCAL = localStorage.getItem("DEV_ENABLED") === "1";
  } catch (e) {
    console.warn("[Dock] localStorage not available:", e.message);
    // In development mode, enable by default if localStorage fails
    LOCAL = viteEnv.MODE === 'development';
  }

  console.log("[Dock] VITE_DEVTOOLS =", viteEnv.VITE_DEVTOOLS, "| DEV_ENABLED =", LOCAL, "| MODE =", viteEnv.MODE);

  if (!FLAG) {
    console.log("[Dock] Not mounting Dev Dock: VITE_DEVTOOLS != '1' (rebuild needed?)");
    return;
  }

  if (!LOCAL && viteEnv.MODE !== 'development') {
    console.log("[Dock] Not mounting Dev Dock: localStorage.DEV_ENABLED != '1' and not in development mode");
    console.log("[Dock] To enable: localStorage.setItem('DEV_ENABLED','1')");
    return;
  }

  // Lazy-load React + Dock
  Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./devdock/DevDock.tsx"),
  ]).then(([React, ReactDOMClient, DevDockMod]) => {
    try {
      const dockDiv = document.createElement("div");
      dockDiv.id = "dev-dock-root";
      document.body.appendChild(dockDiv);

      // react-dom/client exports { createRoot }
      const { createRoot } = ReactDOMClient;
      const root = createRoot(dockDiv);
      root.render(React.createElement(DevDockMod.default));
      console.log("[Dock] Dev Dock mounted successfully.");
      log("Dev Dock mounted.");
    } catch (e) {
      console.error("[Dock] Failed to render Dev Dock:", e);
      log("Dev Dock failed to mount: " + e.message);
    }
  }).catch((e) => {
    console.error("[Dock] Failed to load Dev Dock chunks:", e);
    log("Dev Dock chunks failed to load: " + e.message);
  });
})();