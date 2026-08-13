begin;

create extension if not exists pgtap with schema extensions;
select plan(64);

-- Stable identities and fixtures. Tests switch JWT claims without requiring GoTrue.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000001','authenticated','authenticated','host1@test.local','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000002','authenticated','authenticated','host2@test.local','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000002','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000003','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000099','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());

insert into public.profiles(id,display_name) values
 ('10000000-0000-0000-0000-000000000001','Host One'),
 ('10000000-0000-0000-0000-000000000002','Host Two');
insert into public.events(id,host_id,room_code,name,venue,event_date,status) values
 ('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','ABC123','Event One','Venue','2026-03-01','lobby'),
 ('a0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','XYZ789','Event Two','Venue','2026-03-01','lobby');
insert into public.event_rounds(id,event_id,position,game_type,title,settings) values
 ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',1,'guess_age','Guess the Age','{"timer":15}'),
 ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002',1,'guess_age','Guess the Age','{"timer":15}');
insert into public.questions(id,event_id,round_id,position,celebrity_name) values
 ('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',1,'Birthday Today'),
 ('c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',2,'Leap Birthday'),
 ('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',3,'Other Question'),
 ('c0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002',1,'Other Event');
insert into public.question_secrets(question_id,date_of_birth) values
 ('c0000000-0000-0000-0000-000000000001','2000-03-01'),
 ('c0000000-0000-0000-0000-000000000002','2000-02-29'),
 ('c0000000-0000-0000-0000-000000000003','1990-01-01'),
 ('c0000000-0000-0000-0000-000000000004','1980-01-01');
insert into public.teams(id,event_id,auth_user_id,name) values
 ('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Team One'),
 ('d0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Team Two'),
 ('d0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','Team Three');

-- Every application table is protected by RLS.
select ok(c.relrowsecurity, c.relname || ' has RLS enabled')
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('profiles','events','event_rounds','questions','question_secrets','teams','submissions','score_awards')
order by c.relname;

-- Domain calculations: normal boundary, birthday boundary and leap-day behavior.
select is(private.age_on(date '2000-03-01', date '2026-02-28'), 25, 'age before birthday');
select is(private.age_on(date '2000-03-01', date '2026-03-01'), 26, 'age on birthday');
select is(private.age_on(date '2000-02-29', date '2025-02-28'), 24, 'leap-day DOB remains pre-birthday on February 28');
select is(private.age_on(date '2000-02-29', date '2025-03-01'), 25, 'leap-day DOB advances on March 1 in a non-leap year');
select results_eq(
  $$select private.points_for_age_difference(x) from generate_series(0,11) x$$,
  $$values (10),(8),(6),(5),(3),(3),(1),(1),(1),(1),(1),(0)$$,
  'Guess the Age scoring bands are exact'
);

-- Host 1 can see only Host 1's records and private question data.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select is((select count(*) from public.events), 1::bigint, 'host sees only owned event');
select is((select count(*) from public.event_rounds), 1::bigint, 'host sees only owned round');
select is((select count(*) from public.question_secrets), 3::bigint, 'host sees secrets only for owned event');
select throws_ok(
  $$select public.start_question('a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000004',15)$$,
  '42501', 'event owner required', 'host cannot control another host event'
);

-- Anonymous Team 1 can see only itself and its own eventual submission/award.
select set_config('request.jwt.claims','{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select is((select count(*) from public.events), 0::bigint, 'team cannot directly read events');
select is((select count(*) from public.event_rounds), 0::bigint, 'team cannot directly read rounds');
select is((select count(*) from public.questions), 0::bigint, 'team cannot directly read questions');
select is((select count(*) from public.question_secrets), 0::bigint, 'team cannot read question secrets');
select is((select count(*) from public.teams), 1::bigint, 'team sees only its own membership');
select throws_ok($$update public.events set status='reveal' where id='a0000000-0000-0000-0000-000000000001'$$, '42501', 'permission denied for table events', 'team cannot update event state');
select lives_ok($$update public.event_rounds set position=9 where id='b0000000-0000-0000-0000-000000000001'$$, 'team round update is safely filtered by RLS');
select is((select count(*) from public.event_rounds where position=9), 0::bigint, 'team cannot update rounds');
select throws_ok($$insert into public.score_awards(event_id,team_id,points,kind,reason) values ('a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001',99,'manual_correction','cheat')$$, '42501', 'permission denied for table score_awards', 'team cannot directly change scores');
select throws_ok($$select public.start_question('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',15)$$, '42501', 'event owner required', 'anonymous user cannot call host RPC');

-- Audience is anonymous but has no Team membership: no direct application rows.
select set_config('request.jwt.claims','{"sub":"20000000-0000-0000-0000-000000000099","role":"authenticated","is_anonymous":true}',true);
select is((select count(*) from public.events), 0::bigint, 'audience cannot directly read events');
select is((select count(*) from public.teams), 0::bigint, 'audience has no team membership');
select is((select count(*) from public.submissions), 0::bigint, 'audience cannot directly read submissions');
select is((select count(*) from public.score_awards), 0::bigint, 'audience cannot directly read scores');
select is((select count(*) from public.question_secrets), 0::bigint, 'audience cannot read question secrets');
select ok(public.get_public_room_state('ABC123') is not null, 'audience can hydrate safe public room state');
select ok(not (public.get_public_room_state('ABC123')::text like '%date_of_birth%'), 'public hydration omits DOB');
select is(public.get_public_room_state('ABC123')->'question', 'null'::jsonb, 'inactive question is not exposed');

-- Host opens question 1 using server timestamps.
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.start_question('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',30)$$, 'owner starts active question');

-- Submission ownership, active question, range and duplicate checks.
select set_config('request.jwt.claims','{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.submit_guess('d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001',26)$$, '42501', 'team ownership required', 'team cannot submit for another team');
select throws_ok($$select public.submit_guess('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003',26)$$, 'P0001', 'question is not accepting answers', 'only active question accepts answers');
select throws_ok($$select public.submit_guess('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',0)$$, '22023', 'guess must be an integer from 1 to 120', 'age below range rejected');
select throws_ok($$select public.submit_guess('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',121)$$, '22023', 'guess must be an integer from 1 to 120', 'age above range rejected');
select lives_ok($$select public.submit_guess('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',26)$$, 'valid integer guess accepted');
select throws_ok($$select public.submit_guess('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',25)$$, '23505', 'a submission has already been accepted for this question', 'duplicate submission rejected');

-- Independent rows model concurrent teams without whole-state overwrite.
select set_config('request.jwt.claims','{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}',true);
select lives_ok($$select public.submit_guess('d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001',27)$$, 'second team submission is independently accepted');
select is((select count(*) from public.submissions where question_id='c0000000-0000-0000-0000-000000000001'), 1::bigint, 'team RLS still exposes only caller submission');

-- Expiry is enforced from database time, regardless of browser state.
reset role;
update public.events set question_started_at=clock_timestamp()-interval '2 seconds', question_deadline_at=clock_timestamp()-interval '1 second' where id='a0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.submit_guess('d0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001',27)$$, 'P0001', 'answer deadline has passed', 'server deadline rejects late submission');

-- Reveal and scoring are one atomic, idempotent host transaction.
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.reveal_question('a0000000-0000-0000-0000-000000000001')$$, 'reveal atomically scores');
select is((select count(*) from public.score_awards where kind='game'), 2::bigint, 'both accepted teams scored without overwrite');
select is((select points from public.score_awards where team_id='d0000000-0000-0000-0000-000000000001' and kind='game'), 10, 'exact guess receives ten points');
select lives_ok($$select public.reveal_question('a0000000-0000-0000-0000-000000000001')$$, 'reveal retry is safe');
select is((select count(*) from public.score_awards where kind='game'), 2::bigint, 'scoring retry is idempotent');

-- Corrections append to the immutable ledger.
select lives_ok($$select public.add_manual_score_correction('a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001',-2,'Host correction')$$, 'manual correction appended');
select is((select count(*) from public.score_awards where team_id='d0000000-0000-0000-0000-000000000001'), 2::bigint, 'correction preserves original game award');
select is((select sum(points)::integer from public.score_awards where team_id='d0000000-0000-0000-0000-000000000001'), 8, 'ledger total includes signed correction');

-- Realtime policies are receive-only and topic-scoped.
select is((select count(*) from pg_policies where schemaname='realtime' and tablename='messages' and cmd='SELECT'), 3::bigint, 'three private Realtime receive policies exist');
select is((select count(*) from pg_policies where schemaname='realtime' and tablename='messages' and cmd='INSERT'), 0::bigint, 'clients have no Realtime broadcast-send policy');
reset role;
select set_config('request.jwt.claims','{"sub":"20000000-0000-0000-0000-000000000099","role":"authenticated","is_anonymous":true}',true);
select ok(private.can_receive_public_event('a0000000-0000-0000-0000-000000000001'), 'Audience may receive live public topic');
select set_config('request.jwt.claims','{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select ok(private.can_receive_team_topic('a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001'), 'Team may receive its event/team topic');
select ok(not private.can_receive_team_topic('a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002'), 'Team cannot receive another Team topic');
select ok(not private.can_receive_team_topic('a0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001'), 'Team topic must match its event');

-- Storage is public-read but Host-only write; anonymous upload is rejected.
select is((select file_size_limit from storage.buckets where id='celebrity-images'), 5242880::bigint, 'celebrity bucket has five MiB limit');
select is((select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'celebrity_images_host_%'), 3::bigint, 'storage has Host-only write policies');
insert into storage.objects(bucket_id,name,owner_id) values ('celebrity-images','a0000000-0000-0000-0000-000000000001/c0000000-0000-0000-0000-000000000001/protected.jpg','10000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select throws_ok(
  $$insert into storage.objects(bucket_id,name,owner_id) values ('celebrity-images','a0000000-0000-0000-0000-000000000001/c0000000-0000-0000-0000-000000000001/test.jpg','20000000-0000-0000-0000-000000000001')$$,
  '42501', 'new row violates row-level security policy for table "objects"', 'anonymous Team cannot upload celebrity image'
);
select throws_ok(
  $$delete from storage.objects where bucket_id='celebrity-images' and name like '%protected.jpg'$$,
  '42501', 'Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'anonymous direct image deletion is rejected'
);
reset role;
select is((select count(*) from storage.objects where bucket_id='celebrity-images' and name like '%protected.jpg'), 1::bigint, 'anonymous Team cannot delete celebrity image');

select * from finish();
rollback;
