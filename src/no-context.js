import { mascotEmoji } from './mascots.js'
import './no-context.css'

export const RESPONSE_LIMIT=140
export const escapeHtml=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export function responseError(value){const size=Array.from(String(value).trim()).length;return size<1?'Write a response first.':size>RESPONSE_LIMIT?'Keep your response to 140 characters.':''}
export function noContextSeconds(snapshot,now=Date.now()){
  const game=snapshot?.no_context,deadline=Date.parse(game?.play?.deadline_at),server=Date.parse(snapshot?.server_now)
  return Number.isFinite(deadline)&&Number.isFinite(server)?Math.max(0,Math.ceil((deadline-server-(now-(snapshot._hydratedAt??now)))/1000)):0
}
export function noContextOptions(game){return (game.options||[]).slice(game.play.page*4,game.play.page*4+4)}
export function noContextCloseWarning(game,seconds){
  const writing=game.play.phase==='responses',missing=(writing?game.team_count:game.eligible_count)-(writing?game.response_count:game.vote_count)
  return missing>0&&seconds>5?`${missing} team${missing===1?' has':'s have'} not ${writing?'answered':'voted'} yet. Close ${writing?'submissions':'voting'} now?`:''
}
export function noContextHostActions(game){
  const {phase,number,revealed_place:place}=game.play
  if(phase==='ready')return [{action:'start',label:`Start round ${number}`}]
  if(phase==='responses')return [{action:'close_responses',label:'Close Submissions'}]
  if(phase==='reading')return [{action:'start_voting',label:'Start Voting'}]
  if(['voting','tiebreak'].includes(phase))return [{action:`close_voting_${game.play.ballot}`,label:phase==='tiebreak'?'Close Tie Break':'Close Voting'}]
  if(['results','reveal'].includes(phase))return [{action:`reveal_${place-1}`,label:`Reveal ${['','1st','2nd','3rd'][place-1]}`}]
  if(phase==='round_complete')return [{action:number===5?'finish':'next',label:number===5?'Finish No Context':'Next Round'}]
  return []
}
const esc=escapeHtml
const phaseLabel=phase=>({ready:'Ready',responses:'Discuss at your table',reading:'Read the responses',voting:'Vote for the funniest',tiebreak:'TIE BREAK',results:'Results locked',reveal:'The podium',round_complete:'Round complete',complete:'No Context complete'})[phase]
function media(game){const m=game.prompt.media;return `<img class="nc-media" src="${esc(m.url)}" alt="${esc(m.alt||'No Context visual prompt')}"><h2>${esc(game.prompt.instruction)}</h2>`}
function timer(snapshot){return snapshot.no_context.play.deadline_at?`<strong class="nc-timer" role="timer">${noContextSeconds(snapshot)}s</strong>`:''}
function progress(game){const voting=['voting','tiebreak'].includes(game.play.phase);return `<p class="nc-progress">${voting?`${game.vote_count} / ${game.eligible_count} teams have voted`:`${game.response_count} / ${game.team_count} teams answered`}</p>`}
function optionCards(options){return `<div class="nc-options">${options.map(o=>`<article class="nc-option">${esc(o.text)}</article>`).join('')}</div>`}
function podium(game){
  const current=(game.revealed||[]).find(r=>r.placement===game.play.revealed_place)
  if(!current)return `<h2>${game.play.revealed_place===4?'Waiting for the Host’s reveal':`No ${['','1st','2nd','3rd'][game.play.revealed_place]} place this round`}</h2>`
  return `<article class="nc-podium nc-place-${current.placement}"><p>${['','🥇 FIRST','🥈 SECOND','🥉 THIRD'][current.placement]} PLACE</p><h2>${esc(current.text)}</h2><h3>${mascotEmoji(current.mascot_id)} ${esc(current.name)}</h3><p>${current.votes} ${current.tiebreak?'tie-break ':''}vote${current.votes===1?'':'s'} · +${current.points} points</p></article>`
}
export function noContextStage(snapshot,{host=false}={}){
  const game=snapshot.no_context,{phase,number}=game.play,showOptions=['reading','voting','tiebreak'].includes(phase),pages=Math.max(1,Math.ceil((game.options?.length||0)/4))
  let body=''
  if(['ready','responses'].includes(phase))body=media(game)+(phase==='responses'?progress(game):'<p>The Host will start the 45-second response timer.</p>')
  else if(showOptions)body=`${phase==='tiebreak'?'<p>The room couldn’t decide. Vote only among these tied responses.</p>':''}${optionCards(noContextOptions(game))}${!game.options.length?'<p>No responses this round. The Host can continue.</p>':''}<p>Page ${game.play.page+1} / ${pages}</p>${phase==='reading'?'<p>Read and react together. Voting opens when the Host is ready.</p>':progress(game)}`
  else if(phase==='complete')body='<h2>Thanks for playing!</h2><p>Points are on the overall Game Night leaderboard.</p>'
  else body=`${game.play.random_resolution?'<p>Game Night broke the remaining tie at random.</p>':''}${podium(game)}`
  const actions=host?`<div class="nc-actions">${noContextHostActions(game).map(a=>`<button class="btn primary" data-nc-action="${a.action}">${a.label}</button>`).join('')}${showOptions&&pages>1?`<button class="btn secondary" data-nc-action="page_previous" ${game.play.page===0?'disabled':''}>Previous page</button><button class="btn secondary" data-nc-action="page_next" ${game.play.page>=pages-1?'disabled':''}>Next page</button>`:''}</div><details><summary>Recovery</summary><button class="btn secondary" data-nc-action="restart">Restart No Context</button></details>`:''
  return `<section class="nc-stage ${host?'nc-host':''}"><header><p>NO CONTEXT · ROUND ${number} / 5</p><h1>${phaseLabel(phase)}</h1>${timer(snapshot)}</header>${body}${actions}</section>`
}
export function updateNoContextClock(root,snapshot){
  if(!snapshot?.no_context)return
  const seconds=noContextSeconds(snapshot)
  root.querySelectorAll('.nc-timer').forEach(el=>el.textContent=seconds?`${seconds}s`:'Time’s up — closing…')
  if(snapshot.no_context?.play.deadline_at&&seconds===0)root.querySelectorAll('[data-nc-input]').forEach(el=>el.disabled=true)
}

// UI-only drafts. Identity and accepted input always come from the existing session/RPCs.
export function createNoContextTeamController({shell,getState,refresh,submitResponse,submitVote,rerender}){
  let playId=null,draft='',editing=false,pending=false,message=''
  async function send(kind,value){
    if(pending)return
    const snapshot=getState(),game=snapshot.no_context,id=game.play.id
    pending=true;message='';rerender()
    try{
      if(kind==='response')await submitResponse(snapshot.team.id,id,value)
      else await submitVote(snapshot.team.id,id,value,game.play.ballot)
      if(playId===id)editing=false
      await refresh()
    }catch(error){message=error?.message||'Could not save. Check your connection and try again.';await refresh().catch(()=>{})}
    finally{pending=false;rerender()}
  }
  return {render(snapshot){
    const game=snapshot.no_context,{phase,id}=game.play,open=noContextSeconds(snapshot)>0
    const focused=document.activeElement?.id==='ncResponse',selection=focused?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null
    if(playId!==id){playId=id;draft=game.my_response||'';editing=false;message=''}
    let content=''
    if(phase==='responses'){
      if(!game.participating)content='<h2>Join in next round</h2><p>Watch the big screen with your table.</p>'
      else if(game.my_response&&!editing)content=`<h2>Answer submitted!</h2><blockquote>${esc(game.my_response)}</blockquote><p>Think you can do better? You can change it until time runs out.</p><button class="btn secondary" id="ncEdit" data-nc-input ${!open||pending?'disabled':''}>Edit Answer</button>`
      else content=`${media(game)}<form id="ncResponseForm"><label for="ncResponse">Your team’s answer</label><textarea id="ncResponse" data-nc-input rows="3" placeholder="Type your team’s answer…" ${!open||pending?'disabled':''}>${esc(draft)}</textarea><p id="ncCounter">${Array.from(draft).length} / 140 characters</p><button class="btn primary full" data-nc-input ${!open||pending||responseError(draft)?'disabled':''}>${pending?'Saving…':'Submit'}</button></form>`
    }else if(['reading','voting','tiebreak'].includes(phase)){
      const canVote=phase!=='reading'&&open&&game.participating&&!pending
      content=`<h2>${phaseLabel(phase)}</h2>${game.my_vote?'<p>Vote submitted! Changed your mind? You can change your vote until voting closes.</p>':''}${phase==='reading'?'<p>Discuss the responses. The Host will open voting shortly.</p>':''}<div class="nc-team-options">${game.options.map(o=>`<article class="nc-option"><p>${esc(o.text)}</p>${o.is_own?'<small>Your team’s response — no self-voting</small>':`<button class="btn secondary" data-nc-input data-nc-vote="${o.id}" ${canVote?'':'disabled'}>${game.my_vote===o.id?'Selected ✓':'Vote'}</button>`}</article>`).join('')}</div>${!game.options.length?'<p>No eligible responses. Watch the main screen.</p>':''}`
    }else if(['results','reveal','round_complete'].includes(phase)){
      const mine=game.revealed.find(r=>r.team_id===snapshot.team.id)
      content=mine?`<h2>${['','YOU WON THE ROUND!','YOU GOT 2ND!','YOU GOT 3RD!'][mine.placement]}</h2><h3>+${mine.points} points</h3>`:'<h2>Eyes on the big screen</h2><p>The Host will reveal the podium.</p>'
    }else content=`<h2>${phase==='complete'?'No Context complete':'Get ready'}</h2><p>Discuss together. Your Captain submits for the team.</p>`
    shell(`<section class="card nc-team"><p class="eyebrow">NO CONTEXT · ROUND ${game.play.number} / 5</p>${timer(snapshot)}${message?`<p class="error-box" role="alert">${esc(message)}</p>`:''}${content}</section>`)
    const input=document.getElementById('ncResponse')
    if(input){input.oninput=()=>{draft=input.value;document.getElementById('ncCounter').textContent=`${Array.from(draft).length} / 140 characters`;document.querySelector('#ncResponseForm button').disabled=pending||Boolean(responseError(draft))||noContextSeconds(getState())<=0};if(selection){input.focus();input.setSelectionRange(...selection)};document.getElementById('ncResponseForm').onsubmit=e=>{e.preventDefault();if(!responseError(draft)&&noContextSeconds(getState())>0)send('response',draft)}}
    const edit=document.getElementById('ncEdit');if(edit)edit.onclick=()=>{draft=game.my_response||'';editing=true;rerender();document.getElementById('ncResponse')?.focus()}
    document.querySelectorAll('[data-nc-vote]').forEach(button=>button.onclick=()=>send('vote',button.dataset.ncVote))
  }}
}
