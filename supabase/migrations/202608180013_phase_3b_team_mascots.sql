-- Phase 3B: curated Team mascots and safely shaped Guess the Age presentation data.

alter table public.teams add column mascot_id text;
alter table public.teams add constraint teams_mascot_catalogue check(mascot_id is null or mascot_id in(
  'frog','fox','bear','shark','octopus','dinosaur','ghost','robot','alien','rocket','crown','wizard','dragon','cat','dog','penguin',
  'monkey','tiger','lion','owl','bee','snake','unicorn','skull','lightning','flame','star','planet','gamepad','dice','pizza','burger'
));
create unique index teams_event_active_mascot_unique on public.teams(event_id,mascot_id) where status='active' and mascot_id is not null;

drop function public.join_event(text,text);
create function public.join_event(p_room_code text,p_team_name text,p_mascot_id text) returns public.teams
language plpgsql security definer set search_path='' as $$
declare v_event public.events;v_team public.teams;
begin
  if auth.uid() is null or not private.is_anonymous_user() then raise exception 'anonymous authentication required' using errcode='42501';end if;
  if p_mascot_id is null or p_mascot_id not in('frog','fox','bear','shark','octopus','dinosaur','ghost','robot','alien','rocket','crown','wizard','dragon','cat','dog','penguin','monkey','tiger','lion','owl','bee','snake','unicorn','skull','lightning','flame','star','planet','gamepad','dice','pizza','burger') then raise exception 'choose a valid mascot' using errcode='22023';end if;
  select * into v_event from public.events where room_code=upper(trim(p_room_code)) for update;
  if not found or v_event.status not in('lobby','ready') then raise exception 'event is not available for joining';end if;
  select * into v_team from public.teams where event_id=v_event.id and auth_user_id=auth.uid();
  if found then
    if v_team.mascot_id is null then
      begin update public.teams set mascot_id=p_mascot_id,updated_at=now() where id=v_team.id returning * into v_team;
      exception when unique_violation then raise exception 'that mascot was just taken' using errcode='23505';end;
      update public.events set state_version=state_version+1 where id=v_event.id returning state_version into v_event.state_version;
      perform private.notify_event(v_event.id,v_event.state_version,'team_mascot_selected');
    end if;
    return v_team;
  end if;
  begin
    insert into public.teams(event_id,auth_user_id,name,mascot_id) values(v_event.id,auth.uid(),trim(p_team_name),p_mascot_id) returning * into v_team;
  exception when unique_violation then
    if exists(select 1 from public.teams where event_id=v_event.id and status='active' and mascot_id=p_mascot_id) then raise exception 'that mascot was just taken' using errcode='23505';end if;
    raise;
  end;
  update public.events set state_version=state_version+1 where id=v_event.id returning state_version into v_event.state_version;
  perform private.notify_event(v_event.id,v_event.state_version,'team_joined');
  return v_team;
end;
$$;
revoke all on function public.join_event(text,text,text) from public,anon,authenticated;
grant execute on function public.join_event(text,text,text) to authenticated;

create function public.set_team_mascot(p_team_id uuid,p_mascot_id text) returns public.teams
language plpgsql security definer set search_path='' as $$
declare v_team public.teams;v_event public.events;
begin
  if p_mascot_id is null or p_mascot_id not in('frog','fox','bear','shark','octopus','dinosaur','ghost','robot','alien','rocket','crown','wizard','dragon','cat','dog','penguin','monkey','tiger','lion','owl','bee','snake','unicorn','skull','lightning','flame','star','planet','gamepad','dice','pizza','burger') then raise exception 'choose a valid mascot' using errcode='22023';end if;
  select * into v_team from public.teams where id=p_team_id and auth_user_id=auth.uid() and status='active';
  if not found then raise exception 'team ownership required' using errcode='42501';end if;
  select * into v_event from public.events where id=v_team.event_id for update;
  if v_event.status not in('lobby','ready') then raise exception 'mascot changes are locked during gameplay';end if;
  begin update public.teams set mascot_id=p_mascot_id,updated_at=now() where id=p_team_id returning * into v_team;
  exception when unique_violation then raise exception 'that mascot was just taken' using errcode='23505';end;
  update public.events set state_version=state_version+1 where id=v_event.id returning state_version into v_event.state_version;
  perform private.notify_event(v_event.id,v_event.state_version,'team_mascot_changed');
  return v_team;
end;
$$;
revoke all on function public.set_team_mascot(uuid,text) from public,anon,authenticated;
grant execute on function public.set_team_mascot(uuid,text) to authenticated;

-- Add mascots to persisted I Bet You membership hydration without changing mechanics.
create or replace function private.i_bet_you_state(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when rs.round_id is null then null else jsonb_build_object(
    'round',jsonb_build_object('id',r.id,'title',r.title,'position',r.position,'game_type',r.game_type,'status',rs.status,'active_group_id',rs.active_group_id),
    'groups',coalesce((select jsonb_agg(jsonb_build_object(
      'id',g.id,'position',g.position,'state',g.state,
      'category',jsonb_build_object('id',c.id,'title',c.title,'difficulty',c.difficulty,'type',c.category_type),
      'members',coalesce((select jsonb_agg(jsonb_build_object('team_id',t.id,'name',t.name,'mascot_id',t.mascot_id,'position',m.position) order by m.position) from public.i_bet_you_group_members m join public.teams t on t.id=m.team_id where m.group_id=g.id),'[]'::jsonb),
      'current_bidder_team_id',g.current_bidder_team_id,'current_bid',g.current_bid,
      'challenged_bidder_team_id',g.challenged_bidder_team_id,'challenger_team_id',g.challenger_team_id,'target_bid',g.target_bid,
      'countdown_started_at',g.countdown_started_at,'countdown_deadline_at',g.countdown_deadline_at,
      'result',g.result,'winning_team_id',g.winning_team_id,'completed_at',g.completed_at
    ) order by g.position) from public.i_bet_you_groups g join public.i_bet_you_categories c on c.id=g.category_id where g.round_id=r.id),'[]'::jsonb)
  ) end
  from public.event_rounds r join public.i_bet_you_round_states rs on rs.round_id=r.id
  where r.event_id=p_event_id and r.game_type='i_bet_you' order by r.position limit 1
$$;

alter function public.get_public_room_state(text) rename to get_public_room_state_phase3a;
create function public.get_public_room_state(p_room_code text) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when s is null then null else s||jsonb_build_object(
    'taken_mascot_ids',coalesce((select jsonb_agg(t.mascot_id order by t.mascot_id) from public.teams t where t.event_id=(s->'event'->>'id')::uuid and t.status='active' and t.mascot_id is not null),'[]'::jsonb),
    'guess_markers',case
      when s->'event'->>'status'='reveal' then coalesce((select jsonb_agg(jsonb_build_object(
        'team_id',t.id,'team_name',t.name,'mascot_id',t.mascot_id,'guess',sub.guess_integer,
        'signed_difference',sub.guess_integer-(s->'question'->>'correct_age')::integer,
        'points',coalesce(a.points,0)
      ) order by sub.guess_integer,t.name) from public.submissions sub join public.teams t on t.id=sub.team_id left join public.score_awards a on a.question_id=sub.question_id and a.team_id=t.id and a.kind='game' where sub.event_id=(s->'event'->>'id')::uuid and sub.question_id=(s->'event'->>'active_question_id')::uuid),'[]'::jsonb)
      when s->'event'->>'status' in('question','locked','suspense') then coalesce((select jsonb_agg(jsonb_build_object('mascot_id',t.mascot_id,'guess',sub.guess_integer) order by sub.accepted_at) from public.submissions sub join public.teams t on t.id=sub.team_id where sub.event_id=(s->'event'->>'id')::uuid and sub.question_id=(s->'event'->>'active_question_id')::uuid),'[]'::jsonb)
      else '[]'::jsonb end,
    'leaderboard',case when s->'event'->>'display_mode'='leaderboard' then (select coalesce(jsonb_agg(jsonb_build_object('team_id',x.team_id,'name',x.name,'mascot_id',x.mascot_id,'points',x.points) order by x.points desc,x.name),'[]'::jsonb) from(select t.id team_id,t.name,t.mascot_id,coalesce(sum(sa.points),0)::integer points from public.teams t left join public.score_awards sa on sa.team_id=t.id where t.event_id=(s->'event'->>'id')::uuid and t.status='active' group by t.id,t.name,t.mascot_id)x) else '[]'::jsonb end,
    'i_bet_you',case when private.i_bet_you_state((s->'event'->>'id')::uuid)->'round'->>'id'=s->'event'->>'active_round_id' then private.i_bet_you_state((s->'event'->>'id')::uuid) else null end
  ) end from public.get_public_room_state_phase3a(p_room_code)s
$$;

create or replace function public.get_team_room_state(p_room_code text) returns jsonb
language sql stable security definer set search_path='' as $$
  select public.get_public_room_state(p_room_code)||jsonb_build_object(
    'team',jsonb_build_object('id',t.id,'name',t.name,'mascot_id',t.mascot_id,'status',t.status),
    'submission',case when sub.id is null then null else jsonb_build_object('id',sub.id,'guess_integer',sub.guess_integer,'accepted_at',sub.accepted_at) end,
    'award',case when a.id is null then null else jsonb_build_object('points',a.points,'kind',a.kind,'reason',a.reason,'metadata',a.metadata) end
  ) from public.events e join public.teams t on t.event_id=e.id and t.auth_user_id=auth.uid()
  left join public.submissions sub on sub.team_id=t.id and sub.question_id=e.active_question_id
  left join public.score_awards a on a.team_id=t.id and a.question_id=e.active_question_id and a.kind='game'
  where e.room_code=upper(trim(p_room_code))
$$;

alter function public.get_host_event_state(uuid) rename to get_host_event_state_phase3a;
create function public.get_host_event_state(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when s is null then null else s||jsonb_build_object(
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'mascot_id',t.mascot_id,'status',t.status,'joined_at',t.joined_at,'total',coalesce((select sum(sa.points) from public.score_awards sa where sa.team_id=t.id),0)) order by t.joined_at,t.name) from public.teams t where t.event_id=p_event_id),'[]'::jsonb),
    'submissions',coalesce((select jsonb_agg(jsonb_build_object('team_id',t.id,'team_name',t.name,'mascot_id',t.mascot_id,'guess_integer',sub.guess_integer,'accepted_at',sub.accepted_at) order by t.name) from public.teams t left join public.submissions sub on sub.team_id=t.id and sub.question_id=(s->'event'->>'active_question_id')::uuid where t.event_id=p_event_id and t.status='active'),'[]'::jsonb),
    'leaderboard',(select coalesce(jsonb_agg(jsonb_build_object('team_id',x.team_id,'name',x.name,'mascot_id',x.mascot_id,'points',x.points) order by x.points desc,x.name),'[]'::jsonb) from(select t.id team_id,t.name,t.mascot_id,coalesce(sum(sa.points),0)::integer points from public.teams t left join public.score_awards sa on sa.team_id=t.id where t.event_id=p_event_id and t.status='active' group by t.id,t.name,t.mascot_id)x),
    'i_bet_you',private.i_bet_you_state(p_event_id)
  ) end from public.get_host_event_state_phase3a(p_event_id)s
$$;

revoke all on function public.get_public_room_state_phase3a(text),public.get_host_event_state_phase3a(uuid) from public,anon,authenticated;
revoke all on function public.get_public_room_state(text),public.get_team_room_state(text),public.get_host_event_state(uuid) from public,anon,authenticated;
grant execute on function public.get_public_room_state(text),public.get_team_room_state(text),public.get_host_event_state(uuid) to authenticated;
