create function public.save_guess_age_round(
  p_event_id uuid,
  p_title text,
  p_questions jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_round_id uuid;
  v_item jsonb;
  v_position integer := 0;
  v_question_id uuid;
  v_image_url text;
begin
  if not private.is_event_host(p_event_id) then
    raise exception 'event owner required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 1 and 50 then
    raise exception 'Guess the Age requires between 1 and 50 questions' using errcode = '22023';
  end if;

  select r.id into v_round_id
  from public.event_rounds r
  where r.event_id = p_event_id and r.game_type = 'guess_age'
  order by r.position limit 1;

  if v_round_id is null then
    insert into public.event_rounds(event_id, position, game_type, title, settings)
    values (
      p_event_id,
      coalesce((select max(position) + 1 from public.event_rounds where event_id = p_event_id), 1),
      'guess_age', coalesce(nullif(trim(p_title), ''), 'Guess the Age'),
      jsonb_build_object('duration_seconds', 15)
    ) returning id into v_round_id;
  else
    if exists (
      select 1 from public.submissions s
      join public.questions q on q.id = s.question_id
      where q.round_id = v_round_id
    ) then
      raise exception 'A played Guess the Age round cannot be replaced';
    end if;
    update public.event_rounds
    set title = coalesce(nullif(trim(p_title), ''), 'Guess the Age'),
        settings = jsonb_build_object('duration_seconds', 15)
    where id = v_round_id;
    delete from public.questions where round_id = v_round_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_questions)
  loop
    v_position := v_position + 1;
    if nullif(trim(v_item ->> 'celebrity_name'), '') is null then
      raise exception 'Every question requires a celebrity name' using errcode = '22023';
    end if;
    if nullif(v_item ->> 'date_of_birth', '') is null then
      raise exception 'Every question requires a date of birth' using errcode = '22023';
    end if;
    v_image_url := nullif(trim(v_item ->> 'external_image_url'), '');
    if v_image_url is not null and v_image_url !~ '^https://' then
      v_image_url := null;
    end if;

    insert into public.questions(event_id, round_id, position, celebrity_name, image_kind, external_image_url)
    values (
      p_event_id, v_round_id, v_position, trim(v_item ->> 'celebrity_name'),
      case when v_image_url is null then 'none' else 'external' end,
      v_image_url
    ) returning id into v_question_id;
    insert into public.question_secrets(question_id, date_of_birth)
    values (v_question_id, (v_item ->> 'date_of_birth')::date);
  end loop;

  update public.events
  set active_round_id = v_round_id, active_question_id = null,
      status = case when status = 'draft' then 'lobby' else status end,
      state_version = state_version + 1
  where id = p_event_id;
  perform private.notify_event(p_event_id, (select state_version from public.events where id = p_event_id), 'guess_age_saved');
  return v_round_id;
end;
$$;

create function public.set_event_display(p_event_id uuid, p_status text) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode = '42501'; end if;
  if p_status not in ('lobby', 'ready', 'leaderboard', 'round_complete') then
    raise exception 'invalid display state' using errcode = '22023';
  end if;
  select * into v_event from public.events where id = p_event_id for update;
  update public.events
  set status = p_status,
      question_deadline_at = case when p_status in ('lobby','ready') then null else question_deadline_at end,
      state_version = state_version + 1
  where id = p_event_id returning * into v_event;
  perform private.notify_event(v_event.id, v_event.state_version, 'display_changed');
  return v_event;
end;
$$;

create function public.advance_guess_age_question(p_event_id uuid) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_current public.questions; v_next public.questions;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode = '42501'; end if;
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.active_question_id is null then raise exception 'no active question'; end if;
  if v_event.status not in ('locked','reveal') then raise exception 'question must be locked or revealed before advancing'; end if;
  select q.* into v_current from public.questions q join public.event_rounds r on r.id=q.round_id
  where q.id=v_event.active_question_id and q.event_id=p_event_id and r.game_type='guess_age';
  if not found then raise exception 'active question is not Guess the Age'; end if;
  select * into v_next from public.questions
  where round_id=v_current.round_id and position>v_current.position order by position limit 1;
  update public.events
  set active_question_id = v_next.id,
      status = case when v_next.id is null then 'round_complete' else 'ready' end,
      question_started_at = null, question_deadline_at = null, question_revealed_at = null,
      state_version = state_version + 1
  where id=p_event_id returning * into v_event;
  perform private.notify_event(v_event.id, v_event.state_version, 'question_advanced');
  return v_event;
end;
$$;

create or replace function public.start_question(p_event_id uuid, p_question_id uuid, p_duration_seconds integer) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_question public.questions; v_game_type text; v_now timestamptz := clock_timestamp();
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode = '42501'; end if;
  if p_duration_seconds is null or p_duration_seconds not between 5 and 300 then raise exception 'invalid duration' using errcode = '22023'; end if;
  select * into v_event from public.events where id=p_event_id for update;
  if v_event.status not in ('lobby','ready','locked','reveal','round_complete','leaderboard') then raise exception 'invalid event transition'; end if;
  select q.* into v_question from public.questions q
  where q.id=p_question_id and q.event_id=p_event_id;
  if not found then raise exception 'question does not belong to event'; end if;
  select r.game_type into v_game_type from public.event_rounds r where r.id=v_question.round_id;
  if v_game_type <> 'guess_age' then raise exception 'unsupported game type'; end if;
  update public.events set active_round_id=v_question.round_id,active_question_id=v_question.id,
    status='question',question_started_at=v_now,question_deadline_at=v_now+interval '15 seconds',question_revealed_at=null,
    state_version=state_version+1 where id=p_event_id returning * into v_event;
  perform private.notify_event(v_event.id,v_event.state_version,'question_started'); return v_event;
end;
$$;

create or replace function public.get_public_room_state(p_room_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'server_now', clock_timestamp(),
    'event', jsonb_build_object(
      'id', e.id, 'room_code', e.room_code, 'name', e.name, 'venue', e.venue,
      'event_date', e.event_date, 'status', e.status, 'state_version', e.state_version,
      'active_round_id', e.active_round_id, 'active_question_id', e.active_question_id,
      'question_started_at', e.question_started_at, 'question_deadline_at', e.question_deadline_at,
      'accepting_answers', e.status='question' and e.question_deadline_at > clock_timestamp()
    ),
    'round', case when r.id is null then null else jsonb_build_object(
      'id', r.id, 'position', r.position, 'game_type', r.game_type, 'title', r.title,
      'question_count', (select count(*) from public.questions rq where rq.round_id=r.id)
    ) end,
    'question', case when q.id is null then null else jsonb_build_object(
      'id', q.id, 'position', q.position, 'celebrity_name', q.celebrity_name,
      'image_kind', q.image_kind, 'image_path', q.image_path, 'external_image_url', q.external_image_url,
      'correct_age', case when e.status='reveal' then private.age_on(qs.date_of_birth,e.event_date) else null end
    ) end,
    'answer_count', (select count(*) from public.submissions s where s.event_id=e.id and s.question_id=e.active_question_id),
    'team_count', (select count(*) from public.teams t where t.event_id=e.id and t.status='active'),
    'leaderboard', case when e.status='leaderboard' then (
      select coalesce(jsonb_agg(jsonb_build_object('team_id',x.team_id,'name',x.name,'points',x.points) order by x.points desc,x.name),'[]'::jsonb)
      from (select t.id team_id,t.name,coalesce(sum(sa.points),0)::integer points from public.teams t left join public.score_awards sa on sa.team_id=t.id where t.event_id=e.id and t.status='active' group by t.id,t.name) x
    ) else '[]'::jsonb end
  )
  from public.events e
  left join public.event_rounds r on r.id=e.active_round_id
  left join public.questions q on q.id=e.active_question_id
  left join public.question_secrets qs on qs.question_id=q.id
  where e.room_code=upper(trim(p_room_code)) and e.status<>'ended'
$$;

create or replace function public.get_team_room_state(p_room_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.get_public_room_state(p_room_code) || jsonb_build_object(
    'team', jsonb_build_object('id',t.id,'name',t.name,'status',t.status),
    'submission', case when s.id is null then null else jsonb_build_object('id',s.id,'guess_integer',s.guess_integer,'accepted_at',s.accepted_at) end,
    'award', case when a.id is null then null else jsonb_build_object('points',a.points,'kind',a.kind,'reason',a.reason,'metadata',a.metadata) end
  )
  from public.events e join public.teams t on t.event_id=e.id and t.auth_user_id=auth.uid()
  left join public.submissions s on s.team_id=t.id and s.question_id=e.active_question_id
  left join public.score_awards a on a.team_id=t.id and a.question_id=e.active_question_id and a.kind='game'
  where e.room_code=upper(trim(p_room_code))
$$;

create or replace function public.get_host_event_state(p_event_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'server_now', clock_timestamp(),
    'event', to_jsonb(e),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'name',t.name,'status',t.status,'joined_at',t.joined_at,
      'total',coalesce((select sum(sa.points) from public.score_awards sa where sa.team_id=t.id),0)
    ) order by t.joined_at,t.name) from public.teams t where t.event_id=e.id),'[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'position',r.position,'game_type',r.game_type,'title',r.title,'settings',r.settings,
      'questions',coalesce((select jsonb_agg(jsonb_build_object(
        'id',q.id,'position',q.position,'celebrity_name',q.celebrity_name,'image_kind',q.image_kind,
        'image_path',q.image_path,'external_image_url',q.external_image_url,'date_of_birth',qs.date_of_birth
      ) order by q.position) from public.questions q join public.question_secrets qs on qs.question_id=q.id where q.round_id=r.id),'[]'::jsonb)
    ) order by r.position) from public.event_rounds r where r.event_id=e.id and r.game_type='guess_age'),'[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object(
      'team_id',t.id,'team_name',t.name,'guess_integer',s.guess_integer,'accepted_at',s.accepted_at
    ) order by t.name) from public.teams t left join public.submissions s on s.team_id=t.id and s.question_id=e.active_question_id where t.event_id=e.id and t.status='active'),'[]'::jsonb),
    'awards', coalesce((select jsonb_agg(jsonb_build_object('team_id',a.team_id,'points',a.points,'metadata',a.metadata)) from public.score_awards a where a.event_id=e.id and a.question_id=e.active_question_id and a.kind='game'),'[]'::jsonb),
    'leaderboard', (select coalesce(jsonb_agg(jsonb_build_object('team_id',x.team_id,'name',x.name,'points',x.points) order by x.points desc,x.name),'[]'::jsonb) from (select t.id team_id,t.name,coalesce(sum(sa.points),0)::integer points from public.teams t left join public.score_awards sa on sa.team_id=t.id where t.event_id=e.id and t.status='active' group by t.id,t.name) x)
  ) from public.events e where e.id=p_event_id and private.is_event_host(e.id)
$$;

revoke all on function public.save_guess_age_round(uuid,text,jsonb), public.set_event_display(uuid,text), public.advance_guess_age_question(uuid)
from public, anon, authenticated;
grant execute on function public.save_guess_age_round(uuid,text,jsonb), public.set_event_display(uuid,text), public.advance_guess_age_question(uuid)
to authenticated;
