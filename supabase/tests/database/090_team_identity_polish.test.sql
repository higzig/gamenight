begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','19000000-0000-0000-0000-000000000001','authenticated','authenticated','identity-host@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','29000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','29000000-0000-0000-0000-000000000002','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','29000000-0000-0000-0000-000000000003','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id) values('19000000-0000-0000-0000-000000000001');
insert into public.events(id,host_id,room_code,name,event_date,status) values
('af000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','NAME01','Names One','2026-08-18','lobby'),
('af000000-0000-0000-0000-000000000002','19000000-0000-0000-0000-000000000001','NAME02','Names Two','2026-08-18','lobby');

select ok(exists(select 1 from pg_indexes where indexname='teams_event_active_normalized_name_unique'),'race-safe normalized-name unique index exists');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"29000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select lives_ok($$select public.join_event('NAME01','  The   Quizards  ','fox')$$,'canonical Team joins');
select is((select name from public.teams where auth_user_id=auth.uid()),'The Quizards','display name is trimmed and repeated spaces collapse');

select set_config('request.jwt.claims','{"sub":"29000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.join_event('NAME01','the quizards','robot')$$,'23505','That Team name is already taken.','case-insensitive duplicate loses the join race');
select throws_ok($$select public.join_event('NAME01',' The      Quizards ','robot')$$,'23505','That Team name is already taken.','repeated-space duplicate is rejected');
select lives_ok($$select public.join_event('NAME02','the quizards','robot')$$,'same normalized name is allowed in another event');

select set_config('request.jwt.claims','{"sub":"29000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.join_event('NAME01','Different Name','fox')$$,'23505','That mascot was just taken. Pick another one.','mascot uniqueness remains race-safe');
select is(public.get_public_room_state('NAME01')->'lobby_roster',jsonb_build_array(jsonb_build_object('name','The Quizards','mascot_id','fox')),'lobby roster exposes name and mascot only');
select ok(public.get_public_room_state('NAME01')->'lobby_roster'->0 ?& array['name','mascot_id'] and (select count(*) from jsonb_object_keys(public.get_public_room_state('NAME01')->'lobby_roster'->0))=2,'roster object has exactly the approved keys');
select ok(not (public.get_public_room_state('NAME01')->'lobby_roster'->0 ? 'auth_user_id') and not (public.get_public_room_state('NAME01')->'lobby_roster'->0 ? 'id'),'roster contains no Team or auth identifiers');

-- Captain ownership is the existing anonymous Auth identity, not the team name.
select set_config('request.jwt.claims','{"sub":"29000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select set_config('test.captain_team_id',public.get_team_room_state('NAME01')->'team'->>'id',true);
select lives_ok($$select public.join_event('NAME01','Accidental retry name','robot')$$,'same Captain can retry joining');
select is(public.get_team_room_state('NAME01')->'team'->>'id',current_setting('test.captain_team_id'),'retry restores original team identity');
select is(public.get_team_room_state('NAME01')->'team'->>'name','The Quizards','retry does not rename the original team');
select is((select count(*) from public.teams where event_id='af000000-0000-0000-0000-000000000001'),1::bigint,'same Captain has only one team in this event');

select set_config('request.jwt.claims','{"sub":"29000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}',true);
select ok(public.get_team_room_state('NAME01') is null,'another browser cannot hydrate the existing Captain team');
select lives_ok($$select public.join_event('NAME01','Table Two','robot')$$,'another Captain can join a different team simultaneously');
select isnt(public.get_team_room_state('NAME01')->'team'->>'id',current_setting('test.captain_team_id'),'different Captains receive independent team identities');
select throws_ok($$select public.submit_guess(current_setting('test.captain_team_id')::uuid,'00000000-0000-0000-0000-000000000001',30)$$,'42501','team ownership required','second Captain cannot submit an age for the first team');
select throws_ok($$select public.submit_perfect_lie_answer(current_setting('test.captain_team_id')::uuid,'00000000-0000-0000-0000-000000000001','answer')$$,'42501','Team ownership required','second Captain cannot answer for the first team');
select throws_ok($$select public.submit_perfect_lie_lie(current_setting('test.captain_team_id')::uuid,'00000000-0000-0000-0000-000000000001','lie')$$,'42501','Team ownership required','second Captain cannot write a lie for the first team');
select throws_ok($$select public.submit_perfect_lie_vote(current_setting('test.captain_team_id')::uuid,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')$$,'42501','Team ownership required','second Captain cannot vote for the first team');

select * from finish();
rollback;
