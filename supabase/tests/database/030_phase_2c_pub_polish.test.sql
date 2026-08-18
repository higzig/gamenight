begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','13000000-0000-0000-0000-000000000001','authenticated','authenticated','p2c-host@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','13000000-0000-0000-0000-000000000002','authenticated','authenticated','p2c-other@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','23000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id) values('13000000-0000-0000-0000-000000000001'),('13000000-0000-0000-0000-000000000002');
insert into public.events(id,host_id,room_code,name,venue,event_date,status,display_mode) values
('ac000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001','P2C123','Pub Test','The Local','2026-08-20','lobby','join');
insert into public.teams(id,event_id,auth_user_id,name) values
('dc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000001','Team One');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"13000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.save_guess_age_round('ac000000-0000-0000-0000-000000000001','Guess the Age','[{"celebrity_name":"First","date_of_birth":"1980-08-20"},{"celebrity_name":"Second","date_of_birth":"1990-08-20"},{"celebrity_name":"Third","date_of_birth":"2000-08-20"}]')$$,'host configures lineup');
select lives_ok($$select public.start_question('ac000000-0000-0000-0000-000000000001',(select id from public.questions where event_id='ac000000-0000-0000-0000-000000000001' and position=1),15)$$,'host starts automatic flow');
select is((select extract(epoch from(question_reveal_due_at-question_deadline_at))::integer from public.events where id='ac000000-0000-0000-0000-000000000001'),5,'server schedules five second suspense');

reset role;
insert into public.submissions(event_id,question_id,team_id,guess_integer) select id,active_question_id,'dc000000-0000-0000-0000-000000000001',46 from public.events where id='ac000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select pass('accepted active submission fixture is present');
select is(public.get_public_room_state('P2C123')->>'submitted_count','1','active public state exposes aggregate submitted count');
select is(public.get_public_room_state('P2C123')->'guess_markers','[]'::jsonb,'active public state exposes no individual guesses');
select ok(public.get_public_room_state('P2C123')->'question'->'correct_age'='null'::jsonb,'correct age remains unavailable while answering');
select ok(public.get_public_room_state('P2C123')::text not like '%date_of_birth%' and public.get_public_room_state('P2C123')::text not like '%auth_user_id%','active public state leaks neither DOB nor auth identity');

reset role;
update public.events set question_started_at=clock_timestamp()-interval '16 seconds',question_deadline_at=clock_timestamp()-interval '1 second',question_reveal_due_at=clock_timestamp()+interval '4 seconds' where id='ac000000-0000-0000-0000-000000000001';
select is(private.process_guess_age_transitions(),1,'scheduler closes expired question');
select is((select status from public.events where id='ac000000-0000-0000-0000-000000000001'),'suspense','event enters suspense');
select is(public.get_public_room_state('P2C123')->'guess_markers','[]'::jsonb,'suspense public state still exposes no individual guesses');
select ok(public.get_public_room_state('P2C123')->'question'->'correct_age'='null'::jsonb and public.get_public_room_state('P2C123')::text not like '%date_of_birth%','suspense hides correct age and DOB');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.submit_guess('dc000000-0000-0000-0000-000000000001',(select active_question_id from public.events where id='ac000000-0000-0000-0000-000000000001'),40)$$,'question is not accepting answers','late submission is rejected during suspense');
select throws_ok($$select public.restart_guess_age_round('ac000000-0000-0000-0000-000000000001')$$,'42501','event owner required','Team cannot restart');
select throws_ok($$select public.copy_event_session('ac000000-0000-0000-0000-000000000001')$$,'42501','event owner required','Team cannot create Host session');

reset role;
update public.events set question_reveal_due_at=clock_timestamp()-interval '1 second' where id='ac000000-0000-0000-0000-000000000001';
select is(private.process_guess_age_transitions(),1,'scheduler reveals and scores');
select is((select status from public.events where id='ac000000-0000-0000-0000-000000000001'),'reveal','event reaches reveal');
select ok(public.get_public_room_state('P2C123')->'guess_markers'->0 ?& array['team_name','mascot_id','guess','signed_difference','points'] and not (public.get_public_room_state('P2C123')->'guess_markers'->0 ? 'team_id'),'reveal exposes shaped result without Team identifier');
select is(public.get_public_room_state('P2C123')->'question'->>'correct_age','46','correct age becomes available only at reveal');
select is((select count(*) from public.score_awards where event_id='ac000000-0000-0000-0000-000000000001' and kind='game'),1::bigint,'automatic scoring creates one award');
select is(private.process_guess_age_transitions(),0,'automatic transition retry is idempotent');
select is((select count(*) from public.score_awards where event_id='ac000000-0000-0000-0000-000000000001' and kind='game'),1::bigint,'automatic score remains single');
insert into public.score_awards(event_id,team_id,points,kind,reason) values('ac000000-0000-0000-0000-000000000001','dc000000-0000-0000-0000-000000000001',2,'manual_correction','Pub correction');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"13000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}',true);
select throws_ok($$select public.restart_guess_age_round('ac000000-0000-0000-0000-000000000001')$$,'42501','event owner required','non-owner cannot restart');
select throws_ok($$select public.reorder_guess_age_question('ac000000-0000-0000-0000-000000000001',(select id from public.questions where event_id='ac000000-0000-0000-0000-000000000001' limit 1),1)$$,'42501','event owner required','non-owner cannot reorder');

select set_config('request.jwt.claims','{"sub":"13000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select throws_ok($$select public.reorder_guess_age_question('ac000000-0000-0000-0000-000000000001',(select id from public.questions where event_id='ac000000-0000-0000-0000-000000000001' and position=1),1)$$,'played questions cannot be reordered','unsafe reorder after play is rejected');
select lives_ok($$select public.copy_event_session('ac000000-0000-0000-0000-000000000001')$$,'Host creates a fresh session');
select isnt((select room_code from public.events where host_id='13000000-0000-0000-0000-000000000001' and id<>'ac000000-0000-0000-0000-000000000001' limit 1),'P2C123','new session has a new room code');
select is((select count(*) from public.teams where event_id=(select id from public.events where host_id='13000000-0000-0000-0000-000000000001' and id<>'ac000000-0000-0000-0000-000000000001' limit 1)),0::bigint,'new session copies no Teams');
select is((select count(*) from public.questions where event_id=(select id from public.events where host_id='13000000-0000-0000-0000-000000000001' and id<>'ac000000-0000-0000-0000-000000000001' limit 1)),3::bigint,'new session copies lineup');
select is((select count(*) from public.submissions where event_id=(select id from public.events where host_id='13000000-0000-0000-0000-000000000001' and id<>'ac000000-0000-0000-0000-000000000001' limit 1)),0::bigint,'new session copies no submissions');
select is((select count(*) from public.score_awards where event_id=(select id from public.events where host_id='13000000-0000-0000-0000-000000000001' and id<>'ac000000-0000-0000-0000-000000000001' limit 1)),0::bigint,'new session copies no awards');
select lives_ok($$select public.reorder_guess_age_question(
  (select id from public.events where host_id='13000000-0000-0000-0000-000000000001' and id<>'ac000000-0000-0000-0000-000000000001' limit 1),
  (select q.id from public.questions q where q.event_id=(select id from public.events where host_id='13000000-0000-0000-0000-000000000001' and id<>'ac000000-0000-0000-0000-000000000001' limit 1) and q.position=2),-1)$$,'unplayed lineup can be reordered');
select is((select celebrity_name from public.questions where event_id=(select id from public.events where host_id='13000000-0000-0000-0000-000000000001' and id<>'ac000000-0000-0000-0000-000000000001' limit 1) and position=1),'Second','authoritative positions remain contiguous after reorder');

select lives_ok($$select public.restart_guess_age_round('ac000000-0000-0000-0000-000000000001')$$,'owner restarts atomically');
select is((select count(*) from public.teams where event_id='ac000000-0000-0000-0000-000000000001'),1::bigint,'restart preserves Teams');
select is((select count(*) from public.submissions where event_id='ac000000-0000-0000-0000-000000000001'),0::bigint,'restart removes Guess the Age submissions');
select is((select count(*) from public.score_awards where event_id='ac000000-0000-0000-0000-000000000001' and kind='game'),0::bigint,'restart removes Guess the Age game awards');
select is((select count(*) from public.score_awards where event_id='ac000000-0000-0000-0000-000000000001' and kind='manual_correction'),1::bigint,'restart preserves manual corrections');

select * from finish(); rollback;
