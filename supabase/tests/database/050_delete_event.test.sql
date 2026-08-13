begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','15000000-0000-0000-0000-000000000001','authenticated','authenticated','delete-owner@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','15000000-0000-0000-0000-000000000002','authenticated','authenticated','delete-other@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','25000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id) values('15000000-0000-0000-0000-000000000001'),('15000000-0000-0000-0000-000000000002');
insert into public.events(id,host_id,room_code,name,event_date,status,display_mode) values
('ae000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','DEL123','Delete Me','2026-08-20','lobby','join'),
('ae000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000001','KEEP12','Keep Me','2026-08-20','lobby','join');
insert into public.celebrities(id,host_id,display_name,normalized_name,date_of_birth,created_by) values
('ce000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','Reusable Person','reusableperson','1980-01-01','15000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"15000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}',true);
select throws_ok($$select public.delete_event('ae000000-0000-0000-0000-000000000001')$$,'42501','event owner required','non-owner Host cannot delete event');
select set_config('request.jwt.claims','{"sub":"25000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.delete_event('ae000000-0000-0000-0000-000000000001')$$,'42501','event owner required','anonymous user cannot delete event');
select set_config('request.jwt.claims','{"sub":"15000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.delete_event('ae000000-0000-0000-0000-000000000001')$$,'owner deletes event');
select is((select count(*) from public.events where id='ae000000-0000-0000-0000-000000000001'),0::bigint,'target event is deleted');
select is(jsonb_array_length(public.search_celebrities('Reusable Person')),1,'reusable celebrity library survives event deletion');
select * from finish();rollback;
