const STORE_KEY='gameNightAdminV3';
const CHANNEL_NAME='gameNightLiveV3';
const channel='BroadcastChannel' in window?new BroadcastChannel(CHANNEL_NAME):null;
let state=load();let ticker=null;
function load(){try{return JSON.parse(localStorage.getItem(STORE_KEY))}catch{return null}}
function esc(s=''){return String(s).replace(/[&<>\'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function ageOn(dob,dateStr){if(!dob)return'—';const d=new Date(dob+'T00:00:00'),ref=new Date(dateStr+'T12:00:00');let age=ref.getFullYear()-d.getFullYear(),m=ref.getMonth()-d.getMonth();if(m<0||(m===0&&ref.getDate()<d.getDate()))age--;return age}
function round(){return state?.rounds?.find(r=>r.id===state.live?.activeRoundId)}
function celeb(){const r=round();return r?.settings?.celebrities?.[state.live?.questionIndex||0]}
function left(){return state?.live?.deadline?Math.max(0,Math.ceil((state.live.deadline-Date.now())/1000)):0}
function standings(){return [...(state?.teams||[])].sort((a,b)=>(b.total||0)-(a.total||0))}
function initials(name='?'){return name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}
function render(){
  const root=document.getElementById('audienceApp');if(!state){root.innerHTML='<section class="holding"><p>OPEN THE ADMIN FIRST</p><h1>Game Night</h1></section>';return}
  const r=round(),c=celeb(),status=state.live?.status||'idle',q=(state.live?.questionIndex||0)+1,total=r?.settings?.celebrities?.length||0;
  if(status==='leaderboard'){const top=standings();root.innerHTML=`<section class="screen leaderboard"><header><span>${esc(state.event.venue)}</span><span>${esc(state.event.name)}</span></header><div class="board-wrap"><p class="kicker">CURRENT STANDINGS</p><h1>Leaderboard</h1><div class="board">${top.map((t,i)=>`<div class="board-row ${i<3?'top':''}"><span class="place">${i+1}</span><strong>${esc(t.name)}</strong><span class="points">${t.total||0}<small> pts</small></span></div>`).join('')}</div></div></section>`;return}
  if(status==='idle'||status==='ready'||status==='roundComplete'||!c){root.innerHTML=`<section class="holding"><div class="orb"></div><p>${esc(state.event.venue)}</p><h1>${esc(state.event.name)}</h1><div class="join"><span>ROOM</span><strong>${esc(state.event.roomCode)}</strong></div><small>${status==='roundComplete'?'ROUND COMPLETE — NEXT ROUND COMING UP':'GET READY'}</small></section>`;return}
  const correct=ageOn(c.dob,state.event.date),showAnswer=status==='reveal';
  root.innerHTML=`<section class="screen question-screen ${status}"><header><span>ROUND ${Math.max(1,state.rounds.indexOf(r)+1)} · ${esc(r.title)}</span><span>QUESTION ${q} / ${total}</span></header><div class="question-layout"><div class="portrait">${c.image?`<div class="portrait-bg" style="background-image:url('${esc(c.image)}')"></div><img class="portrait-main" src="${esc(c.image)}" alt="${esc(c.name)}">`:`<span>${esc(initials(c.name))}</span>`}</div><div class="copy"><p class="kicker">GUESS THE AGE</p><h1>${esc(c.name)}</h1>${showAnswer?`<div class="answer"><span>ACTUAL AGE</span><strong>${correct}</strong></div>`:`<p class="prompt">How old are they?</p>`}<div class="answer-count">${Object.keys(state.live.submissions||{}).length} / ${state.teams.length} teams locked in</div></div><div class="countdown ${status==='locked'?'locked':''}">${status==='question'?`<strong>${left()}</strong><span>SECONDS</span>`:status==='locked'?'<strong>✓</strong><span>ANSWERS LOCKED</span>':showAnswer?'<strong>!</strong><span>REVEAL</span>':''}</div></div>${showAnswer?renderAwards():''}</section>`;
}
function renderAwards(){const awards=(state.live.lastAwarded||[]).slice(0,4);if(!awards.length)return'';return `<div class="results-strip">${awards.map((a,i)=>`<div class="result ${i===0?'winner':''}"><span>${i===0?'CLOSEST':'TEAM'}</span><strong>${esc(a.name)}</strong><small>Guessed ${a.guess} · +${a.points} pts</small></div>`).join('')}</div>`}
function startTicker(){clearInterval(ticker);ticker=setInterval(()=>{if(state?.live?.status==='question')render()},200)}
channel?.addEventListener('message',e=>{if(e.data?.type==='state'){state=e.data.state;render();startTicker()}});
window.addEventListener('storage',e=>{if(e.key===STORE_KEY&&e.newValue){state=JSON.parse(e.newValue);render();startTicker()}});
render();startTicker();
