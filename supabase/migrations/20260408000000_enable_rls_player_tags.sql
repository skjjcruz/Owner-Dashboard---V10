-- Enable Row Level Security on player_tags table and add ownership policy.
-- Resolves: "Table public.player_tags is public, but RLS has not been enabled."

alter table public.player_tags enable row level security;

do $$ begin
  create policy "player_tags_own"
    on public.player_tags for all
    to authenticated
    using  ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username)
    with check ((auth.jwt() -> 'app_metadata' ->> 'sleeper_username') = username);
exception when duplicate_object then null;
end $$;
