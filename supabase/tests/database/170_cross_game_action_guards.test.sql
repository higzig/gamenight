begin;create extension if not exists pgtap with schema extensions;select plan(23);
set constraints all immediate;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values
('00000000-0000-0000-0000-000000000000','17100000-0000-0000-0000-000000000001','authenticated','authenticated','guards-host@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','27100000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','27100000-0000-0000-0000-000000000002','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','27100000-0000-0000-0000-000000000003','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id)values('17100000-0000-0000-0000-000000000001');
-- E1 plays I Bet You to completion, then moves on to Table of Lies. E2 is a plain Guess the Age night.
insert into public.events(id,host_id,room_code,name,event_date,status,display_mode)values
('a7100000-0000-0000-0000-000000000001','17100000-0000-0000-0000-000000000001','GUARD1','Guards','2026-10-23','lobby','join'),
('a7100000-0000-0000-0000-000000000002','17100000-0000-0000-0000-000000000001','GUARD2','Ages','2026-10-23','lobby','join');
insert into public.teams(id,event_id,auth_user_id,name,mascot_id)values
('d7100000-0000-0000-0000-000000000001','a7100000-0000-0000-0000-000000000001','27100000-0000-0000-0000-000000000001','Frogs','frog'),
('d7100000-0000-0000-0000-000000000002','a7100000-0000-0000-0000-000000000001','27100000-0000-0000-0000-000000000002','Robots','robot'),
('d7100000-0000-0000-0000-000000000003','a7100000-0000-0000-0000-000000000002','27100000-0000-0000-0000-000000000003','Foxes','fox');

set local role authenticated;select set_config('request.jwt.claims','{"sub":"17100000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.setup_i_bet_you_round('a7100000-0000-0000-0000-000000000001');
select set_config('test.group',public.get_host_event_state('a7100000-0000-0000-0000-000000000001')->'i_bet_you'->'groups'->0->>'id',true);
select public.set_i_bet_you_bid(current_setting('test.group')::uuid,'d7100000-0000-0000-0000-000000000001',3);
select public.challenge_i_bet_you(current_setting('test.group')::uuid,'d7100000-0000-0000-0000-000000000002');
select public.judge_i_bet_you_group(current_setting('test.group')::uuid,true);

-- Legitimate: while I Bet You is on stage, the Host can reset and replay the group.
select lives_ok($$select public.reset_i_bet_you_group(current_setting('test.group')::uuid)$$,'Host resets the I Bet You group that is on stage');
select is(public.get_host_event_state('a7100000-0000-0000-0000-000000000001')->'i_bet_you'->'groups'->0->>'state','waiting','Reset returns the group to waiting');
reset role;select is((select count(*) from public.score_awards where event_id='a7100000-0000-0000-0000-000000000001'),0::bigint,'Reset removes the group award');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"17100000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.set_i_bet_you_bid(current_setting('test.group')::uuid,'d7100000-0000-0000-0000-000000000001',4);
select public.challenge_i_bet_you(current_setting('test.group')::uuid,'d7100000-0000-0000-0000-000000000002');
select public.judge_i_bet_you_group(current_setting('test.group')::uuid,false);
select lives_ok($$select public.next_i_bet_you_group(current_setting('test.group')::uuid)$$,'Host completes I Bet You');

-- Move on to a live Table of Lies question; No Context is prepared but not on stage.
select set_config('test.tol',public.save_perfect_lie_round('a7100000-0000-0000-0000-000000000001','Table of Lies','[{"title":"Sport","questions":[{"question_text":"Guard Q?","correct_answer":"Bees"}]}]')::text,true);
select public.setup_no_context('a7100000-0000-0000-0000-000000000001','[{"instruction":"One","media":{"type":"image","url":"/no-context/meeting.svg"}},{"instruction":"Two","media":{"type":"image","url":"/no-context/shopping.svg"}},{"instruction":"Three","media":{"type":"image","url":"/no-context/traffic.svg"}},{"instruction":"Four","media":{"type":"image","url":"/no-context/island.svg"}},{"instruction":"Five","media":{"type":"image","url":"/no-context/picnic.svg"}}]');
select public.select_hosted_game('a7100000-0000-0000-0000-000000000001',current_setting('test.tol')::uuid);
select set_config('test.tol_q',public.get_host_event_state('a7100000-0000-0000-0000-000000000001')->'perfect_lie'->'categories'->0->'questions'->0->>'id',true);
select public.advance_perfect_lie_question('a7100000-0000-0000-0000-000000000001',current_setting('test.tol_q')::uuid);
select public.start_perfect_lie_question('a7100000-0000-0000-0000-000000000001',current_setting('test.tol_q')::uuid,20);
reset role;
select set_config('test.version',(select state_version::text from public.events where id='a7100000-0000-0000-0000-000000000001'),true);
select set_config('test.nc_play',(select active_play_id::text from public.no_context_games where event_id='a7100000-0000-0000-0000-000000000001'),true);

-- A stale Host tab still showing an earlier game sends that game's actions.
set local role authenticated;select set_config('request.jwt.claims','{"sub":"17100000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select throws_ok($$select public.lock_question('a7100000-0000-0000-0000-000000000001')$$,'55000','This game is not on stage. Refresh and select it first.','Stale tab cannot lock answers during Table of Lies');
select throws_ok($$select public.reset_i_bet_you_group(current_setting('test.group')::uuid)$$,'55000','This game is not on stage. Refresh and select it first.','Stale tab cannot reset a finished I Bet You group during another game');
select throws_ok($$select public.reveal_question('a7100000-0000-0000-0000-000000000001')$$,null,null,'Stale tab cannot reveal or score Guess the Age during Table of Lies');
select throws_ok($$select public.advance_guess_age_question('a7100000-0000-0000-0000-000000000001')$$,null,null,'Stale tab cannot advance Guess the Age during Table of Lies');
select throws_ok($$select public.next_i_bet_you_group(current_setting('test.group')::uuid)$$,null,null,'Stale tab cannot advance a finished I Bet You');
-- Judging an already-finished group is an existing idempotent no-op; the state checks below prove it changes nothing.
select lives_ok($$select public.judge_i_bet_you_group(current_setting('test.group')::uuid,true)$$,'Stale judge of a finished I Bet You group is a no-op');
select throws_ok($$select public.no_context_control('a7100000-0000-0000-0000-000000000001',current_setting('test.nc_play')::uuid,'close_responses')$$,null,null,'Stale tab cannot drive No Context while it is off stage');
reset role;

select is((select status from public.events where id='a7100000-0000-0000-0000-000000000001'),'question','Table of Lies question keeps its event status');
select is((select state_version::text from public.events where id='a7100000-0000-0000-0000-000000000001'),current_setting('test.version'),'Rejected stale actions leave shared event state untouched');
select is((select r.game_type from public.events e join public.event_rounds r on r.id=e.active_round_id where e.id='a7100000-0000-0000-0000-000000000001'),'perfect_lie','Table of Lies stays on stage');
select is((select phase from public.perfect_lie_round_states where round_id=current_setting('test.tol')::uuid),'writing','Table of Lies phase is unchanged');
select is((select state from public.i_bet_you_groups where id=current_setting('test.group')::uuid),'complete','Finished I Bet You group stays complete');
select is((select status from public.i_bet_you_round_states where event_id='a7100000-0000-0000-0000-000000000001'),'complete','Finished I Bet You round stays complete');
select is((select count(*) from public.score_awards where event_id='a7100000-0000-0000-0000-000000000001' and metadata->>'game_type'='i_bet_you'),1::bigint,'Finished I Bet You award is kept');
select is((select phase from public.no_context_plays where id=current_setting('test.nc_play')::uuid),'ready','Off-stage No Context is unchanged');

-- Legitimate Guess the Age lock and reveal still work when Guess the Age is on stage.
set local role authenticated;select set_config('request.jwt.claims','{"sub":"17100000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.save_guess_age_round('a7100000-0000-0000-0000-000000000002','Guess the Age','[{"celebrity_name":"Pedro Pascal","date_of_birth":"1975-04-02"}]');
reset role;select set_config('test.ga_q',(select id::text from public.questions where event_id='a7100000-0000-0000-0000-000000000002'),true);
set local role authenticated;select set_config('request.jwt.claims','{"sub":"17100000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.start_question('a7100000-0000-0000-0000-000000000002',current_setting('test.ga_q')::uuid,15);
select lives_ok($$select public.lock_question('a7100000-0000-0000-0000-000000000002')$$,'Host locks answers during Guess the Age');
reset role;select is((select status from public.events where id='a7100000-0000-0000-0000-000000000002'),'locked','Guess the Age answers are locked');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"17100000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.reveal_question('a7100000-0000-0000-0000-000000000002')$$,'Host reveals during Guess the Age');
reset role;select is((select status from public.events where id='a7100000-0000-0000-0000-000000000002'),'reveal','Guess the Age question is revealed');
select * from finish();rollback;
