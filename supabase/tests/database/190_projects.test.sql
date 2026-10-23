begin;create extension if not exists pgtap with schema extensions;select plan(17);
set constraints all immediate;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values
('00000000-0000-0000-0000-000000000000','19000000-0000-0000-0000-000000000001','authenticated','authenticated','projects-host@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','19000000-0000-0000-0000-000000000002','authenticated','authenticated','projects-other@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','29000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id)values('19000000-0000-0000-0000-000000000001'),('19000000-0000-0000-0000-000000000002');
-- An older event created before projects, with a saved Guess the Age game and no running order.
insert into public.events(id,host_id,room_code,name,event_date,status,display_mode,created_at)values('a9000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','LEGACY','Legacy night','2026-08-20','lobby','join',now()-interval '60 days');
insert into public.event_rounds(event_id,position,game_type,title)values('a9000000-0000-0000-0000-000000000001',1,'guess_age','Guess the Age');

set local role authenticated;select set_config('request.jwt.claims','{"sub":"19000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('test.p1',public.create_project('  Friday Quiz  ',array['guess_age','no_context','i_bet_you'])::text,true);
reset role;
select is((select name from public.events where id=current_setting('test.p1')::uuid),'Friday Quiz','A project needs only a name');
select is((select status from public.events where id=current_setting('test.p1')::uuid),'lobby','A new project is open for teams to join');
select is((select event_date from public.events where id=current_setting('test.p1')::uuid),current_date,'The date defaults to today when none is given');
select is((select venue from public.events where id=current_setting('test.p1')::uuid),'','Venue is optional');
select is((select array_agg(game_type order by position) from public.event_lineup_games where event_id=current_setting('test.p1')::uuid),array['guess_age','no_context','i_bet_you'],'The recommended games are saved with the project');
select is((select lineup_revision from public.events where id=current_setting('test.p1')::uuid),1,'The running order starts at revision 1');
select is((select count(*) from public.event_rounds where event_id=current_setting('test.p1')::uuid),0::bigint,'Creating a project prepares no games');
select ok((select active_round_id is null and started_at is null from public.events where id=current_setting('test.p1')::uuid),'Creating a project activates nothing and does not start hosting');

set local role authenticated;select set_config('request.jwt.claims','{"sub":"19000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select throws_ok($$select public.create_project('Broken',array['guess_age','bingo'])$$,'22023','Choose up to four different games.','An invalid running order is rejected');
select throws_ok($$select public.create_project('   ',array['guess_age'])$$,'22023','Give your project a name of up to 120 characters.','A project needs a name');
reset role;
select is((select count(*) from public.events where host_id='19000000-0000-0000-0000-000000000001'),2::bigint,'A failed creation leaves no empty project behind');

set local role authenticated;select set_config('request.jwt.claims','{"sub":"19000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select is(jsonb_array_length(public.list_projects()),2,'The Host sees their own projects');
select is((select p->'games' from jsonb_array_elements(public.list_projects())p where p->>'id'=current_setting('test.p1')),'["guess_age","no_context","i_bet_you"]'::jsonb,'A project lists its games in running order');
select is((select p->'games' from jsonb_array_elements(public.list_projects())p where p->>'name'='Legacy night'),'["guess_age"]'::jsonb,'An older event without a running order lists the games it has content for');
select is((select (p->>'lineup_saved')::boolean from jsonb_array_elements(public.list_projects())p where p->>'name'='Legacy night'),false,'An older event is identified as not having a saved running order');
select set_config('request.jwt.claims','{"sub":"19000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}',true);
select is(public.list_projects(),'[]'::jsonb,'Another Host sees none of these projects');
select set_config('request.jwt.claims','{"sub":"29000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.create_project('Captain project',array['guess_age'])$$,'42501',null,'A Team Captain cannot create projects');
reset role;
select * from finish();rollback;
