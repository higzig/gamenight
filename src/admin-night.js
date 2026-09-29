import {lineupValidationError} from './celebrity-library.js'
import {perfectLieValidationError,perfectLiePayload} from './perfect-lie.js'

export const GAME_TYPES={guessAge:'guess_age',perfectLie:'perfect_lie',iBetYou:'i_bet_you',noContext:'no_context'}
export const PLAN_PREFIX='gameNightPlan:'
export function serverGame(snapshot,type){
  if(type==='perfectLie')return snapshot.perfect_lie?.round
  if(type==='iBetYou')return snapshot.i_bet_you?.round
  if(type==='noContext')return snapshot.no_context?.round
  return snapshot.rounds?.find(r=>r.game_type===GAME_TYPES[type])
}
// A selected database round is not necessarily live: saving Guess the Age selects it.
export function gameProgress(snapshot,type){
  const round=serverGame(snapshot,type),event=snapshot.event||{}
  if(!round)return 'upcoming'
  const checkpoint=snapshot.game_pause?.games?.find(g=>g.round_id===round.id)
  if(checkpoint?.state==='paused')return 'paused'
  if(checkpoint?.state==='complete'&&event.active_round_id!==round.id)return 'complete'
  if(type==='noContext'&&snapshot.no_context.play?.phase==='ready'&&event.active_round_id===round.id&&event.display_mode==='game')return 'live'
  if(type==='noContext')return snapshot.no_context.play?.phase==='complete'?'complete':snapshot.no_context.play?.number>1||snapshot.no_context.play?.phase!=='ready'?'live':'upcoming'
  if(type==='perfectLie')return round.phase==='complete'?'complete':round.active_question_id||!['setup','ready'].includes(round.phase)?'live':'upcoming'
  if(type==='iBetYou')return round.status==='complete'?'complete':round.status==='playing'||event.active_round_id===round.id&&event.display_mode==='game'?'live':'upcoming'
  if(event.active_round_id===round.id){
    if(event.status==='round_complete')return 'complete'
    const current=round.questions?.find(q=>q.id===event.active_question_id)
    if(['question','suspense','locked','reveal'].includes(event.status)||current?.position>1||event.status==='ready'&&event.display_mode==='game'&&current)return 'live'
  }
  return 'upcoming'
}
export function setupError(game,snapshot){
  if(game.type==='guessAge')return lineupValidationError(game.settings?.celebrities||[])?.replaceAll('syncing','saving')
  if(game.type==='perfectLie')return perfectLieValidationError(game.settings?.categories||[])
  if(game.type==='iBetYou'&&(snapshot.teams||[]).filter(t=>t.status!=='inactive').length<2)return 'At least two teams need to join.'
  return null
}
export function nightGames(snapshot,plan){
  return plan.games.filter(g=>GAME_TYPES[g.type]).map(game=>{
    const remote=serverGame(snapshot,game.type),progress=gameProgress(snapshot,game.type)
    // Retain legacy browser progress until a server checkpoint supersedes it.
    const remembered=plan.progress?.[game.type]
    const status=game.awaitingStart&&progress==='complete'?'upcoming':progress!=='upcoming'?progress:remembered||'upcoming'
    return {...game,remote,status,error:setupError(game,snapshot),editable:status==='upcoming'}
  })
}
export function reconcilePlan(snapshot,plan,names){
  const next=structuredClone(plan||{games:[],excluded:[],progress:{}})
  next.games=next.games.filter(g=>GAME_TYPES[g.type]);next.excluded||=[];next.progress||={}
  for(const [type,gameType]of Object.entries(GAME_TYPES)){
    const remote=serverGame(snapshot,type);if(!remote)continue
    const progress=gameProgress(snapshot,type)
    if(progress!=='upcoming'&&!next.games.find(g=>g.type===type)?.awaitingStart)next.progress[type]=progress
    if(next.excluded.includes(type)&&progress==='upcoming')continue
    let game=next.games.find(g=>g.type===type)
    if(!game){game={id:`plan-${gameType}`,type,title:remote.title||names[type],settings:{}};next.games.push(game)}
    // Unsaved editor data is kept in a separate draft, never overwritten by polling.
    game.title=remote.title||game.title||names[type]
    if(type==='guessAge')game.settings={timer:15,points:'bands',celebrities:(remote.questions||[]).map(q=>({id:q.celebrity_id,questionId:q.id,name:q.celebrity_name,dob:q.date_of_birth,imageKind:q.image_kind,imagePath:q.image_path,image:q.external_image_url||'',imageSourceKind:q.image_source,sourceReference:q.source_reference,libraryStatus:q.celebrity_id?'existing':'new'}))}
    if(type==='perfectLie'&&snapshot.perfect_lie.categories)game.settings={categories:structuredClone(snapshot.perfect_lie.categories)}
  }
  return next
}
export async function startPlannedGame(game,{snapshot,actions,prompts}){
  const s=snapshot(),existing=serverGame(s,game.type)
  if(game.status==='paused'){await actions.selectGame(existing.id);return}
  if(game.type==='guessAge'){
    if(!existing)await actions.saveGuessAgeRound(game.title,game.settings.celebrities)
    await actions.selectGame(serverGame(snapshot(),game.type).id)
  }else if(game.type==='perfectLie'){
    if(!existing)await actions.savePerfectLie(game.title,perfectLiePayload(game.settings.categories))
    await actions.selectGame(serverGame(snapshot(),game.type).id)
    const current=snapshot().perfect_lie
    if(!current.round.active_question_id){const first=current.categories?.flatMap(c=>c.questions||[])[0];if(!first)throw new Error('Add a question first.');await actions.advancePerfectLieQuestion(first.id)}
    await actions.setDisplay('game')
  }else if(game.type==='iBetYou'){
    if(!existing)await actions.setupIBetYou()
    else await actions.selectGame(existing.id)
  }else if(game.type==='noContext'){
    if(!existing)await actions.setupNoContext(prompts)
    await actions.selectGame(snapshot().no_context.round.id)
  }
}
