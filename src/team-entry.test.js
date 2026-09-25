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
