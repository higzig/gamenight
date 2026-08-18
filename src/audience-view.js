export function teamJoinUrl(origin, roomCode) {
  const url = new URL('/team.html', origin)
  url.searchParams.set('room', roomCode)
  return url.href
}

export function audienceMode(state) {
  if (state?.event?.display_mode === 'join') return 'join'
  if (state?.event?.display_mode === 'leaderboard') return 'leaderboard'
  if (state?.event?.status === 'suspense') return 'suspense'
  if (state?.event?.status === 'reveal') return 'reveal'
  return state?.question ? 'question' : 'holding'
}

export function suspenseSeconds(state, now = Date.now()) {
  if (state?.event?.status !== 'suspense' || !state.event.question_reveal_due_at) return 0
  const serverNow = new Date(state.server_now).getTime()
  const due = new Date(state.event.question_reveal_due_at).getTime()
  return Math.max(0, Math.ceil((due - serverNow - (now - (state._hydratedAt ?? now))) / 1000))
}

export function revealOrder(age) {
  return String(age).split('').map((_, index, digits) => digits.length - 1 - index)
}

export async function animateAge({ age, target, reducedMotion = false, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const answer = String(age)
  const shown = Array(answer.length).fill('–')
  if (reducedMotion) { target.textContent = answer; return answer }
  for (const index of revealOrder(age)) {
    for (let step = 0; step < 10; step += 1) {
      shown[index] = String((Number(answer[index]) + step * 7 + 3) % 10)
      target.textContent = shown.join('')
      await sleep(40 + step * 12)
    }
    shown[index] = answer[index]
    target.textContent = shown.join('')
  }
  return target.textContent
}

function stableNumber(value='') { let hash=2166136261;for(const char of value){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return hash>>>0 }

export function scatterGuessMarkers(markers=[]) {
  return markers.map((marker,index)=>{const seed=stableNumber(`${marker.mascot_id}:${marker.guess}:${index}`);return {...marker,left:8+(seed%82),top:8+(Math.floor(seed/97)%68)}})
}

export function buildAgeScale(markers=[],correctAge) {
  if(!markers.length)return {min:Math.max(0,correctAge-5),max:correctAge+5,answerPosition:50,markers:[]}
  const values=[...markers.map(x=>Number(x.guess)),Number(correctAge)],low=Math.min(...values),high=Math.max(...values),padding=Math.max(2,Math.ceil((high-low)*.12)),min=Math.max(0,low-padding),max=Math.max(min+4,high+padding),lanePositions=[]
  const position=value=>((value-min)/(max-min))*100
  return {min,max,answerPosition:position(correctAge),markers:[...markers].sort((a,b)=>a.guess-b.guess||(a.team_name||'').localeCompare(b.team_name||'')).map(marker=>{const markerPosition=position(marker.guess);let lane=lanePositions.findIndex(last=>Math.abs(markerPosition-last)>=12);if(lane<0)lane=lanePositions.length;lanePositions[lane]=markerPosition;return {...marker,position:markerPosition,lane}})}
}

export function differencePresentation(signedDifference) {
  const value=Number(signedDifference)
  if(value===0)return {short:'EXACT',long:'EXACT!'}
  return {short:value>0?`+${value}`:`${value}`,long:`${Math.abs(value)} YEAR${Math.abs(value)===1?'':'S'} ${value>0?'HIGH':'LOW'}`}
}

export function distanceDirection(signedDifference) {
  const value=Number(signedDifference)
  return value===0?'exact':value<0?'right':'left'
}

export function resultPointsLabel(points) {
  const value=Number(points)||0
  return value>0?`+${value}`:'0 PTS'
}

export function revealLayout(teamCount) {
  const count=Math.max(0,Number(teamCount)||0)
  return {count,columns:count<=2?2:count<=4?4:count<=6?3:4,dense:count>4}
}
