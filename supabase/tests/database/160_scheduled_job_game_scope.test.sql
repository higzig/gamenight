begin;create extension if not exists pgtap with schema extensions;select plan(12);
set constraints all immediate;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values
('00000000-0000-0000-0000-000000000000','16000000-0000-0000-0000-000000000001','authenticated','authenticated','job-scope-host@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','26000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','26000000-0000-0000-0000-000000000002','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','26000000-0000-0000-0000-000000000003','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id)values('16000000-0000-0000-0000-000000000001');
-- E1: Table of Lies question in progress. E2: Guess the Age control. E3: No Context paused mid-responses.
insert into public.events(id,host_id,room_code,name,event_date,status,display_mode)values
('a6000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','JOBTL1','Lies','2026-10-23','lobby','join'),
('a6000000-0000-0000-0000-000000000002','16000000-0000-0000-0000-000000000001','JOBGA1','Ages','2026-10-23','lobby','join'),
('a6000000-0000-0000-0000-000000000003','16000000-0000-0000-0000-000000000001','JOBNC1','Context','2026-10-23','lobby','join');
insert into public.teams(id,event_id,auth_user_id,name,mascot_id)values
('d6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-000000000001','Frogs','frog'),
('d6000000-0000-0000-0000-000000000002','a6000000-0000-0000-0000-000000000002','26000000-0000-0000-0000-000000000002','Robots','robot'),
('d6000000-0000-0000-0000-000000000003','a6000000-0000-0000-0000-000000000003','26000000-0000-0000-0000-000000000003','Foxes','fox');

set local role authenticated;select set_config('request.jwt.claims','{"sub":"16000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('test.tol_round',public.save_perfect_lie_round('a6000000-0000-0000-0000-000000000001','Table of Lies','[{"title":"Sport","questions":[{"question_text":"Job scope Q?","correct_answer":"Bees"}]}]')::text,true);
select public.select_hosted_game('a6000000-0000-0000-0000-000000000001',current_setting('test.tol_round')::uuid);
reset role;select set_config('test.tol_q',(select id::text from public.perfect_lie_questions where question_text='Job scope Q?'),true);
set local role authenticated;select set_config('request.jwt.claims','{"sub":"16000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.advance_perfect_lie_question('a6000000-0000-0000-0000-000000000001',current_setting('test.tol_q')::uuid);
select public.start_perfect_lie_question('a6000000-0000-0000-0000-000000000001',current_setting('test.tol_q')::uuid,20);

select public.save_guess_age_round('a6000000-0000-0000-0000-000000000002','Guess the Age','[{"celebrity_name":"Pedro Pascal","date_of_birth":"1975-04-02"}]');
reset role;select set_config('test.ga_q',(select q.id::text from public.questions q where q.event_id='a6000000-0000-0000-0000-000000000002'),true);
set local role authenticated;select set_config('request.jwt.claims','{"sub":"16000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.start_question('a6000000-0000-0000-0000-000000000002',current_setting('test.ga_q')::uuid,15);

select public.setup_no_context('a6000000-0000-0000-0000-000000000003','[{"instruction":"One","media":{"type":"image","url":"/no-context/meeting.svg"}},{"instruction":"Two","media":{"type":"image","url":"/no-context/shopping.svg"}},{"instruction":"Three","media":{"type":"image","url":"/no-context/traffic.svg"}},{"instruction":"Four","media":{"type":"image","url":"/no-context/island.svg"}},{"instruction":"Five","media":{"type":"image","url":"/no-context/picnic.svg"}}]');
reset role;select set_config('test.nc_play',(select active_play_id::text from public.no_context_games where event_id='a6000000-0000-0000-0000-000000000003'),true);
set local role authenticated;select set_config('request.jwt.claims','{"sub":"16000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.no_context_control('a6000000-0000-0000-0000-000000000003',current_setting('test.nc_play')::uuid,'start');
-- Saving a Guess the Age lineup selects it, which pauses No Context mid-responses.
select public.save_guess_age_round('a6000000-0000-0000-0000-000000000003','Guess the Age','[{"celebrity_name":"Zendaya","date_of_birth":"1996-09-01"}]');
reset role;

select set_config('test.tol_version',(select state_version::text from public.events where id='a6000000-0000-0000-0000-000000000001'),true);
select is((select status from public.events where id='a6000000-0000-0000-0000-000000000001'),'question','Table of Lies question is live');

-- A minute later every deadline has passed; run each scheduled job twice.
select private.process_guess_age_transitions(clock_timestamp()+interval '1 minute');
select private.process_no_context_transitions(clock_timestamp()+interval '1 minute');
select private.process_guess_age_transitions(clock_timestamp()+interval '1 minute');
select private.process_no_context_transitions(clock_timestamp()+interval '1 minute');

select is((select status from public.events where id='a6000000-0000-0000-0000-000000000001'),'question','Guess the Age job leaves a Table of Lies question in its own status');
select is((select state_version::text from public.events where id='a6000000-0000-0000-0000-000000000001'),current_setting('test.tol_version'),'Guess the Age job does not touch the Table of Lies event at all');
select is((select phase from public.perfect_lie_round_states where round_id=current_setting('test.tol_round')::uuid),'writing','Table of Lies phase is unchanged');

-- Legacy rows may already have been flipped to suspense by the old job.
update public.events set status='suspense',question_reveal_due_at=clock_timestamp()-interval '1 second' where id='a6000000-0000-0000-0000-000000000001';
select private.process_guess_age_transitions(clock_timestamp()+interval '1 minute');
select is((select status from public.events where id='a6000000-0000-0000-0000-000000000001'),'suspense','Guess the Age job never reveals or scores a Table of Lies event');
select is((select count(*) from public.score_awards where event_id='a6000000-0000-0000-0000-000000000001'),0::bigint,'No Guess the Age scoring on a Table of Lies event');

select is((select status from public.events where id='a6000000-0000-0000-0000-000000000002'),'reveal','Guess the Age questions still move to suspense and reveal automatically');
select ok((select question_revealed_at is not null from public.events where id='a6000000-0000-0000-0000-000000000002'),'Guess the Age reveal is recorded');

select is((select phase from public.no_context_plays where id=current_setting('test.nc_play')::uuid),'responses','No Context job leaves a paused No Context round alone');
select is((select deadline_at from public.no_context_plays where id=current_setting('test.nc_play')::uuid),null::timestamptz,'Paused No Context deadline stays frozen');
select is((select status from public.events where id='a6000000-0000-0000-0000-000000000003'),'ready','No Context job leaves the newly selected game status alone');
select is((select r.game_type from public.events e join public.event_rounds r on r.id=e.active_round_id where e.id='a6000000-0000-0000-0000-000000000003'),'guess_age','Selected game remains Guess the Age');
select * from finish();rollback;
