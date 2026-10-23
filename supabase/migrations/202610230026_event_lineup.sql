-- Host Dashboard Phase 1: a server-side running order, separate from gameplay preparation.
-- The lineup only lists which games are planned and in what order. Changing it never creates
-- rounds, groups or plays, never starts timers and never changes the active game.

alter table public.events add column lineup_revision integer, add column started_at timestamptz;
comment on column public.events.lineup_revision is 'Null until the running order is first saved; increments on every change for optimistic concurrency.';
comment on column public.events.started_at is 'Set when the Host enters hosting mode with Start Game Night.';

create table public.event_lineup_games(
 event_id uuid not null references public.events(id) on delete cascade,
 game_type text not null check(game_type in('guess_age','no_context','i_bet_you','perfect_lie')),
 position integer not null check(position between 1 and 4),
 primary key(event_id,game_type),
 unique(event_id,position)
);
alter table public.event_lineup_games enable row level security;
revoke all on public.event_lineup_games from public,anon,authenticated;

-- A game that has been on stage cannot be removed or replaced (its points stay on the leaderboard).
-- Saved-but-unplayed content does not lock a game; removing it keeps that content on the server.
create function private.lineup_game_locked(p_event_id uuid,p_game_type text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.event_rounds r join public.events e on e.id=r.event_id
  where r.event_id=p_event_id and r.game_type=p_game_type
    and(exists(select 1 from private.game_checkpoints c where c.round_id=r.id)
     or(e.active_round_id=r.id and e.status not in('draft','lobby'))))
$$;

create function private.event_lineup_state(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',e.lineup_revision,'started_at',e.started_at,
  'games',coalesce((select jsonb_agg(jsonb_build_object('game_type',l.game_type,'position',l.position,'locked',private.lineup_game_locked(e.id,l.game_type))order by l.position)
   from public.event_lineup_games l where l.event_id=e.id),'[]'::jsonb))
 from public.events e where e.id=p_event_id
$$;

-- Replaces the whole running order. Callers send the revision they last saw; a different
-- revision means another screen changed the order first. Games that have been on stage must remain.
create function public.set_event_lineup(p_event_id uuid,p_game_types text[],p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.events;v_types text[]:=coalesce(p_game_types,'{}');v_locked text;
begin
 if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
 select * into e from public.events where id=p_event_id for update;
 if e.status='ended'then raise exception 'This Game Night has ended.' using errcode='55000';end if;
 if e.lineup_revision is distinct from p_expected_revision then
  raise exception 'The running order was changed on another screen. It has been refreshed; please try again.' using errcode='40001';
 end if;
 if cardinality(v_types)>4 or exists(select 1 from unnest(v_types)t where t not in('guess_age','no_context','i_bet_you','perfect_lie'))then
  raise exception 'Choose up to four different games.' using errcode='22023';
 end if;
 if(select count(distinct t)from unnest(v_types)t)<>cardinality(v_types)then raise exception 'Each game can appear once per night.' using errcode='22023';end if;
 select l.game_type into v_locked from public.event_lineup_games l
  where l.event_id=p_event_id and not(l.game_type=any(v_types)) and private.lineup_game_locked(p_event_id,l.game_type) limit 1;
 if v_locked is not null then raise exception 'A game that has already been on stage cannot be removed or replaced.' using errcode='55000';end if;
 delete from public.event_lineup_games where event_id=p_event_id;
 insert into public.event_lineup_games(event_id,game_type,position)select p_event_id,t,n::integer from unnest(v_types)with ordinality u(t,n);
 -- First save of an older event: never hide a game that has already been played.
 if e.lineup_revision is null then
  insert into public.event_lineup_games(event_id,game_type,position)
  select p_event_id,r.game_type,cardinality(v_types)+row_number()over(order by r.position)::integer
  from(select distinct on(game_type)game_type,position from public.event_rounds where event_id=p_event_id order by game_type,position)r
  where private.lineup_game_locked(p_event_id,r.game_type) and not(r.game_type=any(v_types));
 end if;
 update public.events set lineup_revision=coalesce(lineup_revision,0)+1,state_version=state_version+1 where id=p_event_id returning * into e;
 perform private.notify_event(e.id,e.state_version,'lineup_changed');
 return private.event_lineup_state(p_event_id);
end $$;

-- Enters hosting mode: records started_at and, the first time only, shows the Join screen.
create function public.start_game_night(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.events;
begin
 if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
 select * into e from public.events where id=p_event_id for update;
 if e.status='ended'then raise exception 'This Game Night has ended.' using errcode='55000';end if;
 if not exists(select 1 from public.event_lineup_games where event_id=p_event_id)then raise exception 'Add at least one game before starting the night.' using errcode='55000';end if;
 if e.started_at is not null then return private.event_lineup_state(p_event_id);end if;
 update public.events set started_at=clock_timestamp(),display_mode='join',state_version=state_version+1 where id=p_event_id returning * into e;
 perform private.notify_event(e.id,e.state_version,'game_night_started');
 return private.event_lineup_state(p_event_id);
end $$;

-- Saving a Guess the Age lineup no longer selects Guess the Age as the active game. When it is
-- already the active round, its question pointer is still cleared because the old questions are replaced.
create or replace function public.save_guess_age_round_before_pause(p_event_id uuid,p_title text,p_questions jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
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
    update public.events set active_question_id=null where id=p_event_id and active_round_id=v_round_id;
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
  update public.events set status=case when status='draft' then 'lobby' else status end,state_version=state_version+1 where id=p_event_id;
  perform private.notify_event(p_event_id,(select state_version from public.events where id=p_event_id),'guess_age_saved');return v_round_id;
end;
$$;

create or replace function public.get_host_event_state(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select s||jsonb_build_object('game_defaults',private.host_game_defaults(p_event_id),'lineup',private.event_lineup_state(p_event_id))
 from public.get_host_event_state_before_defaults(p_event_id)s
$$;

revoke all on function private.lineup_game_locked(uuid,text),private.event_lineup_state(uuid) from public,anon,authenticated;
revoke all on function public.set_event_lineup(uuid,text[],integer),public.start_game_night(uuid) from public,anon,authenticated;
grant execute on function public.set_event_lineup(uuid,text[],integer),public.start_game_night(uuid) to authenticated;
