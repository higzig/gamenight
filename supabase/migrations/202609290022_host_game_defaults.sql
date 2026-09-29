-- Host-owned defaults; each prepared game keeps its own category pool.
alter table public.i_bet_you_categories add column host_id uuid references public.profiles(id) on delete cascade;
create unique index i_bet_you_custom_title_unique on public.i_bet_you_categories(host_id,lower(trim(title))) where host_id is not null;
create table private.host_game_preferences (
 host_id uuid primary key references public.profiles(id) on delete cascade,
 i_bet_you_category_ids uuid[],
 guess_age_lineup jsonb
);
revoke all on private.host_game_preferences from public,anon,authenticated;

-- Preserve the original easy-category pool for games prepared before this change.
update public.event_rounds r set settings=r.settings||jsonb_build_object('category_ids',
 (select jsonb_agg(c.id)from public.i_bet_you_categories c where c.active and c.host_id is null and(c.difficulty='easy' or c.id in(select category_id from public.i_bet_you_groups where round_id=r.id))))
where r.game_type='i_bet_you' and not(r.settings ? 'category_ids');

create function private.i_bet_you_category_pool(p_event_id uuid) returns setof public.i_bet_you_categories
language sql stable security definer set search_path='' as $$
 select c.* from public.events e
 left join private.host_game_preferences p on p.host_id=e.host_id
 left join public.event_rounds r on r.event_id=e.id and r.game_type='i_bet_you'
 join public.i_bet_you_categories c on c.active and(c.host_id is null or c.host_id=e.host_id)
 where e.id=p_event_id and case
 when r.settings ? 'category_ids' then c.id::text in(select jsonb_array_elements_text(r.settings->'category_ids'))
 when p.i_bet_you_category_ids is not null then c.id=any(p.i_bet_you_category_ids)
 else true end
$$;

create function private.host_game_defaults(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('guess_age',p.guess_age_lineup,'i_bet_you',jsonb_build_object(
 'saved_for_event',exists(select 1 from public.event_rounds where event_id=e.id and game_type='i_bet_you' and settings ? 'category_ids'),
 'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'difficulty',c.difficulty,'custom',c.host_id is not null,'selected',c.id in(select id from private.i_bet_you_category_pool(e.id)))order by lower(c.title))from public.i_bet_you_categories c where c.active and(c.host_id is null or c.host_id=e.host_id)),'[]'::jsonb)))
 from public.events e left join private.host_game_preferences p on p.host_id=e.host_id
 where e.id=p_event_id and private.is_event_host(e.id)
$$;

create function public.save_i_bet_you_settings(p_event_id uuid,p_category_ids uuid[],p_custom_categories jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.events;rid uuid;v_title text;item jsonb;cid uuid;selected uuid[]:=coalesce(p_category_ids,'{}');
begin
 if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
 select * into e from public.events where id=p_event_id for update;
 if e.status='ended'then raise exception 'event ended';end if;
 perform private.assert_game_not_paused(p_event_id,'i_bet_you');
 if exists(select 1 from public.i_bet_you_round_states where event_id=p_event_id)then raise exception 'category settings are locked after the game is prepared' using errcode='55000';end if;
 if p_custom_categories is null or jsonb_typeof(p_custom_categories)<>'array' then raise exception 'invalid custom categories' using errcode='22023';end if;
 if cardinality(selected)>500 or jsonb_array_length(p_custom_categories)>100 then raise exception 'too many categories' using errcode='22023';end if;
 if exists(select 1 from unnest(selected)x where not exists(select 1 from public.i_bet_you_categories c where c.id=x and c.active and(c.host_id is null or c.host_id=e.host_id)))then raise exception 'invalid category selection' using errcode='22023';end if;
 -- Serializes preference saves across this host's events as well as this event.
 perform 1 from public.profiles where id=e.host_id for update;
 for item in select value from jsonb_array_elements(p_custom_categories)loop
  v_title:=regexp_replace(trim(item->>'title'),'\s+',' ','g');
  if v_title is null or char_length(v_title)not between 2 and 120 then raise exception 'categories need 2 to 120 characters' using errcode='22023';end if;
  select id into cid from public.i_bet_you_categories where active and(host_id is null or host_id=e.host_id)and lower(trim(i_bet_you_categories.title))=lower(v_title)order by host_id nulls first limit 1;
  if cid is null then insert into public.i_bet_you_categories(title,difficulty,category_type,host_id)values(v_title,'easy','custom',e.host_id)returning id into cid;end if;
  if coalesce((item->>'selected')::boolean,true)then selected:=array_append(selected,cid);end if;
 end loop;
 select array_agg(distinct x)into selected from unnest(selected)x;
 if coalesce(cardinality(selected),0)=0 then raise exception 'select at least one category' using errcode='22023';end if;
 insert into private.host_game_preferences(host_id,i_bet_you_category_ids)values(e.host_id,selected)on conflict(host_id)do update set i_bet_you_category_ids=excluded.i_bet_you_category_ids;
 select id into rid from public.event_rounds where event_id=e.id and game_type='i_bet_you';
 if rid is null then
  insert into public.event_rounds(event_id,position,game_type,title,settings)values(e.id,coalesce((select max(position)+1 from public.event_rounds where event_id=e.id),1),'i_bet_you','I Bet You',jsonb_build_object('timer_seconds',60,'points',5,'category_ids',to_jsonb(selected)));
 else update public.event_rounds set settings=settings||jsonb_build_object('category_ids',to_jsonb(selected))where id=rid;end if;
 update public.events set state_version=state_version+1 where id=e.id returning * into e;
 perform private.notify_event(e.id,e.state_version,'i_bet_you_settings_saved');
 return private.host_game_defaults(e.id)->'i_bet_you';
end $$;

create or replace function public.setup_i_bet_you_round_before_pause(p_event_id uuid) returns jsonb
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

  -- Freeze the selected pool before assigning groups; future defaults cannot change it.
  if not exists(select 1 from public.event_rounds where id=v_round_id and settings ? 'category_ids')then
    update public.event_rounds set settings=settings||jsonb_build_object('category_ids',(select jsonb_agg(id)from private.i_bet_you_category_pool(p_event_id)))where id=v_round_id;
  end if;

  insert into public.i_bet_you_round_states(round_id,event_id,status)
  values(v_round_id,p_event_id,'setup')
  on conflict(round_id) do update set active_group_id=null,status='setup';

  insert into public.i_bet_you_groups(event_id,round_id,position,category_id)
  select p_event_id,v_round_id,c.n,c.id
  from(
    select row_number()over()::integer n,id
    from(select id from private.i_bet_you_category_pool(p_event_id) order by random() limit v_group_count)picked
  )c;
  get diagnostics v_created_count=row_count;
  if v_created_count<>v_group_count then raise exception 'Select at least one different category per group before starting I Bet You.';end if;

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

create or replace function public.change_i_bet_you_category_before_pause(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.i_bet_you_groups;cid uuid;
begin
 g:=private.assert_i_bet_you_host(p_group_id);
 if g.state<>'waiting'then raise exception 'category is locked for this group';end if;
 select c.id into cid from private.i_bet_you_category_pool(g.event_id)c where c.id not in(select category_id from public.i_bet_you_groups where round_id=g.round_id)order by random()limit 1;
 if cid is null then raise exception 'No unused selected category is available.';end if;
 update public.i_bet_you_groups set category_id=cid where id=g.id;
 perform private.notify_i_bet_you(g.event_id,'i_bet_you_category_changed');return private.i_bet_you_state(g.event_id);
end $$;

-- Remember only a successfully saved, validated lineup. Keep per-game answers untouched.
create or replace function public.save_guess_age_round(p_event_id uuid,p_title text,p_questions jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;owner_id uuid;lineup jsonb;
begin
 perform private.assert_game_not_paused(p_event_id,'guess_age');
 rid:=public.save_guess_age_round_before_pause(p_event_id,p_title,p_questions);
 select host_id into owner_id from public.events where id=p_event_id;
 select jsonb_agg(jsonb_build_object('celebrity_id',c.id,'celebrity_name',c.display_name,'date_of_birth',qs.date_of_birth,'image_kind',c.image_kind,'image_path',c.image_path,'external_image_url',c.external_image_url,'image_source',c.image_source,'source_reference',c.source_reference)order by q.position)into lineup
 from public.questions q join public.question_secrets qs on qs.question_id=q.id join public.celebrities c on c.id=q.celebrity_id where q.round_id=rid;
 insert into private.host_game_preferences(host_id,guess_age_lineup)values(owner_id,lineup)on conflict(host_id)do update set guess_age_lineup=excluded.guess_age_lineup;
 return rid;
end $$;

alter function public.get_host_event_state(uuid) rename to get_host_event_state_before_defaults;
create function public.get_host_event_state(p_event_id uuid)returns jsonb
language sql stable security definer set search_path='' as $$
 select s||jsonb_build_object('game_defaults',private.host_game_defaults(p_event_id))from public.get_host_event_state_before_defaults(p_event_id)s
$$;
revoke all on function public.get_host_event_state_before_defaults(uuid),private.i_bet_you_category_pool(uuid),private.host_game_defaults(uuid) from public,anon,authenticated;
revoke all on function public.save_i_bet_you_settings(uuid,uuid[],jsonb),public.get_host_event_state(uuid) from public,anon;
grant execute on function public.save_i_bet_you_settings(uuid,uuid[],jsonb),public.get_host_event_state(uuid) to authenticated;
