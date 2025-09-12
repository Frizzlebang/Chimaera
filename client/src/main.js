import * as Colyseus from 'colyseus.js'
const defaultWs = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
const wsUrl = import.meta.env.PROD
  ? defaultWs
  : (import.meta.env.VITE_WS_URL || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + (location.hostname || 'localhost') + ':2567'))
const client = new Colyseus.Client(wsUrl)
let room=null
const statusEl=document.getElementById('status'); const joinBtn=document.getElementById('joinBtn'); const logEl=document.getElementById('log')
function log(m){ logEl.innerHTML += m + '<br/>'; logEl.scrollTop = logEl.scrollHeight }
async function join(){ try{
  room = await client.joinOrCreate('demo')
  statusEl.textContent='connected'
  room.send('join', { name: document.getElementById('name').value || 'Player' })
  room.onMessage('info',(m)=>log(m))
  room.onStateChange((state)=>{
    const tbody=document.querySelector('#players tbody'); tbody.innerHTML='';
    for (const [id,p] of state.players){
      const tr=document.createElement('tr'); tr.innerHTML=`<td>${p.name}</td><td>${p.hp}</td><td>${p.xp}</td>`; tbody.appendChild(tr);
    }
  })
  document.querySelectorAll('[data-kind]').forEach(btn=>{
    btn.onclick=()=>{ if(!room) return; room.send('op',{ kind:btn.dataset.kind, value: parseInt(btn.dataset.val,10) }) }
  })
  room.onLeave(()=>{ statusEl.textContent='disconnected'; room=null })
} catch(e){ console.error(e); statusEl.textContent='error'; log('Join failed: '+e.message) } }
joinBtn.onclick = join
