import {describe,expect,it} from 'vitest'
import {friendlyJoinError,isTeamNameTaken,joinAvailability,normalizeTeamName,rosterPresentation} from './team-join.js'

describe('Team join polish',()=>{
  const roster=[{name:'The Quizards',mascot_id:'robot'}]
  it('normalizes case and whitespace for live availability',()=>{expect(normalizeTeamName('  THE   Quizards ')).toBe('the quizards');expect(isTeamNameTaken('the quizards',roster)).toBe(true)})
  it('presents only mascot and display name in Already Playing',()=>expect(rosterPresentation([{id:'secret',auth_user_id:'secret',...roster[0]}])).toEqual(roster))
  it('supports a friendly empty roster',()=>expect(rosterPresentation([])).toEqual([]))
  it.each([
    [{name:'',mascotId:'fox'},false],
    [{name:'the quizards',mascotId:'fox',roster},false],
    [{name:'Vixens',mascotId:null},false],
    [{name:'Vixens',mascotId:'fox',takenMascotIds:['fox']},false],
    [{name:'Vixens',mascotId:'fox'},true],
  ])('derives whether Join Game is enabled for %o', (input,expected)=>expect(joinAvailability(input).canJoin).toBe(expected))
  it('maps name and mascot races to specific safe errors',()=>{expect(friendlyJoinError({message:'That Team name is already taken.'})).toBe('That Team name is already taken.');expect(friendlyJoinError({message:'That mascot was just taken'})).toBe('That mascot was just taken. Pick another one.')})
})
