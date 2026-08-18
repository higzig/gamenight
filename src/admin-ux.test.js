import {describe,expect,it} from 'vitest'
import {audienceDisplayOptions,guessPrimaryAction,hostRoundOptions,leaderboardRows,mergeHostRoundOptions,selectSensibleControlRound} from './admin-ux.js'

describe('Admin control-surface models',()=>{
  const rounds=[{id:'g',position:1,game_type:'guess_age',title:'Guess the Age'},{id:'i',position:2,game_type:'i_bet_you',title:'I Bet You'},{id:'x',position:3,game_type:'future',title:'Later'}]
  it('shows every planned round and marks unconfigured rounds safely',()=>expect(hostRoundOptions({rounds}).map(x=>[x.id,x.configured])).toEqual([['g',true],['i',true],['x',false]]))
  it('restores saved Host control selection before authoritative active gameplay',()=>expect(selectSensibleControlRound(rounds,'i','g')).toBe('i'))
  it('falls back to active then first configured round',()=>{expect(selectSensibleControlRound(rounds,null,'i')).toBe('i');expect(selectSensibleControlRound(rounds)).toBe('g')})
  it('derives one relevant Guess the Age primary action',()=>{expect(guessPrimaryAction('ready')).toMatchObject({id:'startQuestion'});expect(guessPrimaryAction('reveal')).toMatchObject({id:'nextQuestion'});expect(guessPrimaryAction('question').id).toBeNull()})
  it('models one selected Audience display mode',()=>expect(audienceDisplayOptions('leaderboard').filter(x=>x.selected).map(x=>x.value)).toEqual(['leaderboard']))
  it('renders compact mascot-ready leaderboard ordering',()=>expect(leaderboardRows([{name:'B',points:3},{name:'A',points:8}])).toMatchObject([{name:'A',place:1,points:8},{name:'B',place:2,points:3}]))
  it('keeps planned I Bet You directly navigable before authoritative setup',()=>expect(mergeHostRoundOptions({rounds:[rounds[0]]},[{type:'guessAge',title:'Guess the Age'},{type:'iBetYou',title:'I Bet You'}]).map(x=>x.game_type)).toEqual(['guess_age','i_bet_you']))
  it('does not reorder or mutate the planned run of show while selecting control state',()=>{const original=structuredClone(rounds);selectSensibleControlRound(rounds,'i','g');expect(rounds).toEqual(original)})
})
