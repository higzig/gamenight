-- Phase 2D: Host-private reusable celebrities. question_secrets remains the
-- immutable per-question DOB snapshot used by scoring and reveal.

create function private.normalize_celebrity_name(p_name text) returns text
language sql immutable strict set search_path = '' as $$
  select regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '', 'g')
$$;

create table public.celebrities (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  normalized_name text not null,
  date_of_birth date not null,
  image_kind text not null default 'none',
  image_path text,
  external_image_url text,
  image_source text,
  source_reference text,
  wikipedia_checked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint celebrities_name_length check (char_length(trim(display_name)) between 2 and 160),
  constraint celebrities_normalized_name_valid check (normalized_name = private.normalize_celebrity_name(display_name) and char_length(normalized_name) >= 2),
  constraint celebrities_dob_sensible check (date_of_birth between date '1850-01-01' and current_date),
  constraint celebrities_image_kind_valid check (image_kind in ('none','storage','external')),
  constraint celebrities_image_source_valid check (image_source is null or image_source in ('wikipedia','upload','manual_url')),
  constraint celebrities_image_shape check (
    (image_kind='none' and image_path is null and external_image_url is null) or
    (image_kind='storage' and image_path is not null and external_image_url is null) or
    (image_kind='external' and image_path is null and external_image_url ~ '^https://')
  ),
  unique(host_id, normalized_name, date_of_birth)
);
create index celebrities_host_search_idx on public.celebrities(host_id, normalized_name);
create trigger celebrities_updated_at before update on public.celebrities
for each row execute function private.set_updated_at();

alter table public.questions add column celebrity_id uuid references public.celebrities(id) on delete restrict;
create index questions_celebrity_idx on public.questions(celebrity_id);

-- Backfill one private library per Host. DOB disambiguates genuinely different
-- people with the same name; punctuation/case variants collapse safely.
insert into public.celebrities(host_id,display_name,normalized_name,date_of_birth,image_kind,image_path,external_image_url,image_source,source_reference,created_by)
select distinct on (e.host_id,private.normalize_celebrity_name(q.celebrity_name),qs.date_of_birth)
  e.host_id,q.celebrity_name,private.normalize_celebrity_name(q.celebrity_name),qs.date_of_birth,
  q.image_kind,q.image_path,q.external_image_url,
  case when q.external_image_url is not null then 'manual_url' else null end,
  'Backfilled from question '||q.id::text,e.host_id
from public.questions q
join public.question_secrets qs on qs.question_id=q.id
join public.events e on e.id=q.event_id
order by e.host_id,private.normalize_celebrity_name(q.celebrity_name),qs.date_of_birth,
  case q.image_kind when 'storage' then 0 when 'external' then 1 else 2 end,q.created_at;

update public.questions q set celebrity_id=c.id
from public.question_secrets qs,public.events e,public.celebrities c
where qs.question_id=q.id and e.id=q.event_id and c.host_id=e.host_id
  and c.normalized_name=private.normalize_celebrity_name(q.celebrity_name)
  and c.date_of_birth=qs.date_of_birth;

create function private.backfill_celebrity_library() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into public.celebrities(host_id,display_name,normalized_name,date_of_birth,image_kind,image_path,external_image_url,image_source,source_reference,created_by)
  select distinct on(e.host_id,private.normalize_celebrity_name(q.celebrity_name),qs.date_of_birth)
    e.host_id,q.celebrity_name,private.normalize_celebrity_name(q.celebrity_name),qs.date_of_birth,q.image_kind,q.image_path,q.external_image_url,
    case when q.external_image_url is not null then 'manual_url' end,'Backfilled from question '||q.id::text,e.host_id
  from public.questions q join public.question_secrets qs on qs.question_id=q.id join public.events e on e.id=q.event_id
  where q.celebrity_id is null
  order by e.host_id,private.normalize_celebrity_name(q.celebrity_name),qs.date_of_birth,case q.image_kind when 'storage' then 0 when 'external' then 1 else 2 end,q.created_at
  on conflict(host_id,normalized_name,date_of_birth) do nothing;
  update public.questions q set celebrity_id=c.id from public.question_secrets qs,public.events e,public.celebrities c
  where q.celebrity_id is null and qs.question_id=q.id and e.id=q.event_id and c.host_id=e.host_id
    and c.normalized_name=private.normalize_celebrity_name(q.celebrity_name) and c.date_of_birth=qs.date_of_birth;
  get diagnostics v_count=row_count;return v_count;
end;
$$;
revoke all on function private.backfill_celebrity_library() from public,anon,authenticated;

alter table public.celebrities enable row level security;
create policy celebrities_owner_select on public.celebrities for select to authenticated
using (host_id=auth.uid() and not private.is_anonymous_user());
create policy celebrities_owner_insert on public.celebrities for insert to authenticated
with check (host_id=auth.uid() and not private.is_anonymous_user());
create policy celebrities_owner_update on public.celebrities for update to authenticated
using (host_id=auth.uid() and not private.is_anonymous_user())
with check (host_id=auth.uid() and not private.is_anonymous_user());
create policy celebrities_owner_delete on public.celebrities for delete to authenticated
using (host_id=auth.uid() and not private.is_anonymous_user());
revoke all on table public.celebrities from public,anon,authenticated;

create function private.owns_celebrity(p_celebrity_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.celebrities c where c.id=p_celebrity_id and c.host_id=auth.uid())
    and not private.is_anonymous_user()
$$;
revoke all on function private.owns_celebrity(uuid) from public,anon,authenticated;
grant execute on function private.owns_celebrity(uuid) to authenticated;

create function private.upsert_host_celebrity(
  p_id uuid,p_display_name text,p_date_of_birth date,p_image_kind text,
  p_image_path text,p_external_image_url text,p_image_source text,p_source_reference text
) returns public.celebrities
language plpgsql security definer set search_path = '' as $$
declare v public.celebrities; v_kind text:=coalesce(p_image_kind,'none');
begin
  if auth.uid() is null or private.is_anonymous_user() then raise exception 'Host authentication required' using errcode='42501'; end if;
  if p_date_of_birth is null or nullif(trim(p_display_name),'') is null then raise exception 'name and DOB required' using errcode='22023'; end if;
  if v_kind='external' and coalesce(p_external_image_url,'') !~ '^https://' then raise exception 'HTTPS image URL required' using errcode='22023'; end if;
  if v_kind='storage' and coalesce(p_image_path,'') !~ ('^celebrities/'||coalesce(p_id::text,'[0-9a-f-]{36}')||'/') then raise exception 'invalid celebrity image path' using errcode='22023'; end if;
  if p_id is not null then
    select * into v from public.celebrities where id=p_id and host_id=auth.uid() for update;
    if not found then raise exception 'celebrity owner required' using errcode='42501'; end if;
    update public.celebrities set display_name=trim(p_display_name),normalized_name=private.normalize_celebrity_name(p_display_name),
      date_of_birth=p_date_of_birth,image_kind=v_kind,
      image_path=case when v_kind='storage' then p_image_path else null end,
      external_image_url=case when v_kind='external' then p_external_image_url else null end,
      image_source=case when v_kind='none' then null else p_image_source end,source_reference=p_source_reference
    where id=p_id returning * into v;
  else
    insert into public.celebrities(host_id,display_name,normalized_name,date_of_birth,image_kind,image_path,external_image_url,image_source,source_reference,created_by)
    values(auth.uid(),trim(p_display_name),private.normalize_celebrity_name(p_display_name),p_date_of_birth,v_kind,
      case when v_kind='storage' then p_image_path end,case when v_kind='external' then p_external_image_url end,
      case when v_kind='none' then null else p_image_source end,p_source_reference,auth.uid())
    on conflict(host_id,normalized_name,date_of_birth) do update set
      display_name=excluded.display_name,
      image_kind=case when public.celebrities.image_kind='none' then excluded.image_kind else public.celebrities.image_kind end,
      image_path=case when public.celebrities.image_kind='none' then excluded.image_path else public.celebrities.image_path end,
      external_image_url=case when public.celebrities.image_kind='none' then excluded.external_image_url else public.celebrities.external_image_url end,
      image_source=case when public.celebrities.image_kind='none' then excluded.image_source else public.celebrities.image_source end,
      source_reference=case when public.celebrities.image_kind='none' then excluded.source_reference else public.celebrities.source_reference end
    returning * into v;
  end if;
  return v;
end;
$$;

create function public.search_celebrities(p_query text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by
    case when c.normalized_name=private.normalize_celebrity_name(p_query) then 0 else 1 end,c.display_name),'[]'::jsonb)
  from (select * from public.celebrities where host_id=auth.uid()
    and not private.is_anonymous_user()
    and normalized_name like '%'||private.normalize_celebrity_name(p_query)||'%' limit 12)c
$$;

create function public.save_celebrity(
  p_id uuid,p_display_name text,p_date_of_birth date,p_image_kind text default 'none',
  p_image_path text default null,p_external_image_url text default null,
  p_image_source text default null,p_source_reference text default null
) returns public.celebrities
language sql security definer set search_path = '' as $$
  select private.upsert_host_celebrity(p_id,p_display_name,p_date_of_birth,p_image_kind,p_image_path,p_external_image_url,p_image_source,p_source_reference)
$$;

create function public.mark_celebrity_wikipedia_checked(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.owns_celebrity(p_id) then raise exception 'celebrity owner required' using errcode='42501'; end if;
  update public.celebrities set wikipedia_checked_at=clock_timestamp() where id=p_id;
end;
$$;

create or replace function public.save_guess_age_round(p_event_id uuid,p_title text,p_questions jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_round_id uuid;v_item jsonb;v_position integer:=0;v_question_id uuid;v_celeb public.celebrities;v_image_url text;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode='42501'; end if;
  if jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions) not between 1 and 50 then raise exception 'Guess the Age requires between 1 and 50 questions' using errcode='22023'; end if;
  select id into v_round_id from public.event_rounds where event_id=p_event_id and game_type='guess_age' order by position limit 1;
  if v_round_id is null then
    insert into public.event_rounds(event_id,position,game_type,title,settings) values(p_event_id,coalesce((select max(position)+1 from public.event_rounds where event_id=p_event_id),1),'guess_age',coalesce(nullif(trim(p_title),''),'Guess the Age'),jsonb_build_object('duration_seconds',15)) returning id into v_round_id;
  else
    if exists(select 1 from public.submissions s join public.questions q on q.id=s.question_id where q.round_id=v_round_id) then raise exception 'A played Guess the Age round cannot be replaced'; end if;
    update public.event_rounds set title=coalesce(nullif(trim(p_title),''),'Guess the Age'),settings=jsonb_build_object('duration_seconds',15) where id=v_round_id;
    delete from public.questions where round_id=v_round_id;
  end if;
  for v_item in select value from jsonb_array_elements(p_questions) loop
    v_position:=v_position+1;v_image_url:=nullif(trim(v_item->>'external_image_url'),'');if v_image_url is not null and v_image_url !~ '^https://' then v_image_url:=null;end if;
    v_celeb:=private.upsert_host_celebrity(nullif(v_item->>'celebrity_id','')::uuid,v_item->>'celebrity_name',(v_item->>'date_of_birth')::date,
      case when nullif(v_item->>'image_path','') is not null then 'storage' when v_image_url is not null then 'external' else 'none' end,
      nullif(v_item->>'image_path',''),v_image_url,nullif(v_item->>'image_source',''),nullif(v_item->>'source_reference',''));
    insert into public.questions(event_id,round_id,celebrity_id,position,celebrity_name,image_kind,image_path,external_image_url)
    values(p_event_id,v_round_id,v_celeb.id,v_position,v_celeb.display_name,v_celeb.image_kind,v_celeb.image_path,v_celeb.external_image_url) returning id into v_question_id;
    insert into public.question_secrets(question_id,date_of_birth) values(v_question_id,v_celeb.date_of_birth);
  end loop;
  update public.events set active_round_id=v_round_id,active_question_id=null,status=case when status='draft' then 'lobby' else status end,state_version=state_version+1 where id=p_event_id;
  perform private.notify_event(p_event_id,(select state_version from public.events where id=p_event_id),'guess_age_saved');return v_round_id;
end;
$$;

create or replace function public.copy_event_session(p_event_id uuid) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_source public.events;v_new public.events;v_old_round public.event_rounds;v_new_round_id uuid;v_q public.questions;v_new_q_id uuid;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode='42501'; end if;
  select * into v_source from public.events where id=p_event_id;v_new:=public.create_event(v_source.name,v_source.venue,v_source.event_date,v_source.expected_teams);
  update public.events set status='lobby',display_mode='join' where id=v_new.id returning * into v_new;
  for v_old_round in select * from public.event_rounds where event_id=p_event_id and game_type='guess_age' order by position loop
    insert into public.event_rounds(event_id,position,game_type,title,settings) values(v_new.id,v_old_round.position,v_old_round.game_type,v_old_round.title,v_old_round.settings) returning id into v_new_round_id;
    for v_q in select * from public.questions where round_id=v_old_round.id order by position loop
      insert into public.questions(event_id,round_id,celebrity_id,position,celebrity_name,image_kind,image_path,external_image_url)
      values(v_new.id,v_new_round_id,v_q.celebrity_id,v_q.position,v_q.celebrity_name,v_q.image_kind,v_q.image_path,v_q.external_image_url) returning id into v_new_q_id;
      insert into public.question_secrets(question_id,date_of_birth) select v_new_q_id,date_of_birth from public.question_secrets where question_id=v_q.id;
    end loop;
  end loop;
  update public.events e set active_round_id=r.id,active_question_id=q.id from public.event_rounds r left join public.questions q on q.round_id=r.id and q.position=1 where e.id=v_new.id and r.event_id=v_new.id and r.game_type='guess_age' returning e.* into v_new;
  perform private.notify_event(v_new.id,v_new.state_version,'session_created');return v_new;
end;
$$;

-- Library media is reused live, while question_secrets supplies the historical
-- answer snapshot. Public payloads still reveal age only in reveal state.
create or replace function public.get_public_room_state(p_room_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('server_now',clock_timestamp(),'event',jsonb_build_object('id',e.id,'room_code',e.room_code,'name',e.name,'venue',e.venue,'event_date',e.event_date,'status',e.status,'display_mode',e.display_mode,'state_version',e.state_version,'active_round_id',e.active_round_id,'active_question_id',e.active_question_id,'question_started_at',e.question_started_at,'question_deadline_at',e.question_deadline_at,'question_reveal_due_at',e.question_reveal_due_at,'accepting_answers',e.status='question' and e.question_deadline_at>clock_timestamp()),
    'round',case when r.id is null then null else jsonb_build_object('id',r.id,'position',r.position,'game_type',r.game_type,'title',r.title,'question_count',(select count(*) from public.questions rq where rq.round_id=r.id))end,
    'question',case when q.id is null then null else jsonb_build_object('id',q.id,'position',q.position,'celebrity_name',coalesce(c.display_name,q.celebrity_name),'image_kind',coalesce(c.image_kind,q.image_kind),'image_path',coalesce(c.image_path,q.image_path),'external_image_url',coalesce(c.external_image_url,q.external_image_url),'correct_age',case when e.status='reveal' then private.age_on(qs.date_of_birth,e.event_date)else null end)end,
    'answer_count',(select count(*) from public.submissions s where s.event_id=e.id and s.question_id=e.active_question_id),'team_count',(select count(*) from public.teams t where t.event_id=e.id and t.status='active'),
    'leaderboard',case when e.display_mode='leaderboard' then(select coalesce(jsonb_agg(jsonb_build_object('team_id',x.team_id,'name',x.name,'points',x.points)order by x.points desc,x.name),'[]'::jsonb)from(select t.id team_id,t.name,coalesce(sum(sa.points),0)::integer points from public.teams t left join public.score_awards sa on sa.team_id=t.id where t.event_id=e.id and t.status='active' group by t.id,t.name)x)else'[]'::jsonb end)
  from public.events e left join public.event_rounds r on r.id=e.active_round_id left join public.questions q on q.id=e.active_question_id left join public.celebrities c on c.id=q.celebrity_id left join public.question_secrets qs on qs.question_id=q.id where e.room_code=upper(trim(p_room_code))and e.status<>'ended'
$$;

create or replace function public.get_host_event_state(p_event_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('server_now',clock_timestamp(),'event',to_jsonb(e),
 'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'joined_at',t.joined_at,'total',coalesce((select sum(sa.points)from public.score_awards sa where sa.team_id=t.id),0))order by t.joined_at,t.name)from public.teams t where t.event_id=e.id),'[]'::jsonb),
 'celebrity_library',coalesce((select jsonb_agg(to_jsonb(c)order by c.display_name)from public.celebrities c where c.host_id=e.host_id),'[]'::jsonb),
 'rounds',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'position',r.position,'game_type',r.game_type,'title',r.title,'settings',r.settings,'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'celebrity_id',q.celebrity_id,'position',q.position,'celebrity_name',coalesce(c.display_name,q.celebrity_name),'image_kind',coalesce(c.image_kind,q.image_kind),'image_path',coalesce(c.image_path,q.image_path),'external_image_url',coalesce(c.external_image_url,q.external_image_url),'image_source',c.image_source,'source_reference',c.source_reference,'date_of_birth',qs.date_of_birth)order by q.position)from public.questions q join public.question_secrets qs on qs.question_id=q.id left join public.celebrities c on c.id=q.celebrity_id where q.round_id=r.id),'[]'::jsonb))order by r.position)from public.event_rounds r where r.event_id=e.id and r.game_type='guess_age'),'[]'::jsonb),
 'submissions',coalesce((select jsonb_agg(jsonb_build_object('team_id',t.id,'team_name',t.name,'guess_integer',s.guess_integer,'accepted_at',s.accepted_at)order by t.name)from public.teams t left join public.submissions s on s.team_id=t.id and s.question_id=e.active_question_id where t.event_id=e.id and t.status='active'),'[]'::jsonb),
 'awards',coalesce((select jsonb_agg(jsonb_build_object('team_id',a.team_id,'points',a.points,'metadata',a.metadata))from public.score_awards a where a.event_id=e.id and a.question_id=e.active_question_id and a.kind='game'),'[]'::jsonb),
 'leaderboard',(select coalesce(jsonb_agg(jsonb_build_object('team_id',x.team_id,'name',x.name,'points',x.points)order by x.points desc,x.name),'[]'::jsonb)from(select t.id team_id,t.name,coalesce(sum(sa.points),0)::integer points from public.teams t left join public.score_awards sa on sa.team_id=t.id where t.event_id=e.id and t.status='active' group by t.id,t.name)x))
 from public.events e where e.id=p_event_id and private.is_event_host(e.id)
$$;

drop policy celebrity_images_host_insert on storage.objects;
drop policy celebrity_images_host_update on storage.objects;
drop policy celebrity_images_host_delete on storage.objects;
create policy celebrity_images_host_insert on storage.objects for insert to authenticated with check(bucket_id='celebrity-images' and not private.is_anonymous_user() and ((storage.foldername(name))[1]='celebrities' and private.owns_celebrity((storage.foldername(name))[2]::uuid) or private.is_event_host((storage.foldername(name))[1]::uuid)));
create policy celebrity_images_host_update on storage.objects for update to authenticated using(bucket_id='celebrity-images' and not private.is_anonymous_user() and ((storage.foldername(name))[1]='celebrities' and private.owns_celebrity((storage.foldername(name))[2]::uuid) or private.is_event_host((storage.foldername(name))[1]::uuid))) with check(bucket_id='celebrity-images' and ((storage.foldername(name))[1]='celebrities' and private.owns_celebrity((storage.foldername(name))[2]::uuid) or private.is_event_host((storage.foldername(name))[1]::uuid)));
create policy celebrity_images_host_delete on storage.objects for delete to authenticated using(bucket_id='celebrity-images' and not private.is_anonymous_user() and ((storage.foldername(name))[1]='celebrities' and private.owns_celebrity((storage.foldername(name))[2]::uuid) or private.is_event_host((storage.foldername(name))[1]::uuid)));

revoke all on function private.upsert_host_celebrity(uuid,text,date,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.search_celebrities(text),public.save_celebrity(uuid,text,date,text,text,text,text,text),public.mark_celebrity_wikipedia_checked(uuid) from public,anon,authenticated;
grant execute on function public.search_celebrities(text),public.save_celebrity(uuid,text,date,text,text,text,text,text),public.mark_celebrity_wikipedia_checked(uuid) to authenticated;
