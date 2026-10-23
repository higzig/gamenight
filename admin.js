import {iBetCategoryDefaults,categorySelectionError,GAME_TYPES,PLAN_PREFIX,nightGames,startPlannedGame} from './src/admin-night.js';
import { GAME_CATALOG,STARTER_CELEBRITIES,toGameTypes } from './src/host/game-catalog.js';
import { addGame,adoptedLineup,lineupSaved,moveGame,nightStartCheck,removeGame,replaceGame,serverLineupTypes } from './src/host/lineup.js';
import { bindDashboard,configHeaderMarkup,dashboardMarkup,libraryMarkup } from './src/host/dashboard.js';
import { createActionRunner,friendlyHostError } from './src/host/action-runner.js';
import { formatEventDate } from './src/event-chooser.js';
import { NO_CONTEXT_TEST_PROMPTS } from './src/no-context-content.js';
import { noContextStage,noContextCloseWarning,noContextSeconds,updateNoContextClock } from './src/no-context.js';
import { moveItem, runConfirmed } from './src/admin-controls.js';
import { applyCelebrityRecord, createNewCelebrityDraft, dobInputValue, lineupValidationError, selectCelebrityMatch, shouldTryWikipedia, updateCelebrityDob, wikidataDobFromClaims } from './src/celebrity-library.js';
import { activeIBetYouGroup, adjustBid, iBetYouGroups, iBetYouSecondsRemaining, initialProposedBid, teamName, validateIBetYouChallenge, validateIBetYouCommit } from './src/i-bet-you.js';
import { mascotEmoji } from './src/mascots.js';
import { createPerfectLieCategory,createPerfectLieDraft,createPerfectLieQuestion,movePerfectLieItem,perfectLieDisplayTitle,perfectLieHostControlModel,perfectLieMissingConfirmation,perfectLiePayload,perfectLieRevealProgress,perfectLieValidationError,TABLE_OF_LIES_NAME,TABLE_OF_LIES_LABEL } from './src/perfect-lie.js';
import { audienceDisplayOptions,CONTROL_ROUND_PREFIX,guessPrimaryAction,leaderboardRows,mergeHostRoundOptions,selectSensibleControlRound } from './src/admin-ux.js';
const STORE_KEY = 'gameNightAdminV3';
const LEGACY_KEY = 'gameNightAdminV2';
const CHANNEL_NAME = 'gameNightLiveV3';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

const games = Object.fromEntries(Object.values(GAME_CATALOG).map(g=>[g.type,{name:g.name,icon:g.icon,desc:g.description,ready:true}]));
games.future={name:'Future Game',icon:'✦',desc:'Placeholder for a new round',ready:false};

const seedCelebs = STARTER_CELEBRITIES;

function defaultState(){return {
  version:3,
  event:{name:'Thursday Game Night',venue:'The Local',date:'2026-08-20',roomCode:'4821'},
  teams:[
    {id:1,name:'Quiztopher Columbus',scores:{},total:0},
    {id:2,name:'No Eye Deer',scores:{},total:0},
    {id:3,name:'Table 7',scores:{},total:0},
    {id:4,name:'The Know-It-Alls',scores:{},total:0}
  ],
  rounds:[
    {id:'r1',type:'guessAge',title:'Guess the Age',settings:{timer:15,points:'bands',celebrities:structuredClone(seedCelebs)}},
    {id:'r2',type:'future',title:'Round 2',settings:{}},
    {id:'r3',type:'iBetYou',title:'I Bet You',settings:{seconds:60,winPoints:5}},
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
let noContextPending=false;
// Browser-only Host preferences. The running order and game progress come from the server.
let nightPrefs={},nightEventId=null,nightScreen='auto',editorReturn='auto',nightPending=false,editorDraft=null,editorOriginal='',editorSaving=false,libraryMode=null,lastStatuses=new Map();
const adoptedEvents=new Set();
const runner=createActionRunner({showError:showHostError,clearError:clearHostError,onBusyChange:()=>renderNight()});
function showHostError(message){$('#hostAlertText').textContent=message;$('#hostAlert').hidden=false}
function clearHostError(){$('#hostAlert').hidden=true}
function storedPlan(eventId){try{return JSON.parse(localStorage.getItem(PLAN_PREFIX+eventId))}catch{return null}}
// Only display preferences are written; an older stored running order is left untouched.
function persistNight(){if(nightEventId)localStorage.setItem(PLAN_PREFIX+nightEventId,JSON.stringify({...(storedPlan(nightEventId)||{}),finished:Boolean(nightPrefs.finished),audienceManual:Boolean(nightPrefs.audienceManual)}))}
function loadNight(){
  const snapshot=remoteSession();if(!snapshot)return;
  if(nightEventId!==snapshot.event.id){
    nightEventId=snapshot.event.id;nightScreen='auto';editorDraft=null;editingRoundId=null;perfectLieBrowseQuestionId='';perfectLieObservedQuestionId=null;lastStatuses=new Map();closeModal();
    const stored=storedPlan(nightEventId)||{};nightPrefs={finished:Boolean(stored.finished),audienceManual:Boolean(stored.audienceManual)};
  }
  // An older database returns no running order at all. Say so; never fall back to browser storage.
  if(!('lineup' in snapshot))showHostError('Game Night’s database is missing an update this screen needs (event running order). Apply the latest database migrations, then reload the page.');
  // A night created before the running order moved to the server adopts its earlier order once.
  if(snapshot.lineup&&!lineupSaved(snapshot)&&!adoptedEvents.has(nightEventId)){
    adoptedEvents.add(nightEventId);const types=adoptedLineup(snapshot,storedPlan(nightEventId));
    runner.run('lineup',()=>window.gameNightSupabaseActions.setLineup(toGameTypes(types),null),{failure:'Could not load tonight’s running order. Refresh the page to try again.'});
  }
  state.rounds=plannedGames();
}
function plannedGames(){return remoteSession()?nightGames(remoteSession()):[]}
function nightView(){document.querySelector('[data-view="night"]')?.click()}
function gameForId(id){return plannedGames().find(g=>g.id===id||g.remote?.id===id||`control-${GAME_TYPES[g.type]}`===id)}
function primaryNightGame(){return plannedGames().find(g=>g.status==='live'&&g.remote?.id===remoteSession()?.event.active_round_id)||null}
function renderNight(){
  if(!remoteSession())return;
  const list=plannedGames(),live=primaryNightGame(),next=list.find(g=>g.status==='upcoming'),finished=nightPrefs.finished&& !live;
  const selectedPaused=list.find(g=>g.status==='paused'&&g.remote?.id===remoteSession().event.active_round_id);
  const history=nightScreen.startsWith('history:')?list.find(g=>g.id===nightScreen.slice(8)&&g.status==='complete'):null;
  const configuring=nightScreen.startsWith('configure:')&&Boolean(editorDraft);
  const stage=!configuring&&Boolean(history||(live||selectedPaused)&&nightScreen!=='order');if(!stage)clearInterval(liveTicker);
  $('#nightOverview').hidden=stage||configuring;$('#nightConfigure').hidden=!configuring;$('#nightStage').hidden=!stage;
  if(history){renderGameHistory(history)}else if(stage&&selectedPaused){renderPausedGame(selectedPaused)}else if(stage){const id=live.remote?.id;if(id)localStorage.setItem(CONTROL_ROUND_PREFIX+nightEventId,id);$('#nightStage').dataset.game=live.type;renderLiveControl()}
  if(!stage&&!configuring)renderDashboard(list,live,selectedPaused,next,finished);
  renderAudienceOverride();
}
function renderDashboard(list,live,pausedGame,next,finished){
  const s=remoteSession(),root=$('#nightOverview'),started=Boolean(s.lineup?.started_at)||list.some(g=>g.status!=='upcoming');
  root.innerHTML=dashboardMarkup({event:{name:s.event.name,venue:s.event.venue,date:s.event.event_date?formatEventDate(s.event.event_date):'',roomCode:s.event.room_code},teamCount:remoteTeams().filter(t=>t.status==='active').length,games:list,started,busy:runner.isBusy()||nightPending,live,pausedGame,next,finished,startCheck:nightStartCheck(list)});
  bindDashboard(root,{action:dashboardAction,move:(type,to)=>changeLineup(types=>moveGame(types,type,to),`${games[type].name} moved to position ${to+1}.`)},plannedGames);
}
async function copyJoinLink(){const code=remoteSession()?.event?.room_code;if(!code)return;const url=new URL('team.html',location.href);url.searchParams.set('room',code);try{await navigator.clipboard.writeText(url.href);toast('Team join link copied')}catch{toast(`Room code: ${code}`)}}
function dashboardAction(action,type){
  const index=plannedGames().findIndex(g=>g.type===type),name=games[type]?.name;
  if(action==='add')return openLibrary('add');
  if(action==='replace')return openLibrary('replace',type);
  if(action==='remove'){if(confirm(`Remove ${name} from tonight’s line-up? Its saved settings are kept if you add it again.`))changeLineup(types=>removeGame(types,type),`${name} removed from tonight’s line-up.`);return}
  if(action==='move-up'||action==='move-down')return changeLineup(types=>moveGame(types,type,index+(action==='move-up'?-1:1)),`${name} moved to position ${index+(action==='move-up'?0:2)}.`);
  if(action==='edit')return openEditor(type);
  if(action==='start-game')return startNightGame(type);
  if(action==='open-live'){nightScreen='auto';return renderNight()}
  if(action==='history'){nightScreen='history:'+type;return renderNight()}
  if(action==='start-night')return runner.run('start-night',()=>window.gameNightSupabaseActions.startGameNight(),{failure:'Could not start the night. Please try again.'});
  if(action==='finish-night')return runner.run('finish-night',async()=>{await window.gameNightSupabaseActions.setDisplay('leaderboard');nightPrefs.finished=true;persistNight();renderNight()},{failure:'Could not show the final standings. Please try again.'});
  if(action==='leaderboard'||action==='teams')return document.querySelector(`[data-view="${action}"]`)?.click();
  if(action==='copy-link')return copyJoinLink();
}
// Every running-order change goes to the server with the revision this screen last saw.
async function changeLineup(transform,announcement){
  const s=remoteSession(),current=serverLineupTypes(s),next=transform(current);
  if(next.join()===current.join())return;
  const focused=document.activeElement?.closest?.('#nightOverview [data-action]'),focusKey=focused?[focused.dataset.action,focused.dataset.type]:null;
  const result=await runner.run('lineup',()=>window.gameNightSupabaseActions.setLineup(toGameTypes(next),s.lineup?.revision??null),{failure:'Could not update tonight’s games. Please try again.'});
  if(!result.ok&&result.error?.code==='40001')await window.gameNightSupabaseActions.refresh().catch(console.error);
  renderNight();
  if(!result.ok)return;
  const announce=$('#dashAnnounce');if(announce)announce.textContent=announcement;
  if(focusKey)(document.querySelector(`#nightOverview [data-action="${focusKey[0]}"][data-type="${focusKey[1]}"]:not(:disabled)`)||document.querySelector(`#nightOverview .gn-card[data-type="${focusKey[1]}"] .gn-card-primary`))?.focus();
}
async function startNightGame(id){
  const game=gameForId(id);if(!game||nightPending||!['upcoming','paused'].includes(game.status))return;
  if(game.status!=='paused'&&game.configIssue)return openEditor(game.type);
  if(game.status!=='paused'&&game.error)return showHostError(game.error);
  nightPending=true;clearHostError();renderNight();
  try{
    await startPlannedGame(game,{snapshot:remoteSession,actions:window.gameNightSupabaseActions,prompts:NO_CONTEXT_TEST_PROMPTS});
    nightPrefs.finished=false;nightScreen='auto';persistNight();nightView();
  }catch(error){console.error(error);showHostError(friendlyHostError(error,'Could not start this game. Please try again.'))}finally{nightPending=false;loadNight();renderNight()}
}
function renderPausedGame(game){
  clearInterval(liveTicker);$('#nightStage').dataset.game=game.type;
  $('#liveControl').innerHTML=`<header class="stage-heading"><div><p class="eyebrow">PAUSED</p><h2>${esc(games[game.type].name)}</h2><p>Your progress and points are saved. The clock is stopped.</p></div><button class="btn secondary" data-night-order>Tonight’s Games →</button></header><section class="panel"><h2>Ready to pick up where you left off?</h2><p>Resume continues the same question or phase, with the time that was left. Previously accepted answers and votes are preserved.</p><button class="btn primary" id="resumePausedGame">Resume Game</button></section>`;
  bindRoundNavigator();$('#resumePausedGame').onclick=async()=>{const button=$('#resumePausedGame');button.disabled=true;try{await window.gameNightSupabaseActions.resumeGame(game.remote.id);loadNight();renderNight()}catch(error){toast(error.message||'Could not resume this game.');button.disabled=false}};
}
function renderGameHistory(game){
  const replay=game.type==='guessAge'||game.type==='noContext';
  $('#nightStage').dataset.game=game.type;
  $('#liveControl').innerHTML=`<header class="stage-heading"><div><p class="eyebrow">COMPLETE</p><h2>${esc(games[game.type].name)}</h2><p>Game finished. Points are included in tonight’s standings.</p></div><button class="btn secondary" data-night-order>Tonight’s Games →</button></header><section class="panel"><h2>Current standings</h2><div class="host-leaderboard">${leaderboardRows(remoteSession().leaderboard||[]).map(t=>`<div class="leaderboard-row"><span>${t.place}</span><strong>${mascotEmoji(t.mascot_id)} ${esc(t.name)}</strong><b>${t.points} pts</b></div>`).join('')}</div>${replay?'<details class="more-menu"><summary>More actions</summary><button class="danger-link" id="replayCompleted">Restart this game…</button></details>':''}<details class="more-menu"><summary>New night</summary><button id="newNightFromHistory">Start a new session…</button></details></section>`;
  bindRoundNavigator();
  if($('#replayCompleted'))$('#replayCompleted').onclick=async()=>{
    if(primaryNightGame())return toast('Finish the current game before restarting this one.');
    if(!confirm(`Restart ${games[game.type].name}? Its answers and game points will be removed. Teams and other game scores stay.`))return;
    try{if(game.type==='guessAge')await window.gameNightSupabaseActions.restartRound();else await window.gameNightSupabaseActions.controlNoContext(remoteSession().no_context.play.id,'restart');nightPrefs.finished=false;nightScreen='auto';persistNight();renderNight()}catch{toast('Could not restart the game. Please try again.')}
  };
  $('#newNightFromHistory').onclick=()=>runConfirmed(confirm,'Create a new room? This night stays in history. Only the Guess the Age lineup is copied.',()=>window.gameNightSupabaseActions.startNewSession());
}
function renderAudienceOverride(){
  const root=$('#audienceOverride');if(!root||!remoteSession())return;
  root.innerHTML=`<p class="eyebrow">AUDIENCE SCREEN</p><p class="hint">Start a game to put it on screen. Choose a view below to override it.</p><label class="audience-auto"><input id="autoAudience" type="checkbox" ${nightPrefs.audienceManual?'':'checked'}> Automatic between games</label>${audienceSelector(remoteSession().event)}`;
  $('#autoAudience').onchange=e=>{nightPrefs.audienceManual=!e.target.checked;persistNight()};bindAudienceSelector();
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
function remotePerfectLie(){return remoteSession()?.perfect_lie||null}
function storageBase(){return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/celebrity-images`}
let perfectLieHostPending=false,perfectLieBrowseQuestionId='',perfectLieObservedQuestionId=null
function remoteQuestion(){const s=remoteSession();return remoteGuessRound()?.questions?.find(q=>q.id===s?.event?.active_question_id)||remoteGuessRound()?.questions?.[0]||null}
function remoteTimeLeft(){const s=remoteSession();if(!s?.event?.question_deadline_at)return 0;const serverAtHydration=new Date(s.server_now).getTime(),deadline=new Date(s.event.question_deadline_at).getTime(),elapsed=Date.now()-(s._hydratedAt||Date.now());return Math.max(0,Math.ceil((deadline-serverAtHydration-elapsed)/1000))}
function controlRounds(){return mergeHostRoundOptions(remoteSession()||{},state.rounds)}
function selectedControlRound(){const s=remoteSession(),rounds=controlRounds(),saved=s?.event?.id?localStorage.getItem(CONTROL_ROUND_PREFIX+s.event.id):null,id=selectSensibleControlRound(rounds,saved,s?.event?.active_round_id);return rounds.find(r=>r.id===id)||null}
function selectControlRound(id){const game=gameForId(id);if(!game)return;if(game.status==='upcoming')return openEditor(game.type);if(game.status==='complete'){nightScreen='order';nightView();return}nightScreen='auto';nightView()}
function roundNavigator(){const list=plannedGames(),live=primaryNightGame(),selected=live||gameForId(selectedControlRound()?.id),next=list.find(g=>g.status==='upcoming');return `<header class="stage-heading"><div><p class="eyebrow">${selected?.status==='complete'?'COMPLETE':'ON STAGE'} · GAME ${Math.max(1,list.findIndex(g=>g.id===selected?.id)+1)} OF ${list.length}</p><h2>${esc(games[selected?.type]?.name||'Game Night')}</h2><p>${next?`Up next: ${esc(games[next.type].name)}`:'The final game of the night'}</p></div><button class="btn secondary" data-night-order>Tonight’s Games ↗</button></header><div class="stage-progress" aria-label="Tonight’s Games">${list.map(g=>`<span class="${g.status}" data-control-round="${g.remote?.id||g.id}">${g.status==='complete'?'✓':g.status==='live'?'●':'○'} ${esc(games[g.type].name)}</span>`).join('')}</div>`}
function bindRoundNavigator(){document.querySelectorAll('[data-night-order]').forEach(b=>b.onclick=()=>{nightScreen='order';renderNight()})}
function audienceSelector(event){return `<div class="audience-control"><div>${audienceDisplayOptions(event.display_mode).map(mode=>`<button class="segment ${mode.selected?'selected':''}" data-display="${mode.value}" aria-pressed="${mode.selected}">${mode.label}</button>`).join('')}</div></div>`}
function bindAudienceSelector(){document.querySelectorAll('[data-display]').forEach(button=>button.onclick=async()=>{try{await window.gameNightSupabaseActions.setDisplay(button.dataset.display);nightPrefs.audienceManual=true;persistNight();renderAudienceOverride()}catch{toast('Could not change the Audience screen.')}})}

function bindEventFields(){
  const remote=remoteSession()?.event;
  if(remote){
    state.event={...state.event,name:remote.name,venue:remote.venue,date:remote.event_date,roomCode:remote.room_code};
    $('#eventTitle').textContent=remote.name;$('#eventStatusLine').textContent=[remote.event_date?formatEventDate(remote.event_date):'',remote.venue].filter(Boolean).join(' · ');
    return;
  }
  // Local prototype only.
  if(!$('#eventName'))return;
  $('#eventName').value=state.event.name;$('#venueName').value=state.event.venue;$('#eventDate').value=state.event.date;$('#eventTitle').textContent=state.event.name;
  [['eventName','name'],['venueName','venue'],['eventDate','date']].forEach(([id,key])=>$('#'+id).oninput=e=>{state.event[key]=e.target.value;$('#eventTitle').textContent=state.event.name||'Untitled Game Night';save(false)});
}
// One configuration view for every game: the game's own editor, then Cancel / Save Game.
function openEditor(type){
  const game=gameForId(type);if(!game)return;
  if(!game.editable)return showHostError(`${games[game.type].name} has already been on stage, so its settings are locked.`);
  editingRoundId=game.type;editorReturn=nightScreen.startsWith('configure:')?editorReturn:nightScreen;
  editorDraft={id:game.type,type:game.type,title:game.title,settings:structuredClone(game.settings)};
  if(game.type==='perfectLie'&&!editorDraft.settings.categories.length)editorDraft.settings.categories=createPerfectLieDraft().categories;
  if(game.type==='guessAge')for(const c of editorDraft.settings.celebrities||[])if(c.imageKind==='storage'&&c.imagePath)c.image=`${storageBase()}/${c.imagePath}`;
  editorOriginal=JSON.stringify(editorDraft);nightScreen='configure:'+game.type;
  const info=game.type==='noContext';
  $('#nightConfigure').dataset.game=game.type;$('#configIdentity').innerHTML=configHeaderMarkup(game);$('#gameSettingsError').hidden=true;
  $('#doneRound').textContent=info?'Done':'Save Game';$('#doneRound').disabled=false;$('#cancelConfig').hidden=info;
  $('#configNote').textContent=info?'No Context uses five sample picture prompts. Custom prompts will come later.':'Changes apply when you press Save Game. Saving never starts or switches a game.';
  renderDrawer(editorDraft);renderNight();window.scrollTo?.(0,0);$('#configBack').focus();
}
function closeEditor({force=false}={}){
  if(editorSaving||!editorDraft)return;
  if(!force&&JSON.stringify(editorDraft)!==editorOriginal&&!confirm('Discard your unsaved changes to this game?'))return;
  const type=editingRoundId;editingRoundId=null;editorDraft=null;nightScreen=editorReturn||'auto';renderNight();
  document.querySelector(`#nightOverview .gn-card[data-type="${type}"] .gn-card-primary`)?.focus();
}
async function saveGameSettings(){
  if(!editorDraft||editorSaving)return;
  const r=editorDraft,original=gameForId(editingRoundId);
  const fail=message=>{$('#gameSettingsError').textContent=message;$('#gameSettingsError').hidden=false};
  if(r.type==='noContext')return closeEditor({force:true});
  if(!original?.editable)return fail('This game has started. Its settings are now locked.');
  const error=r.type==='guessAge'?lineupValidationError(r.settings.celebrities)?.replaceAll('syncing','saving'):r.type==='perfectLie'?perfectLieValidationError(r.settings.categories):r.type==='iBetYou'?categorySelectionError(r.settings.categories):null;
  if(error)return fail(error);
  editorSaving=true;$('#doneRound').disabled=true;$('#doneRound').textContent='Saving…';$('#gameSettingsError').hidden=true;
  try{
    if(r.type==='guessAge')await window.gameNightSupabaseActions.saveGuessAgeRound(r.title,r.settings.celebrities);
    if(r.type==='iBetYou')await window.gameNightSupabaseActions.saveIBetYouSettings(r.settings.categories);
    if(r.type==='perfectLie')await window.gameNightSupabaseActions.savePerfectLie(r.title,perfectLiePayload(r.settings.categories));
    editorSaving=false;toast('Game saved');closeEditor({force:true});
  }catch(err){console.error(err);fail(friendlyHostError(err,'Could not save this game. Your changes are still here.'))}finally{editorSaving=false;$('#doneRound').disabled=false;$('#doneRound').textContent='Save Game'}
}
function renderDrawer(r){
  if(r.type==='guessAge') return renderGuessAgeEditor(r);
  if(r.type==='noContext'){$('#drawerBody').innerHTML='<div class="settings-intro"><span class="settings-game-icon">💬</span><h3>Five pictures. Absolutely no context.</h3><p>Teams write a caption, then vote for their favourites. Reveal the podium and let the room react.</p></div><div class="nc-prompt-preview">'+NO_CONTEXT_TEST_PROMPTS.map(p=>`<img src="${esc(p.media.url)}" alt="${esc(p.instruction)}">`).join('')+'</div><p class="hint">Includes five sample image prompts. Custom images and prompt editing are not available yet.</p><div class="settings-facts"><span><strong>45 sec</strong> to write</span><span><strong>30 sec</strong> to vote</span><span><strong>5 / 3 / 1</strong> podium points</span></div>';return}
  if(r.type==='iBetYou') return renderIBetEditor(r);
  if(r.type==='perfectLie')return renderPerfectLieEditor(r);
  $('#drawerBody').innerHTML=`<div class="field"><label>Game title</label><input id="roundTitleInput" value="${esc(r.title)}"></div><div class="empty-state" style="margin-top:18px"><strong>This round is intentionally a placeholder.</strong><p class="hint">When we decide the next game, its own editor will live here while still using the same event, teams and leaderboard.</p></div>`;
  $('#roundTitleInput').oninput=e=>r.title=e.target.value;
}
function renderPerfectLieEditor(r){const categories=r.settings.categories||=[];$('#drawerBody').innerHTML=`<div class="field"><label>Game title</label><input id="perfectLieTitle" value="${esc(r.title)}"></div><p class="hint">Correct answers, accepted variants and sources remain Host-only until the reveal.</p><div id="perfectLieCategories" class="perfect-lie-editor">${categories.map((c,ci)=>`<section class="perfect-lie-category" data-category="${ci}"><div class="perfect-lie-category-head"><input class="pl-category-title" value="${esc(c.title)}" aria-label="Category name"><div><button class="mini-btn pl-cat-up" ${ci===0?'disabled':''}>Up</button><button class="mini-btn pl-cat-down" ${ci===categories.length-1?'disabled':''}>Down</button><button class="mini-btn danger-link pl-cat-delete">Delete</button></div></div>${(c.questions||[]).map((q,qi)=>`<article class="perfect-lie-question" data-question="${qi}"><strong>Question ${qi+1}</strong><textarea class="pl-question-text" placeholder="Question text">${esc(q.question_text)}</textarea><input class="pl-correct" value="${esc(q.correct_answer)}" placeholder="Correct answer"><input class="pl-variants" value="${esc(Array.isArray(q.accepted_answer_variants)?q.accepted_answer_variants.join(', '):q.accepted_answer_variants)}" placeholder="Accepted variants, comma separated"><textarea class="pl-explanation" placeholder="Optional reveal explanation">${esc(q.explanation)}</textarea><input class="pl-source" value="${esc(q.source_reference)}" placeholder="Optional Host-only source/reference"><div><button class="mini-btn pl-q-up" ${qi===0?'disabled':''}>Up</button><button class="mini-btn pl-q-down" ${qi===c.questions.length-1?'disabled':''}>Down</button><button class="mini-btn danger-link pl-q-delete">Delete</button></div></article>`).join('')}<button class="mini-btn pl-add-question">+ Add question</button></section>`).join('')}</div><button class="btn secondary" id="plAddCategory">+ Add category</button>`;$('#perfectLieTitle').oninput=e=>r.title=e.target.value;document.querySelectorAll('.perfect-lie-category').forEach(section=>{const ci=Number(section.dataset.category),c=categories[ci];section.querySelector('.pl-category-title').oninput=e=>c.title=e.target.value;section.querySelector('.pl-cat-up').onclick=()=>{movePerfectLieItem(categories,ci,-1);renderPerfectLieEditor(r)};section.querySelector('.pl-cat-down').onclick=()=>{movePerfectLieItem(categories,ci,1);renderPerfectLieEditor(r)};section.querySelector('.pl-cat-delete').onclick=()=>{categories.splice(ci,1);renderPerfectLieEditor(r)};section.querySelector('.pl-add-question').onclick=()=>{c.questions.push(createPerfectLieQuestion());renderPerfectLieEditor(r)};section.querySelectorAll('.perfect-lie-question').forEach(row=>{const qi=Number(row.dataset.question),q=c.questions[qi];[['.pl-question-text','question_text'],['.pl-correct','correct_answer'],['.pl-variants','accepted_answer_variants'],['.pl-explanation','explanation'],['.pl-source','source_reference']].forEach(([selector,key])=>row.querySelector(selector).oninput=e=>q[key]=e.target.value);row.querySelector('.pl-q-up').onclick=()=>{movePerfectLieItem(c.questions,qi,-1);renderPerfectLieEditor(r)};row.querySelector('.pl-q-down').onclick=()=>{movePerfectLieItem(c.questions,qi,1);renderPerfectLieEditor(r)};row.querySelector('.pl-q-delete').onclick=()=>{c.questions.splice(qi,1);renderPerfectLieEditor(r)}})});$('#plAddCategory').onclick=()=>{categories.push(createPerfectLieCategory());renderPerfectLieEditor(r)}}
function renderGuessAgeEditor(r){
  const celebs=r.settings.celebrities||[];
  $('#drawerBody').innerHTML=`<div class="settings-grid"><label class="field">Game title<input id="roundTitleInput" value="${esc(r.title)}"></label><label class="field">Answer timer<select id="timerInput"><option value="10">10 seconds</option><option value="12">12 seconds</option><option value="15">15 seconds</option><option value="20">20 seconds</option></select></label></div><p class="hint">Start with ten celebrities, or your last saved lineup. Edit, remove, reorder or add anyone you like. Save Game remembers your lineup for future nights. Ages are calculated for tonight. Add a portrait photo for each question; check that you have permission to use it.</p><div class="subheading"><h3>Celebrity lineup <span style="color:var(--muted)">(${celebs.length})</span></h3><button class="mini-btn" id="addCeleb">+ Add</button></div><div class="celebs" id="celebList"></div>`;
  $('#roundTitleInput').oninput=e=>r.title=e.target.value;$('#timerInput').value='15';$('#timerInput').disabled=true;$('#timerInput').onchange=e=>r.settings.timer=Number(e.target.value);$('#addCeleb').onclick=()=>{celebs.push(createNewCelebrityDraft());renderGuessAgeEditor(r)};renderCelebs(r);
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
      ${c.imageSourceKind==='wikipedia'?'<small class="photo-source">Photo from Wikipedia</small>':''}
    </div>
    <div class="celeb-fields">
      <input data-field="name" data-i="${i}" value="${esc(c.name)}" placeholder="Search or enter celebrity">
      <input data-field="image" data-i="${i}" value="${esc(c.image?.startsWith('data:')?'':(c.image||''))}" placeholder="Or paste image URL">
      <small class="library-state">${c.image?'Photo added':'Add a photo'}</small>
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
  el.querySelectorAll('.move-celeb-up,.move-celeb-down').forEach(b=>b.onclick=()=>{if(moveItem(r.settings.celebrities,Number(b.dataset.i),b.classList.contains('move-celeb-up')?-1:1))renderCelebs(r)});
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
  const s=r.settings;s.categories??=iBetCategoryDefaults(remoteSession()||{});
  const categories=s.categories,count=categories.filter(c=>c.selected).length;
  $('#drawerBody').innerHTML=`<label class="field">Game title<input id="roundTitleInput" value="${esc(r.title)}"></label><p class="hint">Teams are grouped automatically when you start. Each group draws a different category from your selection. Save Game remembers this selection and your custom categories for future nights.</p><div class="subheading"><h3>Categories (${count} selected)</h3><div><button class="mini-btn" id="selectAllCategories">Select all</button><button class="mini-btn" id="clearCategories">Deselect all</button></div></div><div class="ibet-category-list">${categories.map((c,i)=>`<label class="ibet-category-choice"><input type="checkbox" data-category="${i}" ${c.selected?'checked':''}><span>${esc(c.title)}<small>${c.custom?'Your category':esc(c.difficulty||'')}</small></span></label>`).join('')||'<p>The category list is unavailable. Refresh and try again.</p>'}</div><div class="ibet-add-category"><label class="field">Your own category<input id="customCategoryTitle" maxlength="120" placeholder="e.g. Irish comedians"></label><button class="btn secondary" id="addIBetCategory">+ Add Category</button></div><p class="hint" id="categoryDraftError" role="status"></p><div class="settings-facts"><span><strong>60 sec</strong> challenge</span><span><strong>5 points</strong> to the winner</span></div>`;
  $('#roundTitleInput').oninput=e=>r.title=e.target.value;
  document.querySelectorAll('[data-category]').forEach(input=>input.onchange=()=>{categories[Number(input.dataset.category)].selected=input.checked;$('#drawerBody .subheading h3').textContent=`Categories (${categories.filter(c=>c.selected).length} selected)`});
  $('#selectAllCategories').onclick=()=>{categories.forEach(c=>c.selected=true);renderIBetEditor(r)};
  $('#clearCategories').onclick=()=>{categories.forEach(c=>c.selected=false);renderIBetEditor(r)};
  const add=()=>{const title=$('#customCategoryTitle').value.trim().replace(/\s+/g,' ');if(title.length<2){$('#categoryDraftError').textContent='Enter a category with at least two characters.';return}const existing=categories.find(c=>c.title.toLowerCase()===title.toLowerCase());if(existing)existing.selected=true;else categories.push({title,selected:true,custom:true});renderIBetEditor(r);$('#customCategoryTitle').focus()};
  $('#addIBetCategory').onclick=add;$('#customCategoryTitle').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add()}};
}

function renderTeams(){
  const joined=remoteTeams();
  ($('#connectedCount')||{}).textContent=remoteSession()?`${joined.length} teams registered`:`${state.teams.length} local test teams`;
  if(remoteSession()){$('#teamsSummary').textContent=`${joined.length} Team${joined.length===1?'':'s'} registered · One Captain per team · Captains play for their tables`;$('#addTeam').hidden=true;$('#teamsTable').innerHTML=`<div class="host-team-list">${joined.map(t=>`<div class="host-team"><span>${mascotEmoji(t.mascot_id)}</span><strong>${esc(t.name)}</strong><time>Joined ${new Date(t.joined_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>`).join('')||'<div class="empty-state">Waiting for Teams to join…</div>'}</div>`;return}
  const authoritative=remoteSession()?`<div class="remote-teams"><h3>Supabase-joined Teams</h3><p>Authoritative room membership and mascot identity.</p><table><thead><tr><th>Team</th><th>Status</th><th>Joined</th></tr></thead><tbody>${joined.map(t=>`<tr><td><strong><span class="mascot-inline">${mascotEmoji(t.mascot_id)}</span> ${esc(t.name)}</strong></td><td><span class="remote-team-state">${esc(t.status)}</span></td><td>${new Date(t.joined_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td></tr>`).join('')||'<tr><td colspan="3">Waiting for Teams to join…</td></tr>'}</tbody></table></div>`:'';
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
  if($('#openAudience'))$('#openAudience').onclick=()=>window.open('audience.html','gameNightAudience');
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
function renderRemoteLeaderboard(){const board=leaderboardRows(remoteSession()?.leaderboard||[]);$('#leaderboardTable').innerHTML=`<div class="host-leaderboard">${board.map(t=>`<div class="leaderboard-row"><span class="leader-place">${t.place<=3?['🥇','🥈','🥉'][t.place-1]:t.place}</span><strong>${mascotEmoji(t.mascot_id)} ${esc(t.name)}</strong><b>${t.points} pts</b></div>`).join('')||'<div class="empty-state">No scores yet</div>'}</div>`}
function renderRemoteLiveControl(){
  clearInterval(liveTicker)
  const s=remoteSession(),r=remoteGuessRound(),questions=r?.questions||[],event=s.event,q=remoteQuestion(),status=event.status,left=remoteTimeLeft(),submitted=new Map((s.submissions||[]).filter(x=>x.guess_integer!=null).map(x=>[x.team_id,x])),awards=new Map((s.awards||[]).map(x=>[x.team_id,x]));
  const selected=selectedControlRound();if(selected?.game_type==='no_context')return renderRemoteNoContext();if(selected?.game_type==='perfect_lie')return renderRemotePerfectLieControl();if(selected?.game_type==='i_bet_you')return s.i_bet_you?renderRemoteIBetControl():renderRemoteIBetSetup();if(selected&&!selected.configured){$('#liveControl').innerHTML=roundNavigator()+'<div class="empty-state">This round needs setup before it can be controlled.</div>';bindRoundNavigator();return}
  const rows=remoteTeams().map(t=>{const sub=submitted.get(t.id),award=awards.get(t.id);return `<tr><td>${mascotEmoji(t.mascot_id)} ${esc(t.name)}</td><td>${sub?.guess_integer??'—'}</td><td>${sub?'<span class="submission done">Locked</span>':'<span class="submission waiting">Waiting</span>'}${award?` · +${award.points}`:''}</td></tr>`}).join('');
  $('#liveControl').innerHTML=`<div class="live-toolbar panel"><div><p class="eyebrow">SUPABASE LIVE EVENT</p><h2>${esc(event.name)}</h2><p class="hint">Authoritative gameplay across physical devices. Room ${esc(event.room_code)}</p></div><div class="top-actions"><button class="btn secondary" id="openAudience">Open audience ↗</button><button class="btn secondary" id="openTeamTest">Open Team ↗</button><button class="btn secondary" id="prepareIBet">Prepare I Bet You</button><button class="btn ghost" id="audienceIdle">Show Join Screen</button><button class="btn ghost" id="returnGame">Return to Game</button></div></div>
  <div class="live-grid"><div class="panel live-main"><div class="panel-heading"><div><p class="label">GUESS THE AGE</p><h2>${esc(r?.title||'Needs setup')}</h2></div><span class="pill ${status==='question'?'live':'ready'}">${esc(status)}</span></div>
  ${r?`<label class="field">Question<select id="remoteQuestionSelect">${questions.map(x=>`<option value="${x.id}" ${x.id===q?.id?'selected':''}>${x.position}. ${esc(x.celebrity_name)}</option>`).join('')}</select></label><div class="question-preview"><div class="preview-art">${q?.external_image_url?`<div class="preview-art-bg" style="background-image:url('${esc(q.external_image_url)}')"></div><img class="preview-art-main" src="${esc(q.external_image_url)}" alt="">`:`<span>${esc((q?.celebrity_name||'?').split(' ').map(x=>x[0]).slice(0,2).join(''))}</span>`}</div><div><p class="eyebrow">QUESTION ${q?.position||0} OF ${questions.length}</p><h3>${esc(q?.celebrity_name||'Select a question')}</h3><p>Correct age: <strong>${status==='reveal'?ageOn(q?.date_of_birth,event.event_date):'hidden'}</strong></p></div><div class="timer-chip"><span>${status==='question'?left:status==='suspense'?'5':15}</span><small>${status==='suspense'?'SUSPENSE':'SECONDS'}</small></div></div><div class="live-actions"><button class="btn primary" id="startQuestion" ${!q||!['lobby','ready','locked','reveal','round_complete','leaderboard'].includes(status)?'disabled':''}>Start 15s question</button><button class="btn ghost" id="nextQuestion" ${status!=='reveal'?'disabled':''}>Next question →</button></div>`:`<div class="empty-state"><strong>Add your celebrity lineup in Game Settings.</strong><p class="hint">Save your celebrities and photos before starting this game.</p></div>`}
  <div class="live-meta"><span><strong>${submitted.size}/${remoteTeams().length}</strong> Teams answered</span><span>${status==='suspense'?'5-second server suspense':'Server-authoritative deadline'}</span><span>Scoring is idempotent</span></div></div><div class="panel live-side"><div class="panel-heading"><div><p class="label">TEAM SUBMISSIONS</p><h2>Team answers</h2></div><span class="pill ready">Authoritative</span></div><div class="submission-table"><table><thead><tr><th>Team</th><th>Age</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><button class="btn full" id="showLeaderboard">Show Leaderboard</button><div class="recovery-actions"><p class="label">RECOVERY / MORE ACTIONS</p><button class="btn ghost full" id="restartRound">Restart Guess the Age Round</button><button class="btn ghost full" id="newSession">Start New Session</button></div></div></div>`;
  if($('#openAudience'))$('#openAudience').onclick=()=>window.open(`audience.html?room=${encodeURIComponent(event.room_code)}`,'gameNightAudience');$('#openTeamTest').onclick=()=>window.open(`team.html?room=${encodeURIComponent(event.room_code)}`,'_blank');$('#prepareIBet').onclick=()=>window.gameNightSupabaseActions.setupIBetYou();$('#audienceIdle').onclick=()=>window.gameNightSupabaseActions.setDisplay('join');$('#returnGame').onclick=()=>window.gameNightSupabaseActions.setDisplay('game');$('#showLeaderboard').onclick=()=>window.gameNightSupabaseActions.setDisplay('leaderboard');
  $('#restartRound').onclick=()=>runConfirmed(confirm,'Restart Guess the Age? Team membership and manual corrections stay, but all Guess the Age answers and game awards will be removed.',()=>window.gameNightSupabaseActions.restartRound());
  $('#newSession').onclick=()=>runConfirmed(confirm,'Start a fresh session with a new room code? The current event will be kept as history.',()=>window.gameNightSupabaseActions.startNewSession());
  if(r){$('#startQuestion').onclick=()=>window.gameNightSupabaseActions.startQuestion($('#remoteQuestionSelect').value);$('#nextQuestion').onclick=()=>window.gameNightSupabaseActions.advanceQuestion();}
  polishRemoteGuessControl(event,status,q,submitted.size);
  if(status==='question'){clearInterval(liveTicker);liveTicker=setInterval(()=>{if(remoteTimeLeft()<=0){clearInterval(liveTicker);renderRemoteLiveControl()}else renderRemoteLiveControl()},250)}
}
function renderRemoteIBetSetup(){const event=remoteSession().event;$('#liveControl').innerHTML=`${roundNavigator()}<section class="control-empty"><h2>I Bet You</h2><p>Create groups and categories from the Teams currently joined. This does not begin bidding.</p><button class="btn primary" id="prepareIBet">Prepare I Bet You</button></section>`;bindRoundNavigator();bindAudienceSelector();if($('#openAudience'))$('#openAudience').onclick=()=>window.open(`audience.html?room=${encodeURIComponent(event.room_code)}`,'gameNightAudience');$('#prepareIBet').onclick=()=>window.gameNightSupabaseActions.setupIBetYou()}
async function runPerfectLieHostAction(action,failure){if(perfectLieHostPending)return;perfectLieHostPending=true;renderRemotePerfectLieControl();try{await action()}catch(error){console.error(error);toast(failure);await window.gameNightSupabaseActions.refresh().catch(console.error)}finally{perfectLieHostPending=false;renderRemotePerfectLieControl()}}
function renderRemotePerfectLieControl(){
  const s=remoteSession(),game=s.perfect_lie,event=s.event
  if(!game?.round){$('#liveControl').innerHTML=roundNavigator()+`<div class="empty-state">Add questions and save ${TABLE_OF_LIES_NAME} in Game Settings first.</div>`;bindRoundNavigator();return}
  if(game.round.active_question_id!==perfectLieObservedQuestionId){perfectLieObservedQuestionId=game.round.active_question_id;perfectLieBrowseQuestionId=game.round.active_question_id||''}
  const phase=game.round.phase,q=game.question,control=perfectLieHostControlModel(game,perfectLieBrowseQuestionId),{questions,authoritative,browsed,canPrepare}=control,rows=(game.team_status||[]).map(t=>`<tr><td>${mascotEmoji(t.mascot_id)} ${esc(t.name)}</td><td>${t.answered?'Answer in ✓':'Waiting'}</td><td>${t.lie_submitted?'Locked ✓':'Waiting'}</td><td>${t.voted?'Locked ✓':'—'}</td></tr>`).join(''),optionCount=game.options?.length||0
  if(control.browseQuestionId)perfectLieBrowseQuestionId=control.browseQuestionId
  let primary=''
  if(canPrepare)primary=`<button class="btn primary" id="plStart" ${browsed&&!perfectLieHostPending?'':'disabled'}>${perfectLieHostPending?'WORKING…':'START QUESTION'}</button>`
  if(phase==='writing')primary=`<button class="btn primary" id="plClose" ${perfectLieHostPending?'disabled':''}>${perfectLieHostPending?'WORKING…':'CLOSE SUBMISSIONS'}</button>`
  if(phase==='voting')primary=`<button class="btn primary" id="plReveal" ${perfectLieHostPending?'disabled':''}>${perfectLieHostPending?'WORKING…':'START REVEAL'}</button>`
  if(phase==='reveal')primary=`<p class="perfect-lie-reveal-progress">${perfectLieRevealProgress(game.round.reveal_index,optionCount)}</p><button class="btn primary" id="plNextReveal" ${perfectLieHostPending?'disabled':''}>${perfectLieHostPending?'WORKING…':'NEXT ANSWER'}</button>`
  if(phase==='question_complete')primary=`<p class="perfect-lie-reveal-progress">${perfectLieRevealProgress(game.round.reveal_index,optionCount,true)}</p><button class="btn primary" id="plNextQuestion" ${perfectLieHostPending?'disabled':''}>${perfectLieHostPending?'WORKING…':'NEXT QUESTION'}</button>`
  const chooser=canPrepare?`<label class="field">Question<select id="plQuestionSelect"><option value="">Choose a question…</option>${questions.map(x=>`<option value="${x.id}" ${x.id===browsed?.id?'selected':''}>${esc(x.category)} · ${x.position}. ${esc(x.question_text)}</option>`).join('')}</select></label>`:`<div class="field"><label>Current question</label><p>${esc(q?.question_text||'None')}</p><small>Question switching is locked during live gameplay.</small></div>`
  const detail=authoritative?`<h3>${esc(authoritative.question_text)}</h3><p>Answer: <strong>${esc(authoritative.correct_answer)}</strong></p>`:`<h3>Choose a question to continue.</h3>${browsed?`<p>Browsing: <strong>${esc(browsed.category)} · ${esc(browsed.question_text)}</strong></p>`:'<p>Choose a question above, then start when the room is ready.</p>'}`
  $('#liveControl').innerHTML=`${roundNavigator()}<div class="live-grid perfect-lie-admin"><section class="panel live-main"><p class="eyebrow">${TABLE_OF_LIES_LABEL}</p><h2>${esc(authoritative?.category||'Ready to play')}</h2>${chooser}<div class="perfect-lie-host-question">${detail}</div><div class="perfect-lie-counts"><span>${game.answer_count}/${game.team_count} answers in</span><span><strong>${game.lie_count}/${game.team_count}</strong> lies locked in</span><span><strong>${game.vote_count}/${game.team_count}</strong> Teams voted</span></div>${primary}${phase==='complete'?`<div class="empty-state">${TABLE_OF_LIES_NAME} complete. Show the leaderboard or choose your next game.</div>`:''}</section><section class="panel"><h2>Team status</h2><table><thead><tr><th>Team</th><th>Answer</th><th>Lie</th><th>Vote</th></tr></thead><tbody>${rows}</tbody></table></section></div>`
  bindRoundNavigator();bindAudienceSelector();if($('#plAudience'))$('#plAudience').onclick=()=>window.open(`audience.html?room=${encodeURIComponent(event.room_code)}`,'gameNightAudience')
  if($('#plQuestionSelect'))$('#plQuestionSelect').onchange=e=>{perfectLieBrowseQuestionId=e.target.value;renderRemotePerfectLieControl()}
  if($('#plUseQuestion'))$('#plUseQuestion').onclick=()=>runPerfectLieHostAction(()=>window.gameNightSupabaseActions.advancePerfectLieQuestion(perfectLieBrowseQuestionId),'Could not prepare that question.')
  if($('#plStart')&&!$('#plStart').disabled)$('#plStart').onclick=()=>runPerfectLieHostAction(async()=>{if(browsed.id!==authoritative?.id)await window.gameNightSupabaseActions.advancePerfectLieQuestion(browsed.id);await window.gameNightSupabaseActions.startPerfectLieQuestion(browsed.id)},'Could not start the question.');
  if($('#plClose'))$('#plClose').onclick=()=>{const warning=perfectLieMissingConfirmation('lies',game.lie_count,game.team_count);if(warning&&!confirm(warning))return;runPerfectLieHostAction(()=>window.gameNightSupabaseActions.closePerfectLieWriting(),'Could not close submissions.')}
  if($('#plReveal'))$('#plReveal').onclick=()=>{const warning=perfectLieMissingConfirmation('votes',game.vote_count,game.team_count);if(warning&&!confirm(warning))return;runPerfectLieHostAction(()=>window.gameNightSupabaseActions.startPerfectLieReveal(),'Could not start the reveal.')}
  if($('#plNextReveal'))$('#plNextReveal').onclick=()=>runPerfectLieHostAction(()=>window.gameNightSupabaseActions.advancePerfectLieReveal(),'Could not reveal the next answer.')
  if($('#plNextQuestion'))$('#plNextQuestion').onclick=()=>runPerfectLieHostAction(()=>window.gameNightSupabaseActions.advancePerfectLieQuestion(null),'Could not advance to the next question.')
}
function polishRemoteGuessControl(event,status,q,answered){const toolbar=$('#liveControl .live-toolbar');if(toolbar)toolbar.outerHTML=`${roundNavigator()}`;bindRoundNavigator();bindAudienceSelector();if($('#openAudiencePolished'))$('#openAudiencePolished').onclick=()=>window.open(`audience.html?room=${encodeURIComponent(event.room_code)}`,'gameNightAudience');const main=$('#liveControl .live-main');main?.querySelector('.panel-heading .label')?.remove();const title=main?.querySelector('.panel-heading h2');if(title)title.textContent='Guess the Age';main?.querySelector('.live-meta')?.remove();const answerText=main?.querySelector('.question-preview p:last-child');if(answerText)answerText.innerHTML=`Answer: <strong>${q?ageOn(q.date_of_birth,event.event_date):'—'}</strong> · ${answered}/${remoteTeams().length} locked`;const action=guessPrimaryAction(status),start=$('#startQuestion'),next=$('#nextQuestion');if(start){start.hidden=action.id!=='startQuestion';start.textContent='Start question'}if(next){next.hidden=action.id!=='nextQuestion';next.className='btn primary';next.textContent='Next question'}const side=$('#liveControl .live-side');side?.querySelector('.panel-heading .label')?.remove();side?.querySelector('.panel-heading .pill')?.remove();const sideTitle=side?.querySelector('.panel-heading h2');if(sideTitle)sideTitle.textContent='Answers';side?.querySelector('#showLeaderboard')?.remove();const recovery=side?.querySelector('.recovery-actions');if(recovery)recovery.innerHTML=`<details class="more-menu"><summary>More</summary><button class="danger-link" id="restartRoundPolished">Restart this game</button><button id="newSessionPolished">Start new session</button></details>`;if($('#restartRoundPolished'))$('#restartRoundPolished').onclick=()=>runConfirmed(confirm,'Restart Guess the Age? Team membership and manual corrections stay, but all Guess the Age answers and game awards will be removed.',()=>(async()=>{await window.gameNightSupabaseActions.restartRound();renderNight() }));if($('#newSessionPolished'))$('#newSessionPolished').onclick=()=>runConfirmed(confirm,'Start a fresh session with a new room code? The current event will be kept as history.',()=>window.gameNightSupabaseActions.startNewSession())}
function renderRemoteIBetControl(){
  const s=remoteSession(),game=s.i_bet_you,event=s.event,group=activeIBetYouGroup(s),groups=iBetYouGroups(s),allMembers=groups.flatMap(g=>g.members.map(m=>({...m,groupId:g.id,groupPosition:g.position}))),left=iBetYouSecondsRemaining(s);
  const groupCards=groups.map(g=>`<div class="ibet-group-card ${g.id===group?.id?'active':''}"><div><p class="eyebrow">GROUP ${g.position}</p><h3>${esc(g.category.title)}</h3><p>${g.members.map(m=>`${mascotEmoji(m.mascot_id)} ${esc(m.name)}`).join(' · ')}</p></div>${g.state==='waiting'?`<button class="mini-btn change-ibet-category" data-id="${g.id}">Change Category</button>`:`<span class="pill ready">${esc(g.state)}</span>`}</div>`).join('');
  if(!group){$('#liveControl').innerHTML=`${roundNavigator()}<div class="control-empty"><h2>I Bet You complete</h2><p>Return to Tonight’s Games to continue.</p><button class="btn primary" id="ibetLeaderboard">Show leaderboard</button></div>`;bindRoundNavigator();bindAudienceSelector();if($('#openAudience'))$('#openAudience').onclick=()=>window.open(`audience.html?room=${encodeURIComponent(event.room_code)}`,'gameNightAudience');$('#ibetLeaderboard').onclick=()=>window.gameNightSupabaseActions.setDisplay('leaderboard');return}
  const memberOptions=group.members.map(m=>`<option value="${m.team_id}">${mascotEmoji(m.mascot_id)} ${esc(m.name)}</option>`).join(''),bidder=group.challenged_bidder_team_id||group.current_bidder_team_id||group.members[0]?.team_id,challenger=group.challenger_team_id||group.members.find(m=>m.team_id!==bidder)?.team_id,bid=group.target_bid||group.current_bid||1,commitKey=`${group.current_bidder_team_id||''}:${group.current_bid??''}`;
  let draft=iBetYouDrafts.get(group.id);if(!draft||draft.commitKey!==commitKey){draft={commitKey,selectedTeamId:null,proposedBid:initialProposedBid(group),pending:false};iBetYouDrafts.set(group.id,draft)}
  let controls='';
  if(['waiting','bidding'].includes(group.state))controls=`${group.current_bidder_team_id?`<p class="ibet-committed-bid">Current bid: <strong>${mascotEmoji(group.members.find(m=>m.team_id===group.current_bidder_team_id)?.mascot_id)} ${esc(teamName(group,group.current_bidder_team_id))} · ${group.current_bid}</strong></p>`:'<p class="ibet-committed-bid">Who’s bidding first? Choose a team.</p>'}<div class="ibet-bidder-grid">${group.members.map(m=>`<button class="ibet-team-button ${m.team_id===draft.selectedTeamId?'selected':''}" data-team="${m.team_id}" ${draft.pending?'disabled':''}><span>${mascotEmoji(m.mascot_id)}</span>${esc(m.name)}</button>`).join('')}</div><div class="ibet-bid-control"><button class="ibet-number-button" id="ibetMinus" ${draft.pending?'disabled':''}>−</button><strong>${draft.proposedBid}</strong><button class="ibet-number-button" id="ibetPlus" ${draft.pending?'disabled':''}>+</button></div><div class="ibet-bidding-actions"><button class="btn primary" id="ibetCommit" ${draft.pending||!draft.selectedTeamId?'disabled':''}>${draft.pending?'SAVING…':'I BET YOU'}</button><button class="btn secondary" id="ibetChallenge" ${draft.pending||!group.current_bidder_team_id||!draft.selectedTeamId||draft.selectedTeamId===group.current_bidder_team_id?'disabled':''}>NAME THEM</button></div>`;
  if(group.state==='challenged')controls=`<div class="ibet-showdown"><p>Challenged bidder</p><select id="correctBidder">${memberOptions}</select><p>Challenger</p><select id="correctChallenger">${memberOptions}</select><div class="ibet-bid-control"><button class="ibet-number-button" id="correctMinus">−</button><strong>${bid}</strong><button class="ibet-number-button" id="correctPlus">+</button></div><button class="btn secondary" id="saveShowdown">Save correction</button><button class="btn primary ibet-primary-action" id="startIBetTimer">START 60s</button></div>`;
  if(group.state==='countdown')controls=`<div class="ibet-host-countdown"><strong>${left}</strong><span>${left?'SECONDS':'TIME’S UP'}</span></div><div class="ibet-judge"><button class="btn primary" id="ibetSuccess">SUCCESS</button><button class="btn ibet-fail" id="ibetFail">FAIL</button></div>`;
  if(group.state==='result')controls=`<div class="ibet-result-admin"><p class="eyebrow">${group.result==='success'?'SUCCESS':'FAILED'}</p><h2>${mascotEmoji(group.members.find(m=>m.team_id===group.winning_team_id)?.mascot_id)} ${esc(teamName(group,group.winning_team_id))} +5</h2><button class="btn primary ibet-primary-action" id="ibetNext">NEXT GROUP</button></div>`;
  const guess=remoteGuessRound();$('#liveControl').innerHTML=`<div class="live-toolbar panel"><div><p class="eyebrow">I BET YOU · HOST CONTROL</p><h2>${esc(event.name)}</h2><p class="hint">All bids and judgments are authoritative and persisted.</p></div><div class="top-actions"><button class="btn secondary" id="openAudience">Open audience ↗</button>${guess?'<button class="btn secondary" id="returnGuess">Guess the Age</button>':''}<button class="btn ghost" id="showLeaderboard">Show Leaderboard</button></div></div><div class="ibet-admin-layout"><div class="panel"><div class="panel-heading"><div><p class="label">CURRENT SHOWDOWN</p><h2>Group ${group.position} · ${esc(group.category.title)}</h2></div><span class="pill ${group.state==='countdown'?'live':'ready'}">${esc(group.state)}</span></div>${controls}<div class="recovery-actions"><button class="btn ghost" id="resetIBetGroup">Reset / replay this group</button></div></div><div class="panel"><div class="panel-heading"><div><p class="label">GROUPS</p><h2>Team groups</h2></div>${game.round.status==='setup'?'<button class="mini-btn" id="randomiseIBet">Randomise</button>':''}</div>${groupCards}${game.round.status==='setup'?`<div class="ibet-swap"><select id="swapA">${allMembers.map(m=>`<option value="${m.team_id}">G${m.groupPosition} · ${mascotEmoji(m.mascot_id)} ${esc(m.name)}</option>`).join('')}</select><select id="swapB">${allMembers.map(m=>`<option value="${m.team_id}">G${m.groupPosition} · ${mascotEmoji(m.mascot_id)} ${esc(m.name)}</option>`).join('')}</select><button class="btn secondary" id="swapTeams">Swap Teams</button></div>`:''}</div></div>`;
  if($('#openAudience'))$('#openAudience').onclick=()=>window.open(`audience.html?room=${encodeURIComponent(event.room_code)}`,'gameNightAudience');if($('#returnGuess'))$('#returnGuess').onclick=()=>selectControlRound(guess.id);$('#showLeaderboard').onclick=()=>window.gameNightSupabaseActions.setDisplay('leaderboard');document.querySelectorAll('.change-ibet-category').forEach(b=>b.onclick=()=>window.gameNightSupabaseActions.changeIBetYouCategory(b.dataset.id));
  if($('#randomiseIBet'))$('#randomiseIBet').onclick=()=>window.gameNightSupabaseActions.setupIBetYou();if($('#swapTeams'))$('#swapTeams').onclick=()=>{const a=$('#swapA').value,b=$('#swapB').value;if(a!==b)window.gameNightSupabaseActions.swapIBetYouTeams(a,b)};
  document.querySelectorAll('.ibet-team-button').forEach(b=>b.onclick=()=>{draft.selectedTeamId=b.dataset.team;renderRemoteIBetControl()});const redrawBid=delta=>{draft.proposedBid=adjustBid(draft.proposedBid,delta);renderRemoteIBetControl()};if($('#ibetMinus'))$('#ibetMinus').onclick=()=>redrawBid(-1);if($('#ibetPlus'))$('#ibetPlus').onclick=()=>redrawBid(1);
  if($('#ibetCommit'))$('#ibetCommit').onclick=async()=>{const error=validateIBetYouCommit(group,draft.selectedTeamId,draft.proposedBid);if(error)return toast(error);draft.pending=true;renderRemoteIBetControl();try{await window.gameNightSupabaseActions.setIBetYouBid(group.id,draft.selectedTeamId,draft.proposedBid)}catch(e){console.error(e);draft.pending=false;renderRemoteIBetControl();toast('Could not commit that bid. It must be higher than the last bid.')}};
  if($('#ibetChallenge'))$('#ibetChallenge').onclick=async()=>{const error=validateIBetYouChallenge(group,draft.selectedTeamId);if(error)return toast(error);draft.pending=true;renderRemoteIBetControl();try{await window.gameNightSupabaseActions.challengeIBetYou(group.id,draft.selectedTeamId)}catch(e){console.error(e);draft.pending=false;renderRemoteIBetControl();toast('Could not start that challenge. Check the selected Team.')}};
  if($('#correctBidder')){$('#correctBidder').value=bidder;$('#correctChallenger').value=challenger;let target=bid;const redraw=n=>{target=adjustBid(target,n);document.querySelector('.ibet-bid-control strong').textContent=target};$('#correctMinus').onclick=()=>redraw(-1);$('#correctPlus').onclick=()=>redraw(1);$('#saveShowdown').onclick=()=>window.gameNightSupabaseActions.correctIBetYou(group.id,$('#correctBidder').value,$('#correctChallenger').value,target);$('#startIBetTimer').onclick=()=>window.gameNightSupabaseActions.startIBetYouTimer(group.id)}
  if($('#ibetSuccess'))$('#ibetSuccess').onclick=()=>window.gameNightSupabaseActions.judgeIBetYou(group.id,true);if($('#ibetFail'))$('#ibetFail').onclick=()=>window.gameNightSupabaseActions.judgeIBetYou(group.id,false);if($('#ibetNext'))$('#ibetNext').onclick=()=>window.gameNightSupabaseActions.nextIBetYou(group.id);$('#resetIBetGroup').onclick=()=>{if(confirm(`Reset Group ${group.position}? Its I Bet You result and award will be removed.`))window.gameNightSupabaseActions.resetIBetYou(group.id)};
  polishRemoteIBetControl(event);if(group.state==='countdown'){clearInterval(liveTicker);liveTicker=setInterval(()=>renderRemoteIBetControl(),250)}
}
function polishRemoteIBetControl(event){const toolbar=$('#liveControl .live-toolbar');if(toolbar)toolbar.outerHTML=`${roundNavigator()}`;bindRoundNavigator();bindAudienceSelector();if($('#openAudiencePolished'))$('#openAudiencePolished').onclick=()=>window.open(`audience.html?room=${encodeURIComponent(event.room_code)}`,'gameNightAudience');const main=$('#liveControl .ibet-admin-layout>.panel');main?.querySelector('.panel-heading .label')?.remove();const recovery=main?.querySelector('.recovery-actions');if(recovery)recovery.innerHTML=`<details class="more-menu"><summary>More</summary><button class="danger-link" id="resetIBetGroupPolished">Reset / replay group</button></details>`;if($('#resetIBetGroupPolished'))$('#resetIBetGroupPolished').onclick=()=>{const group=activeIBetYouGroup(remoteSession());if(group&&confirm(`Reset Group ${group.position}? Its I Bet You result and award will be removed.`))window.gameNightSupabaseActions.resetIBetYou(group.id)}}
function resetQuestion(status='ready'){state.live.status=status;state.live.deadline=null;state.live.submissions={};state.live.lastAwarded=[]}
function startQuestion(){const r=currentRound();if(!r||!currentCelebrity())return;state.live.status='question';state.live.submissions={};state.live.lastAwarded=[];state.live.deadline=Date.now()+(r.settings.timer||15)*1000;save(false);renderLiveControl();startTicker()}
function startTicker(){clearInterval(liveTicker);liveTicker=setInterval(()=>{if(state.live.status!=='question'){clearInterval(liveTicker);return}if(timeLeft()<=0){lockQuestion();return}renderLiveControl()},250)}
function lockQuestion(){if(state.live.status!=='question')return;state.live.status='locked';state.live.deadline=null;save(false);renderLiveControl();clearInterval(liveTicker)}
function simulateAnswers(){const c=currentCelebrity();if(!c)return;const correct=ageOn(c.dob,state.event.date);state.teams.forEach((t,i)=>{if(state.live.submissions[t.id]==null){const offsets=[0,1,-2,4,-7,11,-1,3];state.live.submissions[t.id]=Math.max(1,correct+offsets[i%offsets.length]);}});save(false);renderLiveControl()}
function revealAnswer(){const c=currentCelebrity();if(!c)return;if(state.live.status==='question')lockQuestion();const key=questionKey(), correct=ageOn(c.dob,state.event.date);const already=state.live.scoredKeys.includes(key);const awards=[];state.teams.forEach(t=>{const guess=state.live.submissions[t.id];if(guess==null)return;const diff=Math.abs(Number(guess)-correct),points=pointsForDifference(diff);awards.push({id:t.id,name:t.name,guess:Number(guess),diff,points});if(!already){t.scores[key]=points;t.total=(t.total||0)+points;}});if(!already)state.live.scoredKeys.push(key);state.live.lastAwarded=awards.sort((a,b)=>b.points-a.points||a.diff-b.diff);state.live.status='reveal';state.live.deadline=null;save(false);renderLeaderboard();renderLiveControl()}
function nextQuestion(){const r=currentRound();if(!r)return;if(state.live.questionIndex<r.settings.celebrities.length-1){state.live.questionIndex++;resetQuestion('ready')}else{state.live.status='roundComplete';state.live.deadline=null;state.live.submissions={};state.live.lastAwarded=[]}save(false);renderLiveControl()}

function openLibrary(mode='add',target=null){
  libraryMode={mode,target};
  $('#libraryEyebrow').textContent=mode==='replace'?'REPLACE GAME':'GAME LIBRARY';$('#libraryTitle').textContent=mode==='replace'?`Replace ${games[target].name}`:'Choose a game';
  $('#gamePicker').innerHTML=libraryMarkup({mode,target,lineup:serverLineupTypes(remoteSession())});
  document.querySelectorAll('[data-library-pick]').forEach(b=>b.onclick=()=>pickGame(b.dataset.libraryPick));
  $('#roundModal').classList.add('open');$('#modalBackdrop').classList.add('open');$('#closeModal').focus();
}
function closeModal(){const wasOpen=$('#roundModal')?.classList.contains('open');$('#roundModal')?.classList.remove('open');$('#modalBackdrop')?.classList.remove('open');if(wasOpen)document.querySelector('#nightOverview [data-action="add"],#nightOverview .gn-card-primary')?.focus()}
async function pickGame(type){
  const {mode,target}=libraryMode||{};closeModal();
  if(mode==='replace')await changeLineup(types=>replaceGame(types,target,type),`${games[target].name} replaced with ${games[type].name}.`);
  else await changeLineup(types=>addGame(types,type),`${games[type].name} added to tonight’s line-up.`);
}
function initNav(){document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));$('#view-'+b.dataset.view).classList.add('active');if(b.dataset.view==='night')renderNight()})}
function init(){
  loadNight();bindEventFields();renderTeams();renderRemoteLeaderboard();initNav();renderNight();lastStatuses=new Map(plannedGames().map(g=>[g.type,g.status]));
  document.body.classList.toggle('hosted-admin',Boolean(remoteSession()));
  $('#resetDemo').onclick=()=>{if(confirm('Reset the prototype back to the demo event?')){localStorage.removeItem(STORE_KEY);localStorage.removeItem(LEGACY_KEY);location.reload()}};
  $('#closeModal').onclick=closeModal;$('#modalBackdrop').onclick=closeModal;$('#configBack').onclick=()=>closeEditor();$('#cancelConfig').onclick=()=>closeEditor();$('#doneRound').onclick=saveGameSettings;$('#hostAlertDismiss').onclick=clearHostError;$('#addTeam').onclick=addTeam;
  $('#logoutHost').onclick=()=>window.dispatchEvent(new Event('game-night-host-logout'));
  $('#switchEvent').onclick=$('#backToProjects').onclick=()=>window.dispatchEvent(new Event('game-night-switch-events'));
  $('#headerAudience').onclick=()=>{const event=remoteSession()?.event;window.open(event?`audience.html?room=${encodeURIComponent(event.room_code)}`:'audience.html','gameNightAudience')};
  $('#leaderboardAudience').onclick=()=>remoteSession()?window.gameNightSupabaseActions.setDisplay('leaderboard'):nightView();
  window.addEventListener('storage',e=>{if(!remoteSession()&&e.key===STORE_KEY&&e.newValue){state=migrate(JSON.parse(e.newValue));renderLeaderboard();renderLiveControl()}});
  window.addEventListener('game-night-remote-state',e=>{
    const previous=nightEventId===e.detail.event.id?lastStatuses:new Map();
    e.detail._hydratedAt=Date.now();window.gameNightRemoteSession=e.detail;document.body.classList.add('hosted-admin');loadNight();bindEventFields();renderTeams();renderRemoteLeaderboard();renderNight();
    const current=plannedGames();lastStatuses=new Map(current.map(g=>[g.type,g.status]));
    if(!nightPrefs.audienceManual&&current.some(g=>previous.get(g.type)==='live'&&g.status==='complete'))window.gameNightSupabaseActions.setDisplay('leaderboard').catch(()=>showHostError('Use the Audience menu to show the standings.'));
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('#roundModal').classList.contains('open'))closeModal();else if(editorDraft)closeEditor()}});
}
init();

function renderRemoteNoContext(){
  clearInterval(liveTicker)
  const snapshot=remoteSession(),game=snapshot.no_context,root=$('#liveControl')
  root.innerHTML=roundNavigator()+''+(game?noContextStage(snapshot,{host:true}):'<section class="panel nc-host"><h2>No Context</h2><p>Prepare five test image prompts. This preserves your teams and existing scores.</p><button class="btn primary" id="ncSetup">Prepare No Context</button></section>')
  bindRoundNavigator();bindAudienceSelector()
  const setup=$('#ncSetup')
  if(setup){setup.disabled=noContextPending;setup.onclick=async()=>{if(noContextPending)return;noContextPending=true;setup.disabled=true;try{await window.gameNightSupabaseActions.setupNoContext(NO_CONTEXT_TEST_PROMPTS);selectControlRound(remoteSession().no_context.round.id)}catch(error){toast(error.message||'Could not prepare No Context')}finally{noContextPending=false;renderRemoteNoContext()}};return}
  if(snapshot.event.active_round_id!==game.round.id){root.querySelector('.nc-actions').innerHTML='<button class="btn primary" data-nc-action="resume">Show No Context on stage</button>'}
  root.querySelectorAll('[data-nc-action]').forEach(button=>{
    button.disabled ||= noContextPending
    button.onclick=async()=>{
      if(noContextPending)return
      const action=button.dataset.ncAction
      const warning=action==='restart'?'Restart all five No Context rounds? No Context responses, votes and points will be removed. Teams and other game scores stay.':(action==='close_responses'||action.startsWith('close_voting_'))?noContextCloseWarning(game,noContextSeconds(snapshot)):''
      if(warning&&!confirm(warning))return
      noContextPending=true;renderRemoteNoContext()
      try{await window.gameNightSupabaseActions.controlNoContext(game.play.id,action)}catch(error){toast(error.message||'Could not update No Context');await window.gameNightSupabaseActions.refresh().catch(console.error)}finally{noContextPending=false;renderRemoteNoContext()}
    }
  })
  liveTicker=setInterval(()=>updateNoContextClock(root,remoteSession()),250)
}
