-- Team lobby identity: canonical display names, race-safe normalized uniqueness,
-- and a deliberately small public lobby roster.

create function private.clean_team_name(p_name text) returns text
language sql immutable parallel safe set search_path='' as $$
  select regexp_replace(btrim(coalesce(p_name,'')), '[[:space:]]+', ' ', 'g')
$$;

create function private.normalize_team_name(p_name text) returns text
language sql immutable parallel safe set search_path='' as $$
  select lower(private.clean_team_name(p_name))
$$;

-- Canonicalize legacy display values. The old lower(name) index already prevents
-- case-only duplicates; disambiguate the rare repeated-space legacy collision.
update public.teams set name=private.clean_team_name(name)
where name is distinct from private.clean_team_name(name);

with ranked as (
  select id,name,row_number() over(partition by event_id,private.normalize_team_name(name) order by joined_at,id) as ordinal
  from public.teams where status='active'
)
update public.teams t set name=left(r.name,70)||' ('||r.ordinal||')'
from ranked r where r.id=t.id and r.ordinal>1;

alter table public.teams add column normalized_name text generated always as (private.normalize_team_name(name)) stored;
alter table public.teams add constraint teams_normalized_name_present check(char_length(normalized_name) between 1 and 80);
drop index public.teams_event_name_unique;
create unique index teams_event_active_normalized_name_unique
  on public.teams(event_id,normalized_name) where status='active';

create or replace function public.join_event(p_room_code text,p_team_name text,p_mascot_id text) returns public.teams
language plpgsql security definer set search_path='' as $$
declare v_event public.events;v_team public.teams;v_name text;v_normalized_name text;
begin
  if auth.uid() is null or not private.is_anonymous_user() then raise exception 'anonymous authentication required' using errcode='42501';end if;
  v_name:=private.clean_team_name(p_team_name);v_normalized_name:=private.normalize_team_name(p_team_name);
  if char_length(v_name) not between 1 and 80 then raise exception 'choose a Team name between 1 and 80 characters' using errcode='22023';end if;
  if p_mascot_id is null or p_mascot_id not in('frog','fox','bear','shark','octopus','dinosaur','ghost','robot','alien','rocket','crown','wizard','dragon','cat','dog','penguin','monkey','tiger','lion','owl','bee','snake','unicorn','skull','lightning','flame','star','planet','gamepad','dice','pizza','burger') then raise exception 'choose a valid mascot' using errcode='22023';end if;
  select * into v_event from public.events where room_code=upper(trim(p_room_code)) for update;
  if not found or v_event.status not in('lobby','ready') then raise exception 'event is not available for joining';end if;
  select * into v_team from public.teams where event_id=v_event.id and auth_user_id=auth.uid();
  if found then
    if v_team.mascot_id is null then
      begin update public.teams set mascot_id=p_mascot_id,updated_at=now() where id=v_team.id returning * into v_team;
      exception when unique_violation then raise exception 'That mascot was just taken. Pick another one.' using errcode='23505';end;
      update public.events set state_version=state_version+1 where id=v_event.id returning state_version into v_event.state_version;
      perform private.notify_event(v_event.id,v_event.state_version,'team_mascot_selected');
    end if;
    return v_team;
  end if;
  begin
    insert into public.teams(event_id,auth_user_id,name,mascot_id) values(v_event.id,auth.uid(),v_name,p_mascot_id) returning * into v_team;
  exception when unique_violation then
    if exists(select 1 from public.teams where event_id=v_event.id and status='active' and normalized_name=v_normalized_name) then raise exception 'That Team name is already taken.' using errcode='23505';end if;
    if exists(select 1 from public.teams where event_id=v_event.id and status='active' and mascot_id=p_mascot_id) then raise exception 'That mascot was just taken. Pick another one.' using errcode='23505';end if;
    raise;
  end;
  update public.events set state_version=state_version+1 where id=v_event.id returning state_version into v_event.state_version;
  perform private.notify_event(v_event.id,v_event.state_version,'team_joined');
  return v_team;
end;
$$;

create or replace function public.get_public_room_state(p_room_code text) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when s is null then null else (s-'answer_count')||jsonb_build_object(
    'submitted_count',coalesce((s->>'answer_count')::integer,0),
    'taken_mascot_ids',coalesce((select jsonb_agg(t.mascot_id order by t.mascot_id) from public.teams t where t.event_id=(s->'event'->>'id')::uuid and t.status='active' and t.mascot_id is not null),'[]'::jsonb),
    'lobby_roster',case when s->'event'->>'status' in('lobby','ready') then coalesce((select jsonb_agg(jsonb_build_object('name',t.name,'mascot_id',t.mascot_id) order by t.joined_at,t.name) from public.teams t where t.event_id=(s->'event'->>'id')::uuid and t.status='active'),'[]'::jsonb) else '[]'::jsonb end,
    'guess_markers',case
      when s->'event'->>'status'='reveal' then coalesce((select jsonb_agg(jsonb_build_object('team_name',t.name,'mascot_id',t.mascot_id,'guess',sub.guess_integer,'signed_difference',sub.guess_integer-(s->'question'->>'correct_age')::integer,'points',coalesce(a.points,0)) order by sub.guess_integer,t.name) from public.submissions sub join public.teams t on t.id=sub.team_id left join public.score_awards a on a.question_id=sub.question_id and a.team_id=t.id and a.kind='game' where sub.event_id=(s->'event'->>'id')::uuid and sub.question_id=(s->'event'->>'active_question_id')::uuid),'[]'::jsonb)
      else '[]'::jsonb end,
    'leaderboard',case when s->'event'->>'display_mode'='leaderboard' then (select coalesce(jsonb_agg(jsonb_build_object('team_id',x.team_id,'name',x.name,'mascot_id',x.mascot_id,'points',x.points) order by x.points desc,x.name),'[]'::jsonb) from(select t.id team_id,t.name,t.mascot_id,coalesce(sum(sa.points),0)::integer points from public.teams t left join public.score_awards sa on sa.team_id=t.id where t.event_id=(s->'event'->>'id')::uuid and t.status='active' group by t.id,t.name,t.mascot_id)x) else '[]'::jsonb end,
    'i_bet_you',case when private.i_bet_you_state((s->'event'->>'id')::uuid)->'round'->>'id'=s->'event'->>'active_round_id' then private.i_bet_you_state((s->'event'->>'id')::uuid) else null end
  ) end from public.get_public_room_state_phase3a(p_room_code)s
$$;

revoke all on function private.clean_team_name(text),private.normalize_team_name(text) from public,anon,authenticated;
