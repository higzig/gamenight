begin;create extension if not exists pgtap with schema extensions;select plan(37);
set constraints all immediate;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values
('00000000-0000-0000-0000-000000000000','18000000-0000-0000-0000-000000000001','authenticated','authenticated','lineup-host@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','18000000-0000-0000-0000-000000000002','authenticated','authenticated','lineup-other@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','28000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','28000000-0000-0000-0000-000000000002','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id)values('18000000-0000-0000-0000-000000000001'),('18000000-0000-0000-0000-000000000002');
-- E1 is a new night. E2 is an older night that already played Guess the Age before lineups existed.
insert into public.events(id,host_id,room_code,name,event_date,status,display_mode)values
('a8000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','LINEUP','New night','2026-10-23','lobby','join'),
('a8000000-0000-0000-0000-000000000002','18000000-0000-0000-0000-000000000001','OLDNIT','Old night','2026-10-23','lobby','join');
insert into public.teams(id,event_id,auth_user_id,name,mascot_id)values
('d8000000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000001','Frogs','frog'),
('d8000000-0000-0000-0000-000000000002','a8000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000002','Robots','robot');

set local role authenticated;select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select is(public.get_host_event_state('a8000000-0000-0000-0000-000000000001')->'lineup',jsonb_build_object('revision',null,'started_at',null,'games','[]'::jsonb),'A new event has no saved running order yet');
select throws_ok($$select public.start_game_night('a8000000-0000-0000-0000-000000000001')$$,'55000','Add at least one game before starting the night.','Start Game Night needs at least one game');
reset role;select set_config('test.v0',(select state_version::text from public.events where id='a8000000-0000-0000-0000-000000000001'),true);
set local role authenticated;select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['guess_age','no_context','i_bet_you'],null)$$,'Host saves the three recommended games');
select is((select jsonb_agg(g->>'game_type') from jsonb_array_elements(public.get_host_event_state('a8000000-0000-0000-0000-000000000001')->'lineup'->'games')g),'["guess_age","no_context","i_bet_you"]'::jsonb,'Running order is stored in order');
select is((public.get_host_event_state('a8000000-0000-0000-0000-000000000001')->'lineup'->>'revision')::integer,1,'First save sets revision 1');
reset role;
select ok((select state_version::bigint from public.events where id='a8000000-0000-0000-0000-000000000001')>current_setting('test.v0')::bigint,'Saving the running order notifies other screens');
select is((select active_round_id from public.events where id='a8000000-0000-0000-0000-000000000001'),null::uuid,'Saving the running order does not choose an active game');
select is((select status from public.events where id='a8000000-0000-0000-0000-000000000001'),'lobby','Saving the running order does not change event status');
select is((select count(*) from public.event_rounds where event_id='a8000000-0000-0000-0000-000000000001'),0::bigint,'Saving the running order creates no rounds');
select is((select count(*) from public.i_bet_you_groups where event_id='a8000000-0000-0000-0000-000000000001')+(select count(*) from public.no_context_plays where event_id='a8000000-0000-0000-0000-000000000001'),0::bigint,'Saving the running order creates no groups or plays');

set local role authenticated;select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select throws_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['guess_age'],null)$$,'40001',null,'A stale revision is rejected');
select throws_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['guess_age','guess_age'],1)$$,'22023','Each game can appear once per night.','Duplicate games are rejected');
select throws_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['bingo'],1)$$,'22023','Choose up to four different games.','Unknown games are rejected');
select lives_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['i_bet_you','guess_age','perfect_lie'],1)$$,'Host reorders, replaces No Context with Table of Lies and keeps its slot');
select is((select jsonb_agg(g->>'game_type') from jsonb_array_elements(public.get_host_event_state('a8000000-0000-0000-0000-000000000001')->'lineup'->'games')g),'["i_bet_you","guess_age","perfect_lie"]'::jsonb,'Reordered and replaced running order is stored');
select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}',true);
select throws_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['no_context'],2)$$,'42501','event owner required','Another Host cannot change the running order');
select set_config('request.jwt.claims','{"sub":"28000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['no_context'],2)$$,'42501','event owner required','A Team Captain cannot change the running order');
select throws_ok($$select * from public.event_lineup_games$$,'42501',null,'The lineup table is not directly readable');

-- Start Game Night enters hosting mode once and shows the Join screen.
select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['guess_age','no_context','i_bet_you'],2)$$,'Host restores the recommended games');
reset role;update public.events set display_mode='game' where id='a8000000-0000-0000-0000-000000000001';
set local role authenticated;select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select ok((public.start_game_night('a8000000-0000-0000-0000-000000000001')->>'started_at') is not null,'Start Game Night records started_at');
reset role;select is((select display_mode from public.events where id='a8000000-0000-0000-0000-000000000001'),'join','Start Game Night shows the Join screen');
select set_config('test.started',(select started_at::text||'|'||state_version from public.events where id='a8000000-0000-0000-0000-000000000001'),true);
set local role authenticated;select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.start_game_night('a8000000-0000-0000-0000-000000000001');
reset role;select is((select started_at::text||'|'||state_version from public.events where id='a8000000-0000-0000-0000-000000000001'),current_setting('test.started'),'Start Game Night is idempotent');

-- Once a game has been on stage it cannot be removed, but the order can still change.
set local role authenticated;select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.setup_no_context('a8000000-0000-0000-0000-000000000001','[{"instruction":"One","media":{"type":"image","url":"/no-context/meeting.svg"}},{"instruction":"Two","media":{"type":"image","url":"/no-context/shopping.svg"}},{"instruction":"Three","media":{"type":"image","url":"/no-context/traffic.svg"}},{"instruction":"Four","media":{"type":"image","url":"/no-context/island.svg"}},{"instruction":"Five","media":{"type":"image","url":"/no-context/picnic.svg"}}]');
reset role;select set_config('test.nc_play',(select active_play_id::text from public.no_context_games where event_id='a8000000-0000-0000-0000-000000000001'),true);
set local role authenticated;select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.no_context_control('a8000000-0000-0000-0000-000000000001',current_setting('test.nc_play')::uuid,'start');
select is((select bool_and((g->>'locked')::boolean=(g->>'game_type'='no_context')) from jsonb_array_elements(public.get_host_event_state('a8000000-0000-0000-0000-000000000001')->'lineup'->'games')g),true,'Only the game on stage is locked');
select throws_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['guess_age','i_bet_you'],3)$$,'55000','A game that has already been on stage cannot be removed or replaced.','A live game cannot be removed');
select throws_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['guess_age','perfect_lie','i_bet_you'],3)$$,'55000',null,'A live game cannot be replaced');
select lives_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['no_context','guess_age','i_bet_you'],3)$$,'Reordering around a live game is allowed');

-- Editing Guess the Age while No Context is live does not switch or pause the live game.
select lives_ok($$select public.save_guess_age_round('a8000000-0000-0000-0000-000000000001','Guess the Age','[{"celebrity_name":"Pedro Pascal","date_of_birth":"1975-04-02"}]')$$,'Host saves a Guess the Age lineup during No Context');
reset role;
select is((select r.game_type from public.events e join public.event_rounds r on r.id=e.active_round_id where e.id='a8000000-0000-0000-0000-000000000001'),'no_context','No Context stays on stage');
select is((select phase from public.no_context_plays where id=current_setting('test.nc_play')::uuid),'responses','No Context keeps running');
select ok((select deadline_at is not null from public.no_context_plays where id=current_setting('test.nc_play')::uuid),'No Context timer is not frozen');
select is((select count(*) from private.game_checkpoints where event_id='a8000000-0000-0000-0000-000000000001'),0::bigint,'Saving creates no pause checkpoint');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000001',array['no_context','i_bet_you'],4)$$,'A saved but unplayed Guess the Age can still be removed');
reset role;select is((select count(*) from public.questions where event_id='a8000000-0000-0000-0000-000000000001'),1::bigint,'Removing a game keeps its saved content');

-- Re-saving the active, not-yet-started Guess the Age lineup stays valid under the question foreign key.
set local role authenticated;select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('test.old_ga',public.save_guess_age_round('a8000000-0000-0000-0000-000000000002','Guess the Age','[{"celebrity_name":"Zendaya","date_of_birth":"1996-09-01"}]')::text,true);
select public.select_hosted_game('a8000000-0000-0000-0000-000000000002',current_setting('test.old_ga')::uuid);
select lives_ok($$select public.save_guess_age_round('a8000000-0000-0000-0000-000000000002','Guess the Age','[{"celebrity_name":"Tom Holland","date_of_birth":"1996-06-01"}]')$$,'Host re-saves the selected Guess the Age lineup');
reset role;select is((select active_question_id from public.events where id='a8000000-0000-0000-0000-000000000002'),null::uuid,'Replaced questions are no longer referenced by the event');

-- An older night that was played before lineups existed keeps its played game when first saved.
update public.events set status='round_complete' where id='a8000000-0000-0000-0000-000000000002';
set local role authenticated;select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.set_event_lineup('a8000000-0000-0000-0000-000000000002',array['no_context'],null)$$,'First save of an older night');
select is((select jsonb_agg(g->>'game_type') from jsonb_array_elements(public.get_host_event_state('a8000000-0000-0000-0000-000000000002')->'lineup'->'games')g),'["no_context","guess_age"]'::jsonb,'An already-played game is kept in the running order');
reset role;
select * from finish();rollback;
