create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (display_name is null or char_length(trim(display_name)) between 1 and 80)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete restrict,
  room_code text not null,
  name text not null,
  venue text not null default '',
  event_date date not null,
  expected_teams smallint not null default 12,
  status text not null default 'draft',
  active_round_id uuid,
  active_question_id uuid,
  question_started_at timestamptz,
  question_deadline_at timestamptz,
  question_revealed_at timestamptz,
  state_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_room_code_format check (room_code = upper(room_code) and room_code ~ '^[A-Z0-9]{6}$'),
  constraint events_name_length check (char_length(trim(name)) between 1 and 120),
  constraint events_venue_length check (char_length(venue) <= 160),
  constraint events_expected_teams_range check (expected_teams between 1 and 100),
  constraint events_status_valid check (status in ('draft','lobby','ready','question','locked','reveal','leaderboard','round_complete','ended')),
  constraint events_deadline_after_start check (question_deadline_at is null or (question_started_at is not null and question_deadline_at > question_started_at)),
  constraint events_reveal_after_start check (question_revealed_at is null or question_started_at is not null)
);

create unique index events_room_code_unique on public.events (upper(room_code));
create index events_host_created_idx on public.events (host_id, created_at desc);
create index events_live_room_idx on public.events (room_code) where status <> 'ended';

create table public.event_rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  position integer not null,
  game_type text not null,
  title text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_rounds_position_positive check (position > 0),
  constraint event_rounds_game_type_valid check (game_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint event_rounds_title_length check (char_length(trim(title)) between 1 and 120),
  constraint event_rounds_settings_object check (jsonb_typeof(settings) = 'object'),
  unique (event_id, position),
  unique (id, event_id)
);
create index event_rounds_event_position_idx on public.event_rounds (event_id, position);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  round_id uuid not null,
  position integer not null,
  celebrity_name text not null,
  image_kind text not null default 'none',
  image_path text,
  external_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_round_event_fk foreign key (round_id, event_id) references public.event_rounds(id, event_id) on delete cascade,
  constraint questions_position_positive check (position > 0),
  constraint questions_name_length check (char_length(trim(celebrity_name)) between 1 and 160),
  constraint questions_image_kind_valid check (image_kind in ('none','storage','external')),
  constraint questions_image_shape check (
    (image_kind = 'none' and image_path is null and external_image_url is null) or
    (image_kind = 'storage' and image_path is not null and external_image_url is null) or
    (image_kind = 'external' and image_path is null and external_image_url ~ '^https://')
  ),
  unique (round_id, position),
  unique (id, event_id)
);
create index questions_event_round_position_idx on public.questions (event_id, round_id, position);

create table public.question_secrets (
  question_id uuid primary key references public.questions(id) on delete cascade,
  date_of_birth date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint question_secrets_dob_sensible check (date_of_birth >= date '1850-01-01')
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_name_length check (char_length(trim(name)) between 1 and 80),
  constraint teams_status_valid check (status in ('active','removed','disconnected')),
  unique (event_id, auth_user_id),
  unique (id, event_id)
);
create unique index teams_event_name_unique on public.teams (event_id, lower(name)) where status = 'active';
create index teams_auth_user_idx on public.teams (auth_user_id);
create index teams_event_status_idx on public.teams (event_id, status);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  question_id uuid not null,
  team_id uuid not null,
  guess_integer smallint not null,
  accepted_at timestamptz not null default clock_timestamp(),
  constraint submissions_question_event_fk foreign key (question_id, event_id) references public.questions(id, event_id) on delete cascade,
  constraint submissions_team_event_fk foreign key (team_id, event_id) references public.teams(id, event_id) on delete cascade,
  constraint submissions_guess_range check (guess_integer between 1 and 120),
  unique (question_id, team_id)
);
create index submissions_question_time_idx on public.submissions (event_id, question_id, accepted_at);
create index submissions_team_time_idx on public.submissions (team_id, accepted_at desc);

create table public.score_awards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  team_id uuid not null,
  question_id uuid,
  points integer not null,
  kind text not null,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint score_awards_team_event_fk foreign key (team_id, event_id) references public.teams(id, event_id) on delete cascade,
  constraint score_awards_question_event_fk foreign key (question_id, event_id) references public.questions(id, event_id) on delete cascade,
  constraint score_awards_kind_valid check (kind in ('game','manual_correction')),
  constraint score_awards_points_range check (points between -1000 and 1000),
  constraint score_awards_shape check (
    (kind = 'game' and question_id is not null) or
    (kind = 'manual_correction' and char_length(trim(reason)) between 1 and 500)
  ),
  constraint score_awards_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create unique index score_awards_game_unique on public.score_awards (question_id, team_id) where kind = 'game';
create index score_awards_event_team_idx on public.score_awards (event_id, team_id, created_at);
create index score_awards_event_time_idx on public.score_awards (event_id, created_at);

alter table public.events
  add constraint events_active_round_fk foreign key (active_round_id, id) references public.event_rounds(id, event_id) deferrable initially deferred,
  add constraint events_active_question_fk foreign key (active_question_id, id) references public.questions(id, event_id) deferrable initially deferred;

create function private.set_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger events_updated_at before update on public.events for each row execute function private.set_updated_at();
create trigger event_rounds_updated_at before update on public.event_rounds for each row execute function private.set_updated_at();
create trigger questions_updated_at before update on public.questions for each row execute function private.set_updated_at();
create trigger question_secrets_updated_at before update on public.question_secrets for each row execute function private.set_updated_at();
create trigger teams_updated_at before update on public.teams for each row execute function private.set_updated_at();

comment on table public.question_secrets is 'Private answer material. Never grant Team or Audience access.';
comment on table public.score_awards is 'Append-only authoritative scoring ledger.';
