import { moveItem, runConfirmed } from './src/admin-controls.js';
import { applyCelebrityRecord, createNewCelebrityDraft, dobInputValue, lineupValidationError, selectCelebrityMatch, shouldTryWikipedia, updateCelebrityDob, wikidataDobFromClaims } from './src/celebrity-library.js';
import { activeIBetYouGroup, adjustBid, iBetYouSecondsRemaining, initialProposedBid, teamName, validateIBetYouChallenge, validateIBetYouCommit } from './src/i-bet-you.js';
const STORE_KEY = 'gameNightAdminV3';
const LEGACY_KEY = 'gameNightAdminV2';
const CHANNEL_NAME = 'gameNightLiveV3';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

const games = {
  guessAge: {name:'Guess the Age', icon:'🎂', desc:'15-second celebrity age guesses', ready:true},
  iBetYou: {name:'I Bet You', icon:'🎤', desc:'Hosted live bidding and stage challenge', ready:true},
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
let state=load(); let editingRoundId=null; let liveTicker=null; const iBetYouDrafts=new Map();
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
function storageBase(){return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/celebrity-images`}
function syncRemoteGuessRound(){const remote=remoteGuessRound();if(!remote)return;let local=state.rounds.find(r=>r.type==='guessAge');if(!local){local={id:'remote-guess-age',type:'guessAge',title:remote.title,settings:{timer:15,points:'bands',celebrities:[]}};state.rounds.unshift(local)}local.title=remote.title;local.settings.timer=15;local.settings.celebrities=(remote.questions||[]).map(q=>({id:q.celebrity_id,questionId:q.id,name:q.celebrity_name,dob:q.date_of_birth,imageKind:q.image_kind,imagePath:q.image_path,image:q.image_kind==='storage'&&q.image_path?`${storageBase()}/${q.image_path}`:(q.external_image_url||''),imageSourceKind:q.image_source,sourceReference:q.source_reference,imageSource:q.image_source?`Reusable · ${q.image_source}`:'',imageSourceUrl:q.external_image_url||'',libraryStatus:q.celebrity_id?'existing':'new'}))}
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
  $('#roundTitleInput').oninput=e=>r.title=e.target.value;$('#timerInput').value=String(r.settings.timer||15);$('#timerInput').onchange=e=>r.settings.timer=Number(e.target.value);$('#addCeleb').onclick=()=>{celebs.push(createNewCelebrityDraft());renderGuessAgeEditor(r)};renderCelebs(r);
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
      <input data-field="name" data-i="${i}" value="${esc(c.name)}" placeholder="Search or enter celebrity">
      <input data-field="image" data-i="${i}" value="${esc(c.image?.startsWith('data:')?'':(c.image||''))}" placeholder="Or paste image URL">
      <small class="library-state">${c.libraryStatus==='existing'?'Existing celebrity ✓'+(c.image?' · Image reused ✓':' · Image missing'):'New celebrity'}</small>
    </div>
    <input data-field="dob" data-i="${i}" type="date" value="${esc(dobInputValue(c))}">
    <span class="age-badge">Age ${ageOn(c.dob,state.event.date)}</span>
    <div class="celeb-reorder"><button class="mini-btn move-celeb-up" data-i="${i}" ${i===0?'disabled':''}>Up</button><button class="mini-btn move-celeb-down" data-i="${i}" ${i===r.settings.celebrities.length-1?'disabled':''}>Down</button></div>
    <button class="icon-btn remove-celeb" data-i="${i}">×</button>
  </div>`).join('');
  el.querySelectorAll('input[data-field]').forEach(inp=>inp.oninput=e=>{
    const c=r.settings.celebrities[Number(e.target.dataset.i)];
    if(e.target.dataset.field==='dob')updateCelebrityDob(c,e.target.value);else c[e.target.dataset.field]=e.target.value;
    if(e.target.dataset.field==='image'&&e.target.value){c.imageKind='external';c.imagePath=null;c.imageSourceKind='manual_url';c.sourceReference=null;c.imageSource='Manual URL';c.imageSourceUrl=e.target.value;}
    if(e.target.dataset.field==='dob'){const badge=e.target.parentElement?.querySelector('.age-badge')||e.target.closest('.celeb-row')?.querySelector('.age-badge');if(badge)badge.textContent=`Age ${ageOn(c.dob,state.event.date)}`;}
  });
  el.querySelectorAll('input[data-field="name"]').forEach(inp=>inp.onblur=()=>resolveCelebrity(r,Number(inp.dataset.i)));
  el.querySelectorAll('input[data-field="dob"]').forEach(inp=>inp.onchange=()=>resolveCelebrity(r,Number(inp.dataset.i)));
  el.querySelectorAll('input[data-field="image"]').forEach(inp=>inp.onblur=async()=>{const c=r.settings.celebrities[Number(inp.dataset.i)];if(remoteSession()&&c.dob&&/^https:\/\//.test(c.image||'')){try{await ensureCelebrity(c);await persistCelebrity(c);renderCelebs(r)}catch(e){console.error(e);toast('Could not save that image URL')}}});
  el.querySelectorAll('.remove-celeb').forEach(b=>b.onclick=()=>{r.settings.celebrities.splice(Number(b.dataset.i),1);renderGuessAgeEditor(r)});
  el.querySelectorAll('.move-celeb-up,.move-celeb-down').forEach(b=>b.onclick=async()=>{const i=Number(b.dataset.i),delta=b.classList.contains('move-celeb-up')?-1:1;const remote=remoteGuessRound()?.questions?.[i];if(remote){try{await window.gameNightSupabaseActions.reorderQuestion(remote.id,delta);toast('Lineup reordered')}catch(e){console.error(e);toast('This lineup can no longer be reordered')}}else if(moveItem(r.settings.celebrities,i,delta)){renderCelebs(r);save(false)}});
  el.querySelectorAll('.upload-photo').forEach(b=>b.onclick=()=>el.querySelector(`.photo-file[data-i="${b.dataset.i}"]`).click());
  el.querySelectorAll('.photo-file').forEach(inp=>inp.onchange=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    const i=Number(e.target.dataset.i),c=r.settings.celebrities[i];
    try{const dataUrl=await resizeImageFile(file);if(remoteSession()){await ensureCelebrity(c);const blob=await (await fetch(dataUrl)).blob();const path=await window.gameNightSupabaseActions.uploadCelebrityImage(c.id,blob);c.imageKind='storage';c.imagePath=path;c.image=`${storageBase()}/${path}`;c.imageSourceKind='upload';c.imageSource=`Uploaded · ${file.name}`;c.imageSourceUrl='';await persistCelebrity(c)}else{c.image=dataUrl;c.imageSource=`Uploaded · ${file.name}`;c.imageSourceUrl=''}save(false);renderCelebs(r);toast('Photo added and saved for reuse');}
    catch(err){console.error(err);toast('Could not process that image');}
  });
  el.querySelectorAll('.wiki-photo').forEach(b=>b.onclick=()=>findWikipediaPhoto(r,Number(b.dataset.i),b));
  el.querySelectorAll('.clear-photo').forEach(b=>b.onclick=async()=>{const c=r.settings.celebrities[Number(b.dataset.i)];c.image='';c.imageKind='none';c.imagePath=null;c.imageSourceKind=null;c.sourceReference=null;c.imageSource='';c.imageSourceUrl='';if(remoteSession()&&c.id){try{await persistCelebrity(c)}catch(e){console.error(e);toast('Could not clear reusable image')}}save(false);renderCelebs(r)});
}
async function persistCelebrity(c){if(!remoteSession())return c;const submittedDob=c.dob;const saved=await window.gameNightSupabaseActions.saveCelebrity({...c,dob:submittedDob});applyCelebrityRecord(c,saved,storageBase(),{preserveDob:c.dob!==submittedDob});return c}
async function ensureCelebrity(c){if(c.id)return c;if(!c.name||!c.dob)throw new Error('Enter name and DOB first');c.imageKind=c.image?.startsWith('https://')?'external':'none';c.imageSourceKind=c.imageKind==='external'?'manual_url':null;return persistCelebrity(c)}
async function resolveCelebrity(r,i){if(!remoteSession())return;const c=r.settings.celebrities[i],lookupName=c.name,lookupDob=c.dob;if((lookupName||'').trim().length<3)return;try{const matches=await window.gameNightSupabaseActions.searchCelebrities(lookupName);if(c.name!==lookupName||c.dob!==lookupDob)return;const match=selectCelebrityMatch(matches,lookupName,lookupDob);if(match){applyCelebrityRecord(c,match,storageBase(),{preserveDob:Boolean(lookupDob)});renderCelebs(r);if(shouldTryWikipedia(match,c._wikiAttempted))await findWikipediaPhoto(r,i,null,true);return}if(c.dob)await ensureCelebrity(c);renderCelebs(r);if(!c._wikiAttempted)await findWikipediaPhoto(r,i,null,true)}catch(e){console.error(e);toast('Celebrity library lookup failed') }}
async function resizeImageFile(file){
  const dataUrl=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(file)});
  const img=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=dataUrl});
  const maxW=900,maxH=1125,scale=Math.min(1,maxW/img.width,maxH/img.height),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#111318';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
  return canvas.toDataURL('image/jpeg',.82);
}
async function findWikipediaPhoto(r,i,button,automatic=false){
  const c=r.settings.celebrities[i],name=(c.name||'').trim(),dobAtLookup=c.dob;if(!name){toast('Enter the celebrity name first');return}
  const old=button?.textContent;c._wikiAttempted=true;if(button){button.disabled=true;button.textContent='Searching…'}else{c.libraryStatus='searching';renderCelebs(r)}
  try{
    const url='https://en.wikipedia.org/w/api.php?'+new URLSearchParams({action:'query',generator:'search',gsrsearch:name,gsrlimit:'5',prop:'pageimages|pageprops',ppprop:'wikibase_item',piprop:'thumbnail|original',pithumbsize:'1200',format:'json',origin:'*'});
    const res=await fetch(url);if(!res.ok)throw new Error('Wikipedia request failed');const data=await res.json();
    const pages=Object.values(data?.query?.pages||{}).filter(p=>p.original?.source||p.thumbnail?.source);
    if(!pages.length){toast('No confident Wikipedia photo found');return}
    const exact=pages.find(p=>p.title.toLowerCase()===name.toLowerCase()),pick=exact||pages.sort((a,b)=>(a.index??99)-(b.index??99))[0];
    if(automatic&&!exact){toast('Wikipedia match was uncertain — use manual search or upload');return}
    const wikidataId=pick.pageprops?.wikibase_item;if(wikidataId){const dobResponse=await fetch('https://www.wikidata.org/w/api.php?'+new URLSearchParams({action:'wbgetclaims',entity:wikidataId,property:'P569',format:'json',origin:'*'}));if(dobResponse.ok){const pulledDob=wikidataDobFromClaims(await dobResponse.json());if(pulledDob&&c.dob===dobAtLookup&&!c.dob)updateCelebrityDob(c,pulledDob)}}
    c.image=(pick.original&&pick.original.source)||pick.thumbnail.source;
    c.imageKind='external';c.imagePath=null;c.imageSourceKind='wikipedia';c.sourceReference=pick.title;c.imageSource=`Wikipedia · ${pick.title}`;c.imageSourceUrl=`https://en.wikipedia.org/?curid=${pick.pageid}`;if(remoteSession()&&c.dob){await ensureCelebrity(c);await persistCelebrity(c)}save(false);renderCelebs(r);toast(c.dob?`Added reusable Wikipedia details for ${pick.title}`:`Added the image for ${pick.title}; please confirm the date of birth`);
  }catch(err){console.error(err);toast('Wikipedia lookup failed — upload a photo instead');}
  finally{if(remoteSession()&&c.id){try{await window.gameNightSupabaseActions.markWikipediaChecked(c.id);c.wikipediaCheckedAt=new Date().toISOString()}catch{}}if(button){button.disabled=false;button.textContent=old}if(c.libraryStatus==='searching')c.libraryStatus=c.id?'existing':'new';renderCelebs(r)}
}

function renderIBetEditor(r){
  const s=r.settings;$('#drawerBody').innerHTML=`<div class="settings-grid"><label class="field">Round title<input id="roundTitleInput" value="${esc(r.title)}"></label><label class="field">Groups<input id="groups" type="number" min="1" max="10" value="${s.groups||3}" disabled></label><label class="field">Teams per group<input id="groupSize" type="number" min="2" max="8" value="${s.groupSize||4}" disabled></label><label class="field">Categories<input id="categories" type="number" min="1" max="10" value="${s.categories||3}" disabled></label><label class="field">Challenge timer<input id="seconds" type="number" value="60" disabled></label><label class="field">Winner points<input id="winPoints" type="number" value="5" disabled></label></div><div class="empty-state"><strong>I Bet You is ready for hosted events.</strong><p class="hint">Open Live Control and choose “Prepare I Bet You” to create balanced persisted groups and category assignments from joined Teams.</p></div>`;
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
  if(s.i_bet_you?.round?.id===event.active_round_id)return renderRemoteIBetControl();
  const rows=remoteTeams().map(t=>{const sub=submitted.get(t.id),award=awards.get(t.id);return `<tr><td>${esc(t.name)}</td><td>${sub?.guess_integer??'—'}</td><td>${sub?'<span class="submission done">Locked</span>':'<span class="submission waiting">Waiting</span>'}${award?` · +${award.points}`:''}</td></tr>`}).join('');
  $('#liveControl').innerHTML=`<div class="live-toolbar panel"><div><p class="eyebrow">SUPABASE LIVE EVENT</p><h2>${esc(event.name)}</h2><p class="hint">Authoritative gameplay across physical devices. Room ${esc(event.room_code)}</p></div><div class="top-actions"><button class="btn secondary" id="openAudience">Open audience ↗</button><button class="btn secondary" id="openTeamTest">Open Team ↗</button><button class="btn secondary" id="prepareIBet">Prepare I Bet You</button><button class="btn ghost" id="audienceIdle">Show Join Screen</button><button class="btn ghost" id="returnGame">Return to Game</button></div></div>
  <div class="live-grid"><div class="panel live-main"><div class="panel-heading"><div><p class="label">GUESS THE AGE</p><h2>${esc(r?.title||'Not synced yet')}</h2></div><span class="pill ${status==='question'?'live':'ready'}">${esc(status)}</span></div>
  ${r?`<label class="field">Question<select id="remoteQuestionSelect">${questions.map(x=>`<option value="${x.id}" ${x.id===q?.id?'selected':''}>${x.position}. ${esc(x.celebrity_name)}</option>`).join('')}</select></label><div class="question-preview"><div class="preview-art">${q?.external_image_url?`<div class="preview-art-bg" style="background-image:url('${esc(q.external_image_url)}')"></div><img class="preview-art-main" src="${esc(q.external_image_url)}" alt="">`:`<span>${esc((q?.celebrity_name||'?').split(' ').map(x=>x[0]).slice(0,2).join(''))}</span>`}</div><div><p class="eyebrow">QUESTION ${q?.position||0} OF ${questions.length}</p><h3>${esc(q?.celebrity_name||'Select a question')}</h3><p>Correct age: <strong>${status==='reveal'?ageOn(q?.date_of_birth,event.event_date):'hidden'}</strong></p></div><div class="timer-chip"><span>${status==='question'?left:status==='suspense'?'5':15}</span><small>${status==='suspense'?'SUSPENSE':'SECONDS'}</small></div></div><div class="live-actions"><button class="btn primary" id="startQuestion" ${!q||!['lobby','ready','locked','reveal','round_complete','leaderboard'].includes(status)?'disabled':''}>Start 15s question</button><button class="btn ghost" id="nextQuestion" ${status!=='reveal'?'disabled':''}>Next question →</button></div>`:`<div class="empty-state"><strong>Sync the local Guess the Age lineup first.</strong><p class="hint">Use “Sync Guess the Age” in the Event screen. Base64 uploads are skipped; external/Wikipedia URLs are supported.</p></div>`}
  <div class="live-meta"><span><strong>${submitted.size}/${remoteTeams().length}</strong> Teams answered</span><span>${status==='suspense'?'5-second server suspense':'Server-authoritative deadline'}</span><span>Scoring is idempotent</span></div></div><div class="panel live-side"><div class="panel-heading"><div><p class="label">TEAM SUBMISSIONS</p><h2>Team answers</h2></div><span class="pill ready">Authoritative</span></div><div class="submission-table"><table><thead><tr><th>Team</th><th>Age</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><button class="btn full" id="showLeaderboard">Show Leaderboard</button><div class="recovery-actions"><p class="label">RECOVERY / MORE ACTIONS</p><button class="btn ghost full" id="restartRound">Restart Guess the Age Round</button><button class="btn ghost full" id="newSession">Start New Session</button></div></div></div>`;
  $('#openAudience').onclick=()=>window.open(`audience.html?room=${encodeURIComponent(event.room_code)}`,'gameNightAudience');$('#openTeamTest').onclick=()=>window.open(`team.html?room=${encodeURIComponent(event.room_code)}`,'_blank');$('#prepareIBet').onclick=()=>window.gameNightSupabaseActions.setupIBetYou();$('#audienceIdle').onclick=()=>window.gameNightSupabaseActions.setDisplay('join');$('#returnGame').onclick=()=>window.gameNightSupabaseActions.setDisplay('game');$('#showLeaderboard').onclick=()=>window.gameNightSupabaseActions.setDisplay('leaderboard');
  $('#restartRound').onclick=()=>runConfirmed(confirm,'Restart Guess the Age? Team membership and manual corrections stay, but all Guess the Age answers and game awards will be removed.',()=>window.gameNightSupabaseActions.restartRound());
  $('#newSession').onclick=()=>runConfirmed(confirm,'Start a fresh session with a new room code? The current event will be kept as history.',()=>window.gameNightSupabaseActions.startNewSession());
  if(r){$('#startQuestion').onclick=()=>window.gameNightSupabaseActions.startQuestion($('#remoteQuestionSelect').value);$('#nextQuestion').onclick=()=>window.gameNightSupabaseActions.advanceQuestion();}
  if(status==='question'){clearInterval(liveTicker);liveTicker=setInterval(()=>{if(remoteTimeLeft()<=0){clearInterval(liveTicker);renderRemoteLiveControl()}else renderRemoteLiveControl()},250)}
}
function renderRemoteIBetControl(){
  const s=remoteSession(),game=s.i_bet_you,event=s.event,group=activeIBetYouGroup(s),groups=game.groups||[],allMembers=groups.flatMap(g=>g.members.map(m=>({...m,groupId:g.id,groupPosition:g.position}))),left=iBetYouSecondsRemaining(s);
  const groupCards=groups.map(g=>`<div class="ibet-group-card ${g.id===group?.id?'active':''}"><div><p class="eyebrow">GROUP ${g.position}</p><h3>${esc(g.category.title)}</h3><p>${g.members.map(m=>esc(m.name)).join(' · ')}</p></div>${g.state==='waiting'?`<button class="mini-btn change-ibet-category" data-id="${g.id}">Change Category</button>`:`<span class="pill ready">${esc(g.state)}</span>`}</div>`).join('');
  if(!group){const guess=remoteGuessRound();$('#liveControl').innerHTML=`<div class="panel empty-state"><strong>I Bet You complete.</strong><p class="hint">Show the overall leaderboard or return to another hosted round.</p><button class="btn primary" id="ibetLeaderboard">Show Leaderboard</button>${guess?'<button class="btn secondary" id="returnGuess">Return to Guess the Age</button>':''}</div>`;$('#ibetLeaderboard').onclick=()=>window.gameNightSupabaseActions.setDisplay('leaderboard');if($('#returnGuess'))$('#returnGuess').onclick=()=>window.gameNightSupabaseActions.activateRound(guess.id);return}
  const memberOptions=group.members.map(m=>`<option value="${m.team_id}">${esc(m.name)}</option>`).join(''),bidder=group.challenged_bidder_team_id||group.current_bidder_team_id||group.members[0]?.team_id,challenger=group.challenger_team_id||group.members.find(m=>m.team_id!==bidder)?.team_id,bid=group.target_bid||group.current_bid||1,commitKey=`${group.current_bidder_team_id||''}:${group.current_bid??''}`;
  let draft=iBetYouDrafts.get(group.id);if(!draft||draft.commitKey!==commitKey){draft={commitKey,selectedTeamId:null,proposedBid:initialProposedBid(group),pending:false};iBetYouDrafts.set(group.id,draft)}
  let controls='';
  if(['waiting','bidding'].includes(group.state))controls=`${group.current_bidder_team_id?`<p class="ibet-committed-bid">Last committed bid: <strong>${esc(teamName(group,group.current_bidder_team_id))} · ${group.current_bid}</strong></p>`:'<p class="ibet-committed-bid">No bid committed yet. Select the first Team.</p>'}<div class="ibet-bidder-grid">${group.members.map(m=>`<button class="ibet-team-button ${m.team_id===draft.selectedTeamId?'selected':''}" data-team="${m.team_id}" ${draft.pending?'disabled':''}>${esc(m.name)}</button>`).join('')}</div><div class="ibet-bid-control"><button class="ibet-number-button" id="ibetMinus" ${draft.pending?'disabled':''}>−</button><strong>${draft.proposedBid}</strong><button class="ibet-number-button" id="ibetPlus" ${draft.pending?'disabled':''}>+</button></div><div class="ibet-bidding-actions"><button class="btn primary" id="ibetCommit" ${draft.pending||!draft.selectedTeamId?'disabled':''}>${draft.pending?'COMMITTING…':'I BET YOU'}</button><button class="btn secondary" id="ibetChallenge" ${draft.pending||!group.current_bidder_team_id||!draft.selectedTeamId||draft.selectedTeamId===group.current_bidder_team_id?'disabled':''}>NAME THEM</button></div>`;
  if(group.state==='challenged')controls=`<div class="ibet-showdown"><p>Challenged bidder</p><select id="correctBidder">${memberOptions}</select><p>Challenger</p><select id="correctChallenger">${memberOptions}</select><div class="ibet-bid-control"><button class="ibet-number-button" id="correctMinus">−</button><strong>${bid}</strong><button class="ibet-number-button" id="correctPlus">+</button></div><button class="btn secondary" id="saveShowdown">Save correction</button><button class="btn primary ibet-primary-action" id="startIBetTimer">START 60s</button></div>`;
  if(group.state==='countdown')controls=`<div class="ibet-host-countdown"><strong>${left}</strong><span>${left?'SECONDS':'TIME’S UP'}</span></div><div class="ibet-judge"><button class="btn primary" id="ibetSuccess">SUCCESS</button><button class="btn ibet-fail" id="ibetFail">FAIL</button></div>`;
  if(group.state==='result')controls=`<div class="ibet-result-admin"><p class="eyebrow">${group.result==='success'?'SUCCESS':'FAILED'}</p><h2>${esc(teamName(group,group.winning_team_id))} +5</h2><button class="btn primary ibet-primary-action" id="ibetNext">NEXT GROUP</button></div>`;
  const guess=remoteGuessRound();$('#liveControl').innerHTML=`<div class="live-toolbar panel"><div><p class="eyebrow">I BET YOU · HOST CONTROL</p><h2>${esc(event.name)}</h2><p class="hint">All bids and judgments are authoritative and persisted.</p></div><div class="top-actions"><button class="btn secondary" id="openAudience">Open audience ↗</button>${guess?'<button class="btn secondary" id="returnGuess">Guess the Age</button>':''}<button class="btn ghost" id="showLeaderboard">Show Leaderboard</button></div></div><div class="ibet-admin-layout"><div class="panel"><div class="panel-heading"><div><p class="label">CURRENT SHOWDOWN</p><h2>Group ${group.position} · ${esc(group.category.title)}</h2></div><span class="pill ${group.state==='countdown'?'live':'ready'}">${esc(group.state)}</span></div>${controls}<div class="recovery-actions"><button class="btn ghost" id="resetIBetGroup">Reset / replay this group</button></div></div><div class="panel"><div class="panel-heading"><div><p class="label">GROUPS</p><h2>Round assignments</h2></div>${game.round.status==='setup'?'<button class="mini-btn" id="randomiseIBet">Randomise</button>':''}</div>${groupCards}${game.round.status==='setup'?`<div class="ibet-swap"><select id="swapA">${allMembers.map(m=>`<option value="${m.team_id}">G${m.groupPosition} · ${esc(m.name)}</option>`).join('')}</select><select id="swapB">${allMembers.map(m=>`<option value="${m.team_id}">G${m.groupPosition} · ${esc(m.name)}</option>`).join('')}</select><button class="btn secondary" id="swapTeams">Swap Teams</button></div>`:''}</div></div>`;
  $('#openAudience').onclick=()=>window.open(`audience.html?room=${encodeURIComponent(event.room_code)}`,'gameNightAudience');if($('#returnGuess'))$('#returnGuess').onclick=()=>window.gameNightSupabaseActions.activateRound(guess.id);$('#showLeaderboard').onclick=()=>window.gameNightSupabaseActions.setDisplay('leaderboard');document.querySelectorAll('.change-ibet-category').forEach(b=>b.onclick=()=>window.gameNightSupabaseActions.changeIBetYouCategory(b.dataset.id));
  if($('#randomiseIBet'))$('#randomiseIBet').onclick=()=>window.gameNightSupabaseActions.setupIBetYou();if($('#swapTeams'))$('#swapTeams').onclick=()=>{const a=$('#swapA').value,b=$('#swapB').value;if(a!==b)window.gameNightSupabaseActions.swapIBetYouTeams(a,b)};
  document.querySelectorAll('.ibet-team-button').forEach(b=>b.onclick=()=>{draft.selectedTeamId=b.dataset.team;renderRemoteIBetControl()});const redrawBid=delta=>{draft.proposedBid=adjustBid(draft.proposedBid,delta);renderRemoteIBetControl()};if($('#ibetMinus'))$('#ibetMinus').onclick=()=>redrawBid(-1);if($('#ibetPlus'))$('#ibetPlus').onclick=()=>redrawBid(1);
  if($('#ibetCommit'))$('#ibetCommit').onclick=async()=>{const error=validateIBetYouCommit(group,draft.selectedTeamId,draft.proposedBid);if(error)return toast(error);draft.pending=true;renderRemoteIBetControl();try{await window.gameNightSupabaseActions.setIBetYouBid(group.id,draft.selectedTeamId,draft.proposedBid)}catch(e){console.error(e);draft.pending=false;renderRemoteIBetControl();toast('Could not commit that bid. It must be higher than the last bid.')}};
  if($('#ibetChallenge'))$('#ibetChallenge').onclick=async()=>{const error=validateIBetYouChallenge(group,draft.selectedTeamId);if(error)return toast(error);draft.pending=true;renderRemoteIBetControl();try{await window.gameNightSupabaseActions.challengeIBetYou(group.id,draft.selectedTeamId)}catch(e){console.error(e);draft.pending=false;renderRemoteIBetControl();toast('Could not start that challenge. Check the selected Team.')}};
  if($('#correctBidder')){$('#correctBidder').value=bidder;$('#correctChallenger').value=challenger;let target=bid;const redraw=n=>{target=adjustBid(target,n);document.querySelector('.ibet-bid-control strong').textContent=target};$('#correctMinus').onclick=()=>redraw(-1);$('#correctPlus').onclick=()=>redraw(1);$('#saveShowdown').onclick=()=>window.gameNightSupabaseActions.correctIBetYou(group.id,$('#correctBidder').value,$('#correctChallenger').value,target);$('#startIBetTimer').onclick=()=>window.gameNightSupabaseActions.startIBetYouTimer(group.id)}
  if($('#ibetSuccess'))$('#ibetSuccess').onclick=()=>window.gameNightSupabaseActions.judgeIBetYou(group.id,true);if($('#ibetFail'))$('#ibetFail').onclick=()=>window.gameNightSupabaseActions.judgeIBetYou(group.id,false);if($('#ibetNext'))$('#ibetNext').onclick=()=>window.gameNightSupabaseActions.nextIBetYou(group.id);$('#resetIBetGroup').onclick=()=>{if(confirm(`Reset Group ${group.position}? Its I Bet You result and award will be removed.`))window.gameNightSupabaseActions.resetIBetYou(group.id)};
  if(group.state==='countdown'){clearInterval(liveTicker);liveTicker=setInterval(()=>renderRemoteIBetControl(),250)}
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
  syncRemoteGuessRound();bindEventFields();renderRounds();renderTeams();renderLeaderboard();renderLiveControl();initNav();save(false);
  $('#saveEvent').textContent=remoteSession()?'Sync Guess the Age':'Save changes';
  $('#saveEvent').onclick=async()=>{if(remoteSession()){const r=state.rounds.find(x=>x.type==='guessAge');if(!r)return toast('No Guess the Age round');const celebrities=r.settings.celebrities||[],validationError=lineupValidationError(celebrities);if(validationError)return toast(validationError);$('#saveEvent').disabled=true;try{await window.gameNightSupabaseActions.saveGuessAgeRound(r.title,celebrities);toast('Guess the Age synced')}catch(e){console.error(e);toast('Could not sync lineup. Check each celebrity name and date of birth.')}finally{$('#saveEvent').disabled=false}}else{save(true);renderRounds();renderLiveControl()}};
  $('#resetDemo').onclick=()=>{if(confirm('Reset the prototype back to the demo event?')){localStorage.removeItem(STORE_KEY);localStorage.removeItem(LEGACY_KEY);location.reload()}};
  $('#addRound').onclick=openModal;$('#closeModal').onclick=closeModal;$('#modalBackdrop').onclick=closeModal;$('#closeDrawer').onclick=closeDrawer;$('#drawerBackdrop').onclick=closeDrawer;$('#doneRound').onclick=closeDrawer;$('#deleteRound').onclick=deleteRound;$('#addTeam').onclick=addTeam;
  $('#logoutHost').onclick=()=>window.dispatchEvent(new Event('game-night-host-logout'));
  $('#switchEvent').onclick=()=>window.dispatchEvent(new Event('game-night-switch-events'));
  $('#copyTeamLink').onclick=async()=>{const code=remoteSession()?.event?.room_code;if(!code)return;const url=new URL('team.html',location.href);url.searchParams.set('room',code);try{await navigator.clipboard.writeText(url.href);toast('Team join link copied')}catch{toast(`Room code: ${code}`)}};
  window.addEventListener('storage',e=>{if(e.key===STORE_KEY&&e.newValue){state=migrate(JSON.parse(e.newValue));renderLeaderboard();renderLiveControl()}});
  window.addEventListener('game-night-remote-state',e=>{e.detail._hydratedAt=Date.now();window.gameNightRemoteSession=e.detail;syncRemoteGuessRound();bindEventFields();renderRounds();if(editingRoundId){const current=state.rounds.find(r=>r.id===editingRoundId);if(current)renderDrawer(current)}renderTeams();renderRemoteLeaderboard();renderLiveControl()});
}
init();
