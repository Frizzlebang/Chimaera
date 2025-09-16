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

let room = null
const statusEl = document.getElementById('status')
const statusDot = document.getElementById('statusDot')
const joinBtn = document.getElementById('joinBtn')
const logEl = document.getElementById('log')

function log(m) { 
  logEl.innerHTML += m + '<br/>' 
  logEl.scrollTop = logEl.scrollHeight 
}

function updateStatus(state, message) {
  if (statusEl) statusEl.textContent = message || state
  if (statusDot) {
    statusDot.className = 'status-dot'
    if (state === 'connected') statusDot.classList.add('connected')
    else if (state === 'error') statusDot.classList.add('error')
  }
}

// JWT base64url-safe decode helper
function decodeJwtPayload(token) {
  const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return JSON.parse(atob(b64 + pad));
}

// Login using the name in the input (or override)
async function login(nameOverride) {
  const name = (nameOverride || document.getElementById('name').value || 'Player').trim();
  const email = `${name.toLowerCase()}@example.com`;
  const campaignSlug = 'demo-campaign';

  const response = await api('/api/dev/login', {
  method: 'POST',
  body: JSON.stringify({ email, name, campaignSlug }),
  });


  const data = await response.json();
  const token = data.token;

  // Prefer API campaignId; fallback to JWT claim if needed
  let campaignId = data.campaignId || data.campaign?.id;
  if (!campaignId && token) {
    try {
      const payload = decodeJwtPayload(token);
      campaignId = payload?.campaign_id || null;
    } catch (e) {
      console.warn("Could not decode JWT for campaign_id fallback:", e);
    }
  }

  // cache for convenience (optional)
  if (token) localStorage.setItem("weave_token", token);
  if (campaignId) localStorage.setItem("weave_campaignId", campaignId);

  return { token, campaignId };
}

async function join() {
  try {
    updateStatus('connecting', 'logging in...');

    // If already connected, leave so we can switch identity
    if (room) {
      try { await room.leave(true); } catch {}
      room = null;
    }

    const { token, campaignId } = await login();
    log('Login successful');

    updateStatus('connecting', 'joining room...');

    if (!campaignId) throw new Error("missing campaignId from login");
    log(`Campaign ID: ${campaignId}`);

    // Join campaign-scoped room with fresh identity
    room = await client.joinOrCreate("demo", { token, campaignId });

    updateStatus('connected', 'room joined');
    log('Joined room successfully');

    // Get user info from JWT for the handlers
    const payload = decodeJwtPayload(token);
    setupRoomHandlers(payload);
  } catch (err) {
    console.error("Join error:", err);
    updateStatus('error', err.message || String(err));
    log(`Join error: ${err.message || String(err)}`);
  }
}

function setupRoomHandlers(payload) {
  room.onStateChange((state) => {
    const tbody = document.querySelector('#players tbody')
    tbody.innerHTML = ''

    // Show version (persistence proof)
    const versionEl = document.getElementById('version')
    if (versionEl) versionEl.textContent = `Version: ${state.version}`

    if (state.players.size === 0) {
      tbody.innerHTML = '<tr class="empty-state"><td colspan="4">No players connected</td></tr>'
    } else {
      for (const [id, p] of state.players) {
        const tr = document.createElement('tr')
        tr.innerHTML = `
          <td>${p.name}</td>
          <td>${p.hp}</td>
          <td>${p.xp}</td>
          <td><span class="role-badge role-${p.role}">${p.role}</span></td>
        `
        tbody.appendChild(tr)
      }
    }
  })

document.querySelectorAll('[data-kind]').forEach(btn => {
  btn.onclick = () => {
    if (!room) return
    const kind = btn.dataset.kind
    const value = parseInt(btn.dataset.val, 10)
    
    if (kind === 'hp') {
      // Send HP_ADD directly - server expects { type, amount }
      room.send('op', { 
        type: 'HP_ADD', 
        amount: value  // Remove the 'data' wrapper
      })
    } else if (kind === 'xp') {
      // Send XP_ADD directly - server expects { type, amount }
      room.send('op', { 
        type: 'XP_ADD', 
        amount: value  // Remove the 'data' wrapper
      })
    }
    
    log(`Sent ${kind.toUpperCase()} ${value > 0 ? '+' : ''}${value}`)
  }
})
}

joinBtn.onclick = join
