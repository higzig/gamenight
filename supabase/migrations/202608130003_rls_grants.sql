alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_rounds enable row level security;
alter table public.questions enable row level security;
alter table public.question_secrets enable row level security;
alter table public.teams enable row level security;
alter table public.submissions enable row level security;
alter table public.score_awards enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.events, public.event_rounds, public.questions, public.question_secrets, public.teams, public.submissions, public.score_awards to authenticated;
grant insert, update, delete on public.event_rounds, public.questions, public.question_secrets to authenticated;

create policy profiles_host_select on public.profiles for select to authenticated using (id = auth.uid() and not private.is_anonymous_user());
create policy profiles_host_update on public.profiles for update to authenticated using (id = auth.uid() and not private.is_anonymous_user()) with check (id = auth.uid() and not private.is_anonymous_user());

create policy events_host_select on public.events for select to authenticated using (private.is_event_host(id));

create policy rounds_host_select on public.event_rounds for select to authenticated using (private.is_event_host(event_id));
create policy rounds_host_insert on public.event_rounds for insert to authenticated with check (private.is_event_host(event_id));
create policy rounds_host_update on public.event_rounds for update to authenticated using (private.is_event_host(event_id)) with check (private.is_event_host(event_id));
create policy rounds_host_delete on public.event_rounds for delete to authenticated using (private.is_event_host(event_id));

create policy questions_host_select on public.questions for select to authenticated using (private.is_event_host(event_id));
create policy questions_host_insert on public.questions for insert to authenticated with check (private.is_event_host(event_id));
create policy questions_host_update on public.questions for update to authenticated using (private.is_event_host(event_id)) with check (private.is_event_host(event_id));
create policy questions_host_delete on public.questions for delete to authenticated using (private.is_event_host(event_id));

create policy secrets_host_select on public.question_secrets for select to authenticated using (exists (select 1 from public.questions q where q.id=question_id and private.is_event_host(q.event_id)));
create policy secrets_host_insert on public.question_secrets for insert to authenticated with check (exists (select 1 from public.questions q where q.id=question_id and private.is_event_host(q.event_id)));
create policy secrets_host_update on public.question_secrets for update to authenticated using (exists (select 1 from public.questions q where q.id=question_id and private.is_event_host(q.event_id))) with check (exists (select 1 from public.questions q where q.id=question_id and private.is_event_host(q.event_id)));
create policy secrets_host_delete on public.question_secrets for delete to authenticated using (exists (select 1 from public.questions q where q.id=question_id and private.is_event_host(q.event_id)));

create policy teams_host_or_self_select on public.teams for select to authenticated using (private.is_event_host(event_id) or auth_user_id = auth.uid());
create policy submissions_host_or_self_select on public.submissions for select to authenticated using (private.is_event_host(event_id) or private.owns_team(team_id));
create policy awards_host_or_self_select on public.score_awards for select to authenticated using (private.is_event_host(event_id) or private.owns_team(team_id));

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
