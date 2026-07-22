-- Games hosting: metadata table + public storage bucket
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,49}$'),
  title text not null check (char_length(title) between 1 and 100),
  description text not null default '' check (char_length(description) <= 2000),
  entry_path text not null default 'index.html',
  cover_path text,
  width integer not null default 960 check (width between 100 and 4096),
  height integer not null default 600 check (height between 100 and 4096),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.games enable row level security;

-- Anyone can read published games; all writes go through the
-- games-api edge function using the service role key.
create policy "Public can view published games"
  on public.games for select
  to anon, authenticated
  using (published);

-- Public bucket that serves the uploaded game builds
insert into storage.buckets (id, name, public)
values ('games', 'games', true)
on conflict (id) do nothing;
