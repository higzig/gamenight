create function public.get_host_event_state(p_event_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'event', to_jsonb(e),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', t.id, 'name', t.name, 'status', t.status, 'joined_at', t.joined_at)
        order by t.joined_at, t.name
      )
      from public.teams t where t.event_id = e.id
    ), '[]'::jsonb)
  )
  from public.events e
  where e.id = p_event_id and private.is_event_host(e.id)
$$;

create function public.open_event_lobby(p_event_id uuid) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_event public.events;
begin
  if not private.is_event_host(p_event_id) then
    raise exception 'event owner required' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.status not in ('draft', 'lobby') then
    raise exception 'event cannot be opened for joining from its current state';
  end if;
  update public.events set status = 'lobby', state_version = state_version + 1
  where id = p_event_id returning * into v_event;
  perform private.notify_event(v_event.id, v_event.state_version, 'lobby_opened');
  return v_event;
end;
$$;

revoke all on function public.get_host_event_state(uuid), public.open_event_lobby(uuid)
from public, anon, authenticated;
grant execute on function public.get_host_event_state(uuid), public.open_event_lobby(uuid)
to authenticated;
