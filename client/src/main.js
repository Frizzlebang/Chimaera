import * as Colyseus from 'colyseus.js'

// --- WS_URL config ---
const HTTP_BASE = import.meta.env.VITE_HTTP_BASE || window.location.origin;
const WS_BASE =
  import.meta.env.VITE_WS_BASE ||
  (HTTP_BASE.startsWith("https://")
    ? "wss://" + HTTP_BASE.slice("https://".length)
    : HTTP_BASE.replace(/^http/, "ws"));

// --- begin: API helper ---
const api = (path, init = {}) =>
  fetch(`${HTTP_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
// --- end: API helper ---

const client = new Colyseus.Client(WS_BASE);

let room = null;
let desiredName = "";

// UI refs
const statusEl = document.getElementById('status');
const statusDot = document.getElementById('statusDot');
const joinBtn   = document.getElementById('joinBtn');
const logEl     = document.getElementById('log');
const nameInput = document.getElementById('name');

function log(m) {
  if (!logEl) return;
  logEl.innerHTML += m + '<br/>';
  logEl.scrollTop = logEl.scrollHeight;
}

function updateStatus(state, message) {
  if (statusEl) statusEl.textContent = message || state;
  if (statusDot) {
    statusDot.className = 'status-dot';
    if (state === 'connected') statusDot.classList.add('connected');
    else if (state === 'error') statusDot.classList.add('error');
  }
}

// Robust JWT base64url decode
function decodeJwtPayload(token) {
  try {
    const b64 = (token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    return JSON.parse(atob(b64 + pad));
  } catch {
    return {};
  }
}

// Dev login using current name (or override)
async function login(nameOverride) {
  const name = (nameOverride ?? nameInput?.value ?? 'Player').trim() || 'Player';
  const email = `${name.toLowerCase()}@example.com`;
  const campaignSlug = 'demo-campaign';

  const response = await api('/api/dev/login', {
    method: 'POST',
    body: JSON.stringify({ email, name, campaignSlug, role: 'player' }),
  });

  // Try to parse body even on non-OK to show useful error
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const msg = data?.error || `dev/login ${response.status}`;
    throw new Error(msg);
  }

  const token = data.token;
  // Accept both casing and fallback to JWT if not present in body
  const payload = token ? decodeJwtPayload(token) : {};
  const campaignId =
      data.campaignId ||
      data.campaign_id ||
      data.campaign?.id ||
      payload.campaignId ||
      payload.campaign_id ||
      null;

  // cache for convenience (optional)
  if (token) localStorage.setItem("weave_token", token);
  if (campaignId) localStorage.setItem("weave_campaignId", campaignId);

  return { token, campaignId };
}

async function join() {
  try {
    updateStatus('connecting', 'logging in...');

    // Ensure we read the intended name before login
    desiredName = (nameInput?.value ?? '').trim();

    // If already connected, leave so we can switch identity cleanly
    if (room) {
      try { await room.leave(true); } catch {}
      room = null;
    }

    const { token, campaignId } = await login(desiredName || undefined);
    log('Login successful');

    if (!campaignId) throw new Error("missing campaignId from login");
    log(`Campaign ID: ${campaignId}`);
    updateStatus('connecting', 'joining room...');

    room = await client.joinOrCreate("demo", { token, campaignId });

    // wire room handlers (includes reliable post-join name set)
    setupRoomHandlers(token);

    updateStatus('connected', 'room joined');
    log('Joined room successfully');
  } catch (err) {
    console.error("Join error:", err);
    updateStatus('error', err.message || String(err));
    log(`Join error: ${err.message || String(err)}`);
  }
}

function setupRoomHandlers(token) {
  // Safety: drop previous listeners (if any)
  room.removeAllListeners?.();

  // Show version & render on patches
  room.onStateChange((state) => {
    const versionEl = document.getElementById('version');
    if (versionEl) versionEl.textContent = `Version: ${state.version}`;

    const tbody = document.querySelector('#players tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (state.players.size === 0) {
      tbody.innerHTML = '<tr class="empty-state"><td colspan="4">No players connected</td></tr>';
      return;
    }
    for (const [id, p] of state.players) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>${p.hp}</td>
        <td>${p.xp}</td>
        <td><span class="role-badge role-${p.role}">${p.role}</span></td>
      `;
      tbody.appendChild(tr);
    }
  });

  // After the FIRST patch, reliably set our desired name (if any)
  room.onStateChange.once((state) => {
    const nameToSet = (desiredName || '').trim();
    if (nameToSet) {
      room.send('op', { type: 'SET_NAME', name: nameToSet });
      log(`Sent name: ${nameToSet}`);
    }
  });

  // HP / XP buttons
  document.querySelectorAll('[data-kind]').forEach((btn) => {
    btn.onclick = () => {
      if (!room) return;
      const kind = btn.dataset.kind;
      const value = parseInt(btn.dataset.val, 10);

      if (kind === 'hp') {
        room.send('op', { type: 'HP_ADD', amount: value });
      } else if (kind === 'xp') {
        room.send('op', { type: 'XP_ADD', amount: value });
      }
      log(`Sent ${kind.toUpperCase()} ${value > 0 ? '+' : ''}${value}`);
    };
  });
}

joinBtn.onclick = join;
