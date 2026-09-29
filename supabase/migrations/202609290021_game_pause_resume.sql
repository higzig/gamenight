-- Preserve game state while changing the stage. Gameplay/scoring tables stay in place.
create table private.game_checkpoints (
 round_id uuid primary key references public.event_rounds(id) on delete cascade,
 event_id uuid not null references public.events(id) on delete cascade,
 state text not null check(state in('paused','running','complete')),
 frozen_at timestamptz not null,
 event_state jsonb not null,
 timer_state jsonb not null default '{}'
);
revoke all on private.game_checkpoints from public,anon,authenticated;

create function private.capture_game_switch() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text; timers jsonb:='{}'; finished boolean:=false; saved private.game_checkpoints;
begin
 if new.active_round_id is not distinct from old.active_round_id then return new;end if;
 if old.active_round_id is not null and old.status not in('draft','lobby','ended')
   and not exists(select 1 from private.game_checkpoints where round_id=old.active_round_id and state='paused') then
  select game_type into kind from public.event_rounds where id=old.active_round_id;
  if kind='guess_age' then finished:=old.status='round_complete';
  elsif kind='perfect_lie' then
   select jsonb_build_object('knowledge_deadline_at',knowledge_deadline_at),phase='complete' into timers,finished from public.perfect_lie_round_states where round_id=old.active_round_id;
   update public.perfect_lie_round_states set knowledge_deadline_at=null where round_id=old.active_round_id;
  elsif kind='i_bet_you' then
   select status='complete' into finished from public.i_bet_you_round_states where round_id=old.active_round_id;
   select coalesce(jsonb_object_agg(id::text,jsonb_build_object('started',countdown_started_at,'deadline',countdown_deadline_at)),'{}') into timers from public.i_bet_you_groups where round_id=old.active_round_id;
   update public.i_bet_you_groups set countdown_deadline_at=null where round_id=old.active_round_id;
  elsif kind='no_context' then
   select jsonb_build_object('play_id',p.id,'deadline_at',p.deadline_at),p.phase='complete' into timers,finished from public.no_context_games g join public.no_context_plays p on p.id=g.active_play_id where g.round_id=old.active_round_id;
   update public.no_context_plays set deadline_at=null where id=(timers->>'play_id')::uuid;
  end if;
  insert into private.game_checkpoints values(old.active_round_id,old.id,case when coalesce(finished,false)then'complete'else'paused'end,clock_timestamp(),to_jsonb(old),coalesce(timers,'{}'))
   on conflict(round_id)do update set state=excluded.state,frozen_at=excluded.frozen_at,event_state=excluded.event_state,timer_state=excluded.timer_state;
 end if;
 -- Preparation RPCs can select a new round while retaining the old event clock.
 -- Never carry that clock into an unrelated game.
 if new.question_started_at is not distinct from old.question_started_at then
  new.question_started_at:=null;new.question_deadline_at:=null;new.question_reveal_due_at:=null;new.question_revealed_at:=null;
  if new.status=old.status and old.status in('question','suspense','locked','reveal','round_complete')then new.status:='ready';end if;
 end if;
 select * into saved from private.game_checkpoints where round_id=new.active_round_id;
 if found then
  -- Selecting a paused game does not restart its clock. Resume is a separate RPC.
  new.active_question_id:=(saved.event_state->>'active_question_id')::uuid;
  new.status:=case when saved.state='complete'then'round_complete'else'ready'end;
  new.question_started_at:=null;new.question_deadline_at:=null;new.question_reveal_due_at:=null;new.question_revealed_at:=null;
 end if;
 return new;
end $$;
create trigger capture_game_switch before update of active_round_id on public.events for each row execute function private.capture_game_switch();

create function public.select_hosted_game(p_event_id uuid,p_round_id uuid) returns public.events
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
 if r.game_type='guess_age'then select id into q from public.questions where round_id=r.id order by position limit 1;
 elsif r.game_type='perfect_lie'then select active_question_id into q from public.perfect_lie_round_states where round_id=r.id;
 end if;
 update public.events set active_round_id=r.id,active_question_id=q,status='ready',display_mode='game',question_started_at=null,question_deadline_at=null,question_reveal_due_at=null,question_revealed_at=null,state_version=state_version+1 where id=e.id returning * into e;
 perform private.notify_event(e.id,e.state_version,'game_selected');return e;
end $$;

create function public.resume_hosted_game(p_event_id uuid,p_round_id uuid) returns public.events
language plpgsql security definer set search_path='' as $$
declare e public.events;c private.game_checkpoints;shift interval;kind text;
begin
 if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
 select * into e from public.events where id=p_event_id for update;
 if e.status='ended'or e.active_round_id is distinct from p_round_id then raise exception 'select this game before resuming';end if;
 select * into c from private.game_checkpoints where round_id=p_round_id and event_id=p_event_id for update;
 if not found or c.state='running'then return e;end if;
 if c.state='complete'then raise exception 'completed games cannot be resumed';end if;
 shift:=clock_timestamp()-c.frozen_at;
 select game_type into kind from public.event_rounds where id=p_round_id;
 update private.game_checkpoints set state='running' where round_id=p_round_id;
 if kind='perfect_lie'then update public.perfect_lie_round_states set knowledge_deadline_at=(c.timer_state->>'knowledge_deadline_at')::timestamptz+shift where round_id=p_round_id;
 elsif kind='i_bet_you'then update public.i_bet_you_groups g set countdown_started_at=(c.timer_state->g.id::text->>'started')::timestamptz+shift,countdown_deadline_at=(c.timer_state->g.id::text->>'deadline')::timestamptz+shift where round_id=p_round_id;
 elsif kind='no_context'then update public.no_context_plays set deadline_at=(c.timer_state->>'deadline_at')::timestamptz+shift where id=(c.timer_state->>'play_id')::uuid;
 end if;
 update public.events set status=c.event_state->>'status',active_question_id=(c.event_state->>'active_question_id')::uuid,
 question_started_at=(c.event_state->>'question_started_at')::timestamptz+shift,
 question_deadline_at=(c.event_state->>'question_deadline_at')::timestamptz+shift,
 question_reveal_due_at=(c.event_state->>'question_reveal_due_at')::timestamptz+shift,
 question_revealed_at=(c.event_state->>'question_revealed_at')::timestamptz+shift,
 display_mode='game',state_version=state_version+1 where id=e.id returning * into e;
 perform private.notify_event(e.id,e.state_version,'game_resumed');return e;
end $$;

-- Legacy activation now selects without resetting existing progress.
create or replace function public.activate_hosted_round(p_event_id uuid,p_round_id uuid) returns public.events
language sql security definer set search_path='' as $$select public.select_hosted_game(p_event_id,p_round_id)$$;

-- Serialize gameplay RPCs with switching, and reject stale requests to paused games.
create function private.assert_game_not_paused(p_event_id uuid,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.events where id=p_event_id for update;
 if exists(select 1 from private.game_checkpoints c join public.event_rounds r on r.id=c.round_id where c.event_id=p_event_id and r.game_type=p_kind and c.state='paused')then
  raise exception 'game is paused; select it and resume before playing' using errcode='55000';
 end if;
end $$;

do $$
declare f record;kind text;args text;event_expr text;body text;
begin
 for f in select p.*,pg_get_function_arguments(p.oid) decl,pg_get_function_identity_arguments(p.oid) identity_args,pg_get_function_result(p.oid) result_type
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in(
 'start_question','lock_question','reveal_question','advance_guess_age_question','submit_guess','restart_guess_age_round','save_guess_age_round','reorder_guess_age_question',
 'start_perfect_lie_question','advance_perfect_lie_question','submit_perfect_lie_answer','submit_perfect_lie_lie','submit_perfect_lie_vote','close_perfect_lie_writing','start_perfect_lie_reveal','advance_perfect_lie_reveal','save_perfect_lie_round',
 'setup_i_bet_you_round','swap_i_bet_you_teams','change_i_bet_you_category','set_i_bet_you_bid','challenge_i_bet_you','correct_i_bet_you_showdown','start_i_bet_you_timer','judge_i_bet_you_group','next_i_bet_you_group','reset_i_bet_you_group',
 'setup_no_context','no_context_control','submit_no_context_response','submit_no_context_vote') loop
  kind:=case when f.proname like '%perfect_lie%'then'perfect_lie'when f.proname like '%i_bet_you%'then'i_bet_you'when f.proname like '%no_context%'then'no_context'else'guess_age'end;
  select string_agg(format('$%s',i),',' order by i)into args from generate_series(1,f.pronargs)i;
  if 'p_event_id'=any(f.proargnames)then event_expr:='p_event_id';
  elsif 'p_team_id'=any(f.proargnames)then event_expr:='(select event_id from public.teams where id=p_team_id)';
  elsif 'p_group_id'=any(f.proargnames)then event_expr:='(select event_id from public.i_bet_you_groups where id=p_group_id)';
  else raise exception 'unmapped gameplay RPC %',f.proname;end if;
  execute format('alter function public.%I(%s) rename to %I',f.proname,f.identity_args,f.proname||'_before_pause');
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',f.proname||'_before_pause',f.identity_args);
  body:=format('begin perform private.assert_game_not_paused(%s,%L); ',event_expr,kind);
  -- Explicit restart keeps its existing destructive semantics; selection never uses it.
  if f.proname='restart_guess_age_round'then body:=body||'delete from private.game_checkpoints where event_id=p_event_id and round_id in(select id from public.event_rounds where event_id=p_event_id and game_type=''guess_age''); ';end if;
  if f.prorettype='void'::regtype then body:=body||format('perform public.%I(%s); return; end',f.proname||'_before_pause',args);
  else body:=body||format('return public.%I(%s); end',f.proname||'_before_pause',args);end if;
  execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path='''' as %L',f.proname,f.decl,f.result_type,body);
  execute format('revoke all on function public.%I(%s) from public,anon;grant execute on function public.%I(%s) to authenticated',f.proname,f.identity_args,f.proname,f.identity_args);
 end loop;
end $$;

-- No Context selection goes through the same checkpoint path, including live phases.
create or replace function public.no_context_control(p_event_id uuid,p_play_id uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare rid uuid;pid uuid;
begin
 if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
 perform 1 from public.events where id=p_event_id for update;
 select round_id,active_play_id into rid,pid from public.no_context_games where event_id=p_event_id;
 if pid is distinct from p_play_id then raise exception 'stale round; refresh';end if;
 if p_action='resume'then perform public.select_hosted_game(p_event_id,rid);return;end if;
 perform private.assert_game_not_paused(p_event_id,'no_context');
 if p_action='restart'then delete from private.game_checkpoints where round_id=rid;end if;
 perform public.no_context_control_before_pause(p_event_id,p_play_id,p_action);
end $$;

create function private.game_pause_state(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('selected_paused',exists(select 1 from private.game_checkpoints c join public.events e on e.active_round_id=c.round_id where e.id=p_event_id and c.state='paused'),
 'games',coalesce((select jsonb_agg(jsonb_build_object('round_id',c.round_id,'state',c.state,'status',c.event_state->>'status','remaining_seconds',greatest(0,extract(epoch from(coalesce((c.timer_state->>'deadline_at')::timestamptz,(c.timer_state->>'knowledge_deadline_at')::timestamptz,(c.event_state->>'question_deadline_at')::timestamptz)-c.frozen_at)))))from private.game_checkpoints c where c.event_id=p_event_id),'[]'::jsonb))
$$;

alter function public.get_host_event_state(uuid) rename to get_host_event_state_before_pause;
alter function public.get_team_room_state(text) rename to get_team_room_state_before_pause;
alter function public.get_public_room_state(text) rename to get_public_room_state_before_pause;
create function public.get_host_event_state(p_event_id uuid)returns jsonb language sql stable security definer set search_path='' as $$select s||jsonb_build_object('game_pause',private.game_pause_state((s->'event'->>'id')::uuid)) from public.get_host_event_state_before_pause(p_event_id)s$$;
create function public.get_team_room_state(p_room_code text)returns jsonb language sql stable security definer set search_path='' as $$select case when s is null then null else s||jsonb_build_object('game_paused',(private.game_pause_state((s->'event'->>'id')::uuid)->>'selected_paused')::boolean)end from public.get_team_room_state_before_pause(p_room_code)s$$;
create function public.get_public_room_state(p_room_code text)returns jsonb language sql stable security definer set search_path='' as $$select case when s is null then null else s||jsonb_build_object('game_paused',(private.game_pause_state((s->'event'->>'id')::uuid)->>'selected_paused')::boolean)end from public.get_public_room_state_before_pause(p_room_code)s$$;
revoke all on function public.get_host_event_state_before_pause(uuid),public.get_team_room_state_before_pause(text),public.get_public_room_state_before_pause(text) from public,anon,authenticated;
revoke all on function public.select_hosted_game(uuid,uuid),public.resume_hosted_game(uuid,uuid),public.get_host_event_state(uuid),public.get_team_room_state(text),public.get_public_room_state(text) from public,anon;
grant execute on function public.select_hosted_game(uuid,uuid),public.resume_hosted_game(uuid,uuid),public.get_host_event_state(uuid),public.get_team_room_state(text),public.get_public_room_state(text) to authenticated;
revoke all on function private.capture_game_switch(),private.assert_game_not_paused(uuid,text),private.game_pause_state(uuid) from public,anon,authenticated;
