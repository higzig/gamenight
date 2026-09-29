// @vitest-environment jsdom
import {readFileSync} from 'node:fs'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {NO_CONTEXT_TEST_PROMPTS} from './no-context-content.js'
let handlers=[]
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()}
beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers()
  const storage=new Map();vi.stubGlobal('localStorage',{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)})
  const html=readFileSync('index.html','utf8')
  document.body.innerHTML=new DOMParser().parseFromString(html,'text/html').body.innerHTML
  vi.stubGlobal('BroadcastChannel',class{postMessage(){} close(){}})
  const original=window.addEventListener.bind(window)
  vi.spyOn(window,'addEventListener').mockImplementation((type,handler,...rest)=>{handlers.push([type,handler]);original(type,handler,...rest)})
  window.gameNightRemoteSession={server_now:new Date().toISOString(),_hydratedAt:Date.now(),event:{id:'e1',name:'Test',venue:'Pub',event_date:'2026-09-24',room_code:'ABC123',status:'ready',active_round_id:'nc',display_mode:'game'},teams:[],rounds:[],leaderboard:[],no_context:{round:{id:'nc',game_type:'no_context',position:4},play:{id:'p1',number:1,phase:'ready',deadline_at:null,page:0,ballot:0,revealed_place:4},prompt:NO_CONTEXT_TEST_PROMPTS[0],options:[],revealed:[],team_count:0,response_count:0,eligible_count:0,vote_count:0}}
  window.gameNightSupabaseActions={controlNoContext:vi.fn(async(_play,action)=>{if(action==='start')window.gameNightRemoteSession.no_context.play.phase='responses'}),refresh:vi.fn().mockResolvedValue({}),setDisplay:vi.fn()}
})
afterEach(()=>{for(const [type,handler]of handlers)window.removeEventListener(type,handler);handlers=[];vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();delete window.gameNightRemoteSession;delete window.gameNightSupabaseActions})
describe('No Context Host integration',()=>{
  it('renders the hosted game, starts it, and wires early closure through existing application actions',async()=>{
    await import('../admin.js')
    expect(document.querySelector('[data-control-round="nc"]')).not.toBeNull()
    document.querySelector('[data-nc-action="start"]').click();await flush()
    expect(window.gameNightSupabaseActions.controlNoContext).toHaveBeenCalledWith('p1','start')
    expect(document.querySelector('[data-nc-action="close_responses"]')).not.toBeNull()
    expect(document.getElementById('liveControl').textContent).toContain('0 / 0 teams answered')
  })
  it('adds No Context and prepares it on Start Game, retaining retry after failure',async()=>{
    window.gameNightRemoteSession.no_context=null;window.gameNightRemoteSession.event.active_round_id=null
    window.gameNightSupabaseActions.setupNoContext=vi.fn().mockRejectedValue(new Error('Test setup error'))
    await import('../admin.js')
    document.getElementById('addRound').click();document.querySelector('[data-game="noContext"]').click()
    document.getElementById('doneRound').click();await flush()
    document.getElementById('startNextGame').click();await flush()
    expect(window.gameNightSupabaseActions.setupNoContext).toHaveBeenCalledWith(NO_CONTEXT_TEST_PROMPTS)
    expect(document.getElementById('startNextGame').disabled).toBe(false)
  })
})
