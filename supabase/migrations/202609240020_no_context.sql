-- No Context: private input, frozen participation, authoritative deadlines and podium.
create table public.no_context_prompts (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.event_rounds(id) on delete cascade,
  position integer not null check(position between 1 and 5),
  instruction text not null check(char_length(btrim(instruction)) between 1 and 240),
  media jsonb not null check(media->>'type'='image' and media->>'url' like '/no-context/%'),
  unique(round_id,position)
);
create table public.no_context_plays (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  prompt_id uuid not null references public.no_context_prompts(id) on delete cascade,
  phase text not null default 'ready' check(phase in('ready','responses','reading','voting','tiebreak','results','reveal','round_complete','complete')),
  deadline_at timestamptz,
  ballot integer not null default 0 check(ballot between 0 and 3),
  page integer not null default 0 check(page>=0),
  revealed_place integer not null default 4 check(revealed_place between 1 and 4),
  random_resolution boolean not null default false,
  unique(prompt_id)
);
create table public.no_context_games (
  event_id uuid primary key references public.events(id) on delete cascade,
  round_id uuid unique not null references public.event_rounds(id) on delete cascade,
  active_play_id uuid references public.no_context_plays(id) on delete set null
);
create table public.no_context_participants (
  play_id uuid references public.no_context_plays(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  primary key(play_id,team_id)
);
create table public.no_context_responses (
  id uuid primary key default gen_random_uuid(),
  play_id uuid not null references public.no_context_plays(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 140 and body !~ '^[[:space:]]*$'),
  display_position integer,
  original_votes integer not null default 0,
  final_votes integer not null default 0,
  tie_group integer not null default 0,
  resolved boolean not null default false,
  placement integer check(placement between 1 and 3),
  unique(play_id,team_id), unique(id,play_id), unique(play_id,placement),
  foreign key(play_id,team_id) references public.no_context_participants(play_id,team_id) on delete cascade
);
create table public.no_context_votes (
  play_id uuid not null,
  team_id uuid not null,
  ballot integer not null check(ballot between 0 and 3),
  response_id uuid not null,
  primary key(play_id,team_id,ballot),
  foreign key(play_id,team_id) references public.no_context_participants(play_id,team_id) on delete cascade,
  foreign key(response_id,play_id) references public.no_context_responses(id,play_id) on delete cascade
);
create index no_context_due on public.no_context_plays(deadline_at) where deadline_at is not null;
-- No direct reads, even for the host: only deliberately shaped RPC payloads.
alter table public.no_context_prompts enable row level security;
alter table public.no_context_plays enable row level security;
alter table public.no_context_games enable row level security;
alter table public.no_context_participants enable row level security;
alter table public.no_context_responses enable row level security;
alter table public.no_context_votes enable row level security;
revoke all on public.no_context_prompts,public.no_context_plays,public.no_context_games,public.no_context_participants,public.no_context_responses,public.no_context_votes from public,anon,authenticated;
alter table public.score_awards drop constraint score_awards_shape;
alter table public.score_awards add constraint score_awards_shape check(
 (kind='game' and(question_id is not null or metadata->>'game_type' in('i_bet_you','perfect_lie','no_context')))or
 (kind='manual_correction' and char_length(trim(reason)) between 1 and 500));
create unique index score_awards_no_context_key on public.score_awards((metadata->>'award_key'))
 where kind='game' and metadata->>'game_type'='no_context';

create function private.notify_no_context(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v bigint;
begin
 update public.events set state_version=state_version+1 where id=p_event_id returning state_version into v;
 perform private.notify_event(p_event_id,v,'no_context_changed');
end $$;

-- One helper finishes a ballot. The caller holds the event and play locks.
-- Original vote groups get immutable rank offsets. Each affected group is voted on
-- once; random() only orders equal totals within that group on the second ballot.
create function private.close_no_context_vote(p_play_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.no_context_plays; g integer; eligible integer; total integer;
begin
 select * into p from public.no_context_plays where id=p_play_id for update;
 if p.phase not in('voting','tiebreak') then return;end if;
 if p.ballot=0 then
   update public.no_context_responses r set original_votes=(select count(*) from public.no_context_votes v where v.play_id=p.id and v.ballot=0 and v.response_id=r.id) where r.play_id=p.id;
   select count(*) into total from public.no_context_votes where play_id=p.id and ballot=0;
   if total=0 then
     with ordered as(select id,row_number()over(order by random())::integer pos from public.no_context_responses where play_id=p.id)
     update public.no_context_responses r set resolved=true,placement=case when o.pos<=3 then o.pos end from ordered o where r.id=o.id;
     update public.no_context_plays set random_resolution=(select count(*)>1 from public.no_context_responses where play_id=p.id) where id=p.id;
   else
     with ranked as(select id,original_votes,rank()over(order by original_votes desc)::integer pos,count(*)over(partition by original_votes) n from public.no_context_responses where play_id=p.id)
     update public.no_context_responses r set final_votes=x.original_votes,
       placement=case when x.n=1 and x.pos<=3 then x.pos end,
       tie_group=case when x.n>1 and x.pos<=3 then x.pos else 0 end,
       resolved=(x.n=1 or x.pos>3)
     from ranked x where r.id=x.id;
   end if;
 else
   update public.no_context_responses r set final_votes=(select count(*)from public.no_context_votes v where v.play_id=p.id and v.ballot=p.ballot and v.response_id=r.id) where r.play_id=p.id and r.tie_group=p.ballot;
   if exists(select 1 from public.no_context_responses where play_id=p.id and tie_group=p.ballot group by final_votes having count(*)>1 and p.ballot+(select count(*) from public.no_context_responses z where z.play_id=p.id and z.tie_group=p.ballot and z.final_votes>no_context_responses.final_votes)<=3) then
     update public.no_context_plays set random_resolution=true where id=p.id;
   end if;
   with ordered as(select id,p.ballot+row_number()over(order by final_votes desc,random())::integer-1 pos from public.no_context_responses where play_id=p.id and tie_group=p.ballot)
   update public.no_context_responses r set resolved=true,placement=case when o.pos<=3 then o.pos end from ordered o where r.id=o.id;
 end if;
 -- There can be more than one independent tied group touching the podium.
 loop
   select min(tie_group) into g from public.no_context_responses where play_id=p.id and not resolved;
   exit when g is null;
   select count(*) into eligible from public.no_context_participants t where t.play_id=p.id and exists(select 1 from public.no_context_responses r where r.play_id=p.id and r.tie_group=g and r.team_id<>t.team_id);
   if eligible>=2 then
     update public.no_context_plays set phase='tiebreak',ballot=g,deadline_at=clock_timestamp()+interval '15 seconds',page=0 where id=p.id;
     return;
   end if;
   with ordered as(select id,g+row_number()over(order by random())::integer-1 pos from public.no_context_responses where play_id=p.id and tie_group=g)
   update public.no_context_responses r set resolved=true,placement=case when o.pos<=3 then o.pos end from ordered o where r.id=o.id;
   update public.no_context_plays set random_resolution=true where id=p.id;
 end loop;
 update public.no_context_plays set phase='results',deadline_at=null,page=0 where id=p.id;
end $$;

create function private.close_no_context_responses(p_play_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.no_context_plays where id=p_play_id and phase='responses')then return;end if;
 with ordered as(select id,row_number()over(order by random())::integer pos from public.no_context_responses where play_id=p_play_id)
 update public.no_context_responses r set display_position=o.pos from ordered o where r.id=o.id;
 update public.no_context_plays set phase='reading',deadline_at=null,page=0 where id=p_play_id;
end $$;

create function public.setup_no_context(p_event_id uuid,p_prompts jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid; q jsonb; n integer:=0; first_play uuid;
begin
 if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
 perform 1 from public.events where id=p_event_id and status<>'ended' for update;
 if not found then raise exception 'event unavailable';end if;
 select round_id into rid from public.no_context_games where event_id=p_event_id;
 if found then return rid;end if; -- Setup retries cannot erase an in-progress game.
 if jsonb_typeof(p_prompts)<>'array' or jsonb_array_length(p_prompts)<>5 or p_prompts is null then raise exception 'five prompts required';end if;
 insert into public.event_rounds(event_id,position,game_type,title)values(p_event_id,(select coalesce(max(position),0)+1 from public.event_rounds where event_id=p_event_id),'no_context','No Context')returning id into rid;
 for q in select value from jsonb_array_elements(p_prompts)loop
   n:=n+1;
   if q->'media'->>'type' is distinct from 'image' or coalesce(q->'media'->>'url','') !~ '^/no-context/[a-z0-9-]+[.]svg$' then raise exception 'local test image required';end if;
   insert into public.no_context_prompts(round_id,position,instruction,media)values(rid,n,btrim(q->>'instruction'),q->'media');
 end loop;
 insert into public.no_context_plays(event_id,prompt_id)select p_event_id,id from public.no_context_prompts where round_id=rid;
 select p.id into first_play from public.no_context_plays p join public.no_context_prompts q on q.id=p.prompt_id where q.round_id=rid and q.position=1;
 insert into public.no_context_games values(p_event_id,rid,first_play);
 perform private.notify_no_context(p_event_id);return rid;
end $$;

create function public.no_context_control(p_event_id uuid,p_play_id uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events; g public.no_context_games; p public.no_context_plays; pos integer; next_id uuid; place integer; options integer;
begin
 if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
 select * into e from public.events where id=p_event_id for update;
 if e.status='ended' then raise exception 'event ended';end if;
 select * into g from public.no_context_games where event_id=p_event_id;
 if not found or g.active_play_id is distinct from p_play_id then raise exception 'stale round; refresh';end if;
 select * into p from public.no_context_plays where id=p_play_id for update;
 select position into pos from public.no_context_prompts where id=p.prompt_id;
 if p_action in('start','resume','restart') then
   if e.active_round_id is distinct from g.round_id and e.status in('question','suspense')then raise exception 'finish the current live question first';end if;
   update public.events set active_round_id=g.round_id,active_question_id=null,question_started_at=null,question_deadline_at=null,question_reveal_due_at=null,question_revealed_at=null,display_mode='game',status='ready' where id=e.id;
 elsif e.active_round_id is distinct from g.round_id then raise exception 'activate No Context first';end if;
 if p_action='start' then
   if p.phase<>'ready' then raise exception 'round already started';end if;
   insert into public.no_context_participants select p.id,id from public.teams where event_id=e.id and status='active';
   update public.no_context_plays set phase='responses',deadline_at=clock_timestamp()+interval '45 seconds' where id=p.id;
 elsif p_action='close_responses' then
   perform private.close_no_context_responses(p.id);
 elsif p_action in('page_next','page_previous') then
   if p.phase not in('reading','voting','tiebreak')then raise exception 'responses are not being presented';end if;
   select count(*) into options from public.no_context_responses where play_id=p.id and (p.phase<>'tiebreak' or tie_group=p.ballot);
   update public.no_context_plays set page=greatest(0,least(greatest(0,(options-1)/4),page+case when p_action='page_next' then 1 else -1 end)) where id=p.id;
 elsif p_action='start_voting' then
   if p.phase<>'reading' then raise exception 'read responses before voting';end if;
   select count(*) into options from public.no_context_responses where play_id=p.id;
   update public.no_context_plays set phase='voting',ballot=0,deadline_at=clock_timestamp()+interval '30 seconds',page=0 where id=p.id;
   -- Zero/one response cannot produce a meaningful ordering.
   if options<=1 then perform private.close_no_context_vote(p.id);end if;
 elsif p_action ~ '^close_voting_[0-3]$' then
   if p.ballot<>right(p_action,1)::integer then return;end if;
   perform private.close_no_context_vote(p.id);
 elsif p_action in('reveal_3','reveal_2','reveal_1') then
   place:=right(p_action,1)::integer;
   if p.revealed_place<=place then return;end if; -- A repeated reveal is a no-op.
   if p.phase not in('results','reveal') or p.revealed_place<>place+1 then raise exception 'reveal in podium order';end if;
   insert into public.score_awards(event_id,team_id,points,kind,reason,created_by,metadata)
   select e.id,r.team_id,case place when 1 then 5 when 2 then 3 else 1 end,'game','No Context - Round '||pos||' - Place '||place,auth.uid(),
     jsonb_build_object('game_type','no_context','round_id',g.round_id,'play_id',p.id,'placement',place,'award_key',p.id::text||':'||r.team_id::text)
   from public.no_context_responses r where r.play_id=p.id and r.placement=place
   on conflict((metadata->>'award_key'))where kind='game' and metadata->>'game_type'='no_context' do nothing;
   update public.no_context_plays set revealed_place=place,phase=case when place=1 then 'round_complete' else 'reveal' end where id=p.id;
 elsif p_action='next' then
   if p.phase<>'round_complete' or pos>=5 then raise exception 'finish this reveal before the next round';end if;
   select x.id into next_id from public.no_context_plays x join public.no_context_prompts q on q.id=x.prompt_id where q.round_id=g.round_id and q.position=pos+1;
   update public.no_context_games set active_play_id=next_id where event_id=e.id;
 elsif p_action='finish' then
   if pos<>5 or p.phase not in('round_complete','complete')then raise exception 'complete all five rounds first';end if;
   update public.no_context_plays set phase='complete' where id=p.id;
   update public.events set status='round_complete',display_mode='leaderboard' where id=e.id;
 elsif p_action='restart' then
   delete from public.score_awards where event_id=e.id and kind='game' and metadata->>'game_type'='no_context' and metadata->>'round_id'=g.round_id::text;
   delete from public.no_context_plays where event_id=e.id;
   insert into public.no_context_plays(event_id,prompt_id)select e.id,id from public.no_context_prompts where round_id=g.round_id;
   select x.id into next_id from public.no_context_plays x join public.no_context_prompts q on q.id=x.prompt_id where q.round_id=g.round_id and q.position=1;
   update public.no_context_games set active_play_id=next_id where event_id=e.id;
 elsif p_action<>'resume' then raise exception 'unknown No Context action';
 end if;
 select x.* into p from public.no_context_plays x join public.no_context_games ng on ng.active_play_id=x.id where ng.event_id=e.id;
 update public.events set status=case when p.phase in('responses','voting','tiebreak')then 'question' when p.phase in('results','reveal')then 'reveal' when p.phase in('round_complete','complete')then 'round_complete' else 'ready' end where id=e.id;
 perform private.notify_no_context(e.id);
end $$;

create function public.submit_no_context_response(p_team_id uuid,p_play_id uuid,p_response text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.no_context_plays; eid uuid; body text;
begin
 if not private.owns_team(p_team_id)then raise exception 'Team ownership required' using errcode='42501';end if;
 select event_id into eid from public.teams where id=p_team_id;
 perform 1 from public.events where id=eid and status<>'ended' for update;
 if not found then raise exception 'event unavailable';end if;
 select x.* into p from public.no_context_plays x join public.no_context_games g on g.active_play_id=x.id join public.events e on e.id=g.event_id and e.active_round_id=g.round_id where x.id=p_play_id and x.event_id=eid for update of x;
 if not found or p.phase<>'responses' or clock_timestamp()>=p.deadline_at then raise exception 'responses are closed';end if;
 if not exists(select 1 from public.no_context_participants where play_id=p.id and team_id=p_team_id)then raise exception 'team is not participating';end if;
 body:=regexp_replace(coalesce(p_response,''),'^[[:space:]]+|[[:space:]]+$','','g');
 if char_length(body) not between 1 and 140 then raise exception 'response must be 1 to 140 characters' using errcode='22023';end if;
 insert into public.no_context_responses(play_id,team_id,body)values(p.id,p_team_id,body)on conflict(play_id,team_id)do update set body=excluded.body;
 perform private.notify_no_context(eid);
end $$;

create function public.submit_no_context_vote(p_team_id uuid,p_play_id uuid,p_response_id uuid,p_ballot integer) returns void
language plpgsql security definer set search_path='' as $$
declare p public.no_context_plays; r public.no_context_responses; eid uuid;
begin
 if not private.owns_team(p_team_id)then raise exception 'Team ownership required' using errcode='42501';end if;
 select event_id into eid from public.teams where id=p_team_id;
 perform 1 from public.events where id=eid and status<>'ended' for update;
 if not found then raise exception 'event unavailable';end if;
 select x.* into p from public.no_context_plays x join public.no_context_games g on g.active_play_id=x.id join public.events e on e.id=g.event_id and e.active_round_id=g.round_id where x.id=p_play_id and x.event_id=eid for update of x;
 if not found or p.phase not in('voting','tiebreak') or clock_timestamp()>=p.deadline_at or p_ballot is distinct from p.ballot then raise exception 'voting is closed';end if;
 if not exists(select 1 from public.no_context_participants where play_id=p.id and team_id=p_team_id)then raise exception 'team is not participating';end if;
 select * into r from public.no_context_responses where id=p_response_id and play_id=p.id;
 if not found or (p.phase='tiebreak' and r.tie_group<>p.ballot)then raise exception 'ineligible response';end if;
 if r.team_id=p_team_id then raise exception 'You cannot vote for your own response.' using errcode='42501';end if;
 insert into public.no_context_votes values(p.id,p_team_id,p.ballot,r.id)on conflict(play_id,team_id,ballot)do update set response_id=excluded.response_id;
 perform private.notify_no_context(eid);
end $$;

create function private.process_no_context_transitions(p_now timestamptz default clock_timestamp()) returns integer
language plpgsql security definer set search_path='' as $$
declare e public.events; p public.no_context_plays; n integer:=0;
begin
 -- Same lock order as Host/Captain mutations; SKIP LOCKED lets the next tick retry.
 for e in select ev.* from public.events ev join public.no_context_games g on g.event_id=ev.id join public.no_context_plays x on x.id=g.active_play_id where ev.status<>'ended' and x.deadline_at<=p_now and x.phase in('responses','voting','tiebreak') for update of ev skip locked loop
   select x.* into p from public.no_context_plays x join public.no_context_games g on g.active_play_id=x.id where g.event_id=e.id for update of x;
   if p.phase='responses' then perform private.close_no_context_responses(p.id);else perform private.close_no_context_vote(p.id);end if;
   if e.active_round_id=(select round_id from public.no_context_games where event_id=e.id) then
     update public.events set status=case when (select phase from public.no_context_plays where id=p.id)='tiebreak' then 'question' when (select phase from public.no_context_plays where id=p.id)='results' then 'reveal' else 'ready' end where id=e.id;
   end if;
   perform private.notify_no_context(e.id);n:=n+1;
 end loop;
 return n;
end $$;

-- This is the only response/result projection exposed to browsers. Author IDs,
-- original vote counts, rankings and tie groups never appear in anonymous options.
create function private.no_context_state(p_event_id uuid,p_team_id uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'round',jsonb_build_object('id',g.round_id,'game_type','no_context','title','No Context','position',er.position),
  'play',jsonb_build_object('id',p.id,'number',q.position,'phase',p.phase,'deadline_at',p.deadline_at,'ballot',p.ballot,'page',p.page,'revealed_place',p.revealed_place,'random_resolution',p.random_resolution),
  'prompt',jsonb_build_object('instruction',q.instruction,'media',q.media),
  'team_count',(select count(*) from public.no_context_participants where play_id=p.id),
  'response_count',(select count(*) from public.no_context_responses where play_id=p.id),
  'eligible_count',(select count(*)from public.no_context_participants t where t.play_id=p.id and exists(select 1 from public.no_context_responses r where r.play_id=p.id and r.team_id<>t.team_id and(p.phase<>'tiebreak' or r.tie_group=p.ballot))),
  'vote_count',(select count(*)from public.no_context_votes where play_id=p.id and ballot=p.ballot),
  'participating',exists(select 1 from public.no_context_participants where play_id=p.id and team_id=p_team_id),
  'options',case when p.phase in('reading','voting','tiebreak')then coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'text',r.body,'is_own',coalesce(r.team_id=p_team_id,false))order by r.display_position)from public.no_context_responses r where r.play_id=p.id and(p.phase<>'tiebreak' or r.tie_group=p.ballot)),'[]'::jsonb)else '[]'::jsonb end,
  'my_response',case when p_team_id is not null then(select body from public.no_context_responses where play_id=p.id and team_id=p_team_id)end,
  'my_vote',case when p_team_id is not null then(select response_id from public.no_context_votes where play_id=p.id and team_id=p_team_id and ballot=p.ballot)end,
  'revealed',coalesce((select jsonb_agg(jsonb_build_object('placement',r.placement,'text',r.body,'team_id',r.team_id,'name',t.name,'mascot_id',t.mascot_id,'votes',r.final_votes,'original_votes',r.original_votes,'tiebreak',r.tie_group>0,'points',case r.placement when 1 then 5 when 2 then 3 else 1 end)order by r.placement desc)from public.no_context_responses r join public.teams t on t.id=r.team_id where r.play_id=p.id and r.placement>=p.revealed_place),'[]'::jsonb)
 )from public.no_context_games g join public.event_rounds er on er.id=g.round_id join public.no_context_plays p on p.id=g.active_play_id join public.no_context_prompts q on q.id=p.prompt_id where g.event_id=p_event_id
$$;

alter function public.get_public_room_state(text) rename to get_public_room_state_before_no_context;
create function public.get_public_room_state(p_room_code text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when s is null then null else s||jsonb_build_object('no_context',case when s->'event'->>'active_round_id'=n->'round'->>'id' then n end)end from public.get_public_room_state_before_no_context(p_room_code)s left join lateral private.no_context_state((s->'event'->>'id')::uuid)n on true
$$;
alter function public.get_team_room_state(text) rename to get_team_room_state_before_no_context;
create function public.get_team_room_state(p_room_code text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when s is null then null else s||jsonb_build_object('no_context',case when s->'event'->>'active_round_id'=n->'round'->>'id' then n end)end from public.get_team_room_state_before_no_context(p_room_code)s left join lateral private.no_context_state((s->'event'->>'id')::uuid,(s->'team'->>'id')::uuid)n on true
$$;
alter function public.get_host_event_state(uuid) rename to get_host_event_state_before_no_context;
create function public.get_host_event_state(p_event_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when s is null then null else s||jsonb_build_object('no_context',private.no_context_state(p_event_id))end from public.get_host_event_state_before_no_context(p_event_id)s
$$;
revoke all on function public.get_public_room_state_before_no_context(text),public.get_team_room_state_before_no_context(text),public.get_host_event_state_before_no_context(uuid) from public,anon,authenticated;
revoke all on function public.setup_no_context(uuid,jsonb),public.no_context_control(uuid,uuid,text),public.submit_no_context_response(uuid,uuid,text),public.submit_no_context_vote(uuid,uuid,uuid,integer),public.get_public_room_state(text),public.get_team_room_state(text),public.get_host_event_state(uuid) from public,anon,authenticated;
grant execute on function public.setup_no_context(uuid,jsonb),public.no_context_control(uuid,uuid,text),public.submit_no_context_response(uuid,uuid,text),public.submit_no_context_vote(uuid,uuid,uuid,integer),public.get_public_room_state(text),public.get_team_room_state(text),public.get_host_event_state(uuid) to authenticated;
revoke all on function private.notify_no_context(uuid),private.close_no_context_vote(uuid),private.close_no_context_responses(uuid),private.process_no_context_transitions(timestamptz),private.no_context_state(uuid,uuid) from public,anon,authenticated;
select cron.schedule('gamenight-no-context-transitions','1 second',$$select private.process_no_context_transitions()$$);
