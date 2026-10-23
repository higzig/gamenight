import {lineupValidationError} from './celebrity-library.js'
import {perfectLieValidationError,perfectLiePayload} from './perfect-lie.js'
import {GAME_CATALOG,STARTER_CELEBRITIES,TYPE_FOR_GAME_TYPE} from './host/game-catalog.js'
import {serverLineupTypes} from './host/lineup.js'

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
  if(game.type==='iBetYou'&&game.settings?.categories){const error=categorySelectionError(game.settings.categories);if(error)return error}
  if(game.type==='iBetYou'){
    const teams=(snapshot.teams||[]).filter(t=>t.status!=='inactive').length
    if(teams<2)return 'At least two teams need to join.'
    const groups=teams<=6?1:Math.ceil(teams/5)
    if(game.settings?.categories&&game.settings.categories.filter(c=>c.selected).length<groups)return `Select at least ${groups} categories for ${teams} teams (${groups} groups).`
  }
  return null
}
// Each game's configuration comes from the server, or the Host's saved defaults before first save.
export function gameSettings(snapshot,type){
  const remote=serverGame(snapshot,type)
  if(type==='guessAge')return {timer:15,points:'bands',celebrities:remote?.questions?.length?remote.questions.map(q=>({id:q.celebrity_id,questionId:q.id,name:q.celebrity_name,dob:q.date_of_birth,imageKind:q.image_kind,imagePath:q.image_path,image:q.external_image_url||'',imageSourceKind:q.image_source,sourceReference:q.source_reference,libraryStatus:q.celebrity_id?'existing':'new'})):guessAgeDefaults(snapshot,STARTER_CELEBRITIES)}
  if(type==='perfectLie')return {categories:structuredClone(snapshot.perfect_lie?.categories||[])}
  if(type==='iBetYou')return {seconds:60,winPoints:5,categories:iBetCategoryDefaults(snapshot)}
  return {}
}
// What a game still needs before it can be played (null when configured).
export function configIssue(type,settings){
  if(type==='guessAge')return lineupValidationError(settings.celebrities||[])?.replaceAll('syncing','saving')||null
  if(type==='perfectLie')return (settings.categories||[]).some(c=>c.questions?.length)?perfectLieValidationError(settings.categories):'Add at least one question.'
  if(type==='iBetYou')return categorySelectionError(settings.categories)
  return null
}
// Tonight's games in server running order. status is gameplay progress (upcoming/live/paused/complete);
// state adds configuration for display (needs_setup/ready/live/paused/complete).
export function nightGames(snapshot){
  const locked=new Map((snapshot.lineup?.games||[]).map(g=>[TYPE_FOR_GAME_TYPE[g.game_type],Boolean(g.locked)]))
  return serverLineupTypes(snapshot).map((type,index)=>{
    const remote=serverGame(snapshot,type),status=gameProgress(snapshot,type),settings=gameSettings(snapshot,type)
    const issue=status==='upcoming'?configIssue(type,settings):null
    const game={id:type,type,position:index+1,title:remote?.title||GAME_CATALOG[type].name,remote,settings,status,state:status==='upcoming'?(issue?'needs_setup':'ready'):status,configIssue:issue,locked:locked.get(type)||false}
    return {...game,error:issue||setupError(game,snapshot),editable:status==='upcoming'&&!game.locked}
  })
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
    if(!existing){
      if(!s.game_defaults?.i_bet_you?.saved_for_event)await actions.saveIBetYouSettings(game.settings?.categories||iBetCategoryDefaults(s))
      await actions.setupIBetYou()
    }
    else await actions.selectGame(existing.id)
  }else if(game.type==='noContext'){
    if(!existing)await actions.setupNoContext(prompts)
    await actions.selectGame(snapshot().no_context.round.id)
  }
}

export function iBetCategoryDefaults(snapshot){return structuredClone(snapshot.game_defaults?.i_bet_you?.categories||[])}
export function guessAgeDefaults(snapshot,fallback){
  const saved=snapshot.game_defaults?.guess_age
  if(!saved?.length)return structuredClone(fallback)
  return saved.map(c=>({id:c.celebrity_id,name:c.celebrity_name,dob:c.date_of_birth,imageKind:c.image_kind,imagePath:c.image_path,image:c.external_image_url||'',imageSourceKind:c.image_source,sourceReference:c.source_reference,libraryStatus:'existing'}))
}
export function categorySelectionError(categories){
  if(!categories?.length)return 'The category list is unavailable. Refresh and try again.'
  if(!categories.some(c=>c.selected))return 'Select at least one category.'
  if(categories.some(c=>!c.title?.trim()||c.title.trim().length<2||c.title.trim().length>120))return 'Categories need 2 to 120 characters.'
  return null
}
