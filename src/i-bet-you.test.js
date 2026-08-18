import { describe,expect,it } from 'vitest'
import { activeIBetYouGroup,adjustBid,groupForTeam,iBetYouAudienceModel,iBetYouGroups,iBetYouHostActions,iBetYouSecondsRemaining,iBetYouTeamModel,initialProposedBid,teamName,validateIBetYouChallenge,validateIBetYouCommit } from './i-bet-you.js'

const members=[{team_id:'t1',name:'Team A',position:1},{team_id:'t2',name:'Team B',position:2},{team_id:'t3',name:'Team C',position:3}]
const baseGroup={id:'g1',position:1,state:'waiting',category:{id:'c1',title:'Harry Potter Spells',difficulty:'medium'},members,current_bidder_team_id:null,current_bid:null,challenged_bidder_team_id:null,challenger_team_id:null,target_bid:null,result:null,winning_team_id:null}
const makeState=(group=baseGroup)=>({server_now:'2026-08-14T12:00:00Z',_hydratedAt:1000,event:{active_round_id:'r1'},team:{id:'t1'},i_bet_you:{round:{id:'r1',active_group_id:'g1',status:'playing'},groups:[group,{...baseGroup,id:'g2',position:2,members:[{team_id:'t4',name:'Team D'}]}]}})

describe('I Bet You hosted UI model',()=>{
  it('restores the authoritative active group after hydration',()=>expect(activeIBetYouGroup(makeState()).id).toBe('g1'))
  it('renders persisted group assignments',()=>expect(iBetYouAudienceModel(makeState()).members.map(x=>x.name)).toEqual(['Team A','Team B','Team C']))
  it('carries mascot identity through I Bet You member presentation',()=>{const state=makeState({...baseGroup,members:[{...members[0],mascot_id:'frog'},...members.slice(1)]});expect(iBetYouAudienceModel(state).members[0].mascot_id).toBe('frog')})
  it('exposes the actual persisted group count for variable Admin rendering',()=>{expect(iBetYouGroups(makeState()).length).toBe(2);const four=makeState();four.i_bet_you.groups=[baseGroup,{...baseGroup,id:'g2'},{...baseGroup,id:'g3'},{...baseGroup,id:'g4'}];expect(iBetYouGroups(four).length).toBe(4)})
  it('renders the assigned category',()=>expect(iBetYouAudienceModel(makeState()).category).toBe('Harry Potter Spells'))
  it('increments and decrements bids with safe bounds',()=>{expect(adjustBid(5,1)).toBe(6);expect(adjustBid(5,-1)).toBe(4);expect(adjustBid(1,-1)).toBe(1)})
  it('starts an opening bid at one and a raised bid above the committed bid',()=>{expect(initialProposedBid(baseGroup)).toBe(1);expect(initialProposedBid({...baseGroup,current_bid:7})).toBe(8)})
  it('requires a Team and a strictly higher committed bid',()=>{expect(validateIBetYouCommit(baseGroup,null,1)).toMatch(/Select/);expect(validateIBetYouCommit(baseGroup,'t1',1)).toBe('');expect(validateIBetYouCommit({...baseGroup,current_bid:7},'t2',7)).toMatch(/higher/);expect(validateIBetYouCommit({...baseGroup,current_bid:7},'t2',8)).toBe('')})
  it('disables Name Them before a bid and prevents self-challenge',()=>{expect(validateIBetYouChallenge(baseGroup,'t2')).toMatch(/Commit/);expect(validateIBetYouChallenge({...baseGroup,current_bidder_team_id:'t2',current_bid:7},'t2')).toMatch(/own bid/);expect(validateIBetYouChallenge({...baseGroup,current_bidder_team_id:'t2',current_bid:7},'t3')).toBe('')})
  it('resolves a selected bidder without typed Team names',()=>expect(teamName(baseGroup,'t2')).toBe('Team B'))
  it('models Name Them with frozen bidder and target',()=>{const state=makeState({...baseGroup,state:'challenged',challenged_bidder_team_id:'t2',challenger_team_id:'t3',target_bid:7});expect(iBetYouAudienceModel(state)).toMatchObject({phase:'challenged',bidder:'Team B',challenger:'Team C',bid:7})})
  it('offers correction and start controls before countdown',()=>expect(iBetYouHostActions({...baseGroup,state:'challenged'})).toEqual(['correct-showdown','start-60s']))
  it('makes explicit bid commit part of the normal Host loop',()=>expect(iBetYouHostActions(baseGroup)).toEqual(['select-team','decrement','increment','commit-bid','name-them']))
  it('derives the 60-second countdown from server timestamps',()=>{const state=makeState({...baseGroup,state:'countdown',countdown_deadline_at:'2026-08-14T12:01:00Z'});expect(iBetYouSecondsRemaining(state,11000)).toBe(50)})
  it('does not decide a result when countdown expires',()=>{const state=makeState({...baseGroup,state:'countdown',countdown_deadline_at:'2026-08-14T12:00:01Z'});expect(iBetYouAudienceModel(state,5000)).toMatchObject({phase:'countdown',seconds:0,result:null})})
  it('keeps large Host judgment actions available during countdown',()=>expect(iBetYouHostActions({...baseGroup,state:'countdown'})).toEqual(['success','fail']))
  it('renders SUCCESS and its winning Team',()=>expect(iBetYouAudienceModel(makeState({...baseGroup,state:'result',result:'success',winning_team_id:'t2'}))).toMatchObject({result:'success',winner:'Team B'}))
  it('renders FAIL and the stealing Team',()=>expect(iBetYouAudienceModel(makeState({...baseGroup,state:'result',result:'fail',winning_team_id:'t3'}))).toMatchObject({result:'fail',winner:'Team C'}))
  it('keeps Next Group manual after a result',()=>expect(iBetYouHostActions({...baseGroup,state:'result'})).toEqual(['next-group']))
  it('finds passive Team-phone group membership',()=>expect(groupForTeam(makeState(),'t1').id).toBe('g1'))
  it('renders Team phones as passive group/category state',()=>expect(iBetYouTeamModel(makeState(),'t1')).toMatchObject({groupNumber:1,category:'Harry Potter Spells',active:true}))
  it('preserves the same bidder and bid after reconnect hydration',()=>{const snapshot=makeState({...baseGroup,state:'bidding',current_bidder_team_id:'t2',current_bid:9});expect(iBetYouAudienceModel(structuredClone(snapshot))).toMatchObject({phase:'bidding',bidder:'Team B',bid:9})})
  it('updates the Audience model after every committed bid hydration',()=>{const first=iBetYouAudienceModel(makeState({...baseGroup,state:'bidding',current_bidder_team_id:'t1',current_bid:5}));const raised=iBetYouAudienceModel(makeState({...baseGroup,state:'bidding',current_bidder_team_id:'t2',current_bid:7}));expect(first).toMatchObject({bidder:'Team A',bid:5});expect(raised).toMatchObject({bidder:'Team B',bid:7})})
})
