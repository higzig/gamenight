alter table public.perfect_lie_responses
  alter column initial_answer drop not null,
  alter column normalized_answer drop not null,
  add column timed_out boolean not null default false,
  add constraint perfect_lie_response_shape check(
    (not timed_out and initial_answer is not null and normalized_answer is not null and char_length(trim(initial_answer)) between 1 and 500)
    or (timed_out and initial_answer is null and normalized_answer is null and not knew_truth)
  );

alter table public.perfect_lie_responses drop constraint perfect_lie_initial_length;

create function public.begin_perfect_lie_lie_after_timeout(p_team_id uuid,p_question_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.teams;s public.perfect_lie_round_states;
begin
  if not private.owns_team(p_team_id) then raise exception 'Team ownership required' using errcode='42501';end if;
  select * into t from public.teams where id=p_team_id;
  select rs.* into s from public.perfect_lie_round_states rs
  join public.perfect_lie_questions q on q.round_id=rs.round_id
  where q.id=p_question_id and q.event_id=t.event_id and rs.active_question_id=q.id;
  if not found or s.phase<>'writing' then raise exception 'lie submissions are closed';end if;
  if clock_timestamp()<=s.knowledge_deadline_at then raise exception 'truth attempt is still open';end if;
  insert into public.perfect_lie_responses(event_id,question_id,team_id,initial_answer,normalized_answer,knew_truth,timed_out)
  values(t.event_id,p_question_id,t.id,null,null,false,true) on conflict(question_id,team_id)do nothing;
  perform private.notify_perfect_lie(t.event_id,'perfect_lie_truth_timed_out');
end;$$;

create or replace function private.perfect_lie_state(p_event_id uuid,p_role text,p_team_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
select case when rs.round_id is null then null else jsonb_build_object(
 'round',jsonb_build_object('id',r.id,'title',r.title,'position',r.position,'game_type','perfect_lie','phase',rs.phase,'active_question_id',rs.active_question_id,'reveal_index',rs.reveal_index),
 'categories',case when p_role='host'then coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'position',c.position,'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'position',q.position,'question_text',q.question_text,'explanation',q.explanation,'correct_answer',sec.correct_answer,'accepted_answer_variants',sec.accepted_answer_variants,'source_reference',sec.source_reference)order by q.position),'[]')from public.perfect_lie_questions q join public.perfect_lie_question_secrets sec on sec.question_id=q.id where q.category_id=c.id))order by c.position)from public.perfect_lie_categories c where c.round_id=r.id),'[]')else'[]'::jsonb end,
 'question',(select jsonb_build_object('id',q.id,'position',q.position,'question_text',q.question_text,'explanation',case when rs.phase in('reveal','question_complete')then q.explanation else null end,'category_id',c.id,'category',c.title,'category_position',c.position,'correct_answer',case when rs.phase in('reveal','question_complete')then sec.correct_answer else null end)from public.perfect_lie_questions q join public.perfect_lie_categories c on c.id=q.category_id join public.perfect_lie_question_secrets sec on sec.question_id=q.id where q.id=rs.active_question_id),
 'team_count',(select count(*)from public.teams where event_id=p_event_id and status='active'),
 'answer_count',(select count(*)from public.perfect_lie_responses where question_id=rs.active_question_id and not timed_out),
 'lie_count',(select count(*)from public.perfect_lie_lies where question_id=rs.active_question_id),'vote_count',(select count(*)from public.perfect_lie_votes where question_id=rs.active_question_id),
 'options',case when rs.phase in('voting','reveal','question_complete')then coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'text',o.option_text,'position',o.display_position,'is_own',case when p_role='team'then exists(select 1 from public.perfect_lie_lies l where l.id=o.lie_id and l.team_id=p_team_id)else false end,'is_truth',case when rs.phase in('reveal','question_complete')then o.is_truth else null end)order by o.display_position)from public.perfect_lie_vote_options o where o.question_id=rs.active_question_id),'[]')else'[]'::jsonb end,
 'my_response',case when p_role='team'then(select jsonb_build_object('initial_answer',x.initial_answer,'knew_truth',x.knew_truth,'timed_out',x.timed_out)from public.perfect_lie_responses x where x.question_id=rs.active_question_id and x.team_id=p_team_id)else null end,
 'my_lie',case when p_role='team'then(select jsonb_build_object('id',l.id,'text',l.lie_text)from public.perfect_lie_lies l where l.question_id=rs.active_question_id and l.team_id=p_team_id)else null end,
 'my_vote',case when p_role='team'then(select v.option_id from public.perfect_lie_votes v where v.question_id=rs.active_question_id and v.team_id=p_team_id)else null end,
 'my_result',case when p_role='team'and rs.phase in('reveal','question_complete')then jsonb_build_object('points',coalesce((select sum(a.points)from public.score_awards a where a.team_id=p_team_id and a.metadata->>'game_type'='perfect_lie'and a.metadata->>'perfect_lie_question_id'=rs.active_question_id::text),0),'fooled_count',coalesce((select max((a.metadata->>'fooled_count')::integer)from public.score_awards a where a.team_id=p_team_id and a.metadata->>'game_type'='perfect_lie'and a.metadata->>'perfect_lie_question_id'=rs.active_question_id::text),0))else null end,
 'team_status',case when p_role='host'then coalesce((select jsonb_agg(jsonb_build_object('team_id',t.id,'name',t.name,'mascot_id',t.mascot_id,'knew_truth',coalesce(x.knew_truth,false),'timed_out',coalesce(x.timed_out,false),'answered',x.id is not null,'lie_submitted',l.id is not null,'voted',v.id is not null)order by t.name)from public.teams t left join public.perfect_lie_responses x on x.team_id=t.id and x.question_id=rs.active_question_id left join public.perfect_lie_lies l on l.team_id=t.id and l.question_id=rs.active_question_id left join public.perfect_lie_votes v on v.team_id=t.id and v.question_id=rs.active_question_id where t.event_id=p_event_id and t.status='active'),'[]')else'[]'::jsonb end,
 'truth_teams',case when rs.phase in('reveal','question_complete')and exists(select 1 from public.perfect_lie_vote_options o where o.question_id=rs.active_question_id and o.reveal_position=rs.reveal_index and o.is_truth)then coalesce((select jsonb_agg(jsonb_build_object('name',t.name,'mascot_id',t.mascot_id,'knew_from_start',coalesce(x.knew_truth,false))order by t.name)from public.teams t left join public.perfect_lie_responses x on x.team_id=t.id and x.question_id=rs.active_question_id where t.event_id=p_event_id and(exists(select 1 from public.perfect_lie_responses r2 where r2.question_id=rs.active_question_id and r2.team_id=t.id and r2.knew_truth)or exists(select 1 from public.perfect_lie_votes v join public.perfect_lie_vote_options o on o.id=v.option_id where v.question_id=rs.active_question_id and v.team_id=t.id and o.is_truth))),'[]')else'[]'::jsonb end,
 'reveal',case when rs.phase in('reveal','question_complete')and rs.reveal_index>0 then(select jsonb_build_object('option_id',o.id,'text',o.option_text,'is_truth',o.is_truth,'picked_count',(select count(*)from public.perfect_lie_votes v where v.option_id=o.id),'author',case when o.is_truth then null else(select jsonb_build_object('team_id',t.id,'name',t.name,'mascot_id',t.mascot_id)from public.perfect_lie_lies l join public.teams t on t.id=l.team_id where l.id=o.lie_id)end)from public.perfect_lie_vote_options o where o.question_id=rs.active_question_id and o.reveal_position=rs.reveal_index)else null end
)end from public.perfect_lie_round_states rs join public.event_rounds r on r.id=rs.round_id where rs.event_id=p_event_id
$$;

revoke all on function public.begin_perfect_lie_lie_after_timeout(uuid,uuid)from public,anon,authenticated;
grant execute on function public.begin_perfect_lie_lie_after_timeout(uuid,uuid)to authenticated;
