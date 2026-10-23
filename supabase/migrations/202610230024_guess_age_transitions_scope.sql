-- The once-a-second Guess the Age job selected any event in question/suspense, so a live
-- Table of Lies question (which also uses status='question' and question_deadline_at) was
-- moved to suspense, and with a lingering reveal time, to reveal plus Guess the Age scoring.
-- Only events whose active round is Guess the Age are now processed; the body is otherwise unchanged.
create or replace function private.process_guess_age_transitions(p_now timestamptz default clock_timestamp()) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_event public.events; v_count integer := 0;
begin
  for v_event in
    select e.* from public.events e
    join public.event_rounds r on r.id=e.active_round_id and r.game_type='guess_age'
    where (e.status='question' and e.question_deadline_at <= p_now)
       or (e.status='suspense' and e.question_reveal_due_at <= p_now)
    order by coalesce(e.question_deadline_at,e.question_reveal_due_at)
    for update of e skip locked
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

revoke all on function private.process_guess_age_transitions(timestamptz) from public,anon,authenticated;
