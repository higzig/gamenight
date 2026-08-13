begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','12000000-0000-0000-0000-000000000001','authenticated','authenticated','p2b-host@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','22000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','22000000-0000-0000-0000-000000000002','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id) values('12000000-0000-0000-0000-000000000001');
insert into public.events(id,host_id,room_code,name,event_date,status) values('ab000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','P2B123','P2B','2026-03-01','lobby');
insert into public.teams(id,event_id,auth_user_id,name) values
('db000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','One'),
('db000000-0000-0000-0000-000000000002','ab000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','Two');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"12000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.save_guess_age_round('ab000000-0000-0000-0000-000000000001','Guess the Age','[{"celebrity_name":"Birthday","date_of_birth":"2000-03-01","external_image_url":"https://example.com/a.jpg"},{"celebrity_name":"Leap","date_of_birth":"2000-02-29"}]')$$,'host saves lineup');
select is((select count(*) from public.questions where event_id='ab000000-0000-0000-0000-000000000001'),2::bigint,'two public questions saved');
select is((select count(*) from public.question_secrets qs join public.questions q on q.id=qs.question_id where q.event_id='ab000000-0000-0000-0000-000000000001'),2::bigint,'DOBs stored separately');
select is((public.get_host_event_state('ab000000-0000-0000-0000-000000000001')->'rounds'->0->'questions'->0->>'date_of_birth'),'2000-03-01','owner hydration includes secret');
select lives_ok($$select public.start_question('ab000000-0000-0000-0000-000000000001',(select id from public.questions where celebrity_name='Birthday'),99)$$,'host starts question');
select is((select extract(epoch from(question_deadline_at-question_started_at))::integer from public.events where id='ab000000-0000-0000-0000-000000000001'),15,'server enforces 15 seconds');
select set_config('test.question_id',(select id::text from public.questions where celebrity_name='Birthday'),true);

select set_config('request.jwt.claims','{"sub":"22000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select is((select count(*) from public.question_secrets),0::bigint,'Team cannot read secrets');
select ok(not(public.get_team_room_state('P2B123')::text like '%date_of_birth%'),'Team payload omits DOB');
select ok((public.get_team_room_state('P2B123')->'question'->'correct_age')='null'::jsonb,'Team has no unrevealed answer');
select lives_ok($$select public.submit_guess('db000000-0000-0000-0000-000000000001',current_setting('test.question_id')::uuid,26)$$,'Team submits through RPC');
select throws_ok($$select public.set_event_display('ab000000-0000-0000-0000-000000000001','leaderboard')$$,'42501','event owner required','anonymous cannot control display');

select set_config('request.jwt.claims','{"sub":"12000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.reveal_question('ab000000-0000-0000-0000-000000000001')$$,'atomic reveal succeeds');
select is((public.get_public_room_state('P2B123')->'question'->>'correct_age')::integer,26,'public answer revealed');
select lives_ok($$select public.reveal_question('ab000000-0000-0000-0000-000000000001')$$,'reveal retry succeeds');
select is((select count(*) from public.score_awards where event_id='ab000000-0000-0000-0000-000000000001'),1::bigint,'scoring remains idempotent');
select lives_ok($$select public.set_event_display('ab000000-0000-0000-0000-000000000001','leaderboard')$$,'host shows leaderboard');

select * from finish();rollback;
