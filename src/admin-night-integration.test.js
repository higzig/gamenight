// @vitest-environment jsdom
import {readFileSync} from 'node:fs'
import {NO_CONTEXT_TEST_PROMPTS} from './no-context-content.js'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
let handlers=[],storage,snapshot,actions
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
const emit=()=>{window.gameNightRemoteSession=structuredClone(snapshot);window.dispatchEvent(new CustomEvent('game-night-remote-state',{detail:window.gameNightRemoteSession}))}
const setLineupState=(types,{revision=1,started=false,locked=[]}={})=>{snapshot.lineup={revision,started_at:started?'2026-09-25T19:00:00Z':null,games:types.map((game_type,i)=>({game_type,position:i+1,locked:locked.includes(game_type)}))}}
const cards=()=>[...document.querySelectorAll('#nightOverview .gn-card[data-type]')].map(card=>card.dataset.type)
const cardFor=type=>document.querySelector(`#nightOverview .gn-card[data-type="${type}"]`)
const act=(action,type)=>document.querySelector(`#nightOverview [data-action="${action}"]${type?`[data-type="${type}"]`:''}`)
const setupGuess=()=>{snapshot.rounds=[{id:'ga',game_type:'guess_age',title:'Guess the Age',questions:[{id:'q',position:1,celebrity_name:'Ada',date_of_birth:'1980-01-01'}]}];snapshot.event.active_round_id='ga'}
const liveNoContext=()=>{snapshot.no_context={round:{id:'nc',game_type:'no_context'},play:{id:'p',number:1,phase:'responses'},prompt:NO_CONTEXT_TEST_PROMPTS[0],options:[],revealed:[]};snapshot.event.active_round_id='nc';snapshot.event.status='question';snapshot.event.display_mode='game'}
const dragEvent=type=>Object.assign(new Event(type,{bubbles:true,cancelable:true}),{dataTransfer:{setData(){},effectAllowed:''}})
beforeEach(()=>{
 vi.resetModules();vi.useFakeTimers();storage=new Map()
 vi.stubGlobal('localStorage',{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)})
 document.body.innerHTML=new DOMParser().parseFromString(readFileSync('index.html','utf8'),'text/html').body.innerHTML
 vi.stubGlobal('BroadcastChannel',class{postMessage(){}});vi.stubGlobal('confirm',vi.fn(()=>true))
 const original=window.addEventListener.bind(window);vi.spyOn(window,'addEventListener').mockImplementation((type,handler,...rest)=>{handlers.push([type,handler]);original(type,handler,...rest)})
 snapshot={event:{id:'e',name:'Mic Check',venue:'The Oval',room_code:'ABC123',event_date:'2026-09-25',status:'lobby',display_mode:'join'},rounds:[],teams:[{id:'a',name:'A',status:'active',joined_at:new Date().toISOString()},{id:'b',name:'B',status:'active',joined_at:new Date().toISOString()}],leaderboard:[],game_defaults:{i_bet_you:{saved_for_event:false,categories:[{id:'films',title:'Films',difficulty:'easy',selected:true},{id:'comics',title:'Comics',difficulty:'hard',selected:true}]}}}
 setLineupState(['guess_age','no_context','i_bet_you'])
 actions={
  setLineup:vi.fn(async(types,revision)=>{if(revision!==snapshot.lineup.revision)throw Object.assign(new Error('The running order was changed on another screen. It has been refreshed; please try again.'),{code:'40001'});setLineupState(types,{revision:(revision??0)+1,started:Boolean(snapshot.lineup.started_at)});emit()}),
  startGameNight:vi.fn(async()=>{snapshot.lineup.started_at='2026-09-25T19:00:00Z';snapshot.event.display_mode='join';emit()}),
  saveIBetYouSettings:vi.fn(async categories=>{snapshot.game_defaults.i_bet_you={saved_for_event:true,categories:categories.map((c,i)=>({...c,id:c.id||`custom-${i}`}))};emit()}),
  setDisplay:vi.fn(async mode=>{snapshot.event.display_mode=mode;emit()}),refresh:vi.fn(async()=>emit()),
  saveGuessAgeRound:vi.fn(async()=>emit()),savePerfectLie:vi.fn(async()=>emit()),
  selectGame:vi.fn(async id=>{snapshot.event.active_round_id=id;snapshot.event.active_question_id='q';snapshot.event.status='ready';snapshot.event.display_mode='game';emit()}),
  advanceQuestion:vi.fn(async()=>{snapshot.event.status='round_complete';snapshot.event.active_question_id=null;emit()}),
 }
 window.gameNightRemoteSession=snapshot;window.gameNightSupabaseActions=actions
})
afterEach(()=>{for(const [t,h]of handlers)window.removeEventListener(t,h);handlers=[];vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();delete window.gameNightRemoteSession;delete window.gameNightSupabaseActions})

describe('Planning dashboard',()=>{
 it('shows the recommended games in order with one empty Add Game slot',async()=>{
  await import('../admin.js')
  expect(cards()).toEqual(['guessAge','noContext','iBetYou'])
  expect(document.querySelectorAll('#nightOverview .gn-empty')).toHaveLength(1)
  expect(cardFor('guessAge').textContent).toContain('Ready');expect(cardFor('guessAge').textContent).toContain('10 celebrities')
  expect(cardFor('noContext').textContent).toContain('15–20 min');expect(cardFor('iBetYou').textContent).toContain('2+ teams')
  expect([...document.querySelectorAll('.nav-item')].map(x=>x.dataset.view)).toEqual(['night','teams','leaderboard'])
  expect(document.getElementById('nightStage').hidden).toBe(true)
 })
 it('starts an empty running order with only the Add Game slot',async()=>{
  setLineupState([]);await import('../admin.js')
  expect(cards()).toEqual([]);expect(document.querySelectorAll('#nightOverview .gn-empty')).toHaveLength(1)
  expect(act('start-night')).toBeNull();expect(document.querySelector('.gn-hero [data-action="add"]')).not.toBeNull()
 })
 it('adds a fourth game from the library, then hides the empty slot',async()=>{
  await import('../admin.js')
  document.querySelector('#nightOverview .gn-empty').click()
  expect(document.getElementById('roundModal').classList.contains('open')).toBe(true)
  expect(document.querySelector('[data-library-pick="guessAge"]').disabled).toBe(true)
  expect(document.querySelector('[data-game="perfectLie"] .gn-how').textContent).toContain('2 points for every team fooled')
  document.querySelector('[data-library-pick="perfectLie"]').click();await flush()
  expect(actions.setLineup).toHaveBeenCalledWith(['guess_age','no_context','i_bet_you','perfect_lie'],1)
  expect(cards()).toEqual(['guessAge','noContext','iBetYou','perfectLie'])
  expect(document.querySelectorAll('#nightOverview .gn-empty')).toHaveLength(0)
  expect(document.getElementById('nightOverview').textContent).toContain('All four games')
  expect(cardFor('perfectLie').textContent).toContain('Needs Setup');expect(cardFor('perfectLie').textContent).toContain('Add at least one question')
 })
 it('reorders with the arrow buttons and keeps focus on the moved game',async()=>{
  await import('../admin.js')
  act('move-down','guessAge').focus();act('move-down','guessAge').click();await flush()
  expect(actions.setLineup).toHaveBeenCalledWith(['no_context','guess_age','i_bet_you'],1)
  expect(cards()).toEqual(['noContext','guessAge','iBetYou'])
  expect(document.activeElement.dataset.type).toBe('guessAge')
  expect(document.getElementById('dashAnnounce').textContent).toContain('Guess the Age moved to position 2')
 })
 it('reorders by drag and drop',async()=>{
  await import('../admin.js')
  cardFor('iBetYou').dispatchEvent(dragEvent('dragstart'))
  const over=dragEvent('dragover');cardFor('guessAge').dispatchEvent(over);expect(over.defaultPrevented).toBe(true)
  cardFor('guessAge').dispatchEvent(dragEvent('drop'));await flush()
  expect(actions.setLineup).toHaveBeenCalledWith(['i_bet_you','guess_age','no_context'],1)
 })
 it('replaces a game in its existing position',async()=>{
  await import('../admin.js')
  act('replace','noContext').click()
  expect(document.getElementById('libraryTitle').textContent).toBe('Replace No Context')
  document.querySelector('[data-library-pick="perfectLie"]').click();await flush()
  expect(actions.setLineup).toHaveBeenCalledWith(['guess_age','perfect_lie','i_bet_you'],1)
  expect(cards()).toEqual(['guessAge','perfectLie','iBetYou'])
 })
 it('removes a game without deleting its server content',async()=>{
  setupGuess();setLineupState(['guess_age']);await import('../admin.js')
  act('remove','guessAge').click();await flush()
  expect(confirm).toHaveBeenCalled();expect(actions.setLineup).toHaveBeenCalledWith([],1)
  expect(cards()).toEqual([]);expect(snapshot.rounds).toHaveLength(1)
 })
 it('shows a rejected change and keeps the dashboard usable',async()=>{
  actions.setLineup.mockRejectedValueOnce(Object.assign(new Error('A game that has already been on stage cannot be removed or replaced.'),{code:'55000'}))
  await import('../admin.js')
  act('remove','noContext').click();await flush()
  expect(document.getElementById('hostAlert').hidden).toBe(false)
  expect(document.getElementById('hostAlertText').textContent).toContain('already been on stage')
  expect(act('remove','noContext').disabled).toBe(false)
  document.getElementById('hostAlertDismiss').click();expect(document.getElementById('hostAlert').hidden).toBe(true)
 })
 it('refreshes after another screen changed the running order first',async()=>{
  actions.setLineup.mockRejectedValueOnce(Object.assign(new Error('The running order was changed on another screen. It has been refreshed; please try again.'),{code:'40001'}))
  await import('../admin.js')
  act('move-down','guessAge').click();await flush()
  expect(actions.refresh).toHaveBeenCalled();expect(document.getElementById('hostAlertText').textContent).toContain('changed on another screen')
 })
 it('adopts an older night’s browser running order once, and never adds recommended games',async()=>{
  snapshot.lineup={revision:null,started_at:null,games:[]}
  storage.set('gameNightPlan:e',JSON.stringify({games:[{id:'x',type:'noContext'},{id:'y',type:'guessAge'}],excluded:['iBetYou'],progress:{}}))
  await import('../admin.js');await flush()
  expect(actions.setLineup).toHaveBeenCalledTimes(1);expect(actions.setLineup).toHaveBeenCalledWith(['no_context','guess_age'],null)
  emit();await flush();expect(actions.setLineup).toHaveBeenCalledTimes(1)
  expect(JSON.parse(storage.get('gameNightPlan:e')).games).toHaveLength(2)
 })
 it('adopts an older night’s server content order when this browser has no saved plan',async()=>{
  setupGuess();snapshot.lineup={revision:null,started_at:null,games:[]}
  await import('../admin.js');await flush()
  expect(actions.setLineup).toHaveBeenCalledWith(['guess_age'],null)
 })
})

describe('Starting the night',()=>{
 it('lets the night start while a game still needs setup, but not that game',async()=>{
  setLineupState(['perfect_lie','guess_age']);await import('../admin.js')
  expect(act('start-night').disabled).toBe(false)
  expect(document.getElementById('startNightReason').textContent).toContain('Table of Lies still needs setting up')
  act('start-night').click();await flush()
  expect(actions.startGameNight).toHaveBeenCalledTimes(1)
  expect(document.querySelector('.gn-hero [data-action="edit"][data-type="perfectLie"]').textContent).toContain('Set up Table of Lies')
  act('edit','perfectLie').click()
  expect(document.getElementById('nightConfigure').hidden).toBe(false);expect(document.getElementById('configIdentity').textContent).toContain('Table of Lies')
  expect(actions.selectGame).not.toHaveBeenCalled()
 })
 it('explains a database without the running-order update instead of showing an empty night',async()=>{
  delete snapshot.lineup;await import('../admin.js');await flush()
  expect(document.getElementById('hostAlert').hidden).toBe(false)
  expect(document.getElementById('hostAlertText').textContent).toContain('missing an update this screen needs')
  expect(actions.setLineup).not.toHaveBeenCalled();expect(storage.has('gameNightPlan:e')).toBe(false)
 })
 it('shows the real cause when the running-order RPC is missing',async()=>{
  actions.setLineup.mockRejectedValueOnce(Object.assign(new Error('Could not find the function public.set_event_lineup(p_event_id, p_expected_revision, p_game_types) in the schema cache'),{code:'PGRST202'}))
  await import('../admin.js')
  document.querySelector('#nightOverview [data-action="add"]').click();document.querySelector('[data-library-pick="perfectLie"]').click();await flush()
  expect(document.getElementById('hostAlertText').textContent).toBe('Game Night’s database is missing an update this screen needs (set_event_lineup). Apply the latest database migrations, then reload the page.')
  expect(cards()).toEqual(['guessAge','noContext','iBetYou'])
 })
 it('starts the night on the server, then offers the first game',async()=>{
  setupGuess();snapshot.event.active_round_id=null;await import('../admin.js')
  act('start-night').click();await flush()
  expect(actions.startGameNight).toHaveBeenCalledTimes(1);expect(actions.selectGame).not.toHaveBeenCalled()
  expect(document.querySelector('.gn-hero [data-action="start-game"][data-type="guessAge"]').textContent).toContain('Start Guess the Age')
 })
 it('moves directly into controls, locks editing, and returns to the next game on completion',async()=>{
  setupGuess();setLineupState(['guess_age','no_context'],{started:true});await import('../admin.js')
  document.querySelector('.gn-hero [data-action="start-game"]').click();await flush()
  expect(actions.selectGame).toHaveBeenCalledWith('ga');expect(document.getElementById('nightOverview').hidden).toBe(true);expect(document.getElementById('startQuestion')).not.toBeNull()
  document.querySelector('[data-night-order]').click()
  expect(cardFor('guessAge').dataset.state).toBe('live');expect(act('edit','guessAge')).toBeNull();expect(act('open-live','guessAge')).not.toBeNull()
  snapshot.event.status='round_complete';snapshot.event.active_question_id=null;emit();await flush()
  expect(document.getElementById('nightStage').hidden).toBe(true);expect(cardFor('guessAge').dataset.state).toBe('complete')
  expect(document.querySelector('.gn-hero [data-action="start-game"]').textContent).toContain('Start No Context')
  expect(actions.setDisplay).toHaveBeenCalledWith('leaderboard')
 })
 it('keeps manual Audience mode available and avoids automatic standings after override',async()=>{setupGuess();setLineupState(['guess_age'],{started:true});snapshot.event.status='question';await import('../admin.js');document.querySelector('[data-display="join"]').click();await flush();actions.setDisplay.mockClear();snapshot.event.status='round_complete';snapshot.event.active_question_id=null;emit();await flush();expect(actions.setDisplay).not.toHaveBeenCalled();expect(JSON.parse(storage.get('gameNightPlan:e')).audienceManual).toBe(true)})
})

describe('Game configuration',()=>{
 it('opens one configuration view with Save and Cancel, keeping drafts across server refresh',async()=>{
  setupGuess();snapshot.event.active_round_id=null;setLineupState(['guess_age']);await import('../admin.js')
  act('edit','guessAge').click()
  expect(document.getElementById('nightOverview').hidden).toBe(true);expect(document.getElementById('nightConfigure').hidden).toBe(false)
  expect(document.getElementById('configIdentity').textContent).toContain('Guess the Age');expect(document.getElementById('doneRound').textContent).toBe('Save Game')
  const input=document.getElementById('roundTitleInput');input.value='Draft title';input.dispatchEvent(new Event('input'))
  emit();expect(document.getElementById('roundTitleInput').value).toBe('Draft title')
  document.getElementById('cancelConfig').click()
  expect(confirm).toHaveBeenCalledWith('Discard your unsaved changes to this game?');expect(actions.saveGuessAgeRound).not.toHaveBeenCalled()
  expect(document.getElementById('nightConfigure').hidden).toBe(true);expect(cardFor('guessAge').querySelector('h3').textContent).toBe('Guess the Age')
 })
 it('saves Guess the Age through its existing service without starting or switching games',async()=>{
  setupGuess();snapshot.event.active_round_id=null;setLineupState(['guess_age']);await import('../admin.js')
  act('edit','guessAge').click();document.getElementById('doneRound').click();await flush()
  expect(actions.saveGuessAgeRound).toHaveBeenCalledWith('Guess the Age',expect.arrayContaining([expect.objectContaining({name:'Ada'})]))
  expect(actions.selectGame).not.toHaveBeenCalled();expect(document.getElementById('nightConfigure').hidden).toBe(true)
 })
 it('lets the Host edit an upcoming Guess the Age lineup while another game is live, without touching the live game',async()=>{
  setupGuess();liveNoContext();setLineupState(['guess_age','no_context'],{started:true,locked:['no_context']});await import('../admin.js')
  document.querySelector('[data-night-order]').click();act('edit','guessAge').click();document.getElementById('doneRound').click();await flush()
  expect(actions.saveGuessAgeRound).toHaveBeenCalled();expect(actions.selectGame).not.toHaveBeenCalled()
  expect(document.getElementById('gameSettingsError').hidden).toBe(true);expect(cardFor('noContext').dataset.state).toBe('live')
 })
 it('does not open settings for a game that has been on stage',async()=>{
  setupGuess();liveNoContext();setLineupState(['no_context'],{started:true,locked:['no_context']});await import('../admin.js')
  document.querySelector('[data-night-order]').click();expect(act('edit','noContext')).toBeNull();expect(act('remove','noContext')).toBeNull()
 })
 it('drops an open draft when switching to another night',async()=>{
  await import('../admin.js');act('edit','noContext').click();expect(document.getElementById('nightConfigure').hidden).toBe(false)
  snapshot={...snapshot,event:{...snapshot.event,id:'another',room_code:'DEF456'}};setLineupState([]);emit()
  expect(document.getElementById('nightConfigure').hidden).toBe(true);expect(cards()).toEqual([])
 })
 it('shows every category selected, supports custom categories, and saves deselections',async()=>{
  setLineupState(['i_bet_you']);await import('../admin.js');act('edit','iBetYou').click();expect(document.querySelectorAll('[data-category]:checked')).toHaveLength(2)
  const first=document.querySelector('[data-category="0"]');first.checked=false;first.dispatchEvent(new Event('change'));document.getElementById('customCategoryTitle').value='Irish comedians';document.getElementById('addIBetCategory').click();expect(document.querySelectorAll('[data-category]')).toHaveLength(3)
  emit();expect(document.querySelector('[data-category="0"]').checked).toBe(false);document.getElementById('doneRound').click();await flush();expect(actions.saveIBetYouSettings).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({id:'films',selected:false}),expect.objectContaining({title:'Irish comedians',selected:true})]))
  act('edit','iBetYou').click();expect(document.querySelector('[data-category="0"]').checked).toBe(false);expect(document.getElementById('drawerBody').textContent).toContain('Irish comedians')
 })
 it('keeps an empty selection unsaved and does not save cancelled edits',async()=>{
  setLineupState(['i_bet_you']);await import('../admin.js');act('edit','iBetYou').click();document.getElementById('clearCategories').click();document.getElementById('doneRound').click();await flush();expect(document.getElementById('gameSettingsError').textContent).toContain('Select at least one');expect(actions.saveIBetYouSettings).not.toHaveBeenCalled();document.getElementById('cancelConfig').click();act('edit','iBetYou').click();expect(document.querySelectorAll('[data-category]:checked')).toHaveLength(2)
 })
 it('starts a new Guess the Age lineup with ten editable celebrities',async()=>{
  await import('../admin.js');act('edit','guessAge').click();expect(document.querySelectorAll('.celeb-row')).toHaveLength(10);const name=document.querySelector('[data-field="name"]');name.value='My celebrity';name.dispatchEvent(new Event('input'));document.getElementById('addCeleb').click();expect(document.querySelectorAll('.celeb-row')).toHaveLength(11);expect(document.querySelector('[data-field="name"]').value).toBe('My celebrity');document.querySelector('.remove-celeb').click();expect(document.querySelectorAll('.celeb-row')).toHaveLength(10)
 })
 it('uses the account’s saved lineup for a game that has not been saved yet',async()=>{
  snapshot.game_defaults.guess_age=[{celebrity_id:'saved',celebrity_name:'Saved celebrity',date_of_birth:'1980-02-03'}];await import('../admin.js');act('edit','guessAge').click();expect(document.querySelectorAll('.celeb-row')).toHaveLength(1);expect(document.querySelector('[data-field="name"]').value).toBe('Saved celebrity');expect(document.querySelector('[data-field="dob"]').value).toBe('1980-02-03')
 })
})

describe('Switching from Tonight’s Games',()=>{
 it('offers Start beside Edit during live play, shows Paused, and requires a separate Resume',async()=>{
  setupGuess();liveNoContext();snapshot.game_pause={games:[]};setLineupState(['guess_age','no_context'],{started:true,locked:['no_context']})
  actions.selectGame=vi.fn(async id=>{const previous=snapshot.event.active_round_id;snapshot.game_pause.games=snapshot.game_pause.games.filter(g=>g.round_id!==previous);snapshot.game_pause.games.push({round_id:previous,state:'paused'});snapshot.event.active_round_id=id;snapshot.event.active_question_id=id==='ga'?'q':null;snapshot.event.status='ready';emit()})
  actions.resumeGame=vi.fn(async id=>{snapshot.game_pause.games.find(g=>g.round_id===id).state='running';snapshot.event.status='question';emit()})
  await import('../admin.js');document.querySelector('[data-night-order]').click()
  expect(act('edit','guessAge')).not.toBeNull();act('start-game','guessAge').click();await flush()
  expect(actions.selectGame).toHaveBeenCalledWith('ga');expect(document.getElementById('startQuestion')).not.toBeNull();document.querySelector('[data-night-order]').click()
  expect(cardFor('noContext').dataset.state).toBe('paused');expect(cardFor('noContext').textContent).toContain('Paused');expect(act('edit','noContext')).toBeNull()
  act('start-game','noContext').click();await flush()
  expect(actions.resumeGame).not.toHaveBeenCalled();expect(document.getElementById('liveControl').textContent).toContain('The clock is stopped');expect(document.querySelector('[data-nc-action]')).toBeNull()
  document.getElementById('resumePausedGame').click();await flush();expect(actions.resumeGame).toHaveBeenCalledWith('nc');expect(document.getElementById('resumePausedGame')).toBeNull()
  document.querySelector('[data-night-order]').click();expect(cardFor('guessAge').dataset.state).toBe('paused')
 })
})
