begin;create extension if not exists pgtap with schema extensions;select plan(15);
-- Deferred FKs are otherwise only checked at commit, which these rolled-back tests never reach.
set constraints all immediate;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values
('00000000-0000-0000-0000-000000000000','15000000-0000-0000-0000-000000000001','authenticated','authenticated','tol-fk-host@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','25000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','25000000-0000-0000-0000-000000000002','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id)values('15000000-0000-0000-0000-000000000001');
insert into public.events(id,host_id,room_code,name,event_date,status,display_mode)values('a5000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','TOLFK1','Table of Lies FK','2026-10-23','lobby','join');
insert into public.teams(id,event_id,auth_user_id,name,mascot_id)values
('d5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','25000000-0000-0000-0000-000000000001','Frogs','frog'),
('d5000000-0000-0000-0000-000000000002','a5000000-0000-0000-0000-000000000001','25000000-0000-0000-0000-000000000002','Robots','robot');

set local role authenticated;select set_config('request.jwt.claims','{"sub":"15000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('test.round',public.save_perfect_lie_round('a5000000-0000-0000-0000-000000000001','Table of Lies','[{"title":"Sport","questions":[{"question_text":"Q1?","correct_answer":"Bees"},{"question_text":"Q2?","correct_answer":"Two"}]}]')::text,true);
reset role;
select set_config('test.q1',(select id::text from public.perfect_lie_questions where question_text='Q1?'),true);
select set_config('test.q2',(select id::text from public.perfect_lie_questions where question_text='Q2?'),true);

set local role authenticated;select set_config('request.jwt.claims','{"sub":"15000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.select_hosted_game('a5000000-0000-0000-0000-000000000001',current_setting('test.round')::uuid)$$,'Host selects Table of Lies');
select lives_ok($$select public.advance_perfect_lie_question('a5000000-0000-0000-0000-000000000001',current_setting('test.q1')::uuid)$$,'Host prepares the first question');
select lives_ok($$select public.start_perfect_lie_question('a5000000-0000-0000-0000-000000000001',current_setting('test.q1')::uuid,20)$$,'Host starts the first question');
select set_config('request.jwt.claims','{"sub":"25000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select lives_ok($$select public.submit_perfect_lie_answer('d5000000-0000-0000-0000-000000000001',current_setting('test.q1')::uuid,'Pirates')$$,'Captain submits an answer');
select lives_ok($$select public.submit_perfect_lie_lie('d5000000-0000-0000-0000-000000000001',current_setting('test.q1')::uuid,'Ninjas')$$,'Captain submits a lie');
select set_config('request.jwt.claims','{"sub":"15000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.close_perfect_lie_writing('a5000000-0000-0000-0000-000000000001')$$,'Host opens voting');
select lives_ok($$select public.start_perfect_lie_reveal('a5000000-0000-0000-0000-000000000001')$$,'Host starts the reveal');
select lives_ok($$select public.advance_perfect_lie_reveal('a5000000-0000-0000-0000-000000000001')$$,'Host completes the two-option reveal');
select lives_ok($$select public.advance_perfect_lie_question('a5000000-0000-0000-0000-000000000001',null)$$,'Host advances to the next question');
reset role;
select is((select active_question_id from public.perfect_lie_round_states where round_id=current_setting('test.round')::uuid),current_setting('test.q2')::uuid,'Table of Lies tracks its own question');
select is((select active_question_id from public.events where id='a5000000-0000-0000-0000-000000000001'),null::uuid,'events.active_question_id holds only Guess the Age questions');

set local role authenticated;select set_config('request.jwt.claims','{"sub":"15000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('test.ga',public.save_guess_age_round('a5000000-0000-0000-0000-000000000001','Guess the Age','[{"celebrity_name":"Pedro Pascal","date_of_birth":"1975-04-02"}]')::text,true);
select lives_ok($$select public.select_hosted_game('a5000000-0000-0000-0000-000000000001',current_setting('test.ga')::uuid)$$,'Switching to another game pauses Table of Lies');
reset role;select is((select c.state from private.game_checkpoints c where c.round_id=current_setting('test.round')::uuid),'paused','Table of Lies has a paused checkpoint');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"15000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.select_hosted_game('a5000000-0000-0000-0000-000000000001',current_setting('test.round')::uuid)$$,'Host reselects the paused Table of Lies');
select lives_ok($$select public.resume_hosted_game('a5000000-0000-0000-0000-000000000001',current_setting('test.round')::uuid)$$,'Host resumes Table of Lies');
reset role;
select * from finish();rollback;
