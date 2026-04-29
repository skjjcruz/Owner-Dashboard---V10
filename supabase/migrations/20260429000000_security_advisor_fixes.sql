-- Supabase Security Advisor fixes
--
-- Addresses four advisor findings against the production database:
--   1. Policy Exists RLS Disabled  -> public.field_log
--   2. RLS Disabled in Public      -> public.field_log
--   3. RLS Disabled in Public      -> public.analytics_events
--   4. Sensitive Columns Exposed   -> public.analytics_events
--
-- These tables were created via the Supabase dashboard and are not defined
-- in the repo schema files. This migration enables RLS, removes direct
-- client read access, and forces all reads/writes to go through the service
-- role (which bypasses RLS) used by Edge Functions.

-- ── public.field_log ──────────────────────────────────────────
-- Policies already exist; enabling RLS activates them and clears the
-- "Policy Exists RLS Disabled" + "RLS Disabled in Public" findings.
do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'field_log'
  ) then
    execute 'alter table public.field_log enable row level security';
    execute 'alter table public.field_log force row level security';
  end if;
end $$;

-- ── public.analytics_events ───────────────────────────────────
-- No policies exist and the table is flagged for sensitive column
-- exposure via PostgREST. Enable RLS and revoke direct grants from
-- the anon/authenticated roles so the table is only reachable via
-- the service role (Edge Functions).
do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'analytics_events'
  ) then
    execute 'alter table public.analytics_events enable row level security';
    execute 'alter table public.analytics_events force row level security';
    execute 'revoke all on public.analytics_events from anon';
    execute 'revoke all on public.analytics_events from authenticated';
  end if;
end $$;
