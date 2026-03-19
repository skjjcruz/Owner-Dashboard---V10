-- League Intelligence: shared per-team AI state across all pages
-- Populated by trade-calculator when any AI analysis runs.
-- Read by mock draft, FA, and any future analysis context builders.

create table if not exists public.league_intelligence (
  id           uuid        primary key default gen_random_uuid(),
  league_id    text        not null,
  owner_id     text        not null,          -- Sleeper owner_id
  owner_name   text,
  tier         text,                          -- Elite / Contender / Rebuilder / etc.
  health_score numeric,                       -- 0–100
  posture      text,                          -- Win Now / Rebuilder / Seller / Buyer
  needs        jsonb       default '[]'::jsonb,  -- e.g. ["QB*","WR","RB"] (* = deficit)
  strengths    jsonb       default '[]'::jsonb,
  qb_count     integer     default 0,
  record       text,                          -- "8-5"
  dna          text,                          -- trade DNA archetype name
  updated_at   timestamptz default now(),
  unique(league_id, owner_id)
);

create index if not exists idx_league_intel_league
  on public.league_intelligence(league_id);

alter table public.league_intelligence enable row level security;

-- Shared league data — any authenticated user can read all teams in any league
do $$ begin
  create policy "Anyone can read league intelligence"
    on public.league_intelligence for select
    to authenticated
    using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Anyone can insert league intelligence"
    on public.league_intelligence for insert
    to authenticated
    with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Anyone can update league intelligence"
    on public.league_intelligence for update
    to authenticated
    using (true);
exception when duplicate_object then null;
end $$;
