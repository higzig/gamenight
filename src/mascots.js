export const MASCOTS = Object.freeze([
  ['frog','🐸'],['fox','🦊'],['bear','🐻'],['shark','🦈'],['octopus','🐙'],['dinosaur','🦖'],['ghost','👻'],['robot','🤖'],
  ['alien','👽'],['rocket','🚀'],['crown','👑'],['wizard','🧙'],['dragon','🐉'],['cat','🐱'],['dog','🐶'],['penguin','🐧'],
  ['monkey','🐵'],['tiger','🐯'],['lion','🦁'],['owl','🦉'],['bee','🐝'],['snake','🐍'],['unicorn','🦄'],['skull','💀'],
  ['lightning','⚡'],['flame','🔥'],['star','⭐'],['planet','🪐'],['gamepad','🎮'],['dice','🎲'],['pizza','🍕'],['burger','🍔'],
].map(([id,emoji])=>({id,emoji,label:id[0].toUpperCase()+id.slice(1)})))

const BY_ID=new Map(MASCOTS.map(item=>[item.id,item]))
export const mascotEmoji=id=>BY_ID.get(id)?.emoji??'❔'
export const mascotLabel=id=>BY_ID.get(id)?.label??'Mascot not selected'
export function mascotChoices(taken=[],selected=null){const unavailable=new Set(taken);return MASCOTS.map(item=>({...item,taken:unavailable.has(item.id)&&item.id!==selected,selected:item.id===selected}))}
export function mascotGridHtml(taken=[],selected=null){return mascotChoices(taken,selected).map(item=>`<button type="button" class="mascot-choice${item.selected?' selected':''}${item.taken?' taken':''}" data-mascot="${item.id}" ${item.taken?'disabled':''} aria-pressed="${item.selected}"><span>${item.emoji}</span><small>${item.taken?'Taken':item.label}</small></button>`).join('')}
