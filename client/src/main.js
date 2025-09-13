import * as Colyseus from 'colyseus.js'

const wsUrl = 'ws://localhost:2567'
const client = new Colyseus.Client(wsUrl)

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

async function login() {
  const name = document.getElementById('name').value || 'Player'
  const email = `${name.toLowerCase()}@example.com`
  const campaignSlug = 'demo-campaign'
  
  const response = await fetch('/api/dev/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name, campaignSlug })
  })
  
  const { token } = await response.json()
  return { token }
}

async function join() {
  try {
    updateStatus('connecting', 'logging in...')
    
    const { token } = await login()
    log('Login successful')
    
    updateStatus('connecting', 'joining room...')
    
    const payload = JSON.parse(atob(token.split('.')[1]))
    const campaignId = payload.campaign_id
    log(`Campaign ID: ${campaignId}`)
    
    room = await client.joinOrCreate('demo', { 
      token, 
      campaignId 
    })
    
    updateStatus('connected', 'connected')
    log('Joined room successfully')
    
    setupRoomHandlers(payload)
    
  } catch (e) { 
    console.error('Full error:', e)
    updateStatus('error', 'error')
    log('Join failed: ' + (e.message || 'Unknown error'))
  }
}

function setupRoomHandlers(payload) {
  room.onStateChange((state) => {
    const tbody = document.querySelector('#players tbody')
    tbody.innerHTML = ''
    
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
        const currentPlayer = Array.from(room.state.players.values()).find(p => p.id === payload.sub)
        const currentHP = currentPlayer ? currentPlayer.hp : 10
        const newHP = Math.max(0, currentHP + value)
        
        room.send('op', { 
          type: 'SET_HP', 
          data: { playerId: payload.sub, value: newHP } 
        })
      } else if (kind === 'xp') {
        room.send('op', { 
          type: 'ADD_XP', 
          data: { playerId: payload.sub, amount: value } 
        })
      }
      
      log(`Sent ${kind.toUpperCase()} ${value > 0 ? '+' : ''}${value}`)
    }
  })
}

joinBtn.onclick = join