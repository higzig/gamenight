// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks=vi.hoisted(()=>({client:null}))
vi.mock('./supabase-client.js',()=>({createGameNightClient:()=>mocks.client,getSupabaseConfigError:()=>null}))
let snapshot,liveIntervals
const flush=()=>vi.advanceTimersByTimeAsync(0)

beforeEach(()=>{
  vi.useFakeTimers();vi.resetModules();vi.spyOn(console,'error').mockImplementation(()=>{})
  window.history.replaceState({},'','/audience.html?room=ABC123')
  window.matchMedia=()=>({matches:false})
  liveIntervals=new Set()
  const set=window.setInterval,clear=window.clearInterval
  vi.spyOn(window,'setInterval').mockImplementation((fn,ms)=>{const id=set(fn,ms);liveIntervals.add(id);return id})
  vi.spyOn(window,'clearInterval').mockImplementation(id=>{liveIntervals.delete(id);return clear(id)})
  const channel={on:vi.fn().mockReturnThis(),subscribe:vi.fn().mockReturnThis()}
  mocks.client={
    auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:'screen-1',is_anonymous:true}}}}),signInAnonymously:vi.fn(),onAuthStateChange:vi.fn()},
    channel:vi.fn(()=>channel),removeChannel:vi.fn().mockResolvedValue({}),
    rpc:vi.fn(async()=>{snapshot.server_now=new Date().toISOString();return {data:structuredClone(snapshot)}}),
  }
})
afterEach(()=>{vi.clearAllTimers();vi.restoreAllMocks();vi.useRealTimers()})

describe('Audience I Bet You countdown',()=>{
  it('keeps a single countdown ticker for the whole 60 seconds',async()=>{
    const group={id:'g1',position:1,state:'countdown',category:{title:'Dog Breeds'},members:[{team_id:'a',name:'Frogs',mascot_id:'frog'},{team_id:'b',name:'Robots',mascot_id:'robot'}],challenged_bidder_team_id:'a',challenger_team_id:'b',target_bid:5,countdown_deadline_at:new Date(Date.now()+60000).toISOString()}
    snapshot={event:{id:'event-1',room_code:'ABC123',status:'ready',display_mode:'game',active_round_id:'bet',state_version:1},i_bet_you:{round:{id:'bet',status:'playing',active_group_id:'g1'},groups:[group]}}
    document.body.innerHTML='<main id="audienceApp"></main>'
    await import('./audience-entry.js');await flush()
    expect(document.querySelector('.ibet-audience-timer').textContent).toBe('60')
    for(let tick=0;tick<8;tick++){await vi.advanceTimersByTimeAsync(250);expect(liveIntervals.size).toBe(1)}
    await vi.advanceTimersByTimeAsync(10000)
    expect(liveIntervals.size).toBe(1);expect(document.querySelector('.ibet-audience-timer').textContent).toBe('48')
  })
})

describe('Audience recovery polling',()=>{
  it('keeps the screen in place for unchanged polls and renders genuine updates',async()=>{
    snapshot={event:{id:'event-1',room_code:'ABC123',status:'locked',display_mode:'game',active_round_id:'lie',state_version:3},perfect_lie:{round:{id:'lie',phase:'voting'},question:{id:'q1',category:'Sport',question_text:'Who?'},options:[{id:'o1',text:'Bees'},{id:'o2',text:'Ninjas'}],vote_count:0,team_count:2}}
    document.body.innerHTML='<main id="audienceApp"></main>'
    await import('./audience-entry.js');await flush()
    const cards=document.querySelector('.perfect-lie-vote-cards'),polls=mocks.client.rpc.mock.calls.length
    await vi.advanceTimersByTimeAsync(10500)
    expect(mocks.client.rpc.mock.calls.length).toBeGreaterThanOrEqual(polls+3)
    expect(document.querySelector('.perfect-lie-vote-cards')).toBe(cards)
    snapshot.perfect_lie.vote_count=1;snapshot.event.state_version++
    await vi.advanceTimersByTimeAsync(3500)
    expect(document.querySelector('.perfect-lie-votes').textContent).toBe('1 / 2 VOTES LOCKED')
  })
})
