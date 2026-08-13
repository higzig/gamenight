const STORE_KEY = 'gameNightAdminV3';
const LEGACY_KEY = 'gameNightAdminV2';
const CHANNEL_NAME = 'gameNightLiveV3';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

const games = {
  guessAge: {name:'Guess the Age', icon:'🎂', desc:'15-second celebrity age guesses', ready:true},
  iBetYou: {name:'I Bet You', icon:'🎤', desc:'Live bidding and stage challenge', ready:false},
  future: {name:'Future Game', icon:'✦', desc:'Placeholder for a new round', ready:false}
};

const seedCelebs = [
  {name:'Pedro Pascal',dob:'1975-04-02',image:''}, {name:'Zendaya',dob:'1996-09-01',image:''},
  {name:'Robert Downey Jr.',dob:'1965-04-04',image:''}, {name:'Cristiano Ronaldo',dob:'1985-02-05',image:''},
  {name:'Tom Holland',dob:'1996-06-01',image:''}, {name:'Scarlett Johansson',dob:'1984-11-22',image:''},
  {name:'Ryan Reynolds',dob:'1976-10-23',image:''}, {name:'Lionel Messi',dob:'1987-06-24',image:''},
  {name:'Florence Pugh',dob:'1996-01-03',image:''}, {name:'Samuel L. Jackson',dob:'1948-12-21',image:''}
];

function defaultState(){return {
  version:3,
  event:{name:'Thursday Game Night',venue:'The Local',date:'2026-08-20',expectedTeams:12,roomCode:'4821'},
  teams:[
    {id:1,name:'Quiztopher Columbus',scores:{},total:0},
    {id:2,name:'No Eye Deer',scores:{},total:0},
    {id:3,name:'Table 7',scores:{},total:0},
    {id:4,name:'The Know-It-Alls',scores:{},total:0}
  ],
  rounds:[
    {id:'r1',type:'guessAge',title:'Guess the Age',settings:{timer:15,points:'bands',celebrities:structuredClone(seedCelebs)}},
    {id:'r2',type:'future',title:'Round 2',settings:{}},
    {id:'r3',type:'iBetYou',title:'I Bet You',settings:{groups:3,groupSize:4,categories:3,seconds:60,winPoints:5}},
    {id:'r4',type:'future',title:'Round 4',settings:{}},
    {id:'r5',type:'future',title:'Round 5',settings:{}}
  ],
  live:{activeRoundId:'r1',questionIndex:0,status:'idle',deadline:null,submissions:{},scoredKeys:[],lastAwarded:[],audienceMessage:''}
}}

function migrate(s){
  if(!s) return defaultState();
  s.version=3;
  s.live ||= {activeRoundId:s.rounds?.find(r=>r.type==='guessAge')?.id||null,questionIndex:0,status:'idle',deadline:null,submissions:{},scoredKeys:[],lastAwarded:[],audienceMessage:''};
  s.live.submissions ||= {}; s.live.scoredKeys ||= []; s.live.lastAwarded ||= [];
  s.teams ||= [];
  s.teams.forEach(t=>{t.scores ||= {}; if(typeof t.total!=='number') t.total=0;});
  s.rounds?.forEach(r=>{if(r.type==='guessAge'){r.settings ||= {}; if(!r.settings.timer || r.settings.timer===10) r.settings.timer=15; r.settings.celebrities ||= []; r.settings.celebrities.forEach(c=>{c.image ||= ''; c.imageSource ||= ''; c.imageSourceUrl ||= '';});}});
  return s;
}
function load(){
  try{
    const current=JSON.parse(localStorage.getItem(STORE_KEY)); if(current) return migrate(current);
    const legacy=JSON.parse(localStorage.getItem(LEGACY_KEY)); if(legacy) return migrate(legacy);
  }catch{}
  return defaultState();
}
let state=load(); let editingRoundId=null; let liveTicker=null;
function save(show=true){localStorage.setItem(STORE_KEY,JSON.stringify(state));broadcast();if(show)toast('Saved locally')}
function broadcast(){channel?.postMessage({type:'state',state});}
function $(s){return document.querySelector(s)}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function ageOn(dob,dateStr){if(!dob)return '—';const d=new Date(dob+'T00:00:00');const ref=dateStr?new Date(dateStr+'T12:00:00'):new Date();let age=ref.getFullYear()-d.getFullYear();const m=ref.getMonth()-d.getMonth();if(m<0||(m===0&&ref.getDate()<d.getDate()))age--;return Number.isFinite(age)?age:'—'}
function pointsForDifference(diff){if(diff===0)return 10;if(diff===1)return 8;if(diff===2)return 6;if(diff===3)return 5;if(diff<=5)return 3;if(diff<=10)return 1;return 0}
function toast(msg){const e=document.createElement('div');e.className='toast';e.textContent=msg;document.body.append(e);setTimeout(()=>e.remove(),1700)}
function currentRound(){return state.rounds.find(r=>r.id===state.live.activeRoundId)}
function currentCelebrity(){const r=currentRound();return r?.type==='guessAge'?r.settings.celebrities?.[state.live.questionIndex]:null}
function questionKey(){return `${state.live.activeRoundId || 'none'}:${state.live.questionIndex}`}
function answerCount(){return Object.keys(state.live.submissions||{}).length}
function timeLeft(){if(!state.live.deadline)return 0;return Math.max(0,Math.ceil((state.live.deadline-Date.now())/1000))}
function remoteSession(){return window.gameNightRemoteSession||null}
function remoteTeams(){return remoteSession()?.teams||[]}
function remoteGuessRound(){return remoteSession()?.rounds?.find(r=>r.game_type==='guess_age')||null}
function remoteQuestion(){const s=remoteSession();return remoteGuessRound()?.questions?.find(q=>q.id===s?.event?.active_question_id)||remoteGuessRound()?.questions?.[0]||null}
function remoteTimeLeft(){const s=remoteSession();if(!s?.event?.question_deadline_at)return 0;const serverAtHydration=new Date(s.server_now).getTime(),deadline=new Date(s.event.question_deadline_at).getTime(),elapsed=Date.now()-(s._hydratedAt||Date.now());return Math.max(0,Math.ceil((deadline-serverAtHydration-elapsed)/1000))}

function bindEventFields(){
  const remote=remoteSession()?.event;
  if(remote){
    state.event={...state.event,name:remote.name,venue:remote.venue,date:remote.event_date,expectedTeams:remote.expected_teams,roomCode:remote.room_code};
    $('#eventName').value=remote.name;$('#venueName').value=remote.venue;$('#eventDate').value=remote.event_date;$('#expectedTeams').value=remote.expected_teams;$('#eventTitle').textContent=remote.name;$('#roomCode').textContent=remote.room_code;
    ['eventName','venueName','eventDate','expectedTeams'].forEach(id=>{$('#'+id).disabled=true;$('#'+id).title='Database-backed event details are read-only in Phase 2A'});
    $('#connectedCount').textContent=`${remoteTeams().length} teams joined`;
    return;
  }
  $('#eventName').value=state.event.name;$('#venueName').value=state.event.venue;$('#eventDate').value=state.event.date;$('#expectedTeams').value=state.event.expectedTeams;$('#eventTitle').textContent=state.event.name;$('#roomCode').textContent=state.event.roomCode;$('#connectedCount').textContent=`${state.teams.length} local test teams`;
  [['eventName','name'],['venueName','venue'],['eventDate','date'],['expectedTeams','expectedTeams']].forEach(([id,key])=>$('#'+id).oninput=e=>{state.event[key]=key==='expectedTeams'?Number(e.target.value):e.target.value;$('#eventTitle').textContent=state.event.name||'Untitled Game Night';save(false)});
}
function roundSummary(r){
  if(r.type==='guessAge') return `${r.settings.celebrities?.length||0} celebrities · ${r.settings.timer||15}s answers`;
  if(r.type==='iBetYou') return `${r.settings.groups||3} groups · ${r.settings.categories||3} categories · ${r.settings.winPoints||5} points to winner`;
  return 'Game not chosen yet';
}
function renderRounds(){
  $('#roundsList').innerHTML=state.rounds.map((r,i)=>{const g=games[r.type]||games.future;return `<div class="round-card" data-id="${r.id}"><div class="round-num">ROUND ${i+1}</div><div class="game-icon">${g.icon}</div><div class="round-main"><h3>${esc(r.title||g.name)}</h3><p>${esc(roundSummary(r))}</p></div><div class="round-actions"><span class="round-status ${g.ready?'':'todo'}">${g.ready?'Configured':'Needs setup'}</span><button class="mini-btn move-up" ${i===0?'disabled':''}>↑</button><button class="mini-btn move-down" ${i===state.rounds.length-1?'disabled':''}>↓</button><button class="mini-btn edit-round">Edit</button></div></div>`}).join('');
  document.querySelectorAll('.edit-round').forEach(b=>b.onclick=()=>openDrawer(b.closest('.round-card').dataset.id));
  document.querySelectorAll('.move-up').forEach(b=>b.onclick=()=>moveRound(b.closest('.round-card').dataset.id,-1));
  document.querySelectorAll('.move-down').forEach(b=>b.onclick=()=>moveRound(b.closest('.round-card').dataset.id,1));
}
function moveRound(id,delta){const i=state.rounds.findIndex(r=>r.id===id),j=i+delta;if(j<0||j>=state.rounds.length)return;[state.rounds[i],state.rounds[j]]=[state.rounds[j],state.rounds[i]];renderRounds();save(false)}
function openDrawer(id){editingRoundId=id;const r=state.rounds.find(x=>x.id===id);$('#drawerTitle').textContent=r.title||games[r.type].name;renderDrawer(r);$('#roundDrawer').classList.add('open');$('#drawerBackdrop').classList.add('open')}
function closeDrawer(){editingRoundId=null;$('#roundDrawer').classList.remove('open');$('#drawerBackdrop').classList.remove('open');renderRounds();renderTeams();renderLeaderboard();renderLiveControl();save(false)}
function renderDrawer(r){
  if(r.type==='guessAge') return renderGuessAgeEditor(r);
  if(r.type==='iBetYou') return renderIBetEditor(r);
  $('#drawerBody').innerHTML=`<div class="field"><label>Round title</label><input id="roundTitleInput" value="${esc(r.title)}"></div><div class="empty-state" style="margin-top:18px"><strong>This round is intentionally a placeholder.</strong><p class="hint">When we decide the next game, its own editor will live here while still using the same event, teams and leaderboard.</p></div>`;
  $('#roundTitleInput').oninput=e=>r.title=e.target.value;
}
function renderGuessAgeEditor(r){
  const celebs=r.settings.celebrities||[];
  $('#drawerBody').innerHTML=`<div class="settings-grid"><label class="field">Round title<input id="roundTitleInput" value="${esc(r.title)}"></label><label class="field">Answer timer<select id="timerInput"><option value="10">10 seconds</option><option value="12">12 seconds</option><option value="15">15 seconds</option><option value="20">20 seconds</option></select></label></div><p class="hint">Prepare the lineup before the event. DOB is the source of truth; age is calculated on the event date. For photos, portrait 4:5 works best (around 800 × 1000 px). Uploaded photos are automatically resized and compressed. Wikipedia lookup is a convenience for the prototype; verify the person and image rights before a public/commercial event.</p><div class="subheading"><h3>Celebrity lineup <span style="color:var(--muted)">(${celebs.length})</span></h3><button class="mini-btn" id="addCeleb">+ Add</button></div><div class="celebs" id="celebList"></div>`;
  $('#roundTitleInput').oninput=e=>r.title=e.target.value;$('#timerInput').value=String(r.settings.timer||15);$('#timerInput').onchange=e=>r.settings.timer=Number(e.target.value);$('#addCeleb').onclick=()=>{celebs.push({name:'New celebrity',dob:'1990-01-01',image:'',imageSource:'',imageSourceUrl:''});renderGuessAgeEditor(r)};renderCelebs(r);
}
function renderCelebs(r){
  const el=$('#celebList');if(!el)return;
  el.innerHTML=r.settings.celebrities.map((c,i)=>`<div class="celeb-row expanded">
    <span class="celeb-order">${i+1}</span>
    <div class="celeb-photo-wrap">
      <div class="celeb-photo">${c.image?`<img src="${esc(c.image)}" alt="${esc(c.name)}">`:`<span>${esc((c.name||'?').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase())}</span>`}</div>
      <div class="photo-actions">
        <button class="mini-btn upload-photo" data-i="${i}">Upload</button>
        <button class="mini-btn wiki-photo" data-i="${i}">Wikipedia</button>
        ${c.image?`<button class="mini-btn ghost-mini clear-photo" data-i="${i}">Clear</button>`:''}
      </div>
      <input class="photo-file" data-i="${i}" type="file" accept="image/*" hidden>
      ${c.imageSource?`<small class="photo-source" title="${esc(c.imageSource)}">${esc(c.imageSource)}</small>`:''}
    </div>
    <div class="celeb-fields">
      <input data-field="name" data-i="${i}" value="${esc(c.name)}" placeholder="Celebrity name">
      <input data-field="image" data-i="${i}" value="${esc(c.image?.startsWith('data:')?'':(c.image||''))}" placeholder="Or paste image URL">
    </div>
    <input data-field="dob" data-i="${i}" type="date" value="${esc(c.dob)}">
    <span class="age-badge">Age ${ageOn(c.dob,state.event.date)}</span>
    <button class="icon-btn remove-celeb" data-i="${i}">×</button>
  </div>`).join('');
  el.querySelectorAll('input[data-field]').forEach(inp=>inp.oninput=e=>{
    const c=r.settings.celebrities[Number(e.target.dataset.i)];
    c[e.target.dataset.field]=e.target.value;
    if(e.target.dataset.field==='image'&&e.target.value){c.imageSource='Manual URL';c.imageSourceUrl=e.target.value;}
    if(e.target.dataset.field==='dob')renderCelebs(r);
  });
  el.querySelectorAll('.remove-celeb').forEach(b=>b.onclick=()=>{r.settings.celebrities.splice(Number(b.dataset.i),1);renderGuessAgeEditor(r)});
  el.querySelectorAll('.upload-photo').forEach(b=>b.onclick=()=>el.querySelector(`.photo-file[data-i="${b.dataset.i}"]`).click());
  el.querySelectorAll('.photo-file').forEach(inp=>inp.onchange=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    const i=Number(e.target.dataset.i),c=r.settings.celebrities[i];
    try{c.image=await resizeImageFile(file);c.imageSource=`Uploaded · ${file.name}`;c.imageSourceUrl='';save(false);renderCelebs(r);toast('Photo added and resized');}
    catch(err){console.error(err);toast('Could not process that image');}
  });
  el.querySelectorAll('.wiki-photo').forEach(b=>b.onclick=()=>findWikipediaPhoto(r,Number(b.dataset.i),b));
  el.querySelectorAll('.clear-photo').forEach(b=>b.onclick=()=>{const c=r.settings.celebrities[Number(b.dataset.i)];c.image='';c.imageSource='';c.imageSourceUrl='';save(false);renderCelebs(r)});
}
async function resizeImageFile(file){
  const dataUrl=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(file)});
  const img=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=dataUrl});
  const maxW=900,maxH=1125,scale=Math.min(1,maxW/img.width,maxH/img.height),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#111318';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
  return canvas.toDataURL('image/jpeg',.82);
}
async function findWikipediaPhoto(r,i,button){
  const c=r.settings.celebrities[i],name=(c.name||'').trim();if(!name){toast('Enter the celebrity name first');return}
  const old=button.textContent;button.disabled=true;button.textContent='Searching…';
  try{
    const url='https://en.wikipedia.org/w/api.php?'+new URLSearchParams({action:'query',generator:'search',gsrsearch:name,gsrlimit:'5',prop:'pageimages',piprop:'thumbnail|original',pithumbsize:'1200',format:'json',origin:'*'});
    const res=await fetch(url);if(!res.ok)throw new Error('Wikipedia request failed');const data=await res.json();
    const pages=Object.values(data?.query?.pages||{}).filter(p=>p.original?.source||p.thumbnail?.source);
    if(!pages.length){toast('No Wikipedia photo found');return}
    const exact=pages.find(p=>p.title.toLowerCase()===name.toLowerCase()),pick=exact||pages.sort((a,b)=>(a.index??99)-(b.index??99))[0];
    c.image=(pick.original&&pick.original.source)||pick.thumbnail.source;
    c.imageSource=`Wikipedia · ${pick.title}`;c.imageSourceUrl=`https://en.wikipedia.org/?curid=${pick.pageid}`;save(false);renderCelebs(r);toast(`Added full Wikipedia photo for ${pick.title}`);
  }catch(err){console.error(err);toast('Wikipedia lookup failed — upload a photo instead');}
  finally{button.disabled=false;button.textContent=old;}
}

function renderIBetEditor(r){
  const s=r.settings;$('#drawerBody').innerHTML=`<div class="settings-grid"><label class="field">Round title<input id="roundTitleInput" value="${esc(r.title)}"></label><label class="field">Groups<input id="groups" type="number" min="1" max="10" value="${s.groups||3}"></label><label class="field">Teams per group<input id="groupSize" type="number" min="2" max="8" value="${s.groupSize||4}"></label><label class="field">Categories<input id="categories" type="number" min="1" max="10" value="${s.categories||3}"></label><label class="field">Challenge timer<input id="seconds" type="number" min="15" max="180" value="${s.seconds||60}"></label><label class="field">Winner points<input id="winPoints" type="number" min="1" max="50" value="${s.winPoints||5}"></label></div><div class="empty-state"><strong>Live stage logic comes after Guess the Age.</strong><p class="hint">This editor proves I Bet You is a module inside the same event rather than a separate app.</p></div>`;
  $('#roundTitleInput').oninput=e=>r.title=e.target.value;['groups','groupSize','categories','seconds','winPoints'].forEach(id=>$('#'+id).oninput=e=>s[id]=Number(e.target.value));
}
function renderTeams(){
  const joined=remoteTeams();
  $('#connectedCount').textContent=remoteSession()?`${joined.length} teams joined`:`${state.teams.length} local test teams`;
  const authoritative=remoteSession()?`<div class="remote-teams"><h3>Supabase-joined Teams</h3><p>Authoritative room membership. These identities are not used by local prototype gameplay yet.</p><table><thead><tr><th>Team</th><th>Status</th><th>Joined</th></tr></thead><tbody>${joined.map(t=>`<tr><td><strong>${esc(t.name)}</strong></td><td><span class="remote-team-state">${esc(t.status)}</span></td><td>${new Date(t.joined_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td></tr>`).join('')||'<tr><td colspan="3">Waiting for Teams to join…</td></tr>'}</tbody></table></div>`:'';
  $('#teamsTable').innerHTML=`${authoritative}<div class="prototype-teams"><h3>Local gameplay test Teams</h3><p>Browser-only prototype data. Kept separate until Guess the Age moves to Supabase.</p><table><thead><tr><th>Team</th><th>Local points</th><th></th></tr></thead><tbody>${state.teams.map(t=>`<tr><td><input class="score-input team-name" style="width:220px" data-id="${t.id}" value="${esc(t.name)}"></td><td><input class="score-input team-score" data-id="${t.id}" type="number" value="${t.total||0}"></td><td><button class="mini-btn remove-team" data-id="${t.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('.team-name').forEach(x=>x.oninput=e=>{state.teams.find(t=>t.id==e.target.dataset.id).name=e.target.value;save(false)});document.querySelectorAll('.team-score').forEach(x=>x.oninput=e=>{state.teams.find(t=>t.id==e.target.dataset.id).total=Number(e.target.value);renderLeaderboard();save(false)});document.querySelectorAll('.remove-team').forEach(x=>x.onclick=e=>{state.teams=state.teams.filter(t=>t.id!=e.target.dataset.id);renderTeams();renderLeaderboard();renderLiveControl();save(false)})
}
function renderLeaderboard(){const sorted=[...state.teams].sort((a,b)=>(b.total||0)-(a.total||0));$('#leaderboardTable').innerHTML=`<table><thead><tr><th>Place</th><th>Team</th><th>Points</th></tr></thead><tbody>${sorted.map((t,i)=>`<tr><td>${i+1}</td><td><strong>${esc(t.name)}</strong></td><td>${t.total||0}</td></tr>`).join('')}</tbody></table>`}
function addTeam(){const id=Date.now();state.teams.push({id,name:`Team ${state.teams.length+1}`,scores:{},total:0});renderTeams();renderLeaderboard();renderLiveControl();save(false)}

function renderLiveControl(){
  if(remoteSession())return renderRemoteLiveControl();
  const guessRounds=state.rounds.filter(r=>r.type==='guessAge');
  if(!guessRounds.length){$('#liveControl').innerHTML='<div class="empty-state"><strong>Add a Guess the Age round first.</strong></div>';return;}
  if(!guessRounds.some(r=>r.id===state.live.activeRoundId)) state.live.activeRoundId=guessRounds[0].id;
  const r=currentRound(), c=currentCelebrity(), total=r.settings.celebrities.length, status=state.live.status, answered=answerCount(), left=timeLeft();
  const submissions=state.teams.map(t=>{const a=state.live.submissions?.[t.id];return `<tr><td>${esc(t.name)}</td><td>${a==null?'—':a}</td><td>${a==null?'<span class="submission waiting">Waiting</span>':'<span class="submission done">Locked</span>'}</td></tr>`}).join('');
  const awards=(state.live.lastAwarded||[]).map(a=>`<div class="award-row"><span>${esc(a.name)}</span><span>Guess ${a.guess} · ${a.diff} away</span><strong>+${a.points}</strong></div>`).join('');
  $('#liveControl').innerHTML=`
    <div class="live-toolbar panel">
      <div><p class="eyebrow">LIVE EVENT</p><h2>${esc(state.event.name)}</h2><p class="hint">Audience display reads the same local event state. Open it in a second tab/window.</p></div>
      <div class="top-actions"><button class="btn secondary" id="openAudience">Open audience display ↗</button><button class="btn secondary" id="openTeamTest">Open team test ↗</button><button class="btn ghost" id="audienceIdle">Send holding screen</button></div>
    </div>
    <div class="live-grid">
      <div class="panel live-main">
        <div class="panel-heading"><div><p class="label">CURRENT ROUND</p><h2>${esc(r.title)}</h2></div><span class="pill ${status==='question'?'live':'ready'}">${esc(status)}</span></div>
        <div class="settings-grid"><label class="field">Guess the Age round<select id="liveRoundSelect">${guessRounds.map(x=>`<option value="${x.id}" ${x.id===r.id?'selected':''}>${esc(x.title)}</option>`).join('')}</select></label><label class="field">Question<select id="liveQuestionSelect">${r.settings.celebrities.map((x,i)=>`<option value="${i}" ${i===state.live.questionIndex?'selected':''}>${i+1}. ${esc(x.name)}</option>`).join('')}</select></label></div>
        <div class="question-preview">
          <div class="preview-art">${c?.image?`<div class="preview-art-bg" style="background-image:url('${esc(c.image)}')"></div><img class="preview-art-main" src="${esc(c.image)}" alt="">`:`<span>${esc((c?.name||'?').split(' ').map(x=>x[0]).slice(0,2).join(''))}</span>`}</div>
          <div><p class="eyebrow">QUESTION ${Math.min(state.live.questionIndex+1,total)} OF ${total}</p><h3>${esc(c?.name||'No celebrity selected')}</h3><p>Correct age on event date: <strong>${c?ageOn(c.dob,state.event.date):'—'}</strong></p></div>
          <div class="timer-chip"><span>${status==='question'?left:(r.settings.timer||15)}</span><small>SECONDS</small></div>
        </div>
        <div class="live-actions">
          <button class="btn primary" id="startQuestion" ${!c||status==='question'?'disabled':''}>Start ${r.settings.timer||10}s question</button>
          <button class="btn secondary" id="lockQuestion" ${status!=='question'?'disabled':''}>Lock answers</button>
          <button class="btn secondary" id="simulateAnswers" ${!c||!['question','locked'].includes(status)?'disabled':''}>Simulate team answers</button>
          <button class="btn secondary" id="revealAnswer" ${!c||!['locked','question'].includes(status)?'disabled':''}>Reveal + score</button>
          <button class="btn ghost" id="nextQuestion" ${!c?'disabled':''}>Next question →</button>
        </div>
        <div class="live-meta"><span><strong>${answered}/${state.teams.length}</strong> teams answered</span><span>Correct answer <strong>${status==='reveal'?ageOn(c?.dob,state.event.date):'hidden'}</strong></span><span>Question points are only awarded once</span></div>
      </div>
      <div class="panel live-side">
        <div class="panel-heading"><div><p class="label">TEAM SUBMISSIONS</p><h2>Team answers</h2></div><span class="pill mock">Local test</span></div>
        <div class="submission-table"><table><thead><tr><th>Team</th><th>Age</th><th>Status</th></tr></thead><tbody>${submissions}</tbody></table></div>
        ${awards?`<div class="awards"><p class="label">LAST SCORING</p>${awards}</div>`:''}
        <button class="btn full" id="showLeaderboard">Show leaderboard on audience screen</button>
      </div>
    </div>`;
  $('#openAudience').onclick=()=>window.open('audience.html','gameNightAudience');
  $('#openTeamTest').onclick=()=>{const code=remoteSession()?.event?.room_code;window.open(code?`team.html?room=${encodeURIComponent(code)}`:'team.html','_blank')};
  $('#audienceIdle').onclick=()=>{state.live.status='idle';state.live.deadline=null;save(false);renderLiveControl()};
  $('#liveRoundSelect').onchange=e=>{state.live.activeRoundId=e.target.value;state.live.questionIndex=0;resetQuestion('ready');save(false);renderLiveControl()};
  $('#liveQuestionSelect').onchange=e=>{state.live.questionIndex=Number(e.target.value);resetQuestion('ready');save(false);renderLiveControl()};
  $('#startQuestion').onclick=startQuestion;
  $('#lockQuestion').onclick=lockQuestion;
  $('#simulateAnswers').onclick=simulateAnswers;
  $('#revealAnswer').onclick=revealAnswer;
  $('#nextQuestion').onclick=nextQuestion;
  $('#showLeaderboard').onclick=()=>{state.live.status='leaderboard';state.live.deadline=null;save(false);renderLiveControl()};
}
function renderRemoteLeaderboard(){const board=remoteSession()?.leaderboard||[];$('#leaderboardTable').innerHTML=`<table><thead><tr><th>Place</th><th>Team</th><th>Points</th></tr></thead><tbody>${board.map((t,i)=>`<tr><td>${i+1}</td><td><strong>${esc(t.name)}</strong></td><td>${t.points||0}</td></tr>`).join('')||'<tr><td colspan="3">No scores yet</td></tr>'}</tbody></table>`}
function renderRemoteLiveControl(){
  const s=remoteSession(),r=remoteGuessRound(),questions=r?.questions||[],event=s.event,q=remoteQuestion(),status=event.status,left=remoteTimeLeft(),submitted=new Map((s.submissions||[]).filter(x=>x.guess_integer!=null).map(x=>[x.team_id,x])),awards=new Map((s.awards||[]).map(x=>[x.team_id,x]));
  const rows=remoteTeams().map(t=>{const sub=submitted.get(t.id),award=awards.get(t.id);return `<tr><td>${esc(t.name)}</td><td>${sub?.guess_integer??'—'}</td><td>${sub?'<span class="submission done">Locked</span>':'<span class="submission waiting">Waiting</span>'}${award?` · +${award.points}`:''}</td></tr>`}).join('');
  $('#liveControl').innerHTML=`<div class="live-toolbar panel"><div><p class="eyebrow">SUPABASE LIVE EVENT</p><h2>${esc(event.name)}</h2><p class="hint">Authoritative gameplay across physical devices. Room ${esc(event.room_code)}</p></div><div class="top-actions"><button class="btn secondary" id="openAudience">Open audience ↗</button><button class="btn secondary" id="openTeamTest">Open Team ↗</button><button class="btn ghost" id="audienceIdle">Holding screen</button></div></div>
  <div class="live-grid"><div class="panel live-main"><div class="panel-heading"><div><p class="label">GUESS THE AGE</p><h2>${esc(r?.title||'Not synced yet')}</h2></div><span class="pill ${status==='question'?'live':'ready'}">${esc(status)}</span></div>
  ${r?`<label class="field">Question<select id="remoteQuestionSelect">${questions.map(x=>`<option value="${x.id}" ${x.id===q?.id?'selected':''}>${x.position}. ${esc(x.celebrity_name)}</option>`).join('')}</select></label><div class="question-preview"><div class="preview-art">${q?.external_image_url?`<div class="preview-art-bg" style="background-image:url('${esc(q.external_image_url)}')"></div><img class="preview-art-main" src="${esc(q.external_image_url)}" alt="">`:`<span>${esc((q?.celebrity_name||'?').split(' ').map(x=>x[0]).slice(0,2).join(''))}</span>`}</div><div><p class="eyebrow">QUESTION ${q?.position||0} OF ${questions.length}</p><h3>${esc(q?.celebrity_name||'Select a question')}</h3><p>Correct age: <strong>${status==='reveal'?ageOn(q?.date_of_birth,event.event_date):'hidden'}</strong></p></div><div class="timer-chip"><span>${status==='question'?left:15}</span><small>SECONDS</small></div></div><div class="live-actions"><button class="btn primary" id="startQuestion" ${!q||status==='question'?'disabled':''}>Start 15s question</button><button class="btn secondary" id="lockQuestion" ${status!=='question'?'disabled':''}>Lock answers</button><button class="btn secondary" id="revealAnswer" ${!['question','locked','reveal'].includes(status)?'disabled':''}>Reveal + score</button><button class="btn ghost" id="nextQuestion" ${!['locked','reveal'].includes(status)?'disabled':''}>Next question →</button></div>`:`<div class="empty-state"><strong>Sync the local Guess the Age lineup first.</strong><p class="hint">Use “Sync Guess the Age” in the Event screen. Base64 uploads are skipped; external/Wikipedia URLs are supported.</p></div>`}
  <div class="live-meta"><span><strong>${submitted.size}/${remoteTeams().length}</strong> Teams answered</span><span>Server-authoritative deadline</span><span>Scoring is idempotent</span></div></div><div class="panel live-side"><div class="panel-heading"><div><p class="label">TEAM SUBMISSIONS</p><h2>Team answers</h2></div><span class="pill ready">Authoritative</span></div><div class="submission-table"><table><thead><tr><th>Team</th><th>Age</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><button class="btn full" id="showLeaderboard">Show leaderboard</button></div></div>`;
  $('#openAudience').onclick=()=>window.open(`audience.html?room=${encodeURIComponent(event.room_code)}`,'gameNightAudience');$('#openTeamTest').onclick=()=>window.open(`team.html?room=${encodeURIComponent(event.room_code)}`,'_blank');$('#audienceIdle').onclick=()=>window.gameNightSupabaseActions.setDisplay('lobby');$('#showLeaderboard').onclick=()=>window.gameNightSupabaseActions.setDisplay('leaderboard');
  if(r){$('#startQuestion').onclick=()=>window.gameNightSupabaseActions.startQuestion($('#remoteQuestionSelect').value);$('#lockQuestion').onclick=()=>window.gameNightSupabaseActions.lockQuestion();$('#revealAnswer').onclick=()=>window.gameNightSupabaseActions.revealQuestion();$('#nextQuestion').onclick=()=>window.gameNightSupabaseActions.advanceQuestion();}
  if(status==='question'){clearInterval(liveTicker);liveTicker=setInterval(()=>{if(remoteTimeLeft()<=0){clearInterval(liveTicker);renderRemoteLiveControl()}else renderRemoteLiveControl()},250)}
}
function resetQuestion(status='ready'){state.live.status=status;state.live.deadline=null;state.live.submissions={};state.live.lastAwarded=[]}
function startQuestion(){const r=currentRound();if(!r||!currentCelebrity())return;state.live.status='question';state.live.submissions={};state.live.lastAwarded=[];state.live.deadline=Date.now()+(r.settings.timer||15)*1000;save(false);renderLiveControl();startTicker()}
function startTicker(){clearInterval(liveTicker);liveTicker=setInterval(()=>{if(state.live.status!=='question'){clearInterval(liveTicker);return}if(timeLeft()<=0){lockQuestion();return}renderLiveControl()},250)}
function lockQuestion(){if(state.live.status!=='question')return;state.live.status='locked';state.live.deadline=null;save(false);renderLiveControl();clearInterval(liveTicker)}
function simulateAnswers(){const c=currentCelebrity();if(!c)return;const correct=ageOn(c.dob,state.event.date);state.teams.forEach((t,i)=>{if(state.live.submissions[t.id]==null){const offsets=[0,1,-2,4,-7,11,-1,3];state.live.submissions[t.id]=Math.max(1,correct+offsets[i%offsets.length]);}});save(false);renderLiveControl()}
function revealAnswer(){const c=currentCelebrity();if(!c)return;if(state.live.status==='question')lockQuestion();const key=questionKey(), correct=ageOn(c.dob,state.event.date);const already=state.live.scoredKeys.includes(key);const awards=[];state.teams.forEach(t=>{const guess=state.live.submissions[t.id];if(guess==null)return;const diff=Math.abs(Number(guess)-correct),points=pointsForDifference(diff);awards.push({id:t.id,name:t.name,guess:Number(guess),diff,points});if(!already){t.scores[key]=points;t.total=(t.total||0)+points;}});if(!already)state.live.scoredKeys.push(key);state.live.lastAwarded=awards.sort((a,b)=>b.points-a.points||a.diff-b.diff);state.live.status='reveal';state.live.deadline=null;save(false);renderLeaderboard();renderLiveControl()}
function nextQuestion(){const r=currentRound();if(!r)return;if(state.live.questionIndex<r.settings.celebrities.length-1){state.live.questionIndex++;resetQuestion('ready')}else{state.live.status='roundComplete';state.live.deadline=null;state.live.submissions={};state.live.lastAwarded=[]}save(false);renderLiveControl()}

function openModal(){renderGamePicker();$('#roundModal').classList.add('open');$('#modalBackdrop').classList.add('open')}
function closeModal(){$('#roundModal').classList.remove('open');$('#modalBackdrop').classList.remove('open')}
function renderGamePicker(){$('#gamePicker').innerHTML=Object.entries(games).map(([key,g])=>`<button class="game-option" data-game="${key}"><strong>${g.icon} ${g.name}</strong><span>${g.desc}</span></button>`).join('');document.querySelectorAll('.game-option').forEach(b=>b.onclick=()=>addRound(b.dataset.game))}
function addRound(type){const id='r'+Date.now();const base={id,type,title:games[type].name,settings:{}};if(type==='guessAge')base.settings={timer:15,points:'bands',celebrities:[]};if(type==='iBetYou')base.settings={groups:3,groupSize:4,categories:3,seconds:60,winPoints:5};state.rounds.push(base);closeModal();renderRounds();save(false);openDrawer(id)}
function deleteRound(){if(!editingRoundId)return;state.rounds=state.rounds.filter(r=>r.id!==editingRoundId);if(state.live.activeRoundId===editingRoundId)state.live.activeRoundId=state.rounds.find(r=>r.type==='guessAge')?.id||null;closeDrawer()}
function initNav(){document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));$('#view-'+b.dataset.view).classList.add('active');if(b.dataset.view==='live')renderLiveControl()})}
function init(){
  bindEventFields();renderRounds();renderTeams();renderLeaderboard();renderLiveControl();initNav();save(false);
  $('#saveEvent').textContent=remoteSession()?'Sync Guess the Age':'Save changes';
  $('#saveEvent').onclick=async()=>{if(remoteSession()){const r=state.rounds.find(x=>x.type==='guessAge');if(!r)return toast('No Guess the Age round');const valid=(r.settings.celebrities||[]).filter(c=>c.name&&c.dob);if(!valid.length)return toast('Add at least one celebrity');$('#saveEvent').disabled=true;try{await window.gameNightSupabaseActions.saveGuessAgeRound(r.title,valid);toast('Guess the Age synced')}catch(e){console.error(e);toast('Could not sync lineup')}finally{$('#saveEvent').disabled=false}}else{save(true);renderRounds();renderLiveControl()}};
  $('#resetDemo').onclick=()=>{if(confirm('Reset the prototype back to the demo event?')){localStorage.removeItem(STORE_KEY);localStorage.removeItem(LEGACY_KEY);location.reload()}};
  $('#addRound').onclick=openModal;$('#closeModal').onclick=closeModal;$('#modalBackdrop').onclick=closeModal;$('#closeDrawer').onclick=closeDrawer;$('#drawerBackdrop').onclick=closeDrawer;$('#doneRound').onclick=closeDrawer;$('#deleteRound').onclick=deleteRound;$('#addTeam').onclick=addTeam;
  $('#logoutHost').onclick=()=>window.dispatchEvent(new Event('game-night-host-logout'));
  $('#switchEvent').onclick=()=>window.dispatchEvent(new Event('game-night-switch-events'));
  $('#copyTeamLink').onclick=async()=>{const code=remoteSession()?.event?.room_code;if(!code)return;const url=new URL('team.html',location.href);url.searchParams.set('room',code);try{await navigator.clipboard.writeText(url.href);toast('Team join link copied')}catch{toast(`Room code: ${code}`)}};
  window.addEventListener('storage',e=>{if(e.key===STORE_KEY&&e.newValue){state=migrate(JSON.parse(e.newValue));renderLeaderboard();renderLiveControl()}});
  window.addEventListener('game-night-remote-state',e=>{e.detail._hydratedAt=Date.now();window.gameNightRemoteSession=e.detail;bindEventFields();renderTeams();renderRemoteLeaderboard();renderLiveControl()});
}
init();
