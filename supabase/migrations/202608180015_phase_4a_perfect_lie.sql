create table public.perfect_lie_categories(
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id) on delete cascade,
 round_id uuid not null references public.event_rounds(id) on delete cascade,position integer not null,title text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint perfect_lie_category_position check(position>0),constraint perfect_lie_category_title check(char_length(trim(title)) between 1 and 100),
 unique(round_id,position),unique(id,event_id)
);
create table public.perfect_lie_questions(
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id) on delete cascade,
 round_id uuid not null references public.event_rounds(id) on delete cascade,category_id uuid not null references public.perfect_lie_categories(id) on delete cascade,
 position integer not null,question_text text not null,explanation text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint perfect_lie_question_position check(position>0),constraint perfect_lie_question_text check(char_length(trim(question_text)) between 1 and 1000),
 constraint perfect_lie_explanation_length check(explanation is null or char_length(explanation)<=2000),unique(category_id,position),unique(id,event_id)
);
create table public.perfect_lie_question_secrets(
 question_id uuid primary key references public.perfect_lie_questions(id) on delete cascade,
 correct_answer text not null,accepted_answer_variants text[] not null default '{}',source_reference text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint perfect_lie_truth_length check(char_length(trim(correct_answer)) between 1 and 500),
 constraint perfect_lie_variants_count check(cardinality(accepted_answer_variants)<=25),
 constraint perfect_lie_source_length check(source_reference is null or char_length(source_reference)<=2000)
);
create table public.perfect_lie_round_states(
 round_id uuid primary key references public.event_rounds(id) on delete cascade,event_id uuid not null references public.events(id) on delete cascade,
 active_question_id uuid references public.perfect_lie_questions(id) on delete set null,phase text not null default 'setup',
 knowledge_deadline_at timestamptz,reveal_index integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint perfect_lie_phase check(phase in('setup','ready','writing','voting','reveal','question_complete','category_transition','complete')),
 constraint perfect_lie_reveal_index check(reveal_index>=0),unique(round_id,event_id)
);
create table public.perfect_lie_responses(
 id uuid primary key default gen_random_uuid(),event_id uuid not null,question_id uuid not null,team_id uuid not null,
 initial_answer text not null,normalized_answer text not null,knew_truth boolean not null,submitted_at timestamptz not null default clock_timestamp(),
 foreign key(question_id,event_id) references public.perfect_lie_questions(id,event_id) on delete cascade,
 foreign key(team_id,event_id) references public.teams(id,event_id) on delete cascade,
 constraint perfect_lie_initial_length check(char_length(trim(initial_answer)) between 1 and 500),unique(question_id,team_id)
);
create table public.perfect_lie_lies(
 id uuid primary key default gen_random_uuid(),event_id uuid not null,question_id uuid not null,team_id uuid not null,
 lie_text text not null,normalized_lie text not null,submitted_at timestamptz not null default clock_timestamp(),
 foreign key(question_id,event_id) references public.perfect_lie_questions(id,event_id) on delete cascade,
 foreign key(team_id,event_id) references public.teams(id,event_id) on delete cascade,
 constraint perfect_lie_lie_length check(char_length(trim(lie_text)) between 1 and 500),unique(question_id,team_id),unique(question_id,normalized_lie),unique(id,question_id)
);
create table public.perfect_lie_vote_options(
 id uuid primary key default gen_random_uuid(),event_id uuid not null,question_id uuid not null,option_text text not null,
 normalized_text text not null,is_truth boolean not null,lie_id uuid,display_position integer not null,reveal_position integer not null,
 foreign key(question_id,event_id) references public.perfect_lie_questions(id,event_id) on delete cascade,
 foreign key(lie_id,question_id) references public.perfect_lie_lies(id,question_id) on delete cascade,
 constraint perfect_lie_option_shape check((is_truth and lie_id is null)or(not is_truth and lie_id is not null)),
 unique(question_id,display_position),unique(question_id,reveal_position),unique(question_id,normalized_text),unique(id,question_id)
);
create unique index perfect_lie_one_truth on public.perfect_lie_vote_options(question_id) where is_truth;
create table public.perfect_lie_votes(
 id uuid primary key default gen_random_uuid(),event_id uuid not null,question_id uuid not null,team_id uuid not null,option_id uuid not null,
 submitted_at timestamptz not null default clock_timestamp(),
 foreign key(question_id,event_id) references public.perfect_lie_questions(id,event_id) on delete cascade,
 foreign key(team_id,event_id) references public.teams(id,event_id) on delete cascade,
 foreign key(option_id,question_id) references public.perfect_lie_vote_options(id,question_id) on delete cascade,unique(question_id,team_id)
);
create index perfect_lie_categories_round on public.perfect_lie_categories(round_id,position);
create index perfect_lie_questions_round on public.perfect_lie_questions(round_id,category_id,position);
create index perfect_lie_responses_question on public.perfect_lie_responses(question_id,team_id);
create index perfect_lie_lies_question on public.perfect_lie_lies(question_id,team_id);
create index perfect_lie_votes_question on public.perfect_lie_votes(question_id,option_id);

create trigger perfect_lie_categories_updated before update on public.perfect_lie_categories for each row execute function private.set_updated_at();
create trigger perfect_lie_questions_updated before update on public.perfect_lie_questions for each row execute function private.set_updated_at();
create trigger perfect_lie_secrets_updated before update on public.perfect_lie_question_secrets for each row execute function private.set_updated_at();
create trigger perfect_lie_states_updated before update on public.perfect_lie_round_states for each row execute function private.set_updated_at();

alter table public.perfect_lie_categories enable row level security;alter table public.perfect_lie_questions enable row level security;
alter table public.perfect_lie_question_secrets enable row level security;alter table public.perfect_lie_round_states enable row level security;
alter table public.perfect_lie_responses enable row level security;alter table public.perfect_lie_lies enable row level security;
alter table public.perfect_lie_vote_options enable row level security;alter table public.perfect_lie_votes enable row level security;
revoke all on public.perfect_lie_categories,public.perfect_lie_questions,public.perfect_lie_question_secrets,public.perfect_lie_round_states,public.perfect_lie_responses,public.perfect_lie_lies,public.perfect_lie_vote_options,public.perfect_lie_votes from public,anon,authenticated;

alter table public.score_awards drop constraint score_awards_shape;
alter table public.score_awards add constraint score_awards_shape check(
 (kind='game' and(question_id is not null or metadata->>'game_type' in('i_bet_you','perfect_lie')))or
 (kind='manual_correction' and char_length(trim(reason)) between 1 and 500));
create unique index score_awards_perfect_lie_key on public.score_awards((metadata->>'award_key'))
 where kind='game' and metadata->>'game_type'='perfect_lie';

create function private.normalize_perfect_lie_answer(p_value text) returns text language sql immutable parallel safe set search_path='' as $$
 select lower(regexp_replace(regexp_replace(btrim(coalesce(p_value,'')),'[.!?,;:]+$','','g'),'[[:space:]]+',' ','g'))
$$;
create function private.perfect_lie_matches_truth(p_question_id uuid,p_value text) returns boolean language sql stable security definer set search_path='' as $$
 select private.normalize_perfect_lie_answer(p_value)=private.normalize_perfect_lie_answer(s.correct_answer)
 or private.normalize_perfect_lie_answer(p_value)=any(select private.normalize_perfect_lie_answer(x) from unnest(s.accepted_answer_variants)x)
 from public.perfect_lie_question_secrets s where s.question_id=p_question_id
$$;
create function private.notify_perfect_lie(p_event_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare v bigint;begin update public.events set state_version=state_version+1 where id=p_event_id returning state_version into v;perform private.notify_event(p_event_id,v,p_reason);end;
$$;

create function public.save_perfect_lie_round(p_event_id uuid,p_title text,p_categories jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.event_rounds;c jsonb;q jsonb;c_id uuid;c_pos int:=0;q_pos int;v_variants text[];
begin
 if not private.is_event_host(p_event_id) then raise exception 'event owner required' using errcode='42501';end if;
 if jsonb_typeof(p_categories)<>'array' or jsonb_array_length(p_categories)<1 then raise exception 'add at least one category' using errcode='22023';end if;
 select * into r from public.event_rounds where event_id=p_event_id and game_type='perfect_lie' order by position limit 1;
 if found and exists(select 1 from public.perfect_lie_round_states where round_id=r.id and phase not in('setup','ready')) then raise exception 'cannot edit Perfect Lie while live';end if;
 if not found then insert into public.event_rounds(event_id,position,game_type,title) values(p_event_id,(select coalesce(max(position),0)+1 from public.event_rounds where event_id=p_event_id),'perfect_lie',trim(p_title)) returning * into r;
 else update public.event_rounds set title=trim(p_title) where id=r.id;delete from public.perfect_lie_categories where round_id=r.id;end if;
 for c in select value from jsonb_array_elements(p_categories)loop c_pos:=c_pos+1;if char_length(trim(c->>'title'))<1 then raise exception 'every category needs a name';end if;
  insert into public.perfect_lie_categories(event_id,round_id,position,title)values(p_event_id,r.id,c_pos,trim(c->>'title'))returning id into c_id;
  q_pos:=0;for q in select value from jsonb_array_elements(coalesce(c->'questions','[]'))loop q_pos:=q_pos+1;
   if char_length(trim(q->>'question_text'))<1 or char_length(trim(q->>'correct_answer'))<1 then raise exception 'every question needs question text and a correct answer';end if;
   insert into public.perfect_lie_questions(event_id,round_id,category_id,position,question_text,explanation)values(p_event_id,r.id,c_id,q_pos,trim(q->>'question_text'),nullif(trim(q->>'explanation'),''))returning id into c_id;
   select coalesce(array_agg(trim(value)), '{}') into v_variants from jsonb_array_elements_text(coalesce(q->'accepted_answer_variants','[]'));
   insert into public.perfect_lie_question_secrets(question_id,correct_answer,accepted_answer_variants,source_reference)values(c_id,trim(q->>'correct_answer'),v_variants,nullif(trim(q->>'source_reference'),''));
   select id into c_id from public.perfect_lie_categories where round_id=r.id and position=c_pos;
  end loop;
 end loop;
 insert into public.perfect_lie_round_states(round_id,event_id,phase)values(r.id,p_event_id,'ready')on conflict(round_id)do update set phase='ready',active_question_id=null,reveal_index=0;
 perform private.notify_perfect_lie(p_event_id,'perfect_lie_saved');return r.id;
end;$$;

create function public.start_perfect_lie_question(p_event_id uuid,p_question_id uuid,p_duration_seconds integer default 20) returns void
language plpgsql security definer set search_path='' as $$
declare q public.perfect_lie_questions;begin if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;
 if p_duration_seconds not between 5 and 120 then raise exception 'invalid duration';end if;select * into q from public.perfect_lie_questions where id=p_question_id and event_id=p_event_id;if not found then raise exception 'question not found';end if;
 delete from public.perfect_lie_votes where question_id=q.id;delete from public.perfect_lie_vote_options where question_id=q.id;delete from public.perfect_lie_lies where question_id=q.id;delete from public.perfect_lie_responses where question_id=q.id;
 update public.perfect_lie_round_states set active_question_id=q.id,phase='writing',knowledge_deadline_at=clock_timestamp()+make_interval(secs=>p_duration_seconds),reveal_index=0 where round_id=q.round_id;
 update public.events set active_round_id=q.round_id,status='question',question_started_at=clock_timestamp(),question_deadline_at=clock_timestamp()+make_interval(secs=>p_duration_seconds),question_revealed_at=null where id=p_event_id;
 perform private.notify_perfect_lie(p_event_id,'perfect_lie_question_started');end;$$;

create function public.submit_perfect_lie_answer(p_team_id uuid,p_question_id uuid,p_answer text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.teams;s public.perfect_lie_round_states;v_clean text;v_correct boolean;begin if not private.owns_team(p_team_id)then raise exception 'Team ownership required' using errcode='42501';end if;
 select * into t from public.teams where id=p_team_id;select rs.* into s from public.perfect_lie_round_states rs join public.perfect_lie_questions q on q.round_id=rs.round_id where q.id=p_question_id and q.event_id=t.event_id and rs.active_question_id=q.id;
 if not found or s.phase<>'writing' then raise exception 'answer window is closed';end if;if clock_timestamp()>s.knowledge_deadline_at then raise exception 'answer window is closed';end if;
 v_clean:=trim(p_answer);if char_length(v_clean)not between 1 and 500 then raise exception 'enter an answer';end if;v_correct:=private.perfect_lie_matches_truth(p_question_id,v_clean);
 insert into public.perfect_lie_responses(event_id,question_id,team_id,initial_answer,normalized_answer,knew_truth)values(t.event_id,p_question_id,t.id,v_clean,private.normalize_perfect_lie_answer(v_clean),v_correct);
 perform private.notify_perfect_lie(t.event_id,'perfect_lie_answer_submitted');return jsonb_build_object('knew_truth',v_correct,'lie_draft',case when v_correct then '' else v_clean end);end;$$;

create function public.submit_perfect_lie_lie(p_team_id uuid,p_question_id uuid,p_lie text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.teams;s public.perfect_lie_round_states;v_clean text;begin if not private.owns_team(p_team_id)then raise exception 'Team ownership required' using errcode='42501';end if;select * into t from public.teams where id=p_team_id;
 select rs.* into s from public.perfect_lie_round_states rs join public.perfect_lie_questions q on q.round_id=rs.round_id where q.id=p_question_id and q.event_id=t.event_id and rs.active_question_id=q.id;
 if not found or s.phase<>'writing' then raise exception 'lie submissions are closed';end if;if not exists(select 1 from public.perfect_lie_responses where question_id=p_question_id and team_id=t.id)then raise exception 'submit your real-answer attempt first';end if;
 v_clean:=trim(p_lie);if char_length(v_clean)not between 1 and 500 then raise exception 'write a lie';end if;if private.perfect_lie_matches_truth(p_question_id,v_clean)then raise exception 'That’s the real answer — you need a lie.' using errcode='22023';end if;
 begin insert into public.perfect_lie_lies(event_id,question_id,team_id,lie_text,normalized_lie)values(t.event_id,p_question_id,t.id,v_clean,private.normalize_perfect_lie_answer(v_clean));exception when unique_violation then raise exception 'Someone else beat you to that one. Try another lie.' using errcode='23505';end;
 perform private.notify_perfect_lie(t.event_id,'perfect_lie_lie_submitted');end;$$;

create function public.close_perfect_lie_writing(p_event_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.perfect_lie_round_states;sec public.perfect_lie_question_secrets;begin if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;select * into s from public.perfect_lie_round_states where event_id=p_event_id and phase='writing';if not found then raise exception 'writing is not open';end if;select * into sec from public.perfect_lie_question_secrets where question_id=s.active_question_id;
 delete from public.perfect_lie_vote_options where question_id=s.active_question_id;
 insert into public.perfect_lie_vote_options(event_id,question_id,option_text,normalized_text,is_truth,lie_id,display_position,reveal_position)
 select p_event_id,s.active_question_id,x.text,x.norm,x.truth,x.lie_id,row_number()over(order by md5(s.active_question_id::text||x.norm)),case when x.truth then (select count(*)+1 from public.perfect_lie_lies where question_id=s.active_question_id)else row_number()over(partition by x.truth order by md5(x.norm||s.active_question_id::text))end
 from(select sec.correct_answer text,private.normalize_perfect_lie_answer(sec.correct_answer)norm,true truth,null::uuid lie_id union all select l.lie_text,l.normalized_lie,false,l.id from public.perfect_lie_lies l where l.question_id=s.active_question_id)x;
 update public.perfect_lie_round_states set phase='voting',knowledge_deadline_at=null where round_id=s.round_id;update public.events set status='locked',question_deadline_at=null where id=p_event_id;perform private.notify_perfect_lie(p_event_id,'perfect_lie_voting_open');end;$$;

create function public.submit_perfect_lie_vote(p_team_id uuid,p_question_id uuid,p_option_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.teams;o public.perfect_lie_vote_options;s public.perfect_lie_round_states;begin if not private.owns_team(p_team_id)then raise exception 'Team ownership required' using errcode='42501';end if;select * into t from public.teams where id=p_team_id;select * into o from public.perfect_lie_vote_options where id=p_option_id and question_id=p_question_id and event_id=t.event_id;if not found then raise exception 'invalid vote option';end if;select * into s from public.perfect_lie_round_states where event_id=t.event_id and active_question_id=p_question_id;if s.phase<>'voting'then raise exception 'voting is closed';end if;if exists(select 1 from public.perfect_lie_lies where id=o.lie_id and team_id=t.id)then raise exception 'You cannot vote for your own lie.' using errcode='42501';end if;insert into public.perfect_lie_votes(event_id,question_id,team_id,option_id)values(t.event_id,p_question_id,t.id,p_option_id);perform private.notify_perfect_lie(t.event_id,'perfect_lie_vote_submitted');end;$$;

create function public.start_perfect_lie_reveal(p_event_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.perfect_lie_round_states;begin if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;select * into s from public.perfect_lie_round_states where event_id=p_event_id and phase='voting' for update;if not found then if exists(select 1 from public.perfect_lie_round_states where event_id=p_event_id and phase in('reveal','question_complete'))then return;end if;raise exception 'voting is not open';end if;
 insert into public.score_awards(event_id,team_id,points,kind,reason,created_by,metadata)
 select p_event_id,t.id,3,'game','Perfect Lie - found the truth',auth.uid(),jsonb_build_object('game_type','perfect_lie','perfect_lie_question_id',s.active_question_id,'award_type','truth','award_key',s.active_question_id::text||':'||t.id::text||':truth') from public.teams t
 where t.event_id=p_event_id and t.status='active' and(exists(select 1 from public.perfect_lie_responses r where r.question_id=s.active_question_id and r.team_id=t.id and r.knew_truth)or exists(select 1 from public.perfect_lie_votes v join public.perfect_lie_vote_options o on o.id=v.option_id where v.question_id=s.active_question_id and v.team_id=t.id and o.is_truth))on conflict((metadata->>'award_key'))where kind='game'and metadata->>'game_type'='perfect_lie'do nothing;
 insert into public.score_awards(event_id,team_id,points,kind,reason,created_by,metadata)
 select p_event_id,l.team_id,count(v.id)*2,'game','Perfect Lie - fooled Teams',auth.uid(),jsonb_build_object('game_type','perfect_lie','perfect_lie_question_id',s.active_question_id,'award_type','bluff','fooled_count',count(v.id),'award_key',s.active_question_id::text||':'||l.team_id::text||':bluff') from public.perfect_lie_lies l join public.perfect_lie_vote_options o on o.lie_id=l.id left join public.perfect_lie_votes v on v.option_id=o.id where l.question_id=s.active_question_id group by l.team_id having count(v.id)>0 on conflict((metadata->>'award_key'))where kind='game'and metadata->>'game_type'='perfect_lie'do nothing;
 update public.perfect_lie_round_states set phase='reveal',reveal_index=0 where round_id=s.round_id;update public.events set status='reveal',question_revealed_at=clock_timestamp()where id=p_event_id;perform private.notify_perfect_lie(p_event_id,'perfect_lie_reveal_started');end;$$;

create function public.advance_perfect_lie_reveal(p_event_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.perfect_lie_round_states;n int;begin if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;select * into s from public.perfect_lie_round_states where event_id=p_event_id and phase='reveal' for update;if not found then raise exception 'reveal is not active';end if;select count(*)into n from public.perfect_lie_vote_options where question_id=s.active_question_id;if s.reveal_index<n then update public.perfect_lie_round_states set reveal_index=reveal_index+1 where round_id=s.round_id;else update public.perfect_lie_round_states set phase='question_complete'where round_id=s.round_id;end if;perform private.notify_perfect_lie(p_event_id,'perfect_lie_reveal_advanced');end;$$;

create function public.advance_perfect_lie_question(p_event_id uuid,p_question_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare s public.perfect_lie_round_states;q public.perfect_lie_questions;nextq public.perfect_lie_questions;begin if not private.is_event_host(p_event_id)then raise exception 'event owner required' using errcode='42501';end if;select * into s from public.perfect_lie_round_states where event_id=p_event_id;select * into q from public.perfect_lie_questions where id=s.active_question_id;
 if p_question_id is not null then select * into nextq from public.perfect_lie_questions where id=p_question_id and event_id=p_event_id and round_id=s.round_id;else select nq.* into nextq from public.perfect_lie_questions nq join public.perfect_lie_categories nc on nc.id=nq.category_id join public.perfect_lie_categories cc on cc.id=q.category_id where nq.round_id=s.round_id and(nc.position,nq.position)>(cc.position,q.position)order by nc.position,nq.position limit 1;end if;
 if nextq.id is null then update public.perfect_lie_round_states set phase='complete',active_question_id=null,reveal_index=0 where round_id=s.round_id;update public.events set status='round_complete'where id=p_event_id;
 else update public.perfect_lie_round_states set active_question_id=nextq.id,phase=case when nextq.category_id<>q.category_id then 'category_transition'else'ready'end,reveal_index=0 where round_id=s.round_id;update public.events set status='ready',question_started_at=null,question_deadline_at=null,question_revealed_at=null where id=p_event_id;end if;perform private.notify_perfect_lie(p_event_id,'perfect_lie_question_selected');end;$$;

create function private.perfect_lie_state(p_event_id uuid,p_role text,p_team_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
select case when rs.round_id is null then null else jsonb_build_object(
 'round',jsonb_build_object('id',r.id,'title',r.title,'position',r.position,'game_type','perfect_lie','phase',rs.phase,'active_question_id',rs.active_question_id,'reveal_index',rs.reveal_index),
 'categories',case when p_role='host'then coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'position',c.position,'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'position',q.position,'question_text',q.question_text,'explanation',q.explanation,'correct_answer',sec.correct_answer,'accepted_answer_variants',sec.accepted_answer_variants,'source_reference',sec.source_reference)order by q.position),'[]')from public.perfect_lie_questions q join public.perfect_lie_question_secrets sec on sec.question_id=q.id where q.category_id=c.id))order by c.position)from public.perfect_lie_categories c where c.round_id=r.id),'[]')else'[]'::jsonb end,
 'question',(select jsonb_build_object('id',q.id,'position',q.position,'question_text',q.question_text,'explanation',case when rs.phase in('reveal','question_complete')then q.explanation else null end,'category_id',c.id,'category',c.title,'category_position',c.position,'correct_answer',case when rs.phase in('reveal','question_complete')then sec.correct_answer else null end)from public.perfect_lie_questions q join public.perfect_lie_categories c on c.id=q.category_id join public.perfect_lie_question_secrets sec on sec.question_id=q.id where q.id=rs.active_question_id),
 'team_count',(select count(*)from public.teams where event_id=p_event_id and status='active'),
 'answer_count',(select count(*)from public.perfect_lie_responses where question_id=rs.active_question_id),
 'lie_count',(select count(*)from public.perfect_lie_lies where question_id=rs.active_question_id),'vote_count',(select count(*)from public.perfect_lie_votes where question_id=rs.active_question_id),
 'options',case when rs.phase in('voting','reveal','question_complete')then coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'text',o.option_text,'position',o.display_position,'is_own',case when p_role='team'then exists(select 1 from public.perfect_lie_lies l where l.id=o.lie_id and l.team_id=p_team_id)else false end,'is_truth',case when rs.phase in('reveal','question_complete')then o.is_truth else null end)order by o.display_position)from public.perfect_lie_vote_options o where o.question_id=rs.active_question_id),'[]')else'[]'::jsonb end,
 'my_response',case when p_role='team'then(select jsonb_build_object('initial_answer',x.initial_answer,'knew_truth',x.knew_truth)from public.perfect_lie_responses x where x.question_id=rs.active_question_id and x.team_id=p_team_id)else null end,
 'my_lie',case when p_role='team'then(select jsonb_build_object('id',l.id,'text',l.lie_text)from public.perfect_lie_lies l where l.question_id=rs.active_question_id and l.team_id=p_team_id)else null end,
 'my_vote',case when p_role='team'then(select v.option_id from public.perfect_lie_votes v where v.question_id=rs.active_question_id and v.team_id=p_team_id)else null end,
 'my_result',case when p_role='team'and rs.phase in('reveal','question_complete')then jsonb_build_object('points',coalesce((select sum(a.points)from public.score_awards a where a.team_id=p_team_id and a.metadata->>'game_type'='perfect_lie'and a.metadata->>'perfect_lie_question_id'=rs.active_question_id::text),0),'fooled_count',coalesce((select max((a.metadata->>'fooled_count')::integer)from public.score_awards a where a.team_id=p_team_id and a.metadata->>'game_type'='perfect_lie'and a.metadata->>'perfect_lie_question_id'=rs.active_question_id::text),0))else null end,
 'team_status',case when p_role='host'then coalesce((select jsonb_agg(jsonb_build_object('team_id',t.id,'name',t.name,'mascot_id',t.mascot_id,'knew_truth',coalesce(x.knew_truth,false),'answered',x.id is not null,'lie_submitted',l.id is not null,'voted',v.id is not null)order by t.name)from public.teams t left join public.perfect_lie_responses x on x.team_id=t.id and x.question_id=rs.active_question_id left join public.perfect_lie_lies l on l.team_id=t.id and l.question_id=rs.active_question_id left join public.perfect_lie_votes v on v.team_id=t.id and v.question_id=rs.active_question_id where t.event_id=p_event_id and t.status='active'),'[]')else'[]'::jsonb end,
 'truth_teams',case when rs.phase in('reveal','question_complete')and exists(select 1 from public.perfect_lie_vote_options o where o.question_id=rs.active_question_id and o.reveal_position=rs.reveal_index and o.is_truth)then coalesce((select jsonb_agg(jsonb_build_object('name',t.name,'mascot_id',t.mascot_id,'knew_from_start',coalesce(x.knew_truth,false))order by t.name)from public.teams t left join public.perfect_lie_responses x on x.team_id=t.id and x.question_id=rs.active_question_id where t.event_id=p_event_id and(exists(select 1 from public.perfect_lie_responses r2 where r2.question_id=rs.active_question_id and r2.team_id=t.id and r2.knew_truth)or exists(select 1 from public.perfect_lie_votes v join public.perfect_lie_vote_options o on o.id=v.option_id where v.question_id=rs.active_question_id and v.team_id=t.id and o.is_truth))),'[]')else'[]'::jsonb end,
 'reveal',case when rs.phase in('reveal','question_complete')and rs.reveal_index>0 then(select jsonb_build_object('option_id',o.id,'text',o.option_text,'is_truth',o.is_truth,'picked_count',(select count(*)from public.perfect_lie_votes v where v.option_id=o.id),'author',case when o.is_truth then null else(select jsonb_build_object('team_id',t.id,'name',t.name,'mascot_id',t.mascot_id)from public.perfect_lie_lies l join public.teams t on t.id=l.team_id where l.id=o.lie_id)end)from public.perfect_lie_vote_options o where o.question_id=rs.active_question_id and o.reveal_position=rs.reveal_index)else null end
)end from public.perfect_lie_round_states rs join public.event_rounds r on r.id=rs.round_id where rs.event_id=p_event_id
$$;

alter function public.get_public_room_state(text) rename to get_public_room_state_phase4a_base;
create function public.get_public_room_state(p_room_code text)returns jsonb language sql stable security definer set search_path=''as $$select case when s is null then null else s||jsonb_build_object('perfect_lie',case when private.perfect_lie_state((s->'event'->>'id')::uuid,'public')->'round'->>'id'=s->'event'->>'active_round_id'then private.perfect_lie_state((s->'event'->>'id')::uuid,'public')else null end)end from public.get_public_room_state_phase4a_base(p_room_code)s$$;
alter function public.get_team_room_state(text) rename to get_team_room_state_phase4a_base;
create function public.get_team_room_state(p_room_code text)returns jsonb language sql stable security definer set search_path=''as $$select case when s is null then null else s||jsonb_build_object('perfect_lie',private.perfect_lie_state((s->'event'->>'id')::uuid,'team',(s->'team'->>'id')::uuid))end from public.get_team_room_state_phase4a_base(p_room_code)s$$;
alter function public.get_host_event_state(uuid) rename to get_host_event_state_phase4a_base;
create function public.get_host_event_state(p_event_id uuid)returns jsonb language sql stable security definer set search_path=''as $$select case when s is null then null else s||jsonb_build_object('perfect_lie',private.perfect_lie_state(p_event_id,'host'))end from public.get_host_event_state_phase4a_base(p_event_id)s$$;

revoke all on function private.normalize_perfect_lie_answer(text),private.perfect_lie_matches_truth(uuid,text),private.notify_perfect_lie(uuid,text),private.perfect_lie_state(uuid,text,uuid)from public,anon,authenticated;
revoke all on function public.get_public_room_state_phase4a_base(text),public.get_team_room_state_phase4a_base(text),public.get_host_event_state_phase4a_base(uuid)from public,anon,authenticated;
revoke all on function public.save_perfect_lie_round(uuid,text,jsonb),public.start_perfect_lie_question(uuid,uuid,integer),public.submit_perfect_lie_answer(uuid,uuid,text),public.submit_perfect_lie_lie(uuid,uuid,text),public.close_perfect_lie_writing(uuid),public.submit_perfect_lie_vote(uuid,uuid,uuid),public.start_perfect_lie_reveal(uuid),public.advance_perfect_lie_reveal(uuid),public.advance_perfect_lie_question(uuid,uuid),public.get_public_room_state(text),public.get_team_room_state(text),public.get_host_event_state(uuid)from public,anon,authenticated;
grant execute on function public.save_perfect_lie_round(uuid,text,jsonb),public.start_perfect_lie_question(uuid,uuid,integer),public.submit_perfect_lie_answer(uuid,uuid,text),public.submit_perfect_lie_lie(uuid,uuid,text),public.close_perfect_lie_writing(uuid),public.submit_perfect_lie_vote(uuid,uuid,uuid),public.start_perfect_lie_reveal(uuid),public.advance_perfect_lie_reveal(uuid),public.advance_perfect_lie_question(uuid,uuid),public.get_public_room_state(text),public.get_team_room_state(text),public.get_host_event_state(uuid)to authenticated;

comment on table public.perfect_lie_question_secrets is 'Host-only Perfect Lie truth, accepted variants, and source. Never expose before reveal.';
comment on function private.normalize_perfect_lie_answer(text)is 'V1 exact normalization: trim, lowercase, collapse whitespace, and remove trailing basic punctuation only.';
