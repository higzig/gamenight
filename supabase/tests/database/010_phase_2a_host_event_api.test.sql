begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('00000000-0000-0000-0000-000000000000','11000000-0000-0000-0000-000000000001','authenticated','authenticated','phase2-host1@test.local','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','11000000-0000-0000-0000-000000000002','authenticated','authenticated','phase2-host2@test.local','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','21000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id) values ('11000000-0000-0000-0000-000000000001'), ('11000000-0000-0000-0000-000000000002');
insert into public.events(id,host_id,room_code,name,venue,event_date,status) values
 ('aa000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','P2A111','Phase 2A One','Venue','2026-08-20','draft'),
 ('aa000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000002','P2A222','Phase 2A Two','Venue','2026-08-20','draft');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select ok(public.get_host_event_state('aa000000-0000-0000-0000-000000000001') is not null, 'owner hydrates event');
select is(public.get_host_event_state('aa000000-0000-0000-0000-000000000002'), null, 'owner cannot hydrate another host event');
select lives_ok($$select public.open_event_lobby('aa000000-0000-0000-0000-000000000001')$$, 'owner opens lobby');
select is((public.get_host_event_state('aa000000-0000-0000-0000-000000000001')->'event'->>'status'), 'lobby', 'event becomes joinable');
select throws_ok($$select public.open_event_lobby('aa000000-0000-0000-0000-000000000002')$$, '42501', 'event owner required', 'host cannot open another lobby');

select set_config('request.jwt.claims','{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select is(public.get_host_event_state('aa000000-0000-0000-0000-000000000001'), null, 'anonymous user cannot hydrate host state');
select throws_ok($$select public.open_event_lobby('aa000000-0000-0000-0000-000000000001')$$, '42501', 'event owner required', 'anonymous user cannot open lobby');
select lives_ok($$select public.join_event('P2A111','Physical Team','frog')$$, 'anonymous Team joins opened lobby');
select is((public.get_team_room_state('P2A111')->'team'->>'name'), 'Physical Team', 'Team hydration recovers joined identity');

select * from finish();
rollback;
