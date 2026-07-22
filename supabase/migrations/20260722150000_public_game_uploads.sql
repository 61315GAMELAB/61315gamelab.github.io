-- Public game uploads: track uploader IP, per-game secret token, IP block list
alter table public.games
  add column if not exists uploader_ip text,
  add column if not exists upload_token uuid not null default gen_random_uuid();

-- Keep the secret token and uploader IP out of the anon REST API.
-- The public games page selects explicit columns, so column-level grants work.
revoke select on public.games from anon, authenticated;
grant select (id, slug, title, description, entry_path, cover_path, width, height, published, created_at, updated_at)
  on public.games to anon, authenticated;

create table if not exists public.blocked_ips (
  ip text primary key,
  reason text not null default '',
  created_at timestamptz not null default now()
);

-- No policies on purpose: only the games-api edge function (service role) uses it.
alter table public.blocked_ips enable row level security;
