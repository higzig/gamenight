begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','18000000-0000-0000-0000-000000000001','authenticated','authenticated','mascot-host@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','28000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','28000000-0000-0000-0000-000000000002','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','28000000-0000-0000-0000-000000000003','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','28000000-0000-0000-0000-000000000004','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id) values('18000000-0000-0000-0000-000000000001');
insert into public.events(id,host_id,room_code,name,event_date,status,display_mode) values
('ae000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','MASC01','Mascot One','2026-08-18','lobby','game'),
('ae000000-0000-0000-0000-000000000002','18000000-0000-0000-0000-000000000001','MASC02','Mascot Two','2026-08-18','lobby','game');
insert into public.teams(id,event_id,auth_user_id,name) values('de000000-0000-0000-0000-000000000004','ae000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000004','Legacy Team');

select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='teams_event_active_mascot_unique'),'race-safe unique mascot index exists');
select ok((select mascot_id is null from public.teams where id='de000000-0000-0000-0000-000000000004'),'legacy Team remains valid with nullable fallback mascot');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"28000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select lives_ok($$select public.join_event('MASC01','Frogs','frog')$$,'Team claims an available mascot while joining');
select is(public.get_team_room_state('MASC01')->'team'->>'mascot_id','frog','Team hydration restores own mascot');

select set_config('request.jwt.claims','{"sub":"28000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.join_event('MASC01','Other Frogs','frog')$$,'23505','that mascot was just taken','same-event duplicate mascot is rejected');
select lives_ok($$select public.join_event('MASC01','Robots','robot')$$,'second Team claims another mascot');
select throws_ok($$select public.set_team_mascot('de000000-0000-0000-0000-000000000004','fox')$$,'42501','team ownership required','Team cannot change another Team mascot');

select set_config('request.jwt.claims','{"sub":"28000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}',true);
select lives_ok($$select public.join_event('MASC02','Other Event Frogs','frog')$$,'same mascot can be reused in another event');

select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select ok(public.get_host_event_state('ae000000-0000-0000-0000-000000000001')::text like '%"mascot_id": "frog"%','Host hydration includes mascot identity');
select throws_ok($$select public.set_team_mascot((select id from public.teams where name='Frogs'),'owl')$$,'42501','team ownership required','non-owning authenticated user cannot mutate mascot');
select lives_ok($$select public.save_guess_age_round('ae000000-0000-0000-0000-000000000001','Guess the Age','[{"celebrity_name":"Birthday","date_of_birth":"2000-08-18"}]')$$,'Host creates Guess the Age question');
select set_config('test.mascot_question',(select id::text from public.questions where event_id='ae000000-0000-0000-0000-000000000001'),true);
select lives_ok($$select public.start_question('ae000000-0000-0000-0000-000000000001',current_setting('test.mascot_question')::uuid,15)$$,'Host starts question');

select set_config('request.jwt.claims','{"sub":"28000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select lives_ok($$select public.submit_guess((select id from public.teams where auth_user_id=auth.uid()),current_setting('test.mascot_question')::uuid,24)$$,'authoritative mascot Team guess accepted');
select is(public.get_public_room_state('MASC01')->'guess_markers'->0,jsonb_build_object('mascot_id','frog','guess',24),'active public marker exposes mascot and guess only');
select ok(public.get_public_room_state('MASC01')::text not like '%Frogs%' and public.get_public_room_state('MASC01')::text not like '%date_of_birth%' and public.get_public_room_state('MASC01')->'question'->'correct_age'='null'::jsonb,'active public state hides Team name, DOB, and correct age');

select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.reveal_question('ae000000-0000-0000-0000-000000000001')$$,'Host reveals and scores');
select is(public.get_public_room_state('MASC01')->'guess_markers'->0,jsonb_build_object('team_id',(select id from public.teams where name='Frogs'),'team_name','Frogs','mascot_id','frog','guess',24,'signed_difference',-2,'points',6),'reveal exposes only shaped final Team result');

select * from finish();
rollback;
