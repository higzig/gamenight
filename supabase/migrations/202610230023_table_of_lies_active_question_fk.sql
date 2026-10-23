-- events.active_question_id is a deferred FK to Guess the Age questions only.
-- Table of Lies tracks its question in perfect_lie_round_states.active_question_id,
-- so writing a perfect_lie_questions id here failed every Table of Lies commit (23503).
-- Bodies below are unchanged except that Table of Lies now leaves the column null.
-- The pause migration wraps these RPCs, so the inner *_before_pause functions are replaced.

create or replace function public.start_perfect_lie_question_before_pause(p_event_id uuid,p_question_id uuid,p_duration_seconds integer default 20) returns void
language plpgsql security definer set search_path='' as $$
declare q public.perfect_lie_questions;s public.perfect_lie_round_states;v_now timestamptz;
begin
  if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
  if p_duration_seconds not between 5 and 120 then raise exception 'invalid duration';end if;
  select * into q from public.perfect_lie_questions where id=p_question_id and event_id=p_event_id;
  if not found then raise exception 'question not found';end if;
  select * into s from public.perfect_lie_round_states where round_id=q.round_id for update;
  if not found or s.phase not in('ready','category_transition')or s.active_question_id is distinct from q.id then
    raise exception 'question must be prepared before it can start' using errcode='55000';
  end if;
  if exists(select 1 from public.perfect_lie_responses where question_id=q.id)
    or exists(select 1 from public.score_awards where metadata->>'game_type'='perfect_lie'and metadata->>'perfect_lie_question_id'=q.id::text)then
    raise exception 'question has already been played; replay requires an explicit reset' using errcode='55000';
  end if;
  v_now:=clock_timestamp();
  update public.perfect_lie_round_states set phase='writing',knowledge_deadline_at=v_now+make_interval(secs=>p_duration_seconds),reveal_index=0 where round_id=q.round_id;
  update public.events set active_round_id=q.round_id,active_question_id=null,status='question',question_started_at=v_now,question_deadline_at=v_now+make_interval(secs=>p_duration_seconds),question_revealed_at=null where id=p_event_id;
  perform private.notify_perfect_lie(p_event_id,'perfect_lie_question_started');
end;$$;

create or replace function public.advance_perfect_lie_question_before_pause(p_event_id uuid,p_question_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare s public.perfect_lie_round_states;q public.perfect_lie_questions;nextq public.perfect_lie_questions;
begin
  if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
  select * into s from public.perfect_lie_round_states where event_id=p_event_id for update;
  if not found then raise exception 'Table of Lies round not found';end if;
  select * into q from public.perfect_lie_questions where id=s.active_question_id;
  if s.phase in('ready','category_transition')then
    if p_question_id is null then raise exception 'choose a prepared question' using errcode='55000';end if;
    select * into nextq from public.perfect_lie_questions where id=p_question_id and event_id=p_event_id and round_id=s.round_id;
    if not found then raise exception 'question not found';end if;
    if exists(select 1 from public.perfect_lie_responses where question_id=nextq.id)
      or exists(select 1 from public.score_awards where metadata->>'game_type'='perfect_lie'and metadata->>'perfect_lie_question_id'=nextq.id::text)then
      raise exception 'question has already been played' using errcode='55000';
    end if;
    update public.perfect_lie_round_states set active_question_id=nextq.id,
      phase=case when q.id is not null and nextq.category_id<>q.category_id then'category_transition'else'ready'end,reveal_index=0
      where round_id=s.round_id;
    update public.events set active_round_id=s.round_id,active_question_id=null,status='ready',question_started_at=null,question_deadline_at=null,question_revealed_at=null where id=p_event_id;
  elsif s.phase='question_complete'then
    if p_question_id is not null then raise exception 'completed questions advance in prepared order' using errcode='55000';end if;
    select nq.* into nextq from public.perfect_lie_questions nq
      join public.perfect_lie_categories nc on nc.id=nq.category_id
      join public.perfect_lie_categories cc on cc.id=q.category_id
      where nq.round_id=s.round_id and(nc.position,nq.position)>(cc.position,q.position)
      order by nc.position,nq.position limit 1;
    if nextq.id is null then
      update public.perfect_lie_round_states set phase='complete',active_question_id=null,reveal_index=0 where round_id=s.round_id;
      update public.events set status='round_complete',active_question_id=null,question_started_at=null,question_deadline_at=null,question_revealed_at=null where id=p_event_id;
    else
      update public.perfect_lie_round_states set active_question_id=nextq.id,
        phase=case when nextq.category_id<>q.category_id then'category_transition'else'ready'end,reveal_index=0 where round_id=s.round_id;
      update public.events set active_question_id=null,status='ready',question_started_at=null,question_deadline_at=null,question_revealed_at=null where id=p_event_id;
    end if;
  else
    raise exception 'active question must be completed before changing questions' using errcode='55000';
  end if;
  perform private.notify_perfect_lie(p_event_id,'perfect_lie_question_selected');
end;$$;

create or replace function public.select_hosted_game(p_event_id uuid,p_round_id uuid) returns public.events
language plpgsql security definer set search_path='' as $$
declare e public.events;r public.event_rounds;q uuid;
begin
 if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
 select * into e from public.events where id=p_event_id for update;
 if e.status='ended'then raise exception 'event ended';end if;
 select * into r from public.event_rounds where id=p_round_id and event_id=p_event_id;
 if not found or r.game_type not in('guess_age','perfect_lie','i_bet_you','no_context')then raise exception 'game not found';end if;
 if e.active_round_id=p_round_id then
  -- Initialize a saved-but-unstarted Guess the Age lineup; every other reselection
  -- is idempotent, including completion and the explicit paused holding screen.
  if exists(select 1 from private.game_checkpoints where round_id=p_round_id and state='paused')
    or not(r.game_type='guess_age' and(e.status in('draft','lobby')or(e.status='ready'and e.active_question_id is null)))then return e;end if;
 end if;
 -- Only Guess the Age questions may occupy events.active_question_id.
 if r.game_type='guess_age'then select id into q from public.questions where round_id=r.id order by position limit 1;end if;
 update public.events set active_round_id=r.id,active_question_id=q,status='ready',display_mode='game',question_started_at=null,question_deadline_at=null,question_reveal_due_at=null,question_revealed_at=null,state_version=state_version+1 where id=e.id returning * into e;
 perform private.notify_event(e.id,e.state_version,'game_selected');return e;
end $$;
