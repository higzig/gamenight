-- Choose I Bet You group count from active participation, not a client hint.
drop function public.setup_i_bet_you_round(uuid,integer);

create function public.setup_i_bet_you_round(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_round_id uuid;
  v_team_count integer;
  v_group_count integer;
  v_created_count integer;
  v_first_group uuid;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode='42501';end if;
  select count(*) into v_team_count from public.teams where event_id=p_event_id and status='active';
  if v_team_count<2 then raise exception 'At least two active Teams are required' using errcode='22023';end if;

  -- One table can accommodate up to six Teams. From seven onward, add a
  -- group for each five Teams so normal groups remain in the 3–5 range.
  v_group_count:=case when v_team_count<=6 then 1 else ceil(v_team_count/5.0)::integer end;

  select id into v_round_id from public.event_rounds where event_id=p_event_id and game_type='i_bet_you' order by position limit 1;
  if v_round_id is null then
    insert into public.event_rounds(event_id,position,game_type,title,settings)
    values(p_event_id,coalesce((select max(position)+1 from public.event_rounds where event_id=p_event_id),1),'i_bet_you','I Bet You',jsonb_build_object('timer_seconds',60,'points',5))
    returning id into v_round_id;
  else
    if exists(select 1 from public.i_bet_you_round_states where round_id=v_round_id and status<>'setup')
      or exists(select 1 from public.i_bet_you_groups where round_id=v_round_id and state<>'waiting')
    then raise exception 'grouping is locked after gameplay begins';end if;
    delete from public.i_bet_you_groups where round_id=v_round_id;
  end if;

  insert into public.i_bet_you_round_states(round_id,event_id,status)
  values(v_round_id,p_event_id,'setup')
  on conflict(round_id) do update set active_group_id=null,status='setup';

  insert into public.i_bet_you_groups(event_id,round_id,position,category_id)
  select p_event_id,v_round_id,c.n,c.id
  from(
    select row_number()over()::integer n,id
    from(select id from public.i_bet_you_categories where active and difficulty='easy' order by random() limit v_group_count)picked
  )c;
  get diagnostics v_created_count=row_count;
  if v_created_count<>v_group_count then raise exception 'not enough unique active categories for group setup';end if;

  insert into public.i_bet_you_group_members(group_id,round_id,event_id,team_id,position)
  select g.id,v_round_id,p_event_id,t.id,row_number()over(partition by g.id order by t.n)
  from(select row_number()over(order by random()) n,id from public.teams where event_id=p_event_id and status='active')t
  join public.i_bet_you_groups g on g.round_id=v_round_id and g.position=((t.n-1)%v_group_count)+1;

  select id into v_first_group from public.i_bet_you_groups where round_id=v_round_id order by position limit 1;
  update public.i_bet_you_round_states set active_group_id=v_first_group where round_id=v_round_id;
  update public.events set active_round_id=v_round_id,active_question_id=null,status='ready',display_mode='game',state_version=state_version+1 where id=p_event_id;
  perform private.notify_event(p_event_id,(select state_version from public.events where id=p_event_id),'i_bet_you_setup');
  return private.i_bet_you_state(p_event_id);
end;
$$;

revoke all on function public.setup_i_bet_you_round(uuid) from public,anon,authenticated;
grant execute on function public.setup_i_bet_you_round(uuid) to authenticated;
