// @vitest-environment jsdom
import { beforeEach,describe,expect,it,vi } from 'vitest'
import { createNoContextTeamController,noContextCloseWarning,noContextHostActions,noContextOptions,noContextSeconds,noContextStage,responseError,updateNoContextClock } from './no-context.js'
import { NO_CONTEXT_TEST_PROMPTS } from './no-context-content.js'
import { controlNoContext,setupNoContext } from './host-service.js'
import { submitNoContextResponse,submitNoContextVote } from './team-service.js'
import { hostRoundOptions,mergeHostRoundOptions } from './admin-ux.js'

function snapshot(phase='responses'){
  return {team:{id:'t1'},server_now:'2026-09-24T12:00:00Z',_hydratedAt:Date.now(),no_context:{round:{id:'nc',game_type:'no_context',position:4},play:{id:'p1',phase,number:1,deadline_at:'2026-09-24T12:00:45Z',ballot:0,page:0,revealed_place:4},prompt:NO_CONTEXT_TEST_PROMPTS[0],team_count:10,response_count:3,eligible_count:10,vote_count:2,participating:true,my_response:null,my_vote:null,options:[{id:'r1',text:'Mine',is_own:true},{id:'r2',text:'Another response',is_own:false}],revealed:[]}}
}
function controller(state){
  document.body.innerHTML='<main id="teamApp"></main>'
  const root=document.getElementById('teamApp'),submitResponse=vi.fn(async(_team,_play,response)=>{state.no_context.my_response=response}),submitVote=vi.fn(async(_team,_play,id)=>{state.no_context.my_vote=id})
  const c=createNoContextTeamController({shell:html=>root.innerHTML=html,getState:()=>state,refresh:async()=>{},submitResponse,submitVote,rerender:()=>c.render(state)})
  c.render(state);return {c,root,submitResponse,submitVote}
}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
beforeEach(()=>vi.restoreAllMocks())

describe('No Context presentation and Captain input',()=>{
  it('provides five independent media records with local test assets',()=>{
    expect(NO_CONTEXT_TEST_PROMPTS).toHaveLength(5)
    expect(new Set(NO_CONTEXT_TEST_PROMPTS.map(p=>p.media.url)).size).toBe(5)
    expect(NO_CONTEXT_TEST_PROMPTS.every(p=>p.media.type==='image'&&p.media.url.startsWith('/no-context/'))).toBe(true)
  })
  it('validates blank, long and Unicode responses consistently with SQL character counts',()=>{
    expect(responseError(' \n\t')).toBeTruthy();expect(responseError('x'.repeat(141))).toBeTruthy()
    expect(responseError('😀'.repeat(140))).toBe('');expect(responseError(' x ')).toBe('')
  })
  it('derives time from server time and hydration offset',()=>{
    const s=snapshot();expect(noContextSeconds(s,s._hydratedAt+10000)).toBe(35);expect(noContextSeconds(s,s._hydratedAt+46000)).toBe(0)
  })
  it('keeps large option sets on host-controlled four-card pages',()=>{
    const g=snapshot('reading').no_context;g.options=Array.from({length:10},(_,i)=>({id:`r${i}`,text:`Response ${i}`}));g.play.page=1
    expect(noContextOptions(g).map(x=>x.id)).toEqual(['r4','r5','r6','r7'])
    expect(noContextStage({...snapshot(),no_context:g})).toContain('Page 2 / 3')
  })
  it('shows image and aggregate progress without displaying incoming answers',()=>{
    const s=snapshot();s.no_context.my_response='SECRET';const html=noContextStage(s,{host:true})
    expect(html).toContain('/no-context/meeting.svg');expect(html).toContain('3 / 10 teams answered');expect(html).not.toContain('SECRET');expect(html).not.toContain('Mine')
  })
  it('escapes malicious response text on every display',()=>{
    const s=snapshot('voting');s.no_context.options[1].text='<img src=x onerror=alert(1)>'
    expect(noContextStage(s)).toContain('&lt;img');const {root}=controller(s);expect(root.querySelector('img[src=x]')).toBeNull()
  })
  it('uses explicit phase/ballot and reveal actions so retries cannot advance a new ballot',()=>{
    const g=snapshot('tiebreak').no_context;g.play.ballot=2
    expect(noContextHostActions(g)[0].action).toBe('close_voting_2')
    g.play.phase='results';expect(noContextHostActions(g)[0].action).toBe('reveal_3')
    g.play.phase='reveal';g.play.revealed_place=3;expect(noContextHostActions(g)[0].action).toBe('reveal_2')
    g.play.revealed_place=2;expect(noContextHostActions(g)[0].action).toBe('reveal_1')
    g.play.phase='round_complete';g.play.number=5;expect(noContextHostActions(g)[0].action).toBe('finish')
  })
  it('confirms early close only when inputs and meaningful time remain',()=>{
    const g=snapshot().no_context;expect(noContextCloseWarning(g,20)).toContain('7 teams');expect(noContextCloseWarning(g,2)).toBe('');g.response_count=10;expect(noContextCloseWarning(g,20)).toBe('')
  })
  it('submits, confirms and edits the same team response',async()=>{
    const state=snapshot(),{root,submitResponse}=controller(state)
    let input=root.querySelector('textarea');input.value='First answer';input.dispatchEvent(new Event('input'))
    root.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush()
    expect(submitResponse).toHaveBeenCalledWith('t1','p1','First answer');expect(root.textContent).toContain('Answer submitted!')
    root.querySelector('#ncEdit').click();input=root.querySelector('textarea');expect(input.value).toBe('First answer')
    input.value='Better answer';input.dispatchEvent(new Event('input'));root.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush()
    expect(state.no_context.my_response).toBe('Better answer');expect(root.textContent).toContain('Answer submitted!')
  })
  it('preserves draft text and cursor across realtime refreshes',()=>{
    const state=snapshot(),{root,c}=controller(state),input=root.querySelector('textarea')
    input.value='Draft in progress';input.dispatchEvent(new Event('input'));input.focus();input.setSelectionRange(5,5)
    c.render(state);expect(root.querySelector('textarea').value).toBe('Draft in progress');expect(document.activeElement.id).toBe('ncResponse');expect(document.activeElement.selectionStart).toBe(5)
  })
  it('prevents blank/oversized submissions and disables editing when the timer expires',()=>{
    const state=snapshot(),{root}=controller(state),input=root.querySelector('textarea')
    expect(root.querySelector('form button').disabled).toBe(true)
    input.value='x'.repeat(141);input.dispatchEvent(new Event('input'));expect(root.querySelector('form button').disabled).toBe(true)
    state._hydratedAt=Date.now()-46000;updateNoContextClock(root,state);expect(input.disabled).toBe(true)
  })
  it('allows vote changes, but never renders a self-vote button',async()=>{
    const state=snapshot('voting');state.no_context.options.push({id:'r3',text:'Third response',is_own:false})
    const {root,submitVote}=controller(state)
    expect(root.querySelector('[data-nc-vote="r1"]')).toBeNull()
    root.querySelector('[data-nc-vote="r2"]').click();await flush();expect(root.textContent).toContain('Vote submitted!')
    root.querySelector('[data-nc-vote="r3"]').click();await flush();expect(submitVote).toHaveBeenLastCalledWith('t1','p1','r3',0)
  })
  it('does not offer votes in the reading phase',()=>{
    const {root}=controller(snapshot('reading'));expect([...root.querySelectorAll('[data-nc-vote]')].every(b=>b.disabled)).toBe(true)
  })
  it('shows Captain podium feedback only for officially revealed placements',()=>{
    const state=snapshot('results'),{root,c}=controller(state);expect(root.textContent).not.toContain('YOU WON')
    state.no_context.play.phase='round_complete';state.no_context.play.revealed_place=1;state.no_context.revealed=[{team_id:'t1',placement:1,points:5,name:'Table One',text:'Winner',votes:4}]
    c.render(state);expect(root.textContent).toContain('YOU WON THE ROUND!');expect(root.textContent).toContain('+5 points')
    expect(noContextStage(state)).toContain('Table One');expect(noContextStage(state)).toContain('4 votes')
  })
  it('clears UI drafts when the next play arrives',()=>{
    const state=snapshot(),{root,c}=controller(state),input=root.querySelector('textarea');input.value='Old answer';input.dispatchEvent(new Event('input'))
    state.no_context.play.id='p2';state.no_context.play.number=2;c.render(state);expect(root.querySelector('textarea').value).toBe('')
  })
  it('integrates planned and persisted No Context with the existing navigator',()=>{
    expect(mergeHostRoundOptions({},[{type:'noContext',title:'No Context'}])[0].game_type).toBe('no_context')
    expect(hostRoundOptions(snapshot())[0]).toMatchObject({id:'nc',configured:true})
  })
  it('routes setup, control and Captain input through the current Supabase client',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:null,error:null}),client={rpc}
    await setupNoContext(client,'event',NO_CONTEXT_TEST_PROMPTS);await controlNoContext(client,'event','play','start')
    await submitNoContextResponse(client,'team','play','Hello');await submitNoContextVote(client,'team','play','response',2)
    expect(rpc.mock.calls.map(([name])=>name)).toEqual(['setup_no_context','no_context_control','submit_no_context_response','submit_no_context_vote'])
    expect(rpc).toHaveBeenLastCalledWith('submit_no_context_vote',{p_team_id:'team',p_play_id:'play',p_response_id:'response',p_ballot:2})
  })
})
