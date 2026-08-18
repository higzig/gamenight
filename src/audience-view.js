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
  return value>0?`+${value} PTS`:'0 PTS'
}

export function revealLayout(teamCount) {
  const count=Math.max(0,Number(teamCount)||0)
  return {count,columns:count<=2?2:count<=4?4:count<=6?3:4,dense:count>4}
}

export function lockCountChange(previous,next,reducedMotion=false) {
  return {value:Number(next)||0,pop:!reducedMotion&&previous!=null&&Number(next)>Number(previous)}
}

export function answeringPresentation(answerCount,teamCount,previousCount=null,reducedMotion=false) {
  const change=lockCountChange(previousCount,answerCount,reducedMotion)
  return {countText:`${change.value} / ${Number(teamCount)||0}`,label:'TEAMS LOCKED IN',pop:change.pop,individualGuesses:[]}
}

export function lockCountParts(submitted,total) {
  const safe=value=>{const number=Number(value);return Number.isFinite(number)?Math.max(0,Math.trunc(number)):0}
  return {submitted:String(safe(submitted)),total:String(safe(total)),label:'TEAMS LOCKED IN'}
}

export function lockCountMarkup(submitted,total,{secondary=false,pop=false}={}) {
  const count=lockCountParts(submitted,total)
  return `<div class="lock-count-block${secondary?' secondary':''}${pop?' count-pop':''}" data-lock-count><strong class="locked-count"><span>${count.submitted}</span><small> / ${count.total}</small></strong><span class="lock-count-label">${count.label}</span></div>`
}

export function revealAgeLabel({settled=false,correctReached=false,overshooting=false}={}) {
  if(settled||correctReached)return overshooting?'HIGH GUESSES':''
  return 'COUNTING UP'
}

export function buildCountUpTrack(markers=[],correctAge) {
  const answer=Math.max(1,Math.min(120,Number(correctAge)||1)),highest=Math.max(answer,...markers.map(x=>Number(x.guess)||1)),max=Math.max(1,Math.min(120,highest)),lanes=[]
  const position=age=>(Math.max(1,Math.min(max,Number(age)))/max)*100
  const sorted=[...markers].sort((a,b)=>Number(a.guess)-Number(b.guess)||(a.team_name||'').localeCompare(b.team_name||''))
  return {max,correctAge:answer,answerPosition:position(answer),markers:sorted.map(marker=>{const markerPosition=position(marker.guess);let lane=lanes.findIndex(last=>Math.abs(last-markerPosition)>=11);if(lane<0)lane=lanes.length;lanes[lane]=markerPosition;return {...marker,position:markerPosition,lane}})}
}

export function revealFrame(age,track) {
  const current=Math.max(1,Math.min(track.max,Number(age)||1))
  return {age:current,progress:(current/track.max)*100,primaryProgress:(Math.min(current,track.correctAge)/track.max)*100,overshootProgress:(Math.max(0,current-track.correctAge)/track.max)*100,overshooting:current>track.correctAge,correctReached:current>=track.correctAge,revealedMarkers:track.markers.filter(marker=>Number(marker.guess)<=current)}
}

export async function animateCountUp({track,onFrame=()=>{},onCorrect=()=>{},onComplete=()=>{},reducedMotion=false,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  if(reducedMotion){const frame=revealFrame(track.max,track);onFrame(frame);onCorrect(frame);onComplete(frame);return frame}
  let frame=revealFrame(1,track);onFrame(frame)
  await sleep(250)
  if(track.correctAge===1){onCorrect(frame);await sleep(900)}
  const beforeDelay=Math.max(22,Math.min(52,Math.round(2200/track.correctAge))),afterCount=Math.max(1,track.max-track.correctAge),afterDelay=Math.max(18,Math.min(38,Math.round(700/afterCount)))
  for(let age=2;age<=track.max;age+=1){frame=revealFrame(age,track);onFrame(frame);if(age===track.correctAge){onCorrect(frame);await sleep(900)}else await sleep(age<track.correctAge?beforeDelay:afterDelay)}
  onComplete(frame);return frame
}
