// Local-only end-to-end API smoke test. Never target a hosted database.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {NO_CONTEXT_TEST_PROMPTS} from '../src/no-context-content.js'
const url=process.env.SUPABASE_URL
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Local Supabase URL required')
const options={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options)
const users=[],captains=[];let host,eventId
const rpc=async(client,name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw error;return data}
try{
  const email=`nc-smoke-${randomUUID()}@example.test`,password=randomUUID()+'Aa1!'
  const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});if(error)throw error;users.push(data.user.id)
  host=createClient(url,process.env.SUPABASE_ANON_KEY,options)
  const signed=await host.auth.signInWithPassword({email,password});if(signed.error)throw signed.error
  const event=await rpc(host,'create_event',{p_name:'No Context local smoke',p_venue:'Local test',p_event_date:'2026-09-24'});eventId=event.id
  await rpc(host,'open_event_lobby',{p_event_id:eventId})
  for(let i=0;i<3;i++){
    const client=createClient(url,process.env.SUPABASE_ANON_KEY,options),session=await client.auth.signInAnonymously();if(session.error)throw session.error;users.push(session.data.user.id)
    await rpc(client,'join_event',{p_room_code:event.room_code,p_team_name:`Table ${i+1}`,p_mascot_id:['fox','frog','bear'][i]})
    const state=await rpc(client,'get_team_room_state',{p_room_code:event.room_code});captains.push({client,id:state.team.id})
  }
  await rpc(host,'setup_no_context',{p_event_id:eventId,p_prompts:NO_CONTEXT_TEST_PROMPTS})
  const hostState=()=>rpc(host,'get_host_event_state',{p_event_id:eventId})
  const control=async(action)=>{const s=await hostState();return rpc(host,'no_context_control',{p_event_id:eventId,p_play_id:s.no_context.play.id,p_action:action})}
  for(let round=1;round<=5;round++){
    await control('start');let s=await hostState();assert.equal(s.no_context.play.number,round)
    const playId=s.no_context.play.id
    await Promise.all(captains.map((c,i)=>rpc(c.client,'submit_no_context_response',{p_team_id:c.id,p_play_id:playId,p_response:`Round ${round} answer ${i+1}`})))
    await rpc(captains[0].client,'submit_no_context_response',{p_team_id:captains[0].id,p_play_id:playId,p_response:`Round ${round} revised answer`})
    s=await hostState();assert.equal(s.no_context.response_count,3);assert.deepEqual(s.no_context.options,[])
    await control('close_responses');await control('start_voting')
    await Promise.all(captains.map(async c=>{
      const state=await rpc(c.client,'get_team_room_state',{p_room_code:event.room_code}),eligible=state.no_context.options.filter(o=>!o.is_own)
      for(const target of eligible)await rpc(c.client,'submit_no_context_vote',{p_team_id:c.id,p_play_id:playId,p_response_id:target.id,p_ballot:0})
    }))
    await control('close_voting_0')
    s=await hostState()
    let tieBallots=0
    while(s.no_context.play.phase==='tiebreak'){
      assert.ok(++tieBallots<=2,'tiebreaks must terminate')
      const ballot=s.no_context.play.ballot
      await Promise.all(captains.map(async c=>{
        const state=await rpc(c.client,'get_team_room_state',{p_room_code:event.room_code}),eligible=state.no_context.options.filter(o=>!o.is_own)
        if(eligible.length)await rpc(c.client,'submit_no_context_vote',{p_team_id:c.id,p_play_id:playId,p_response_id:eligible[0].id,p_ballot:ballot})
      }))
      await control(`close_voting_${ballot}`);s=await hostState()
    }
    assert.equal(s.no_context.play.phase,'results');assert.deepEqual(s.no_context.revealed,[])
    for(const place of [3,2,1]){await control(`reveal_${place}`);await control(`reveal_${place}`)}
    s=await hostState();assert.equal(s.no_context.revealed.length,3)
    assert.equal(s.leaderboard.reduce((sum,t)=>sum+t.points,0),round*9)
    if(round<5)await control('next')
  }
  await control('finish');let s=await hostState();assert.equal(s.event.display_mode,'leaderboard');assert.equal(s.no_context.play.phase,'complete')
  const audience=await rpc(captains[0].client,'get_public_room_state',{p_room_code:event.room_code});assert.equal(audience.leaderboard.reduce((sum,t)=>sum+t.points,0),45)
  await control('restart');s=await hostState();assert.equal(s.no_context.play.number,1);assert.equal(s.no_context.response_count,0);assert.equal(s.leaderboard.reduce((sum,t)=>sum+t.points,0),0)
  console.log('PASS: local Auth + PostgREST, three independent Captains, five rounds, edited responses/votes, ties, reveals, cumulative scores and restart')
}finally{
  if(host&&eventId)await rpc(host,'delete_event',{p_event_id:eventId})
  for(const id of users){const {error}=await admin.auth.admin.deleteUser(id);if(error)throw error}
}
