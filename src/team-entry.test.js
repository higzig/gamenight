// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks=vi.hoisted(()=>({client:null}))
vi.mock('./supabase-client.js',()=>({createGameNightClient:()=>mocks.client,getSupabaseConfigError:()=>null}))
let snapshot,offline,owned,joinCalls,handlers=[]
const flush=()=>vi.advanceTimersByTimeAsync(0)
const publicState=()=>({event:{id:'event-1',room_code:'ABC123',status:'lobby',state_version:1},lobby_roster:[],taken_mascot_ids:[]})
async function mount(){
  document.body.innerHTML='<main id="teamApp"></main>'
  await import('./team-entry.js');await flush()
}
function cleanupPage(){
  for(const [target,type,handler] of handlers)target.removeEventListener(type,handler)
  handlers=[];vi.clearAllTimers();vi.resetModules()
}
function chooseTeam(){
  const input=document.getElementById('remoteTeamName');input.value='Table One';input.dispatchEvent(new Event('input'))
  document.querySelector('[data-mascot="fox"]').click()
}
async function join(){chooseTeam();document.getElementById('remoteJoin').dispatchEvent(new Event('submit',{cancelable:true}));await flush()}

beforeEach(()=>{
  vi.useFakeTimers();vi.resetModules();vi.spyOn(console,'error').mockImplementation(()=>{})
  window.history.replaceState({},'', '/team.html?room=ABC123')
  for(const target of [window,document]){
    const original=target.addEventListener.bind(target)
    vi.spyOn(target,'addEventListener').mockImplementation((type,handler,options)=>{handlers.push([target,type,handler]);original(type,handler,options)})
  }
  offline=false;owned=false;joinCalls=0;snapshot=publicState()
  const channel={on:vi.fn().mockReturnThis(),subscribe:vi.fn().mockReturnThis()}
  mocks.client={
    auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:'captain-1',is_anonymous:true}}}}),signInAnonymously:vi.fn(),onAuthStateChange:vi.fn()},
    channel:vi.fn(()=>channel),removeChannel:vi.fn().mockResolvedValue({}),
    rpc:vi.fn(async(name,args)=>{
      if(offline)throw new Error('Offline')
      if(name==='get_team_room_state')return {data:owned?structuredClone(snapshot):null}
      if(name==='get_public_room_state')return {data:publicState()}
      if(name==='join_event'){joinCalls++;owned=true;snapshot={...publicState(),team:{id:'team-1',name:args.p_team_name,mascot_id:args.p_mascot_id}};return {data:{id:'team-1'}}}
      if(name==='submit_guess'){snapshot.submission={guess_integer:args.p_guess};snapshot.event.state_version++;return {data:snapshot.submission}}
      throw new Error(`Unexpected RPC ${name}`)
    }),
  }
})
afterEach(()=>{cleanupPage();vi.restoreAllMocks();vi.useRealTimers()})

describe('Captain controller page',()=>{
  it('joins once and restores the same team after reopening the page',async()=>{
    await mount();expect(document.body.textContent).toContain('Choose your Team Captain')
    await join();expect(document.body.textContent).toContain('TEAM CAPTAIN');expect(joinCalls).toBe(1)
    cleanupPage();await mount()
    expect(document.body.textContent).toContain('Table One');expect(document.getElementById('remoteJoin')).toBeNull()
    expect(joinCalls).toBe(1);expect(mocks.client.auth.signInAnonymously).not.toHaveBeenCalled()
  })
  it('unblocks a failed join and recovers without creating another team',async()=>{
    await mount();chooseTeam();offline=true
    document.getElementById('remoteJoin').dispatchEvent(new Event('submit',{cancelable:true}));await flush()
    expect(document.getElementById('joinButton').disabled).toBe(false)
    expect(joinCalls).toBe(0)
    offline=false;await join();expect(joinCalls).toBe(1);expect(document.body.textContent).toContain('Table One')
  })
  it('keeps retrying across consecutive network failures and restores the controller',async()=>{
    await mount();await join();offline=true
    await vi.advanceTimersByTimeAsync(7000)
    expect(document.body.textContent).toContain('Reconnecting')
    const calls=mocks.client.rpc.mock.calls.length
    await vi.advanceTimersByTimeAsync(3500);expect(mocks.client.rpc.mock.calls.length).toBeGreaterThan(calls)
    offline=false;await vi.advanceTimersByTimeAsync(3500)
    expect(document.body.textContent).not.toContain('Reconnecting');expect(document.body.textContent).toContain('Table One');expect(joinCalls).toBe(1)
  })
  it('recovers a failed initial load on the same anonymous session',async()=>{
    offline=true;await mount();expect(document.body.textContent).toContain('Unable to reconnect yet')
    offline=false;await vi.advanceTimersByTimeAsync(3500)
    expect(document.body.textContent).toContain('Choose your Team Captain')
    expect(mocks.client.auth.signInAnonymously).not.toHaveBeenCalled()
  })
  it('submits the team age once and retains the controller across the three games',async()=>{
    await mount();await join()
    snapshot.event={...snapshot.event,status:'question',state_version:2,accepting_answers:true,active_round_id:'age',question_deadline_at:new Date(Date.now()+15000).toISOString()}
    snapshot.server_now=new Date().toISOString();snapshot.question={id:'q1',celebrity_name:'Example'}
    window.dispatchEvent(new Event('focus'));await flush()
    document.querySelector('[data-digit="3"]').click();document.querySelector('[data-digit="0"]').click()
    document.getElementById('lockBtn').click();await flush()
    expect(snapshot.submission.guess_integer).toBe(30);expect(document.getElementById('lockBtn')).toBeNull()
    expect(mocks.client.rpc.mock.calls.filter(([name])=>name==='submit_guess')).toHaveLength(1)
    snapshot.event.active_round_id='bet';snapshot.event.state_version++
    snapshot.i_bet_you={round:{id:'bet',status:'setup'},groups:[]}
    window.dispatchEvent(new Event('focus'));await flush()
    expect(document.body.textContent).toContain('Phones away');expect(document.body.textContent).toContain('Table One')
    snapshot.event.active_round_id='lie';snapshot.event.state_version++
    snapshot.perfect_lie={round:{id:'lie',phase:'ready'},question:null}
    window.dispatchEvent(new Event('focus'));await flush()
    expect(document.body.textContent).toContain('TABLE OF LIES');expect(document.body.textContent).toContain('Table One');expect(joinCalls).toBe(1)
  })
})

describe('Table of Lies captain timer',()=>{
 it('keeps the same lie input after the answer deadline once an answer is submitted',async()=>{
  const deadline=new Date(Date.now()+20000).toISOString(),writing=extra=>({round:{id:'lie',phase:'writing'},question:{id:'q1',category:'Sport',question_text:'Who?'},options:[],...extra})
  owned=true;snapshot={...publicState(),team:{id:'team-1',name:'Table One',mascot_id:'fox'},event:{...publicState().event,status:'question',display_mode:'game',active_round_id:'lie',question_deadline_at:deadline},perfect_lie:writing()}
  const base=mocks.client.rpc
  mocks.client.rpc=vi.fn(async(name,args)=>{
    snapshot.server_now=new Date().toISOString()
    if(name==='submit_perfect_lie_answer'){snapshot.perfect_lie=writing({my_response:{initial_answer:args.p_answer,knew_truth:false,timed_out:false}});snapshot.event.state_version++;return {data:{knew_truth:false,lie_draft:args.p_answer}}}
    return base(name,args)
  })
  await mount()
  const answer=document.getElementById('plAnswer');answer.value='Pirates';answer.dispatchEvent(new Event('input'))
  document.getElementById('plAnswerForm').dispatchEvent(new Event('submit',{cancelable:true}));await flush()
  expect(document.getElementById('plLie')).not.toBeNull()
  // Isolate the countdown from the separate 3.5s recovery poll, which stops while hidden.
  vi.spyOn(document,'hidden','get').mockReturnValue(true);await vi.advanceTimersByTimeAsync(3500)
  const lie=document.getElementById('plLie');lie.value='Ninjas';lie.dispatchEvent(new Event('input'))
  await vi.advanceTimersByTimeAsync(20000)
  expect(document.getElementById('plLie')).toBe(lie);expect(lie.value).toBe('Ninjas')
 })
})

describe('Captain recovery polling',()=>{
 async function mountWritingLie(){
  owned=true;snapshot={...publicState(),team:{id:'team-1',name:'Table One',mascot_id:'fox'},event:{...publicState().event,status:'question',display_mode:'game',active_round_id:'lie',question_deadline_at:new Date(Date.now()+120000).toISOString()},perfect_lie:{round:{id:'lie',phase:'writing'},question:{id:'q1',category:'Sport',question_text:'Who?'},options:[],lie_count:0,my_response:{initial_answer:'Pirates',knew_truth:false,timed_out:false}}}
  const base=mocks.client.rpc
  // The real server returns a fresh server_now on every call.
  mocks.client.rpc=vi.fn(async(name,args)=>{snapshot.server_now=new Date().toISOString();return base(name,args)})
  await mount()
  const lie=document.getElementById('plLie');lie.focus();lie.value='Ninjas';lie.dispatchEvent(new Event('input'));lie.setSelectionRange(2,4)
  return lie
 }
 const polls=()=>mocks.client.rpc.mock.calls.filter(([name])=>name==='get_team_room_state').length
 it('leaves the page untouched when polls return an unchanged snapshot',async()=>{
  const lie=await mountWritingLie(),before=polls()
  await vi.advanceTimersByTimeAsync(10500)
  expect(polls()).toBeGreaterThanOrEqual(before+3)
  expect(document.getElementById('plLie')).toBe(lie);expect(document.activeElement).toBe(lie)
  expect(lie.value).toBe('Ninjas');expect([lie.selectionStart,lie.selectionEnd]).toEqual([2,4])
 })
 it('applies a genuine update while keeping the typed value, focus and cursor',async()=>{
  const lie=await mountWritingLie()
  snapshot.perfect_lie.lie_count=1;snapshot.event.state_version++
  await vi.advanceTimersByTimeAsync(3500)
  const next=document.getElementById('plLie')
  expect(next).not.toBe(lie);expect(document.activeElement).toBe(next)
  expect(next.value).toBe('Ninjas');expect([next.selectionStart,next.selectionEnd]).toEqual([2,4])
 })
 it('renders genuine phase changes from a poll',async()=>{
  await mountWritingLie()
  snapshot.perfect_lie={...snapshot.perfect_lie,round:{id:'lie',phase:'voting'},options:[{id:'o1',text:'Bees',is_own:false},{id:'o2',text:'Ninjas',is_own:true}]};snapshot.event.state_version++
  await vi.advanceTimersByTimeAsync(3500)
  expect(document.getElementById('plLie')).toBeNull();expect(document.querySelectorAll('.perfect-lie-option')).toHaveLength(2)
 })
})

describe('Paused captain view',()=>{
 it('hides all answer controls and countdowns until explicit host resume',async()=>{
  owned=true;snapshot={...publicState(),game_paused:true,team:{id:'team-1',name:'Table One',mascot_id:'fox'},event:{...publicState().event,status:'ready',display_mode:'game'},round:{game_type:'guess_age'},question:{id:'q',celebrity_name:'Ada'},submission:{guess_integer:26}};
  await mount();expect(document.body.textContent).toContain('GAME PAUSED');expect(document.body.textContent).toContain('answers and votes are saved');expect(document.querySelector('#lockBtn,.timer')).toBeNull();await vi.advanceTimersByTimeAsync(20000);expect(document.body.textContent).toContain('GAME PAUSED');expect(mocks.client.rpc.mock.calls.some(([name])=>name==='submit_guess')).toBe(false)
 })
})
