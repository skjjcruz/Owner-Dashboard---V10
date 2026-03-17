-- Fantasy Wars: core user account + subscription tables
-- Apply with: supabase db push --project-ref <ref>

-- ── app_users ─────────────────────────────────────────────────
create table if not exists public.app_users (
  id            uuid        primary key default gen_random_uuid(),
  email         text        not null unique,
  password_hash text        not null,
  display_name  text,
  created_at    timestamptz not null default now()
);

-- Index for login lookups by email
create index if not exists app_users_email_idx on public.app_users (email);

-- RLS: users can only read/update their own row
alter table public.app_users enable row level security;

create policy if not exists "Users can read own row"
  on public.app_users for select
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') = id::text);

create policy if not exists "Users can update own row"
  on public.app_users for update
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') = id::text);

-- ── subscriptions ─────────────────────────────────────────────
create table if not exists public.subscriptions (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.app_users (id) on delete cascade,
  product_slug text        not null,
  tier         text        not null default 'free',
  status       text        not null default 'active',
  created_at   timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx   on public.subscriptions (user_id);
create index if not exists subscriptions_status_idx    on public.subscriptions (status);

alter table public.subscriptions enable row level security;

create policy if not exists "Users can read own subscriptions"
  on public.subscriptions for select
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') = user_id::text);
