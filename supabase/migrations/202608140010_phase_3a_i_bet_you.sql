-- Phase 3A: authoritative I Bet You MVP.

create table public.i_bet_you_categories (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  active boolean not null default true,
  difficulty text not null,
  category_type text not null default 'general',
  created_at timestamptz not null default now(),
  constraint i_bet_you_category_title_length check(char_length(trim(title)) between 2 and 120),
  constraint i_bet_you_category_difficulty check(difficulty in ('easy','medium','hard')),
  constraint i_bet_you_category_type check(category_type ~ '^[a-z][a-z0-9_]{1,39}$')
);

insert into public.i_bet_you_categories(title,difficulty,category_type) values
('Pokémon','medium','gaming'),('Marvel Heroes','medium','entertainment'),('Superheroes','easy','entertainment'),('Supervillains','medium','entertainment'),('Comics','hard','entertainment'),
('Premier League Teams','easy','sport'),('Disney Movies','easy','entertainment'),('James Bond Films','medium','entertainment'),('Beyoncé Songs','medium','music'),('Pizza Toppings','easy','food'),
('Dog Breeds','easy','general'),('Capital Cities','medium','geography'),('Friends Characters','easy','entertainment'),('Football World Cup Winners','medium','sport'),('Harry Potter Spells','medium','entertainment'),
('Fast Food Chains','easy','food'),('Taylor Swift Albums','medium','music'),('Olympic Sports','easy','sport'),('Video Games','easy','gaming'),('Video Game Characters','medium','gaming'),
('Types of Cheese','easy','food'),('Countries in Europe','easy','geography'),('Countries in Africa','medium','geography'),('Countries in Asia','medium','geography'),('90s TV Shows','medium','entertainment'),
('Types of Pasta','easy','food'),('NBA Teams','medium','sport'),('Cocktails','medium','food'),('Roald Dahl Books','medium','entertainment'),('F1 Drivers','medium','sport'),
('Football Players','easy','sport'),('Basketball Players','easy','sport'),('Films','easy','entertainment'),('TV Shows','easy','entertainment'),('Boys Names','easy','general'),
('Girls Names','easy','general'),('Breakfasts','easy','food'),('Pop Singers','easy','music'),('Rock Bands','easy','music'),('DJs','medium','music'),
('Blue-colour Characters','hard','entertainment'),('Things in a Kitchen','easy','general'),('Animated TV Shows','medium','entertainment'),('Animated Movies','easy','entertainment'),('Romantic Movies','medium','entertainment'),
('Animals','easy','general'),('Car Brands','easy','general'),('Chocolate Bars','easy','food'),('Crisps','easy','food'),('Board Games','easy','gaming'),
('Famous Actors','easy','entertainment'),('Famous Actresses','easy','entertainment'),('Disney Characters','easy','entertainment'),('Pixar Films','medium','entertainment'),('Sitcoms','easy','entertainment'),
('Reality TV Shows','medium','entertainment'),('Premier League Players','medium','sport'),('Champions League Winners','hard','sport'),('Football Stadiums','medium','sport'),('Pokémon Types','hard','gaming'),
('Nintendo Characters','medium','gaming'),('PlayStation Games','medium','gaming'),('Xbox Games','medium','gaming'),('Fast Food Menu Items','easy','food'),('Ice Cream Flavours','easy','food'),
('Things You’d Find in a Pub','easy','general'),('Things in a Supermarket','easy','general'),('Things You’d Pack for a Holiday','easy','general'),('Things You’d Find in a Bathroom','easy','general'),
('Musical Instruments','easy','music'),('Clothing Brands','easy','general'),('Shoe Brands','easy','general'),('European Capitals','medium','geography'),('American Cities','easy','geography');

create table public.i_bet_you_groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  round_id uuid not null,
  position integer not null,
  category_id uuid not null references public.i_bet_you_categories(id) on delete restrict,
  state text not null default 'waiting',
  current_bidder_team_id uuid,
  current_bid integer,
  challenged_bidder_team_id uuid,
  challenger_team_id uuid,
  target_bid integer,
  countdown_started_at timestamptz,
  countdown_deadline_at timestamptz,
  result text,
  winning_team_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ibet_group_round_event_fk foreign key(round_id,event_id) references public.event_rounds(id,event_id) on delete cascade,
  constraint ibet_group_bidder_fk foreign key(current_bidder_team_id,event_id) references public.teams(id,event_id),
  constraint ibet_group_challenged_fk foreign key(challenged_bidder_team_id,event_id) references public.teams(id,event_id),
  constraint ibet_group_challenger_fk foreign key(challenger_team_id,event_id) references public.teams(id,event_id),
  constraint ibet_group_winner_fk foreign key(winning_team_id,event_id) references public.teams(id,event_id),
  constraint ibet_group_position_positive check(position>0),
  constraint ibet_group_state check(state in ('waiting','bidding','challenged','countdown','result','complete')),
  constraint ibet_group_result check(result is null or result in ('success','fail')),
  constraint ibet_group_bid_range check(current_bid is null or current_bid between 1 and 100),
  constraint ibet_group_target_range check(target_bid is null or target_bid between 1 and 100),
  unique(round_id,position),unique(id,event_id)
);
create trigger i_bet_you_groups_updated_at before update on public.i_bet_you_groups for each row execute function private.set_updated_at();
create index ibet_groups_round_position_idx on public.i_bet_you_groups(round_id,position);

create table public.i_bet_you_group_members (
  group_id uuid not null references public.i_bet_you_groups(id) on delete cascade,
  round_id uuid not null references public.event_rounds(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  team_id uuid not null,
  position integer not null,
  primary key(group_id,team_id),
  constraint ibet_member_team_event_fk foreign key(team_id,event_id) references public.teams(id,event_id) on delete cascade,
  constraint ibet_member_group_event_fk foreign key(group_id,event_id) references public.i_bet_you_groups(id,event_id) on delete cascade,
  constraint ibet_member_position_positive check(position>0),
  unique(round_id,team_id),unique(group_id,position)
);

create table public.i_bet_you_round_states (
  round_id uuid primary key references public.event_rounds(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  active_group_id uuid references public.i_bet_you_groups(id) on delete set null,
  status text not null default 'setup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ibet_round_state_status check(status in ('setup','playing','complete')),
  unique(round_id,event_id)
);
create trigger i_bet_you_round_states_updated_at before update on public.i_bet_you_round_states for each row execute function private.set_updated_at();

alter table public.score_awards drop constraint score_awards_shape;
alter table public.score_awards add constraint score_awards_shape check(
  (kind='game' and (question_id is not null or metadata->>'game_type'='i_bet_you')) or
  (kind='manual_correction' and char_length(trim(reason)) between 1 and 500)
);
create unique index score_awards_i_bet_you_group_unique
  on public.score_awards((metadata->>'i_bet_you_group_id'))
  where kind='game' and metadata->>'game_type'='i_bet_you';

alter table public.i_bet_you_categories enable row level security;
alter table public.i_bet_you_groups enable row level security;
alter table public.i_bet_you_group_members enable row level security;
alter table public.i_bet_you_round_states enable row level security;
revoke all on public.i_bet_you_categories,public.i_bet_you_groups,public.i_bet_you_group_members,public.i_bet_you_round_states from public,anon,authenticated;

create function private.i_bet_you_state(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when rs.round_id is null then null else jsonb_build_object(
    'round',jsonb_build_object('id',r.id,'title',r.title,'position',r.position,'game_type',r.game_type,'status',rs.status,'active_group_id',rs.active_group_id),
    'groups',coalesce((select jsonb_agg(jsonb_build_object(
      'id',g.id,'position',g.position,'state',g.state,
      'category',jsonb_build_object('id',c.id,'title',c.title,'difficulty',c.difficulty,'type',c.category_type),
      'members',coalesce((select jsonb_agg(jsonb_build_object('team_id',t.id,'name',t.name,'position',m.position) order by m.position) from public.i_bet_you_group_members m join public.teams t on t.id=m.team_id where m.group_id=g.id),'[]'::jsonb),
      'current_bidder_team_id',g.current_bidder_team_id,'current_bid',g.current_bid,
      'challenged_bidder_team_id',g.challenged_bidder_team_id,'challenger_team_id',g.challenger_team_id,'target_bid',g.target_bid,
      'countdown_started_at',g.countdown_started_at,'countdown_deadline_at',g.countdown_deadline_at,
      'result',g.result,'winning_team_id',g.winning_team_id,'completed_at',g.completed_at
    ) order by g.position) from public.i_bet_you_groups g join public.i_bet_you_categories c on c.id=g.category_id where g.round_id=r.id),'[]'::jsonb)
  ) end
  from public.event_rounds r join public.i_bet_you_round_states rs on rs.round_id=r.id
  where r.event_id=p_event_id and r.game_type='i_bet_you' order by r.position limit 1
$$;
revoke all on function private.i_bet_you_state(uuid) from public,anon,authenticated;

create function public.setup_i_bet_you_round(p_event_id uuid,p_group_count integer default 3) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_round_id uuid;v_team_count integer;v_group_count integer;v_first_group uuid;
begin
  if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode='42501';end if;
  select count(*) into v_team_count from public.teams where event_id=p_event_id and status='active';
  if v_team_count<2 then raise exception 'At least two active Teams are required' using errcode='22023';end if;
  v_group_count:=least(greatest(coalesce(p_group_count,3),1),v_team_count);
  select id into v_round_id from public.event_rounds where event_id=p_event_id and game_type='i_bet_you' order by position limit 1;
  if v_round_id is null then insert into public.event_rounds(event_id,position,game_type,title,settings)
    values(p_event_id,coalesce((select max(position)+1 from public.event_rounds where event_id=p_event_id),1),'i_bet_you','I Bet You',jsonb_build_object('timer_seconds',60,'points',5)) returning id into v_round_id;
  else
    if exists(select 1 from public.i_bet_you_round_states where round_id=v_round_id and status<>'setup') or exists(select 1 from public.i_bet_you_groups where round_id=v_round_id and state<>'waiting') then raise exception 'grouping is locked after gameplay begins';end if;
    delete from public.i_bet_you_groups where round_id=v_round_id;
  end if;
  insert into public.i_bet_you_round_states(round_id,event_id,status) values(v_round_id,p_event_id,'setup') on conflict(round_id) do update set active_group_id=null,status='setup';
  insert into public.i_bet_you_groups(event_id,round_id,position,category_id)
    select p_event_id,v_round_id,c.n,c.id from(select row_number()over()::integer n,id from(select id from public.i_bet_you_categories where active and difficulty='easy' order by random() limit v_group_count)picked)c;
  insert into public.i_bet_you_group_members(group_id,round_id,event_id,team_id,position)
  select g.id,v_round_id,p_event_id,t.id,row_number()over(partition by g.id order by t.n)
  from(select row_number()over(order by random()) n,id from public.teams where event_id=p_event_id and status='active')t
  join public.i_bet_you_groups g on g.round_id=v_round_id and g.position=((t.n-1)%v_group_count)+1;
  select id into v_first_group from public.i_bet_you_groups where round_id=v_round_id order by position limit 1;
  update public.i_bet_you_round_states set active_group_id=v_first_group where round_id=v_round_id;
  update public.events set active_round_id=v_round_id,active_question_id=null,status='ready',display_mode='game',state_version=state_version+1 where id=p_event_id;
  perform private.notify_event(p_event_id,(select state_version from public.events where id=p_event_id),'i_bet_you_setup');return private.i_bet_you_state(p_event_id);
end;
$$;

create function private.assert_i_bet_you_host(p_group_id uuid) returns public.i_bet_you_groups
language plpgsql stable security definer set search_path='' as $$
declare v_group public.i_bet_you_groups;
begin select * into v_group from public.i_bet_you_groups where id=p_group_id;if not found or not private.is_event_host(v_group.event_id) then raise exception 'event owner required' using errcode='42501';end if;return v_group;end;
$$;
revoke all on function private.assert_i_bet_you_host(uuid) from public,anon,authenticated;

create function private.notify_i_bet_you(p_event_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v bigint;begin update public.events set state_version=state_version+1 where id=p_event_id returning state_version into v;perform private.notify_event(p_event_id,v,p_reason);end;
$$;
revoke all on function private.notify_i_bet_you(uuid,text) from public,anon,authenticated;

create function public.swap_i_bet_you_teams(p_event_id uuid,p_team_a uuid,p_team_b uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.i_bet_you_group_members;b public.i_bet_you_group_members;v_round uuid;
begin
 if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode='42501';end if;
 select id into v_round from public.event_rounds where event_id=p_event_id and game_type='i_bet_you' order by position limit 1;
 if (select status from public.i_bet_you_round_states where round_id=v_round)<>'setup' or exists(select 1 from public.i_bet_you_groups where round_id=v_round and state<>'waiting') then raise exception 'grouping is locked after gameplay begins';end if;
 select * into a from public.i_bet_you_group_members where round_id=v_round and team_id=p_team_a;select * into b from public.i_bet_you_group_members where round_id=v_round and team_id=p_team_b;
 if a.group_id is null or b.group_id is null then raise exception 'both Teams must belong to this round';end if;if a.group_id=b.group_id then return private.i_bet_you_state(p_event_id);end if;
 delete from public.i_bet_you_group_members where round_id=v_round and team_id in(p_team_a,p_team_b);
 insert into public.i_bet_you_group_members(group_id,round_id,event_id,team_id,position) values(a.group_id,v_round,p_event_id,p_team_b,a.position),(b.group_id,v_round,p_event_id,p_team_a,b.position);
 perform private.notify_i_bet_you(p_event_id,'i_bet_you_groups_swapped');return private.i_bet_you_state(p_event_id);
end;
$$;

create function public.change_i_bet_you_category(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.i_bet_you_groups;v_category uuid;
begin g:=private.assert_i_bet_you_host(p_group_id);if g.state<>'waiting' then raise exception 'category is locked for this group';end if;
 select c.id into v_category from public.i_bet_you_categories c where c.active and c.difficulty=(select difficulty from public.i_bet_you_categories where id=g.category_id) and c.id not in(select category_id from public.i_bet_you_groups where round_id=g.round_id) order by random() limit 1;
 if v_category is null then raise exception 'no unused similar category is available';end if;update public.i_bet_you_groups set category_id=v_category where id=p_group_id;perform private.notify_i_bet_you(g.event_id,'i_bet_you_category_changed');return private.i_bet_you_state(g.event_id);
end;
$$;

create function public.set_i_bet_you_bid(p_group_id uuid,p_bidder_team_id uuid,p_bid integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.i_bet_you_groups;
begin g:=private.assert_i_bet_you_host(p_group_id);if g.state not in('waiting','bidding') then raise exception 'bid is frozen';end if;if p_bid not between 1 and 100 then raise exception 'bid must be between 1 and 100';end if;
 if not exists(select 1 from public.i_bet_you_group_members where group_id=p_group_id and team_id=p_bidder_team_id) then raise exception 'bidder must belong to group';end if;
 update public.i_bet_you_groups set state='bidding',current_bidder_team_id=p_bidder_team_id,current_bid=p_bid where id=p_group_id;update public.i_bet_you_round_states set status='playing',active_group_id=p_group_id where round_id=g.round_id;perform private.notify_i_bet_you(g.event_id,'i_bet_you_bid');return private.i_bet_you_state(g.event_id);
end;
$$;

create function public.challenge_i_bet_you(p_group_id uuid,p_challenger_team_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.i_bet_you_groups;
begin g:=private.assert_i_bet_you_host(p_group_id);if g.state<>'bidding' or g.current_bidder_team_id is null or g.current_bid is null then raise exception 'a current bid is required';end if;
 if p_challenger_team_id=g.current_bidder_team_id or not exists(select 1 from public.i_bet_you_group_members where group_id=p_group_id and team_id=p_challenger_team_id) then raise exception 'valid challenger required';end if;
 update public.i_bet_you_groups set state='challenged',challenged_bidder_team_id=current_bidder_team_id,challenger_team_id=p_challenger_team_id,target_bid=current_bid where id=p_group_id;perform private.notify_i_bet_you(g.event_id,'i_bet_you_challenged');return private.i_bet_you_state(g.event_id);
end;
$$;

create function public.correct_i_bet_you_showdown(p_group_id uuid,p_bidder_team_id uuid,p_challenger_team_id uuid,p_target integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.i_bet_you_groups;
begin g:=private.assert_i_bet_you_host(p_group_id);if g.state<>'challenged' or g.countdown_started_at is not null then raise exception 'showdown can no longer be corrected';end if;if p_bidder_team_id=p_challenger_team_id or p_target not between 1 and 100 then raise exception 'invalid showdown';end if;
 if (select count(*) from public.i_bet_you_group_members where group_id=p_group_id and team_id in(p_bidder_team_id,p_challenger_team_id))<>2 then raise exception 'Teams must belong to group';end if;
 update public.i_bet_you_groups set challenged_bidder_team_id=p_bidder_team_id,current_bidder_team_id=p_bidder_team_id,challenger_team_id=p_challenger_team_id,target_bid=p_target,current_bid=p_target where id=p_group_id;perform private.notify_i_bet_you(g.event_id,'i_bet_you_corrected');return private.i_bet_you_state(g.event_id);
end;
$$;

create function public.start_i_bet_you_timer(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.i_bet_you_groups;v_now timestamptz:=clock_timestamp();
begin g:=private.assert_i_bet_you_host(p_group_id);if g.state<>'challenged' then raise exception 'showdown must be confirmed';end if;update public.i_bet_you_groups set state='countdown',countdown_started_at=v_now,countdown_deadline_at=v_now+interval '60 seconds' where id=p_group_id;perform private.notify_i_bet_you(g.event_id,'i_bet_you_timer_started');return private.i_bet_you_state(g.event_id);end;
$$;

create function public.judge_i_bet_you_group(p_group_id uuid,p_success boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.i_bet_you_groups;v_winner uuid;v_category text;
begin g:=private.assert_i_bet_you_host(p_group_id);if g.state in('result','complete') then return private.i_bet_you_state(g.event_id);end if;if g.state not in('challenged','countdown') then raise exception 'showdown is not ready for judgment';end if;
 v_winner:=case when p_success then g.challenged_bidder_team_id else g.challenger_team_id end;select title into v_category from public.i_bet_you_categories where id=g.category_id;
 insert into public.score_awards(event_id,team_id,points,kind,reason,created_by,metadata) values(g.event_id,v_winner,5,'game','I Bet You - Group '||g.position||' - '||v_category,auth.uid(),jsonb_build_object('game_type','i_bet_you','i_bet_you_group_id',g.id,'result',case when p_success then 'success' else 'fail' end,'target',g.target_bid)) on conflict((metadata->>'i_bet_you_group_id')) where kind='game' and metadata->>'game_type'='i_bet_you' do nothing;
 update public.i_bet_you_groups set state='result',result=case when p_success then 'success' else 'fail' end,winning_team_id=v_winner,completed_at=clock_timestamp() where id=p_group_id;perform private.notify_i_bet_you(g.event_id,'i_bet_you_result');return private.i_bet_you_state(g.event_id);
end;
$$;

create function public.next_i_bet_you_group(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.i_bet_you_groups;v_next uuid;
begin g:=private.assert_i_bet_you_host(p_group_id);if g.state<>'result' then raise exception 'result must be committed before next group';end if;update public.i_bet_you_groups set state='complete' where id=p_group_id;select id into v_next from public.i_bet_you_groups where round_id=g.round_id and position>g.position order by position limit 1;
 if v_next is null then update public.i_bet_you_round_states set status='complete',active_group_id=null where round_id=g.round_id;update public.events set status='round_complete',state_version=state_version+1 where id=g.event_id;perform private.notify_event(g.event_id,(select state_version from public.events where id=g.event_id),'i_bet_you_complete');else update public.i_bet_you_round_states set active_group_id=v_next where round_id=g.round_id;perform private.notify_i_bet_you(g.event_id,'i_bet_you_next_group');end if;return private.i_bet_you_state(g.event_id);end;
$$;

create function public.reset_i_bet_you_group(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.i_bet_you_groups;
begin g:=private.assert_i_bet_you_host(p_group_id);delete from public.score_awards where event_id=g.event_id and kind='game' and metadata->>'i_bet_you_group_id'=g.id::text;update public.i_bet_you_groups set state='waiting',current_bidder_team_id=null,current_bid=null,challenged_bidder_team_id=null,challenger_team_id=null,target_bid=null,countdown_started_at=null,countdown_deadline_at=null,result=null,winning_team_id=null,completed_at=null where id=p_group_id;update public.i_bet_you_round_states set status='playing',active_group_id=p_group_id where round_id=g.round_id;update public.events set status='ready' where id=g.event_id;perform private.notify_i_bet_you(g.event_id,'i_bet_you_group_reset');return private.i_bet_you_state(g.event_id);end;
$$;

create function public.activate_hosted_round(p_event_id uuid,p_round_id uuid) returns public.events
language plpgsql security definer set search_path='' as $$
declare v_round public.event_rounds;v_question uuid;v_event public.events;
begin
 if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode='42501';end if;
 select * into v_round from public.event_rounds where id=p_round_id and event_id=p_event_id;if not found or v_round.game_type not in('guess_age','i_bet_you') then raise exception 'hosted round not found';end if;
 if v_round.game_type='guess_age' then select id into v_question from public.questions where round_id=p_round_id order by position limit 1;else if not exists(select 1 from public.i_bet_you_round_states where round_id=p_round_id) then raise exception 'I Bet You must be prepared first';end if;end if;
 update public.events set active_round_id=p_round_id,active_question_id=v_question,status='ready',display_mode='game',question_started_at=null,question_deadline_at=null,question_reveal_due_at=null,question_revealed_at=null,state_version=state_version+1 where id=p_event_id returning * into v_event;
 perform private.notify_event(p_event_id,v_event.state_version,'hosted_round_activated');return v_event;
end;
$$;

alter function public.get_public_room_state(text) rename to get_public_room_state_phase2d;
create function public.get_public_room_state(p_room_code text) returns jsonb language sql stable security definer set search_path='' as $$
 select s||jsonb_build_object('i_bet_you',private.i_bet_you_state((s->'event'->>'id')::uuid)) from public.get_public_room_state_phase2d(p_room_code)s
$$;
alter function public.get_host_event_state(uuid) rename to get_host_event_state_phase2d;
create function public.get_host_event_state(p_event_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select s||jsonb_build_object('i_bet_you',private.i_bet_you_state(p_event_id)) from public.get_host_event_state_phase2d(p_event_id)s
$$;
revoke all on function public.get_public_room_state_phase2d(text),public.get_host_event_state_phase2d(uuid) from public,anon,authenticated;
revoke all on function public.get_public_room_state(text),public.get_host_event_state(uuid) from public,anon,authenticated;
grant execute on function public.get_public_room_state(text),public.get_host_event_state(uuid) to authenticated;

revoke all on function public.setup_i_bet_you_round(uuid,integer),public.swap_i_bet_you_teams(uuid,uuid,uuid),public.change_i_bet_you_category(uuid),public.set_i_bet_you_bid(uuid,uuid,integer),public.challenge_i_bet_you(uuid,uuid),public.correct_i_bet_you_showdown(uuid,uuid,uuid,integer),public.start_i_bet_you_timer(uuid),public.judge_i_bet_you_group(uuid,boolean),public.next_i_bet_you_group(uuid),public.reset_i_bet_you_group(uuid),public.activate_hosted_round(uuid,uuid) from public,anon,authenticated;
grant execute on function public.setup_i_bet_you_round(uuid,integer),public.swap_i_bet_you_teams(uuid,uuid,uuid),public.change_i_bet_you_category(uuid),public.set_i_bet_you_bid(uuid,uuid,integer),public.challenge_i_bet_you(uuid,uuid),public.correct_i_bet_you_showdown(uuid,uuid,uuid,integer),public.start_i_bet_you_timer(uuid),public.judge_i_bet_you_group(uuid,boolean),public.next_i_bet_you_group(uuid),public.reset_i_bet_you_group(uuid),public.activate_hosted_round(uuid,uuid) to authenticated;
