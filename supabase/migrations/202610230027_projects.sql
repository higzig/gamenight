-- My Projects. A Project is the Host-facing name for an event; no tables are renamed.
-- Creating a project used to be three separate calls (create, open lobby, save lineup). If the
-- last call failed, the app was left with an unexpectedly empty project. create_project now does
-- all three in one transaction: a project either exists with its games, or it does not exist.

create function public.create_project(p_name text,p_game_types text[],p_event_date date default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.events;
begin
 if auth.uid() is null or private.is_anonymous_user() then raise exception 'host authentication required' using errcode='42501';end if;
 if char_length(trim(coalesce(p_name,'')))not between 1 and 120 then raise exception 'Give your project a name of up to 120 characters.' using errcode='22023';end if;
 e:=public.create_event(trim(p_name),'',coalesce(p_event_date,current_date));
 perform public.open_event_lobby(e.id);
 perform public.set_event_lineup(e.id,coalesce(p_game_types,'{}'),null);
 return e.id;
end $$;

-- Everything the My Projects cards show, for the signed-in Host only.
create function public.list_projects() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',e.id,'name',e.name,'venue',e.venue,'event_date',e.event_date,'room_code',e.room_code,'status',e.status,
  'created_at',e.created_at,'started_at',e.started_at,'lineup_saved',e.lineup_revision is not null,
  'games',case when e.lineup_revision is null
   then coalesce((select jsonb_agg(t.game_type order by t.position)from(select distinct on(r.game_type)r.game_type,r.position from public.event_rounds r where r.event_id=e.id and r.game_type in('guess_age','no_context','i_bet_you','perfect_lie')order by r.game_type,r.position)t),'[]'::jsonb)
   else coalesce((select jsonb_agg(l.game_type order by l.position)from public.event_lineup_games l where l.event_id=e.id),'[]'::jsonb)end
 )order by e.created_at desc),'[]'::jsonb)
 from public.events e where e.host_id=auth.uid() and not private.is_anonymous_user()
$$;

revoke all on function public.create_project(text,text[],date),public.list_projects() from public,anon,authenticated;
grant execute on function public.create_project(text,text[],date),public.list_projects() to authenticated;
