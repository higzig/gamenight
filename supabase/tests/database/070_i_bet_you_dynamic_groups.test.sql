begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create temporary table expected_groups(team_count integer primary key,expected_sizes text not null);
grant select on expected_groups to authenticated;
insert into expected_groups values
  (2,'2'),(3,'3'),(4,'4'),(5,'5'),(6,'6'),
  (7,'4,3'),(8,'4,4'),(9,'5,4'),(10,'5,5'),
  (11,'4,4,3'),(12,'4,4,4'),(15,'5,5,5'),
  (16,'4,4,4,4'),(20,'5,5,5,5');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','17000000-0000-0000-0000-000000000001','authenticated','authenticated','dynamic-groups@test.local','',now(),'{}','{}',now(),now());
insert into public.profiles(id) values('17000000-0000-0000-0000-000000000001');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',md5('dynamic-team-user-'||e.team_count||'-'||n)::uuid,'authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()
from expected_groups e cross join lateral generate_series(1,e.team_count)n;

insert into public.events(id,host_id,room_code,name,event_date,status,display_mode)
select md5('dynamic-event-'||team_count)::uuid,'17000000-0000-0000-0000-000000000001','G'||lpad(team_count::text,5,'0'),'Dynamic '||team_count,'2026-08-20','lobby','game'
from expected_groups;

insert into public.teams(id,event_id,auth_user_id,name)
select md5('dynamic-team-'||e.team_count||'-'||n)::uuid,md5('dynamic-event-'||e.team_count)::uuid,md5('dynamic-team-user-'||e.team_count||'-'||n)::uuid,'Team '||n
from expected_groups e cross join lateral generate_series(1,e.team_count)n;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"17000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
do $$declare r record;begin for r in select team_count from expected_groups loop perform public.setup_i_bet_you_round(md5('dynamic-event-'||r.team_count)::uuid);end loop;end$$;
reset role;

select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-2')::uuid group by group_id)x),'2','2 Teams create one group of 2');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-3')::uuid group by group_id)x),'3','3 Teams create one group of 3');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-4')::uuid group by group_id)x),'4','4 Teams create one group of 4');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-5')::uuid group by group_id)x),'5','5 Teams create one group of 5');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-6')::uuid group by group_id)x),'6','6 Teams create one group of 6');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-7')::uuid group by group_id)x),'4,3','7 Teams create groups of 4 and 3');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-8')::uuid group by group_id)x),'4,4','8 Teams create two groups of 4');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-9')::uuid group by group_id)x),'5,4','9 Teams create groups of 5 and 4');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-10')::uuid group by group_id)x),'5,5','10 Teams create two groups of 5');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-11')::uuid group by group_id)x),'4,4,3','11 Teams create groups of 4, 4, and 3');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-12')::uuid group by group_id)x),'4,4,4','12 Teams create three groups of 4');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-15')::uuid group by group_id)x),'5,5,5','15 Teams create three groups of 5');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-16')::uuid group by group_id)x),'4,4,4,4','16 Teams create four groups of 4');
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-20')::uuid group by group_id)x),'5,5,5,5','20 Teams create four groups of 5');

select is((select count(*) from public.i_bet_you_group_members where event_id in(select md5('dynamic-event-'||team_count)::uuid from expected_groups)),128::bigint,'every eligible Team is assigned');
select is((select count(distinct team_id) from public.i_bet_you_group_members where event_id in(select md5('dynamic-event-'||team_count)::uuid from expected_groups)),128::bigint,'no Team is duplicated');
select ok(not exists(select 1 from expected_groups e where (select count(*) from public.i_bet_you_group_members where event_id=md5('dynamic-event-'||e.team_count)::uuid)<>e.team_count),'no event silently excludes a Team');
select ok(not exists(select 1 from public.event_rounds r where r.event_id in(select md5('dynamic-event-'||team_count)::uuid from expected_groups) and (select count(*) from public.i_bet_you_groups where round_id=r.id)<>(select count(distinct category_id) from public.i_bet_you_groups where round_id=r.id)),'each group receives one unique category');
select ok(not exists(select 1 from public.i_bet_you_groups where event_id in(select md5('dynamic-event-'||team_count)::uuid from expected_groups) group by round_id,category_id having count(*)>1),'categories never duplicate within a round');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"17000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.setup_i_bet_you_round(md5('dynamic-event-9')::uuid)$$,'Randomise Groups reuses dynamic setup');
reset role;
select is((select string_agg(s::text,',' order by s desc) from(select count(*)s from public.i_bet_you_group_members where event_id=md5('dynamic-event-9')::uuid group by group_id)x),'5,4','randomising preserves the correct group count and sizes');

select set_config('test.one_group',(select id::text from public.i_bet_you_groups where event_id=md5('dynamic-event-2')::uuid),true);
select set_config('test.one_bidder',(select team_id::text from public.i_bet_you_group_members where group_id=current_setting('test.one_group')::uuid order by position limit 1),true);
select set_config('test.one_challenger',(select team_id::text from public.i_bet_you_group_members where group_id=current_setting('test.one_group')::uuid order by position offset 1 limit 1),true);
select set_config('test.two_group_1',(select id::text from public.i_bet_you_groups where event_id=md5('dynamic-event-7')::uuid and position=1),true);
select set_config('test.two_group_2',(select id::text from public.i_bet_you_groups where event_id=md5('dynamic-event-7')::uuid and position=2),true);
select set_config('test.two_bidder_1',(select team_id::text from public.i_bet_you_group_members where group_id=current_setting('test.two_group_1')::uuid order by position limit 1),true);
select set_config('test.two_challenger_1',(select team_id::text from public.i_bet_you_group_members where group_id=current_setting('test.two_group_1')::uuid order by position offset 1 limit 1),true);
select set_config('test.two_bidder_2',(select team_id::text from public.i_bet_you_group_members where group_id=current_setting('test.two_group_2')::uuid order by position limit 1),true);
select set_config('test.two_challenger_2',(select team_id::text from public.i_bet_you_group_members where group_id=current_setting('test.two_group_2')::uuid order by position offset 1 limit 1),true);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"17000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($test$do $$begin perform public.set_i_bet_you_bid(current_setting('test.one_group')::uuid,current_setting('test.one_bidder')::uuid,2);perform public.challenge_i_bet_you(current_setting('test.one_group')::uuid,current_setting('test.one_challenger')::uuid);perform public.judge_i_bet_you_group(current_setting('test.one_group')::uuid,true);perform public.next_i_bet_you_group(current_setting('test.one_group')::uuid);end$$$test$,'Next Group works for a one-group round');
reset role;
select ok((select rs.status='complete' and rs.active_group_id is null from public.i_bet_you_round_states rs join public.event_rounds r on r.id=rs.round_id where r.event_id=md5('dynamic-event-2')::uuid),'one-group round completes after its actual final group');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"17000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($test$do $$begin perform public.set_i_bet_you_bid(current_setting('test.two_group_1')::uuid,current_setting('test.two_bidder_1')::uuid,2);perform public.challenge_i_bet_you(current_setting('test.two_group_1')::uuid,current_setting('test.two_challenger_1')::uuid);perform public.judge_i_bet_you_group(current_setting('test.two_group_1')::uuid,true);perform public.next_i_bet_you_group(current_setting('test.two_group_1')::uuid);end$$$test$,'Next Group advances a two-group round');
reset role;
select is((select g.position from public.i_bet_you_round_states rs join public.i_bet_you_groups g on g.id=rs.active_group_id join public.event_rounds r on r.id=rs.round_id where r.event_id=md5('dynamic-event-7')::uuid),2,'the actual second group becomes active');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"17000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($test$do $$begin perform public.set_i_bet_you_bid(current_setting('test.two_group_2')::uuid,current_setting('test.two_bidder_2')::uuid,2);perform public.challenge_i_bet_you(current_setting('test.two_group_2')::uuid,current_setting('test.two_challenger_2')::uuid);perform public.judge_i_bet_you_group(current_setting('test.two_group_2')::uuid,true);perform public.next_i_bet_you_group(current_setting('test.two_group_2')::uuid);end$$$test$,'final group in a two-group round advances cleanly');
reset role;
select ok((select rs.status='complete' and rs.active_group_id is null from public.i_bet_you_round_states rs join public.event_rounds r on r.id=rs.round_id where r.event_id=md5('dynamic-event-7')::uuid),'two-group round completes after its actual final group');

select * from finish();
rollback;
