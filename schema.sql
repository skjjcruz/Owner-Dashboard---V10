-- ============================================================
-- Owner Dashboard V10 — Supabase Schema
-- Run this in your Supabase project: SQL Editor → New Query
-- ============================================================

-- ── USERS ────────────────────────────────────────────────────
create table if not exists public.users (
    id               uuid primary key default gen_random_uuid(),
    sleeper_username text unique not null,
    theme            jsonb    default '{}'::jsonb,
    password_hash    text,
    display_name     text,
    is_gifted        boolean  default false,
    created_at       timestamptz default now()
);

-- ── CALENDAR EVENTS ──────────────────────────────────────────
create table if not exists public.calendar_events (
    id         text primary key,
    username   text not null references public.users(sleeper_username) on delete cascade,
    title      text not null,
    date       text not null,
    time       text default '',
    league     text default '',
    details    text default '',
    created_at timestamptz default now()
);

-- ── EARNINGS ─────────────────────────────────────────────────
create table if not exists public.earnings (
    id          text primary key,
    username    text not null references public.users(sleeper_username) on delete cascade,
    year        text not null,
    league      text default '',
    description text default '',
    amount      numeric not null,
    created_at  timestamptz default now()
);

-- ── FREE AGENCY TARGETS ───────────────────────────────────────
create table if not exists public.fa_targets (
    id              uuid primary key default gen_random_uuid(),
    username        text not null references public.users(sleeper_username) on delete cascade,
    league_id       text not null,
    starting_budget numeric default 1000,
    targets         jsonb default '[]'::jsonb,
    updated_at      timestamptz default now(),
    unique (username, league_id)
);

-- ── MESSAGES (DMs between owners) ───────────────────────────
create table if not exists public.messages (
    id            uuid primary key default gen_random_uuid(),
    from_username text not null,
    to_username   text not null,
    body          text not null,
    read          boolean default false,
    created_at    timestamptz default now()
);

-- ── AI ANALYSIS ───────────────────────────────────────────────
create table if not exists public.ai_analysis (
    id              uuid primary key default gen_random_uuid(),
    username        text not null references public.users(sleeper_username) on delete cascade,
    league_id       text not null,
    type            text not null,
    context_summary text default '',
    analysis        text not null,
    created_at      timestamptz default now()
);

-- ── OWNER DNA PROFILES ────────────────────────────────────────
create table if not exists public.owner_dna (
    id         uuid primary key default gen_random_uuid(),
    username   text not null references public.users(sleeper_username) on delete cascade,
    league_id  text not null,
    dna_map    jsonb default '{}'::jsonb,
    updated_at timestamptz default now(),
    unique (username, league_id)
);

-- ── DRAFT BOARDS ──────────────────────────────────────────────
create table if not exists public.draft_boards (
    id               uuid primary key default gen_random_uuid(),
    sleeper_draft_id text,                    -- null for custom boards
    sleeper_username text not null,
    league_id        text,
    draft_year       text,
    board_name       text,
    picks            jsonb default '{}'::jsonb,
    num_teams        numeric default 16,
    num_rounds       numeric default 7,
    draft_type       text default 'linear',
    updated_at       timestamptz default now()
);
-- Unique only when sleeper_draft_id is provided (nullable unique)
create unique index if not exists uidx_draft_boards_sleeper_draft_id
    on public.draft_boards (sleeper_draft_id)
    where sleeper_draft_id is not null;

-- ── MOCK DRAFT PROSPECTS ──────────────────────────────────────
-- Reference data seeded by admins; all authenticated users can read.
create table if not exists public.mock_draft_prospects (
    id          uuid primary key default gen_random_uuid(),
    rank        integer not null,
    player_name text not null,
    position    text not null,
    college     text default '',
    created_at  timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Each owner can only read/write their own rows.
-- The session token issued by get-session-token embeds the
-- Sleeper username in app_metadata so these policies enforce it.
-- ============================================================

-- Helper expression used in every policy:
--   (auth.jwt() -> 'app_metadata' ->> 'sleeper_username')

alter table public.users               enable row level security;
alter table public.calendar_events     enable row level security;
alter table public.earnings            enable row level security;
alter table public.fa_targets          enable row level security;
alter table public.messages            enable row level security;
alter table public.ai_analysis         enable row level security;
alter table public.owner_dna           enable row level security;
alter table public.draft_boards        enable row level security;
alter table public.mock_draft_prospects enable row level security;
alter table public.player_tags          enable row level security;

-- Drop old policies (safe re-run)
drop policy if exists "users_all"           on public.users;
drop policy if exists "calendar_all"        on public.calendar_events;
drop policy if exists "earnings_all"        on public.earnings;
drop policy if exists "fa_targets_all"      on public.fa_targets;
drop policy if exists "messages_all"        on public.messages;
drop policy if exists "ai_analysis_all"     on public.ai_analysis;
drop policy if exists "owner_dna_all"       on public.owner_dna;
drop policy if exists "draft_boards_all"    on public.draft_boards;

-- Drop new policies too (idempotent re-run)
drop policy if exists "users_own"           on public.users;
drop policy if exists "calendar_own"        on public.calendar_events;
drop policy if exists "earnings_own"        on public.earnings;
drop policy if exists "fa_targets_own"      on public.fa_targets;
drop policy if exists "messages_select"     on public.messages;
drop policy if exists "messages_insert"     on public.messages;
drop policy if exists "messages_update"     on public.messages;
drop policy if exists "ai_analysis_own"     on public.ai_analysis;
drop policy if exists "owner_dna_own"       on public.owner_dna;
drop policy if exists "draft_boards_own"    on public.draft_boards;
drop policy if exists "prospects_read"      on public.mock_draft_prospects;
drop policy if exists "player_tags_own"    on public.player_tags;

-- ── users ─────────────────────────────────────────────────────
create policy "users_own" on public.users
    for all
    using  ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = sleeper_username)
    with check ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = sleeper_username);

-- ── calendar_events ───────────────────────────────────────────
create policy "calendar_own" on public.calendar_events
    for all
    using  ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username)
    with check ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username);

-- ── earnings ──────────────────────────────────────────────────
create policy "earnings_own" on public.earnings
    for all
    using  ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username)
    with check ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username);

-- ── fa_targets ────────────────────────────────────────────────
create policy "fa_targets_own" on public.fa_targets
    for all
    using  ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username)
    with check ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username);

-- ── messages (split by operation) ────────────────────────────
-- Read: you are sender or recipient
create policy "messages_select" on public.messages
    for select
    using (
        (auth.jwt() -> 'app_metadata' ->> 'sleeper_username') in (from_username, to_username)
    );
-- Insert: you can only send as yourself
create policy "messages_insert" on public.messages
    for insert
    with check ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = from_username);
-- Update: only the recipient can mark as read
create policy "messages_update" on public.messages
    for update
    using  ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = to_username)
    with check ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = to_username);

-- ── ai_analysis ───────────────────────────────────────────────
create policy "ai_analysis_own" on public.ai_analysis
    for all
    using  ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username)
    with check ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username);

-- ── owner_dna ─────────────────────────────────────────────────
create policy "owner_dna_own" on public.owner_dna
    for all
    using  ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username)
    with check ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username);

-- ── draft_boards ──────────────────────────────────────────────
create policy "draft_boards_own" on public.draft_boards
    for all
    using  ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = sleeper_username)
    with check ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = sleeper_username);

-- ── mock_draft_prospects (read-only for all authenticated users) ──
create policy "prospects_read" on public.mock_draft_prospects
    for select
    using ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') is not null);

-- ── player_tags ───────────────────────────────────────────────
create policy "player_tags_own" on public.player_tags
    for all
    using  ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username)
    with check ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username);

-- ============================================================
-- INDEXES
-- ============================================================

-- Existing indexes (kept)
create index if not exists idx_calendar_username   on public.calendar_events (username);
create index if not exists idx_earnings_username   on public.earnings         (username);
create index if not exists idx_fa_username         on public.fa_targets       (username);
create index if not exists idx_messages_to         on public.messages         (to_username);
create index if not exists idx_messages_from       on public.messages         (from_username);
create index if not exists idx_ai_analysis_username on public.ai_analysis     (username, league_id);
create index if not exists idx_owner_dna_username  on public.owner_dna        (username, league_id);

-- NEW: standalone league_id indexes for queries that filter without username
create index if not exists idx_ai_analysis_league  on public.ai_analysis  (league_id);
create index if not exists idx_owner_dna_league    on public.owner_dna    (league_id);
create index if not exists idx_fa_targets_league   on public.fa_targets   (league_id);

-- NEW: draft_boards — sorted query by username + recency
create index if not exists idx_draft_boards_username_date
    on public.draft_boards (sleeper_username, updated_at desc);

-- NEW: mock draft prospects — sorted by rank
create index if not exists idx_prospects_rank on public.mock_draft_prospects (rank);

-- ── DONE ──────────────────────────────────────────────────────
-- After running this file:
--   1. Copy your project URL and anon key from Supabase → Settings → API
--      and paste them into supabase-client.js
--   2. Set the JWT secret for Edge Functions:
--      supabase secrets set SUPABASE_JWT_SECRET=<your-jwt-secret>
--      (find it: Supabase Dashboard → Settings → API → JWT Settings)
--   3. Deploy Edge Functions:
--      supabase functions deploy get-session-token
--      supabase functions deploy set-password
--      supabase functions deploy ai-analyze
