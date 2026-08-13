create function public.delete_event(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_event_host(p_event_id) then
    raise exception 'event owner required' using errcode='42501';
  end if;
  delete from public.events where id=p_event_id;
end;
$$;

revoke all on function public.delete_event(uuid) from public,anon,authenticated;
grant execute on function public.delete_event(uuid) to authenticated;
