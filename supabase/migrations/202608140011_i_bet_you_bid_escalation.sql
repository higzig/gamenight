-- A bid is only committed by I BET YOU and every later committed bid must escalate.
create or replace function public.set_i_bet_you_bid(p_group_id uuid,p_bidder_team_id uuid,p_bid integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.i_bet_you_groups;
begin
  g:=private.assert_i_bet_you_host(p_group_id);
  select * into g from public.i_bet_you_groups where id=p_group_id for update;
  if g.state not in('waiting','bidding') then raise exception 'bid is frozen';end if;
  if p_bid not between 1 and 100 then raise exception 'bid must be between 1 and 100';end if;
  if g.current_bid is not null and p_bid<=g.current_bid then raise exception 'new bid must be higher than current bid';end if;
  if not exists(select 1 from public.i_bet_you_group_members where group_id=p_group_id and team_id=p_bidder_team_id) then raise exception 'bidder must belong to group';end if;
  update public.i_bet_you_groups set state='bidding',current_bidder_team_id=p_bidder_team_id,current_bid=p_bid where id=p_group_id;
  update public.i_bet_you_round_states set status='playing',active_group_id=p_group_id where round_id=g.round_id;
  perform private.notify_i_bet_you(g.event_id,'i_bet_you_bid');
  return private.i_bet_you_state(g.event_id);
end;
$$;
