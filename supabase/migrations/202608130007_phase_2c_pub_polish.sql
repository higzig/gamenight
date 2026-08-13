-- Phase 2C: independent display mode, autonomous Guess the Age transitions,
-- recovery/session controls, and safe question ordering.

alter table public.events add column display_mode text not null default 'join';
alter table public.events add column question_reveal_due_at timestamptz;
alter table public.events add constraint events_display_mode_valid
  check (display_mode in ('join','game','leaderboard'));

alter table public.events drop constraint events_status_valid;
alter table public.events add constraint events_status_valid
  check (status in ('draft','lobby','ready','question','suspense','locked','reveal','leaderboard','round_complete','ended'));

create index events_automatic_transition_idx
  on public.events (status, question_deadline_at, question_reveal_due_at)
  where status in ('question','suspense');

create or replace function public.start_question(p_event_id uuid, p_question_id uuid, p_duration_seconds integer)
returns public.events language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_question public.questions; v_game_type text; v_now timestamptz := clock_timestamp();
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode = '42501'; end if;
  if p_duration_seconds is null or p_duration_seconds not between 5 and 300 then raise exception 'invalid duration' using errcode = '22023'; end if;
  select * into v_event from public.events where id=p_event_id for update;
  if v_event.status not in ('lobby','ready','locked','reveal','round_complete','leaderboard') then raise exception 'invalid event transition'; end if;
  select q.* into v_question from public.questions q where q.id=p_question_id and q.event_id=p_event_id;
  if not found then raise exception 'question does not belong to event'; end if;
  select r.game_type into v_game_type from public.event_rounds r where r.id=v_question.round_id;
  if v_game_type <> 'guess_age' then raise exception 'unsupported game type'; end if;
  update public.events set active_round_id=v_question.round_id,active_question_id=v_question.id,
    status='question',display_mode='game',question_started_at=v_now,
    question_deadline_at=v_now+interval '15 seconds',question_reveal_due_at=v_now+interval '20 seconds',
    question_revealed_at=null,state_version=state_version+1 where id=p_event_id returning * into v_event;
  perform private.notify_event(v_event.id,v_event.state_version,'question_started'); return v_event;
end;
$$;

create function private.process_guess_age_transitions(p_now timestamptz default clock_timestamp()) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_count integer := 0;
begin
  for v_event in
    select e.* from public.events e
    where (e.status='question' and e.question_deadline_at <= p_now)
       or (e.status='suspense' and e.question_reveal_due_at <= p_now)
    order by coalesce(e.question_deadline_at,e.question_reveal_due_at)
    for update skip locked
  loop
    if v_event.status='question' then
      update public.events set status='suspense',state_version=state_version+1
      where id=v_event.id returning * into v_event;
      perform private.notify_event(v_event.id,v_event.state_version,'question_suspense');
    else
      perform private.score_guess_the_age(v_event.id,v_event.active_question_id);
      update public.events set status='reveal',question_revealed_at=coalesce(question_revealed_at,p_now),
        state_version=state_version+1 where id=v_event.id returning * into v_event;
      perform private.notify_event(v_event.id,v_event.state_version,'question_revealed');
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.set_event_display(p_event_id uuid, p_status text) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_mode text;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode = '42501'; end if;
  v_mode := case p_status when 'lobby' then 'join' when 'join' then 'join'
    when 'leaderboard' then 'leaderboard' when 'ready' then 'game'
    when 'round_complete' then 'game' when 'game' then 'game' else null end;
  if v_mode is null then raise exception 'invalid display state' using errcode = '22023'; end if;
  update public.events set display_mode=v_mode,state_version=state_version+1
  where id=p_event_id returning * into v_event;
  perform private.notify_event(v_event.id,v_event.state_version,'display_changed'); return v_event;
end;
$$;

create or replace function public.join_event(p_room_code text, p_team_name text) returns public.teams
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_team public.teams;
begin
  if auth.uid() is null or not private.is_anonymous_user() then raise exception 'anonymous authentication required' using errcode='42501'; end if;
  if nullif(trim(p_team_name),'') is null then raise exception 'team name required' using errcode='22023'; end if;
  select * into v_event from public.events where room_code=upper(trim(p_room_code)) for update;
  if not found or v_event.status='ended' or v_event.display_mode<>'join' then raise exception 'event is not available for joining'; end if;
  select * into v_team from public.teams where event_id=v_event.id and auth_user_id=auth.uid();
  if found then return v_team; end if;
  insert into public.teams(event_id,auth_user_id,name) values(v_event.id,auth.uid(),trim(p_team_name)) returning * into v_team;
  update public.events set state_version=state_version+1 where id=v_event.id returning state_version into v_event.state_version;
  perform private.notify_event(v_event.id,v_event.state_version,'team_joined'); return v_team;
end;
$$;

create function public.restart_guess_age_round(p_event_id uuid) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_round_id uuid; v_first_question uuid;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode='42501'; end if;
  select * into v_event from public.events where id=p_event_id for update;
  select id into v_round_id from public.event_rounds where event_id=p_event_id and game_type='guess_age' order by position limit 1;
  if v_round_id is null then raise exception 'Guess the Age round not found'; end if;
  delete from public.score_awards a using public.questions q
    where a.event_id=p_event_id and a.kind='game' and a.question_id=q.id and q.round_id=v_round_id;
  delete from public.submissions s using public.questions q
    where s.event_id=p_event_id and s.question_id=q.id and q.round_id=v_round_id;
  select id into v_first_question from public.questions where round_id=v_round_id order by position limit 1;
  update public.events set active_round_id=v_round_id,active_question_id=v_first_question,status='ready',display_mode='join',
    question_started_at=null,question_deadline_at=null,question_reveal_due_at=null,question_revealed_at=null,
    state_version=state_version+1 where id=p_event_id returning * into v_event;
  perform private.notify_event(v_event.id,v_event.state_version,'round_restarted'); return v_event;
end;
$$;

create function public.copy_event_session(p_event_id uuid) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_source public.events; v_new public.events; v_old_round public.event_rounds; v_new_round_id uuid; v_q public.questions; v_new_q_id uuid;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode='42501'; end if;
  select * into v_source from public.events where id=p_event_id;
  v_new := public.create_event(v_source.name,v_source.venue,v_source.event_date,v_source.expected_teams);
  update public.events set status='lobby',display_mode='join' where id=v_new.id returning * into v_new;
  for v_old_round in select * from public.event_rounds where event_id=p_event_id and game_type='guess_age' order by position loop
    insert into public.event_rounds(event_id,position,game_type,title,settings)
      values(v_new.id,v_old_round.position,v_old_round.game_type,v_old_round.title,v_old_round.settings) returning id into v_new_round_id;
    for v_q in select * from public.questions where round_id=v_old_round.id order by position loop
      insert into public.questions(event_id,round_id,position,celebrity_name,image_kind,image_path,external_image_url)
        values(v_new.id,v_new_round_id,v_q.position,v_q.celebrity_name,v_q.image_kind,v_q.image_path,v_q.external_image_url) returning id into v_new_q_id;
      insert into public.question_secrets(question_id,date_of_birth)
        select v_new_q_id,date_of_birth from public.question_secrets where question_id=v_q.id;
    end loop;
  end loop;
  update public.events e set active_round_id=r.id,active_question_id=q.id
    from public.event_rounds r left join public.questions q on q.round_id=r.id and q.position=1
    where e.id=v_new.id and r.event_id=v_new.id and r.game_type='guess_age' returning e.* into v_new;
  perform private.notify_event(v_new.id,v_new.state_version,'session_created'); return v_new;
end;
$$;

create function public.reorder_guess_age_question(p_event_id uuid,p_question_id uuid,p_direction integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_question public.questions; v_other public.questions; v_temp integer;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode='42501'; end if;
  if p_direction not in (-1,1) then raise exception 'direction must be -1 or 1' using errcode='22023'; end if;
  perform 1 from public.events where id=p_event_id for update;
  select q.* into v_question from public.questions q join public.event_rounds r on r.id=q.round_id
    where q.id=p_question_id and q.event_id=p_event_id and r.game_type='guess_age';
  if not found then raise exception 'question not found'; end if;
  if exists(select 1 from public.submissions s join public.questions q on q.id=s.question_id where q.round_id=v_question.round_id)
     or (select status from public.events where id=p_event_id) not in ('draft','lobby','ready') then
    raise exception 'played questions cannot be reordered';
  end if;
  select * into v_other from public.questions where round_id=v_question.round_id
    and position=v_question.position+p_direction;
  if not found then return; end if;
  v_temp := 1000000 + v_question.position;
  update public.questions set position=v_temp where id=v_question.id;
  update public.questions set position=v_question.position where id=v_other.id;
  update public.questions set position=v_other.position where id=v_question.id;
  update public.events set state_version=state_version+1 where id=p_event_id;
  perform private.notify_event(p_event_id,(select state_version from public.events where id=p_event_id),'questions_reordered');
end;
$$;

create or replace function public.advance_guess_age_question(p_event_id uuid) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_current public.questions; v_next public.questions;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode='42501'; end if;
  select * into v_event from public.events where id=p_event_id for update;
  if v_event.active_question_id is null or v_event.status<>'reveal' then raise exception 'question must be revealed before advancing'; end if;
  select q.* into v_current from public.questions q join public.event_rounds r on r.id=q.round_id
    where q.id=v_event.active_question_id and q.event_id=p_event_id and r.game_type='guess_age';
  select * into v_next from public.questions where round_id=v_current.round_id and position>v_current.position order by position limit 1;
  update public.events set active_question_id=v_next.id,status=case when v_next.id is null then 'round_complete' else 'ready' end,
    display_mode='game',question_started_at=null,question_deadline_at=null,question_reveal_due_at=null,question_revealed_at=null,
    state_version=state_version+1 where id=p_event_id returning * into v_event;
  perform private.notify_event(v_event.id,v_event.state_version,'question_advanced'); return v_event;
end;
$$;

-- Replace all three hydration functions so display/timing state is available while
-- secrets remain conditional on authoritative reveal state.
create or replace function public.get_public_room_state(p_room_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('server_now',clock_timestamp(),'event',jsonb_build_object(
    'id',e.id,'room_code',e.room_code,'name',e.name,'venue',e.venue,'event_date',e.event_date,
    'status',e.status,'display_mode',e.display_mode,'state_version',e.state_version,
    'active_round_id',e.active_round_id,'active_question_id',e.active_question_id,
    'question_started_at',e.question_started_at,'question_deadline_at',e.question_deadline_at,
    'question_reveal_due_at',e.question_reveal_due_at,
    'accepting_answers',e.status='question' and e.question_deadline_at>clock_timestamp()),
    'round',case when r.id is null then null else jsonb_build_object('id',r.id,'position',r.position,'game_type',r.game_type,'title',r.title,'question_count',(select count(*) from public.questions rq where rq.round_id=r.id)) end,
    'question',case when q.id is null then null else jsonb_build_object('id',q.id,'position',q.position,'celebrity_name',q.celebrity_name,'image_kind',q.image_kind,'image_path',q.image_path,'external_image_url',q.external_image_url,'correct_age',case when e.status='reveal' then private.age_on(qs.date_of_birth,e.event_date) else null end) end,
    'answer_count',(select count(*) from public.submissions s where s.event_id=e.id and s.question_id=e.active_question_id),
    'team_count',(select count(*) from public.teams t where t.event_id=e.id and t.status='active'),
    'leaderboard',case when e.display_mode='leaderboard' then (select coalesce(jsonb_agg(jsonb_build_object('team_id',x.team_id,'name',x.name,'points',x.points) order by x.points desc,x.name),'[]'::jsonb) from (select t.id team_id,t.name,coalesce(sum(sa.points),0)::integer points from public.teams t left join public.score_awards sa on sa.team_id=t.id where t.event_id=e.id and t.status='active' group by t.id,t.name)x) else '[]'::jsonb end)
  from public.events e left join public.event_rounds r on r.id=e.active_round_id left join public.questions q on q.id=e.active_question_id left join public.question_secrets qs on qs.question_id=q.id
  where e.room_code=upper(trim(p_room_code)) and e.status<>'ended'
$$;

create or replace function public.get_host_event_state(p_event_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('server_now',clock_timestamp(),'event',to_jsonb(e),
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'joined_at',t.joined_at,'total',coalesce((select sum(sa.points) from public.score_awards sa where sa.team_id=t.id),0)) order by t.joined_at,t.name) from public.teams t where t.event_id=e.id),'[]'::jsonb),
    'rounds',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'position',r.position,'game_type',r.game_type,'title',r.title,'settings',r.settings,'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'position',q.position,'celebrity_name',q.celebrity_name,'image_kind',q.image_kind,'image_path',q.image_path,'external_image_url',q.external_image_url,'date_of_birth',qs.date_of_birth) order by q.position) from public.questions q join public.question_secrets qs on qs.question_id=q.id where q.round_id=r.id),'[]'::jsonb)) order by r.position) from public.event_rounds r where r.event_id=e.id and r.game_type='guess_age'),'[]'::jsonb),
    'submissions',coalesce((select jsonb_agg(jsonb_build_object('team_id',t.id,'team_name',t.name,'guess_integer',s.guess_integer,'accepted_at',s.accepted_at) order by t.name) from public.teams t left join public.submissions s on s.team_id=t.id and s.question_id=e.active_question_id where t.event_id=e.id and t.status='active'),'[]'::jsonb),
    'awards',coalesce((select jsonb_agg(jsonb_build_object('team_id',a.team_id,'points',a.points,'metadata',a.metadata)) from public.score_awards a where a.event_id=e.id and a.question_id=e.active_question_id and a.kind='game'),'[]'::jsonb),
    'leaderboard',(select coalesce(jsonb_agg(jsonb_build_object('team_id',x.team_id,'name',x.name,'points',x.points) order by x.points desc,x.name),'[]'::jsonb) from(select t.id team_id,t.name,coalesce(sum(sa.points),0)::integer points from public.teams t left join public.score_awards sa on sa.team_id=t.id where t.event_id=e.id and t.status='active' group by t.id,t.name)x))
  from public.events e where e.id=p_event_id and private.is_event_host(e.id)
$$;

revoke all on function private.process_guess_age_transitions(timestamptz) from public,anon,authenticated;
revoke all on function public.restart_guess_age_round(uuid),public.copy_event_session(uuid),public.reorder_guess_age_question(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.restart_guess_age_round(uuid),public.copy_event_session(uuid),public.reorder_guess_age_question(uuid,uuid,integer) to authenticated;

create extension if not exists pg_cron;
select cron.schedule('gamenight-guess-age-transitions','1 second',$$select private.process_guess_age_transitions()$$);
