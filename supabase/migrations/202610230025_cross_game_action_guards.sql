-- Game-specific Host actions must not change shared event state while another game is on stage.
-- A stale Host tab could (a) reset a finished I Bet You group during another game, which set the
-- live event to ready, reopened the finished round and deleted its awarded points, and (b) lock a
-- live Table of Lies or No Context question through the Guess the Age lock_question RPC.
-- Bodies are unchanged apart from the guard. The pause migration wraps these RPCs, so the inner
-- *_before_pause functions are replaced. The wrapper already holds the event row lock.

create function private.assert_game_on_stage(p_event_id uuid,p_game_type text,p_round_id uuid default null) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.events e join public.event_rounds r on r.id=e.active_round_id
   where e.id=p_event_id and r.game_type=p_game_type and(p_round_id is null or r.id=p_round_id))then
  raise exception 'This game is not on stage. Refresh and select it first.' using errcode='55000';
 end if;
end $$;
revoke all on function private.assert_game_on_stage(uuid,text,uuid) from public,anon,authenticated;

create or replace function public.lock_question_before_pause(p_event_id uuid) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode = '42501'; end if;
  perform private.assert_game_on_stage(p_event_id,'guess_age');
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.status <> 'question' then raise exception 'question is not open'; end if;
  update public.events set status = 'locked', question_deadline_at = least(question_deadline_at, clock_timestamp()), state_version = state_version + 1
  where id = p_event_id returning * into v_event;
  perform private.notify_event(v_event.id, v_event.state_version, 'question_locked'); return v_event;
end;
$$;

create or replace function public.reset_i_bet_you_group_before_pause(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.i_bet_you_groups;
begin g:=private.assert_i_bet_you_host(p_group_id);perform private.assert_game_on_stage(g.event_id,'i_bet_you',g.round_id);delete from public.score_awards where event_id=g.event_id and kind='game' and metadata->>'i_bet_you_group_id'=g.id::text;update public.i_bet_you_groups set state='waiting',current_bidder_team_id=null,current_bid=null,challenged_bidder_team_id=null,challenger_team_id=null,target_bid=null,countdown_started_at=null,countdown_deadline_at=null,result=null,winning_team_id=null,completed_at=null where id=p_group_id;update public.i_bet_you_round_states set status='playing',active_group_id=p_group_id where round_id=g.round_id;update public.events set status='ready' where id=g.event_id;perform private.notify_i_bet_you(g.event_id,'i_bet_you_group_reset');return private.i_bet_you_state(g.event_id);end;
$$;
