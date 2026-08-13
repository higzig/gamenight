begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','14000000-0000-0000-0000-000000000001','authenticated','authenticated','lib-host@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','14000000-0000-0000-0000-000000000002','authenticated','authenticated','other-host@test.local','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','24000000-0000-0000-0000-000000000001','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','24000000-0000-0000-0000-000000000002','authenticated','authenticated',null,'',now(),'{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now());
insert into public.profiles(id) values('14000000-0000-0000-0000-000000000001'),('14000000-0000-0000-0000-000000000002');
insert into public.events(id,host_id,room_code,name,event_date,status,display_mode) values
('ad000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','LIB123','Library Night','2026-08-20','lobby','join');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"14000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.save_celebrity(null,'Pedro Pascal','1975-04-02','external',null,'https://example.com/pedro.jpg','wikipedia','Pedro Pascal')$$,'Host creates reusable celebrity');
select is(jsonb_array_length(public.search_celebrities('pedro-pascal')),1,'normalized search finds punctuation/case variant');
select lives_ok($$select public.save_celebrity(null,'PEDRO-PASCAL','1975-04-02','none',null,null,null,null)$$,'duplicate normalized save reuses record');
select is(jsonb_array_length(public.search_celebrities('Pedro Pascal')),1,'normalized name and DOB are unique within Host');
select set_config('test.celeb_id',public.search_celebrities('Pedro')->0->>'id',true);

select lives_ok($$select public.save_guess_age_round('ad000000-0000-0000-0000-000000000001','Guess the Age',jsonb_build_array(jsonb_build_object('celebrity_id',current_setting('test.celeb_id'),'celebrity_name','Pedro Pascal','date_of_birth','1975-04-02','external_image_url','https://example.com/pedro.jpg','image_source','wikipedia')))$$,'question is saved from library record');
select is((select celebrity_id::text from public.questions where event_id='ad000000-0000-0000-0000-000000000001'),current_setting('test.celeb_id'),'question references valid celebrity');
select ok((public.get_public_room_state('LIB123')::text not like '%1975-04-02%'),'public payload does not expose DOB before reveal');

select set_config('request.jwt.claims','{"sub":"24000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select * from public.celebrities$$,'42501','permission denied for table celebrities','anonymous Team cannot select celebrity library');
select is(jsonb_array_length(public.search_celebrities('Pedro')),0,'anonymous Audience search reveals no celebrities');
select throws_ok($$select public.save_celebrity(current_setting('test.celeb_id')::uuid,'Pedro Pascal','1975-04-02','none',null,null,null,null)$$,'42501','Host authentication required','anonymous cannot alter celebrity');

select set_config('request.jwt.claims','{"sub":"14000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}',true);
select is(jsonb_array_length(public.search_celebrities('Pedro')),0,'non-owner cannot read another Host library');
select throws_ok($$select public.save_celebrity(current_setting('test.celeb_id')::uuid,'Pedro Pascal','1975-04-02','none',null,null,null,null)$$,'42501','celebrity owner required','non-owner cannot update another Host celebrity');
select lives_ok($$select public.save_celebrity(null,'Pedro Pascal','1975-04-02','none',null,null,null,null)$$,'same celebrity name may exist for another Host');

select set_config('request.jwt.claims','{"sub":"14000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.copy_event_session('ad000000-0000-0000-0000-000000000001')$$,'session copies lineup');
select is((select count(distinct celebrity_id) from public.questions where celebrity_id=current_setting('test.celeb_id')::uuid),1::bigint,'session copy reuses celebrity_id');
select lives_ok($$select public.restart_guess_age_round('ad000000-0000-0000-0000-000000000001')$$,'round restart succeeds');
select is((public.search_celebrities('Pedro')->0->>'external_image_url'),'https://example.com/pedro.jpg','restart preserves celebrity media');
select lives_ok($$select public.save_celebrity(current_setting('test.celeb_id')::uuid,'Pedro Pascal','1975-04-02','external',null,'https://example.com/new.jpg','manual_url','replacement')$$,'Host replaces reusable image');
select is((public.search_celebrities('Pedro')->0->>'external_image_url'),'https://example.com/new.jpg','replacement image updates library record');
select ok((select with_check like '%owns_celebrity%' from pg_policies where schemaname='storage' and tablename='objects' and policyname='celebrity_images_host_insert'),'storage writes require celebrity ownership');

reset role;
insert into public.event_rounds(id,event_id,position,game_type,title) values('bd000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-000000000001',2,'guess_age','Legacy');
insert into public.questions(id,event_id,round_id,position,celebrity_name) values('cd000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-000000000001','bd000000-0000-0000-0000-000000000001',1,'Legacy Person');
insert into public.question_secrets(question_id,date_of_birth) values('cd000000-0000-0000-0000-000000000001','1988-01-02');
select is(private.backfill_celebrity_library(),1,'backfill attaches existing legacy question');

select * from finish();rollback;
