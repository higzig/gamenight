-- Released hotfix: a question must be explicitly prepared before it can start.
create or replace function public.start_perfect_lie_question(p_event_id uuid,p_question_id uuid,p_duration_seconds integer default 20) returns void
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
  update public.events set active_round_id=q.round_id,active_question_id=q.id,status='question',question_started_at=v_now,question_deadline_at=v_now+make_interval(secs=>p_duration_seconds),question_revealed_at=null where id=p_event_id;
  perform private.notify_perfect_lie(p_event_id,'perfect_lie_question_started');
end;$$;

revoke all on function public.start_perfect_lie_question(uuid,uuid,integer)from public,anon,authenticated;
grant execute on function public.start_perfect_lie_question(uuid,uuid,integer)to authenticated;
