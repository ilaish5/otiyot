-- אותיות נפגשות — סכמה. כל שורה שייכת למשתמש (ההורה); RLS: רואים ועורכים רק שורות של עצמך.
-- הרצה חוזרת בטוחה (idempotent).

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.words (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  text text not null,
  pic text not null default '',
  level smallint not null check (level between 1 and 20),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- יומן ניסיונות: רק הוספה. id נוצר בצד הלקוח (uuid) כדי שסנכרון חוזר לא ייצור כפילויות
create table if not exists public.attempts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  word_id text not null,
  outcome text not null check (outcome in ('solo', 'heard', 'skipped')),
  attempts smallint not null default 0,
  transcripts jsonb not null default '[]'::jsonb,
  ts timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists attempts_user_ts on public.attempts (user_id, ts desc);

create table if not exists public.drawings (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_id text not null,
  storage_path text not null,
  ts timestamptz not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists drawings_user_ts on public.drawings (user_id, ts desc);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['settings', 'words', 'drawings'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
  foreach t in array array['settings', 'words', 'attempts', 'drawings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ציורים: bucket פרטי, נתיב <user_id>/<drawing_id>.png
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drawings', 'drawings', false, 5242880, array['image/png'])
on conflict (id) do nothing;

drop policy if exists drawings_own on storage.objects;
create policy drawings_own on storage.objects for all to authenticated
  using (bucket_id = 'drawings' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'drawings' and (storage.foldername(name))[1] = (select auth.uid())::text);
