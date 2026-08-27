-- Phase 4B keeps the internal perfect_lie identity while making live transitions safe.

drop function if exists public.begin_perfect_lie_lie_after_timeout(uuid,uuid);

create or replace function public.start_perfect_lie_question(p_event_id uuid,p_question_id uuid,p_duration_seconds integer default 20) returns void
language plpgsql security definer set search_path='' as $$
declare q public.perfect_lie_questions;s public.perfect_lie_round_states;v_now timestamptz;
begin
  if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
  if p_duration_seconds not between 5 and 120 then raise exception 'invalid duration';end if;
  select * into q from public.perfect_lie_questions where id=p_question_id and event_id=p_event_id;
  if not found then raise exception 'question not found';end if;
  select * into s from public.perfect_lie_round_states where round_id=q.round_id for update;
  if not found or s.phase not in('ready','category_transition')or(s.active_question_id is not null and s.active_question_id is distinct from q.id)then
    raise exception 'question is not ready to start' using errcode='55000';
  end if;
  if exists(select 1 from public.perfect_lie_responses where question_id=q.id)
    or exists(select 1 from public.score_awards where metadata->>'game_type'='perfect_lie'and metadata->>'perfect_lie_question_id'=q.id::text)then
    raise exception 'question has already been played; replay requires an explicit reset' using errcode='55000';
  end if;
  v_now:=clock_timestamp();
  update public.perfect_lie_round_states set active_question_id=q.id,phase='writing',knowledge_deadline_at=v_now+make_interval(secs=>p_duration_seconds),reveal_index=0 where round_id=q.round_id;
  update public.events set active_round_id=q.round_id,active_question_id=q.id,status='question',question_started_at=v_now,question_deadline_at=v_now+make_interval(secs=>p_duration_seconds),question_revealed_at=null where id=p_event_id;
  perform private.notify_perfect_lie(p_event_id,'perfect_lie_question_started');
end;$$;

create or replace function public.advance_perfect_lie_question(p_event_id uuid,p_question_id uuid default null) returns void
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
    update public.events set active_round_id=s.round_id,active_question_id=nextq.id,status='ready',question_started_at=null,question_deadline_at=null,question_revealed_at=null where id=p_event_id;
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
      update public.events set active_question_id=nextq.id,status='ready',question_started_at=null,question_deadline_at=null,question_revealed_at=null where id=p_event_id;
    end if;
  else
    raise exception 'active question must be completed before changing questions' using errcode='55000';
  end if;
  perform private.notify_perfect_lie(p_event_id,'perfect_lie_question_selected');
end;$$;

create or replace function public.submit_perfect_lie_answer(p_team_id uuid,p_question_id uuid,p_answer text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.teams;s public.perfect_lie_round_states;v_clean text;v_normalized text;v_correct boolean;existing_response public.perfect_lie_responses;inserted_rows integer;
begin
  if not private.owns_team(p_team_id)then raise exception 'Team ownership required' using errcode='42501';end if;
  select * into t from public.teams where id=p_team_id;
  select rs.* into s from public.perfect_lie_round_states rs join public.perfect_lie_questions q on q.round_id=rs.round_id
    where q.id=p_question_id and q.event_id=t.event_id and rs.active_question_id=q.id;
  if not found or s.phase<>'writing'or clock_timestamp()>s.knowledge_deadline_at then raise exception 'answer window is closed' using errcode='55000';end if;
  v_clean:=trim(p_answer);v_normalized:=private.normalize_perfect_lie_answer(v_clean);
  if char_length(v_clean)not between 1 and 500 then raise exception 'enter an answer';end if;
  select * into existing_response from public.perfect_lie_responses where question_id=p_question_id and team_id=t.id;
  if found then
    if not existing_response.timed_out and existing_response.normalized_answer=v_normalized then
      return jsonb_build_object('knew_truth',existing_response.knew_truth,'lie_draft',case when existing_response.knew_truth then''else existing_response.initial_answer end,'already_submitted',true);
    end if;
    raise exception 'An answer has already been submitted for your Team.' using errcode='55000';
  end if;
  v_correct:=private.perfect_lie_matches_truth(p_question_id,v_clean);
  insert into public.perfect_lie_responses(event_id,question_id,team_id,initial_answer,normalized_answer,knew_truth)
    values(t.event_id,p_question_id,t.id,v_clean,v_normalized,v_correct)on conflict(question_id,team_id)do nothing;
  get diagnostics inserted_rows=row_count;
  if inserted_rows=0 then
    select * into existing_response from public.perfect_lie_responses where question_id=p_question_id and team_id=t.id;
    if not existing_response.timed_out and existing_response.normalized_answer=v_normalized then return jsonb_build_object('knew_truth',existing_response.knew_truth,'lie_draft',case when existing_response.knew_truth then''else existing_response.initial_answer end,'already_submitted',true);end if;
    raise exception 'An answer has already been submitted for your Team.' using errcode='55000';
  end if;
  perform private.notify_perfect_lie(t.event_id,'perfect_lie_answer_submitted');
  return jsonb_build_object('knew_truth',v_correct,'lie_draft',case when v_correct then''else v_clean end,'already_submitted',false);
end;$$;

create or replace function public.submit_perfect_lie_vote(p_team_id uuid,p_question_id uuid,p_option_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.teams;o public.perfect_lie_vote_options;s public.perfect_lie_round_states;existing_option uuid;inserted_rows integer;
begin
  if not private.owns_team(p_team_id)then raise exception 'Team ownership required' using errcode='42501';end if;
  select * into t from public.teams where id=p_team_id;
  select * into o from public.perfect_lie_vote_options where id=p_option_id and question_id=p_question_id and event_id=t.event_id;
  if not found then raise exception 'invalid vote option';end if;
  select * into s from public.perfect_lie_round_states where event_id=t.event_id and active_question_id=p_question_id;
  if not found or s.phase<>'voting'then raise exception 'voting is closed' using errcode='55000';end if;
  if exists(select 1 from public.perfect_lie_lies where id=o.lie_id and team_id=t.id)then raise exception 'You cannot vote for your own lie.' using errcode='42501';end if;
  select option_id into existing_option from public.perfect_lie_votes where question_id=p_question_id and team_id=t.id;
  if found then
    if existing_option=p_option_id then return;end if;
    raise exception 'Your Team has already voted.' using errcode='55000';
  end if;
  insert into public.perfect_lie_votes(event_id,question_id,team_id,option_id)values(t.event_id,p_question_id,t.id,p_option_id)on conflict(question_id,team_id)do nothing;
  get diagnostics inserted_rows=row_count;
  if inserted_rows=0 then select option_id into existing_option from public.perfect_lie_votes where question_id=p_question_id and team_id=t.id;if existing_option=p_option_id then return;end if;raise exception 'Your Team has already voted.' using errcode='55000';end if;
  perform private.notify_perfect_lie(t.event_id,'perfect_lie_vote_submitted');
end;$$;

create or replace function public.submit_perfect_lie_lie(p_team_id uuid,p_question_id uuid,p_lie text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.teams;s public.perfect_lie_round_states;v_clean text;v_normalized text;existing_lie public.perfect_lie_lies;
begin
  if not private.owns_team(p_team_id)then raise exception 'Team ownership required' using errcode='42501';end if;
  select * into t from public.teams where id=p_team_id;
  select rs.* into s from public.perfect_lie_round_states rs join public.perfect_lie_questions q on q.round_id=rs.round_id where q.id=p_question_id and q.event_id=t.event_id and rs.active_question_id=q.id;
  if not found or s.phase<>'writing'then raise exception 'Lie submissions have closed.' using errcode='55000';end if;
  v_clean:=trim(p_lie);v_normalized:=private.normalize_perfect_lie_answer(v_clean);
  if char_length(v_clean)not between 1 and 500 then raise exception 'Write a believable lie.' using errcode='22023';end if;
  select * into existing_lie from public.perfect_lie_lies where question_id=p_question_id and team_id=t.id;
  if found then
    if existing_lie.normalized_lie=v_normalized then return;end if;
    raise exception 'Someone else beat you to that one. Try another lie.' using errcode='55000';
  end if;
  if not exists(select 1 from public.perfect_lie_responses where question_id=p_question_id and team_id=t.id)then
    if clock_timestamp()<=s.knowledge_deadline_at then raise exception 'Submit your answer attempt first.' using errcode='55000';end if;
    insert into public.perfect_lie_responses(event_id,question_id,team_id,initial_answer,normalized_answer,knew_truth,timed_out)
      values(t.event_id,p_question_id,t.id,null,null,false,true)on conflict(question_id,team_id)do nothing;
  end if;
  if private.perfect_lie_matches_truth(p_question_id,v_clean)then raise exception 'That’s the real answer — you need a lie.' using errcode='22023';end if;
  if exists(select 1 from public.perfect_lie_lies where question_id=p_question_id and normalized_lie=v_normalized)then raise exception 'Someone else beat you to that one. Try another lie.' using errcode='23505';end if;
  begin
    insert into public.perfect_lie_lies(event_id,question_id,team_id,lie_text,normalized_lie)values(t.event_id,p_question_id,t.id,v_clean,v_normalized);
  exception when unique_violation then
    select * into existing_lie from public.perfect_lie_lies where question_id=p_question_id and team_id=t.id;
    if found and existing_lie.normalized_lie=v_normalized then return;end if;
    raise exception 'Someone else beat you to that one. Try another lie.' using errcode='23505';
  end;
  perform private.notify_perfect_lie(t.event_id,'perfect_lie_lie_submitted');
end;$$;

create or replace function public.start_perfect_lie_reveal(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.perfect_lie_round_states;n integer;
begin
  if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
  select * into s from public.perfect_lie_round_states where event_id=p_event_id and phase='voting' for update;
  if not found then
    if exists(select 1 from public.perfect_lie_round_states where event_id=p_event_id and phase in('reveal','question_complete'))then return;end if;
    raise exception 'voting is not open';
  end if;
  insert into public.score_awards(event_id,team_id,points,kind,reason,created_by,metadata)
    select p_event_id,t.id,3,'game','Perfect Lie - found the truth',auth.uid(),jsonb_build_object('game_type','perfect_lie','perfect_lie_question_id',s.active_question_id,'award_type','truth','award_key',s.active_question_id::text||':'||t.id::text||':truth')
    from public.teams t where t.event_id=p_event_id and t.status='active'and(exists(select 1 from public.perfect_lie_responses r where r.question_id=s.active_question_id and r.team_id=t.id and r.knew_truth)or exists(select 1 from public.perfect_lie_votes v join public.perfect_lie_vote_options o on o.id=v.option_id where v.question_id=s.active_question_id and v.team_id=t.id and o.is_truth))
    on conflict((metadata->>'award_key'))where kind='game'and metadata->>'game_type'='perfect_lie'do nothing;
  insert into public.score_awards(event_id,team_id,points,kind,reason,created_by,metadata)
    select p_event_id,l.team_id,count(v.id)*2,'game','Perfect Lie - fooled Teams',auth.uid(),jsonb_build_object('game_type','perfect_lie','perfect_lie_question_id',s.active_question_id,'award_type','bluff','fooled_count',count(v.id),'award_key',s.active_question_id::text||':'||l.team_id::text||':bluff')
    from public.perfect_lie_lies l join public.perfect_lie_vote_options o on o.lie_id=l.id left join public.perfect_lie_votes v on v.option_id=o.id where l.question_id=s.active_question_id group by l.team_id having count(v.id)>0
    on conflict((metadata->>'award_key'))where kind='game'and metadata->>'game_type'='perfect_lie'do nothing;
  select count(*)into n from public.perfect_lie_vote_options where question_id=s.active_question_id;
  update public.perfect_lie_round_states set phase=case when n<=1 then'question_complete'else'reveal'end,reveal_index=1 where round_id=s.round_id;
  update public.events set status='reveal',question_revealed_at=clock_timestamp()where id=p_event_id;
  perform private.notify_perfect_lie(p_event_id,'perfect_lie_reveal_started');
end;$$;

create or replace function public.advance_perfect_lie_reveal(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.perfect_lie_round_states;n integer;v_next integer;
begin
  if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
  select * into s from public.perfect_lie_round_states where event_id=p_event_id and phase='reveal' for update;
  if not found then raise exception 'reveal is not active';end if;
  select count(*)into n from public.perfect_lie_vote_options where question_id=s.active_question_id;
  v_next:=s.reveal_index+1;
  if v_next>=n then
    update public.perfect_lie_round_states set phase='question_complete',reveal_index=n where round_id=s.round_id;
  else
    update public.perfect_lie_round_states set reveal_index=v_next where round_id=s.round_id;
  end if;
  perform private.notify_perfect_lie(p_event_id,'perfect_lie_reveal_advanced');
end;$$;

revoke all on function public.start_perfect_lie_question(uuid,uuid,integer),public.advance_perfect_lie_question(uuid,uuid),public.submit_perfect_lie_answer(uuid,uuid,text),public.submit_perfect_lie_lie(uuid,uuid,text),public.submit_perfect_lie_vote(uuid,uuid,uuid),public.start_perfect_lie_reveal(uuid),public.advance_perfect_lie_reveal(uuid)from public,anon,authenticated;
grant execute on function public.start_perfect_lie_question(uuid,uuid,integer),public.advance_perfect_lie_question(uuid,uuid),public.submit_perfect_lie_answer(uuid,uuid,text),public.submit_perfect_lie_lie(uuid,uuid,text),public.submit_perfect_lie_vote(uuid,uuid,uuid),public.start_perfect_lie_reveal(uuid),public.advance_perfect_lie_reveal(uuid)to authenticated;
