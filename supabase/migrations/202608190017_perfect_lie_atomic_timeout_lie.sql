create or replace function public.submit_perfect_lie_lie(p_team_id uuid,p_question_id uuid,p_lie text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.teams;s public.perfect_lie_round_states;v_clean text;v_normalized text;existing_lie public.perfect_lie_lies;
begin
  if not private.owns_team(p_team_id)then raise exception 'Team ownership required' using errcode='42501';end if;
  select * into t from public.teams where id=p_team_id;
  select rs.* into s from public.perfect_lie_round_states rs join public.perfect_lie_questions q on q.round_id=rs.round_id
  where q.id=p_question_id and q.event_id=t.event_id and rs.active_question_id=q.id;
  if not found or s.phase<>'writing'then raise exception 'Lie submissions have closed.' using errcode='55000';end if;
  v_clean:=trim(p_lie);v_normalized:=private.normalize_perfect_lie_answer(v_clean);
  if char_length(v_clean)not between 1 and 500 then raise exception 'Write a believable lie.' using errcode='22023';end if;
  select * into existing_lie from public.perfect_lie_lies where question_id=p_question_id and team_id=t.id;
  if found then
    if existing_lie.normalized_lie=v_normalized then return;end if;
    raise exception 'Someone else beat you to that one. Try another lie.' using errcode='23505';
  end if;
  if not exists(select 1 from public.perfect_lie_responses where question_id=p_question_id and team_id=t.id)then
    if clock_timestamp()<=s.knowledge_deadline_at then raise exception 'Submit your answer attempt first.' using errcode='55000';end if;
    insert into public.perfect_lie_responses(event_id,question_id,team_id,initial_answer,normalized_answer,knew_truth,timed_out)
    values(t.event_id,p_question_id,t.id,null,null,false,true) on conflict(question_id,team_id)do nothing;
  end if;
  if private.perfect_lie_matches_truth(p_question_id,v_clean)then raise exception 'That’s the real answer — you need a lie.' using errcode='22023';end if;
  if exists(select 1 from public.perfect_lie_lies where question_id=p_question_id and normalized_lie=v_normalized)then
    raise exception 'Someone else beat you to that one. Try another lie.' using errcode='23505';
  end if;
  insert into public.perfect_lie_lies(event_id,question_id,team_id,lie_text,normalized_lie)
  values(t.event_id,p_question_id,t.id,v_clean,v_normalized);
  perform private.notify_perfect_lie(t.event_id,'perfect_lie_lie_submitted');
end;$$;

revoke all on function public.submit_perfect_lie_lie(uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.submit_perfect_lie_lie(uuid,uuid,text)to authenticated;
