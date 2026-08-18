export const CONTROL_ROUND_PREFIX='gameNightControlRound:'

export function hostRoundOptions(snapshot={}) {
  const rounds=[...(snapshot.rounds||[])],ibet=snapshot.i_bet_you?.round
  if(ibet&&!rounds.some(round=>round.id===ibet.id))rounds.push({...ibet,game_type:'i_bet_you',title:ibet.title||'I Bet You'})
  return rounds.sort((a,b)=>(a.position||99)-(b.position||99)).map(round=>({...round,configured:['guess_age','i_bet_you','perfect_lie'].includes(round.game_type)}))
}

export function mergeHostRoundOptions(snapshot={},plannedRounds=[]) {
  const rounds=hostRoundOptions(snapshot),typeFor=round=>round.type==='guessAge'?'guess_age':round.type==='iBetYou'?'i_bet_you':round.type==='perfectLie'?'perfect_lie':null
  for(const [index,planned] of plannedRounds.entries()){const gameType=typeFor(planned);if(gameType&&!rounds.some(round=>round.game_type===gameType))rounds.push({id:`control-${gameType}`,position:index+1,game_type:gameType,title:planned.title,configured:true,setupOnly:true})}
  return rounds.sort((a,b)=>(a.position||99)-(b.position||99))
}

export function selectSensibleControlRound(rounds=[],savedId=null,activeId=null) {
  return rounds.find(round=>round.id===savedId)?.id||rounds.find(round=>round.id===activeId)?.id||rounds.find(round=>round.configured)?.id||rounds[0]?.id||null
}

export function guessPrimaryAction(status) {
  if(status==='reveal')return {id:'nextQuestion',label:'Next question',enabled:true}
  if(['question','suspense'].includes(status))return {id:null,label:status==='question'?'Question live':'Reveal pending',enabled:false}
  return {id:'startQuestion',label:'Start question',enabled:true}
}

export function audienceDisplayOptions(current='game') {
  return ['join','game','leaderboard'].map(value=>({value,label:value==='join'?'Join':value==='game'?'Game':'Leaderboard',selected:value===current}))
}

export function leaderboardRows(teams=[]) {
  return [...teams].sort((a,b)=>(b.points??b.total??0)-(a.points??a.total??0)||String(a.name).localeCompare(String(b.name))).map((team,index)=>({...team,place:index+1,points:team.points??team.total??0}))
}
