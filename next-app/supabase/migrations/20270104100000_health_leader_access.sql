-- Health records, release 2: the leader side (Plans/Health-Forms.md; Patrick 2026-11-13 "build the leader side of
-- the health records and ship it").
--
-- 1. health_viewers: the named adults who may open anyone's records (Patrick's answer 1). Its own table, NOT a
--    row in person_capabilities: every capability there counts toward "is a leader / may enter admin / is a full
--    admin" (lib/capabilities holdsLeaderCapability, nav-data isFullAdmin), and a health officer is none of those
--    by virtue of this grant. Granted and removed by the people already on the list.
-- 2. health_reviews: "Reviewed, complete" for one person, by whom and when (answer 3). The app deletes the row
--    whenever one of that person's documents is added, replaced or removed.
--
-- The third way in, an adult attending the same trip, is computed at request time from the sign-up and stores
-- nothing. Additive: DB-first deploy. Posture: RLS on, no policies, nothing granted to anon or authenticated.

create table if not exists public.health_viewers (
  person_id bigint primary key references public.people(id) on delete cascade,
  granted_by_person_id bigint references public.people(id) on delete set null,
  granted_at timestamptz not null default now(),
  constraint granted_at_from_1900 check (granted_at >= '1900-01-01')
);
alter table public.health_viewers enable row level security;
revoke all on public.health_viewers from anon, authenticated;

-- The first name on the list (Patrick): everyone else is added from the site, by someone already on it.
insert into public.health_viewers (person_id)
select id from public.people where id = 82 and merged_into_person_id is null
on conflict do nothing;

-- Takes one adult off the list, never the last one. Locked so two removals at once can't empty it.
-- Returns 'removed' | 'last' | 'absent'.
create or replace function public.health_revoke_viewer(p_person_id bigint) returns text
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  lock table health_viewers in share row exclusive mode;
  if not exists (select 1 from health_viewers where person_id = p_person_id) then return 'absent'; end if;
  if (select count(*) from health_viewers) <= 1 then return 'last'; end if;
  delete from health_viewers where person_id = p_person_id;
  return 'removed';
end;
$$;
revoke all on function public.health_revoke_viewer(bigint) from public, anon, authenticated;

create table if not exists public.health_reviews (
  person_id bigint primary key references public.people(id) on delete cascade,
  reviewed_by_person_id bigint references public.people(id) on delete set null,
  reviewed_by_name text not null check (length(reviewed_by_name) between 1 and 120),
  reviewed_at timestamptz not null default now(),
  constraint reviewed_at_from_1900 check (reviewed_at >= '1900-01-01')
);
alter table public.health_reviews enable row level security;
revoke all on public.health_reviews from anon, authenticated;

-- A merge: the grant follows the person; a review is dropped on both sides (the documents just changed hands).
create or replace function public.health_documents_follow_merge()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  update health_documents d set person_id = new.merged_into_person_id
   where d.person_id = old.id
     and not exists (select 1 from health_documents k
                      where k.person_id = new.merged_into_person_id and k.kind = d.kind and k.page = d.page);
  update health_access_log set person_id = new.merged_into_person_id where person_id = old.id;
  insert into health_viewers (person_id, granted_by_person_id, granted_at)
  select new.merged_into_person_id, granted_by_person_id, granted_at from health_viewers where person_id = old.id
  on conflict (person_id) do nothing;
  delete from health_viewers where person_id = old.id;
  delete from health_reviews where person_id in (old.id, new.merged_into_person_id);
  return new;
end;
$$;
revoke all on function public.health_documents_follow_merge() from public, anon, authenticated;
