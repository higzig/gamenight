create function private.is_anonymous_user() returns boolean
language sql stable security invoker set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

create function private.is_event_host(p_event_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.is_anonymous_user()
    and exists (select 1 from public.events e where e.id = p_event_id and e.host_id = auth.uid())
$$;

create function private.owns_team(p_team_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.teams t where t.id = p_team_id and t.auth_user_id = auth.uid() and t.status = 'active')
$$;

create function private.can_receive_public_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (select 1 from public.events e where e.id = p_event_id and e.status <> 'ended')
$$;

create function private.can_receive_team_topic(p_event_id uuid, p_team_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_event_host(p_event_id) or exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.event_id = p_event_id
      and t.auth_user_id = auth.uid() and t.status = 'active'
  )
$$;

create function private.age_on(p_dob date, p_on_date date) returns integer
language sql immutable strict security invoker set search_path = '' as $$
  select (extract(year from p_on_date) - extract(year from p_dob))::integer
    - case when
        (extract(month from p_on_date), extract(day from p_on_date))
          < (extract(month from p_dob), extract(day from p_dob))
      then 1 else 0 end
$$;

create function private.points_for_age_difference(p_difference integer) returns integer
language sql immutable strict security invoker set search_path = '' as $$
  select case
    when p_difference = 0 then 10 when p_difference = 1 then 8
    when p_difference = 2 then 6 when p_difference = 3 then 5
    when p_difference <= 5 then 3 when p_difference <= 10 then 1 else 0 end
$$;

create function private.random_room_code() returns text
language sql volatile security invoker set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::integer, 1), '')
  from generate_series(1, 6)
$$;

create function private.notify_event(p_event_id uuid, p_version bigint, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('event_id', p_event_id, 'version', p_version, 'reason', p_reason),
    'state_changed', 'event:' || p_event_id::text || ':public', true
  );
end;
$$;

create function public.create_event(
  p_name text, p_venue text, p_event_date date, p_expected_teams smallint default 12
) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_code text; v_attempt integer := 0;
begin
  if auth.uid() is null or private.is_anonymous_user() then raise exception 'host authentication required' using errcode = '42501'; end if;
  insert into public.profiles(id) values (auth.uid()) on conflict (id) do nothing;
  loop
    v_attempt := v_attempt + 1; v_code := private.random_room_code();
    begin
      insert into public.events(host_id, room_code, name, venue, event_date, expected_teams)
      values (auth.uid(), v_code, trim(p_name), coalesce(trim(p_venue), ''), p_event_date, p_expected_teams)
      returning * into v_event;
      exit;
    exception when unique_violation then if v_attempt >= 10 then raise; end if;
    end;
  end loop;
  return v_event;
end;
$$;

create function public.join_event(p_room_code text, p_team_name text) returns public.teams
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_team public.teams;
begin
  if auth.uid() is null or not private.is_anonymous_user() then raise exception 'anonymous authentication required' using errcode = '42501'; end if;
  select * into v_event from public.events where room_code = upper(trim(p_room_code)) for update;
  if not found or v_event.status not in ('lobby','ready') then raise exception 'event is not available for joining'; end if;
  select * into v_team from public.teams where event_id = v_event.id and auth_user_id = auth.uid();
  if found then return v_team; end if;
  insert into public.teams(event_id, auth_user_id, name) values (v_event.id, auth.uid(), trim(p_team_name)) returning * into v_team;
  update public.events set state_version = state_version + 1 where id = v_event.id returning state_version into v_event.state_version;
  perform private.notify_event(v_event.id, v_event.state_version, 'team_joined');
  return v_team;
end;
$$;

create function public.submit_guess(p_team_id uuid, p_question_id uuid, p_guess integer) returns public.submissions
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_team public.teams; v_submission public.submissions;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_guess is null or p_guess < 1 or p_guess > 120 then raise exception 'guess must be an integer from 1 to 120' using errcode = '22023'; end if;
  select * into v_team from public.teams where id = p_team_id and auth_user_id = auth.uid() and status = 'active';
  if not found then raise exception 'team ownership required' using errcode = '42501'; end if;
  select * into v_event from public.events where id = v_team.event_id for update;
  if v_event.status <> 'question' or v_event.active_question_id is distinct from p_question_id then raise exception 'question is not accepting answers'; end if;
  if v_event.question_deadline_at is null or clock_timestamp() > v_event.question_deadline_at then raise exception 'answer deadline has passed'; end if;
  insert into public.submissions(event_id, question_id, team_id, guess_integer)
  values (v_event.id, p_question_id, p_team_id, p_guess) returning * into v_submission;
  update public.events set state_version = state_version + 1 where id = v_event.id returning state_version into v_event.state_version;
  perform private.notify_event(v_event.id, v_event.state_version, 'submission_accepted');
  return v_submission;
exception when unique_violation then raise exception 'a submission has already been accepted for this question' using errcode = '23505';
end;
$$;

create function public.start_question(p_event_id uuid, p_question_id uuid, p_duration_seconds integer) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_question public.questions; v_now timestamptz := clock_timestamp();
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode = '42501'; end if;
  if p_duration_seconds not between 5 and 300 then raise exception 'invalid duration' using errcode = '22023'; end if;
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.status not in ('lobby','ready','locked','reveal','round_complete','leaderboard') then raise exception 'invalid event transition'; end if;
  select * into v_question from public.questions where id = p_question_id and event_id = p_event_id;
  if not found then raise exception 'question does not belong to event'; end if;
  update public.events set active_round_id = v_question.round_id, active_question_id = v_question.id,
    status = 'question', question_started_at = v_now,
    question_deadline_at = v_now + make_interval(secs => p_duration_seconds), question_revealed_at = null,
    state_version = state_version + 1 where id = p_event_id returning * into v_event;
  perform private.notify_event(v_event.id, v_event.state_version, 'question_started'); return v_event;
end;
$$;

create function public.lock_question(p_event_id uuid) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode = '42501'; end if;
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.status <> 'question' then raise exception 'question is not open'; end if;
  update public.events set status = 'locked', question_deadline_at = least(question_deadline_at, clock_timestamp()), state_version = state_version + 1
  where id = p_event_id returning * into v_event;
  perform private.notify_event(v_event.id, v_event.state_version, 'question_locked'); return v_event;
end;
$$;

create function private.score_guess_the_age(p_event_id uuid, p_question_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_inserted integer;
begin
  insert into public.score_awards(event_id, team_id, question_id, points, kind, reason, created_by, metadata)
  select s.event_id, s.team_id, s.question_id,
    private.points_for_age_difference(abs(s.guess_integer - private.age_on(qs.date_of_birth, e.event_date))),
    'game', 'Guess the Age result', auth.uid(),
    jsonb_build_object('guess', s.guess_integer, 'correct_age', private.age_on(qs.date_of_birth, e.event_date), 'difference', abs(s.guess_integer - private.age_on(qs.date_of_birth, e.event_date)))
  from public.submissions s
  join public.events e on e.id = s.event_id
  join public.question_secrets qs on qs.question_id = s.question_id
  where s.event_id = p_event_id and s.question_id = p_question_id
  on conflict (question_id, team_id) where kind = 'game' do nothing;
  get diagnostics v_inserted = row_count; return v_inserted;
end;
$$;

create function public.reveal_question(p_event_id uuid) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode = '42501'; end if;
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.status not in ('question','locked','reveal') or v_event.active_question_id is null then raise exception 'no question can be revealed'; end if;
  perform private.score_guess_the_age(v_event.id, v_event.active_question_id);
  update public.events set status = 'reveal', question_deadline_at = least(question_deadline_at, clock_timestamp()),
    question_revealed_at = coalesce(question_revealed_at, clock_timestamp()), state_version = state_version + 1
  where id = p_event_id returning * into v_event;
  perform private.notify_event(v_event.id, v_event.state_version, 'question_revealed'); return v_event;
end;
$$;

create function public.add_manual_score_correction(p_event_id uuid, p_team_id uuid, p_points integer, p_reason text) returns public.score_awards
language plpgsql security definer set search_path = '' as $$
declare v_award public.score_awards; v_version bigint;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode = '42501'; end if;
  if p_points = 0 or nullif(trim(p_reason), '') is null then raise exception 'non-zero points and reason required' using errcode = '22023'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and event_id = p_event_id) then raise exception 'team does not belong to event'; end if;
  insert into public.score_awards(event_id, team_id, points, kind, reason, created_by)
  values (p_event_id, p_team_id, p_points, 'manual_correction', trim(p_reason), auth.uid()) returning * into v_award;
  update public.events set state_version = state_version + 1 where id = p_event_id returning state_version into v_version;
  perform private.notify_event(p_event_id, v_version, 'score_corrected'); return v_award;
end;
$$;

create function public.get_public_room_state(p_room_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'room_code', e.room_code, 'name', e.name, 'venue', e.venue, 'event_date', e.event_date, 'status', e.status, 'state_version', e.state_version, 'active_round_id', e.active_round_id, 'active_question_id', e.active_question_id, 'question_started_at', e.question_started_at, 'question_deadline_at', e.question_deadline_at),
    'round', case when r.id is null then null else jsonb_build_object('id', r.id, 'position', r.position, 'game_type', r.game_type, 'title', r.title) end,
    'question', case when q.id is null then null else jsonb_build_object('id', q.id, 'position', q.position, 'celebrity_name', q.celebrity_name, 'image_kind', q.image_kind, 'image_path', q.image_path, 'external_image_url', q.external_image_url, 'correct_age', case when e.status = 'reveal' then private.age_on(qs.date_of_birth, e.event_date) else null end) end,
    'answer_count', (select count(*) from public.submissions s where s.event_id = e.id and s.question_id = e.active_question_id),
    'leaderboard', (select coalesce(jsonb_agg(jsonb_build_object('team_id', x.team_id, 'name', x.name, 'points', x.points) order by x.points desc, x.name), '[]'::jsonb) from (select t.id team_id, t.name, coalesce(sum(sa.points),0)::integer points from public.teams t left join public.score_awards sa on sa.team_id=t.id where t.event_id=e.id and t.status='active' group by t.id,t.name) x)
  )
  from public.events e
  left join public.event_rounds r on r.id = e.active_round_id
  left join public.questions q on q.id = e.active_question_id
  left join public.question_secrets qs on qs.question_id = q.id
  where e.room_code = upper(trim(p_room_code)) and e.status <> 'ended'
$$;

create function public.get_team_room_state(p_room_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.get_public_room_state(p_room_code) || jsonb_build_object(
    'team', jsonb_build_object('id', t.id, 'name', t.name, 'status', t.status),
    'submission', case when s.id is null then null else jsonb_build_object('id', s.id, 'guess_integer', s.guess_integer, 'accepted_at', s.accepted_at) end,
    'award', case when a.id is null then null else jsonb_build_object('points', a.points, 'kind', a.kind, 'reason', a.reason, 'metadata', a.metadata) end
  )
  from public.events e join public.teams t on t.event_id=e.id and t.auth_user_id=auth.uid()
  left join public.submissions s on s.team_id=t.id and s.question_id=e.active_question_id
  left join public.score_awards a on a.team_id=t.id and a.question_id=e.active_question_id and a.kind='game'
  where e.room_code=upper(trim(p_room_code))
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_anonymous_user(), private.is_event_host(uuid), private.owns_team(uuid), private.can_receive_public_event(uuid), private.can_receive_team_topic(uuid,uuid) to authenticated;
revoke all on function public.create_event(text,text,date,smallint), public.join_event(text,text), public.submit_guess(uuid,uuid,integer), public.start_question(uuid,uuid,integer), public.lock_question(uuid), public.reveal_question(uuid), public.add_manual_score_correction(uuid,uuid,integer,text), public.get_public_room_state(text), public.get_team_room_state(text) from public, anon, authenticated;
grant execute on function public.create_event(text,text,date,smallint), public.join_event(text,text), public.submit_guess(uuid,uuid,integer), public.start_question(uuid,uuid,integer), public.lock_question(uuid), public.reveal_question(uuid), public.add_manual_score_correction(uuid,uuid,integer,text), public.get_public_room_state(text), public.get_team_room_state(text) to authenticated;
