begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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

select * from finish();
rollback;
