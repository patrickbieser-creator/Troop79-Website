-- Schools become a lookup table (Plans/Person-Record-One-Save.md, step 1 "Schools data"; Patrick 2026-11-15:
-- "Add the school pick list now"). `scouts.school` was free text, so the same school was spelled several ways
-- ("Shorewood" / "Shorewood High School", "Bay View Elementry"). From here every school field is a pick list over
-- `schools`, and a scout points at one with `scouts.school_id`.
--
-- `scouts.school` (text) STAYS for now so the backfill can be checked against it; a later migration drops it once
-- Patrick has verified the mapping below. After this migration no app code reads or writes `scouts.school`.
--
-- Additive: DB-first deploy. Posture (D-051 / D-239): RLS on with no policies, nothing granted to anon or
-- authenticated. Only the service role reads or writes; who may add, rename, merge or hide a school is decided in
-- the server actions (roster.manage), and families only ever see the active names through a server-rendered page.

create table if not exists public.schools (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 1 and 120),
  -- An abbreviation a leader may want in a tight column ("SIS"); never required.
  short_name text check (short_name is null or length(btrim(short_name)) between 1 and 20),
  -- Hidden schools (active = false) are not offered in the pickers; a scout who already has one keeps it.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint created_at_from_1900 check (created_at >= '1900-01-01')
);
-- One row per school, whatever the capitalisation or stray spaces: "shorewood high school " is "Shorewood High School".
create unique index if not exists schools_name_key on public.schools (lower(btrim(name)));
alter table public.schools enable row level security;
revoke all on public.schools from anon, authenticated;
revoke all on sequence public.schools_id_seq from anon, authenticated;

-- A school in use can't be deleted out from under a scout: merge it into another, or hide it.
alter table public.scouts add column if not exists school_id bigint references public.schools(id) on delete restrict;
create index if not exists scouts_school_id_idx on public.scouts (school_id);

-- ── Backfill ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ THE MAPPING — every distinct production `scouts.school` value as of 2026-11-15 → its clean school.           ║
-- ║ PROPOSED, NOT YET CONFIRMED BY PATRICK. Edit the rows here (old text is matched case-insensitively and       ║
-- ║ trimmed). Any non-blank value NOT listed is kept as its own school, trimmed, so nothing is lost.             ║
-- ║ Note: "Reagan … <- Fernwood" etc. recorded the scout's previous school too; only Reagan is kept here.        ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
drop table if exists pg_temp.school_map;
create temp table school_map (old_text text not null, clean_name text not null, short_name text);
insert into school_map (old_text, clean_name, short_name) values
  ('Audubon HS',                              'Audubon High School',                     null),
  ('Bay View Elementry',                      'Bay View Elementary',                     null),
  ('Bayview Montessori',                      'Bay View Montessori',                     null),
  ('Deer Creek Intermediate School',          'Deer Creek Intermediate School',          null),
  ('Fernwood Montessori',                     'Fernwood Montessori School',              null),
  ('Fernwood Montessori School',              'Fernwood Montessori School',              null),
  ('Lake Bluff Elementry',                    'Lake Bluff Elementary',                   null),
  ('Milwaukee Montessori',                    'Milwaukee Montessori School',             null),
  ('Milwaukee Parkside School for the Arts',  'Milwaukee Parkside School for the Arts',  null),
  ('Pilgrim Luthern',                         'Pilgrim Lutheran',                        null),
  ('Pius XI',                                 'Pius XI Catholic High School',            null),
  ('Reagan',                                  'Reagan High School',                      null),
  ('Reagan High School <- Fernwood',          'Reagan High School',                      null),
  ('Reagan HS <- Fernwood Montessori',        'Reagan High School',                      null),
  ('Reagan HS <- Tamarack Waldorf',           'Reagan High School',                      null),
  ('Rufus King',                              'Rufus King High School',                  null),
  ('Saint Francis High School',               'Saint Francis High School',               null),
  ('Shorewood',                               'Shorewood High School',                   null),
  ('Shorewood High School',                   'Shorewood High School',                   null),
  ('Shorewood Intermediate School (SIS)',     'Shorewood Intermediate School',           'SIS'),
  ('St Jude catholic school',                 'St. Jude the Apostle',                    null),
  ('St Jude the Apostle',                     'St. Jude the Apostle',                    null);
-- ── end of mapping ───────────────────────────────────────────────────────────────────────────────────────────────

-- 1. The clean list (one row per clean name; a short name wins over none).
insert into public.schools (name, short_name)
select clean_name, max(short_name)
  from school_map
 group by clean_name
on conflict ((lower(btrim(name)))) do nothing;

-- 2. Anything the mapping doesn't name becomes its own school, trimmed and with runs of spaces collapsed.
insert into public.schools (name)
select distinct btrim(regexp_replace(s.school, '\s+', ' ', 'g'))
  from public.scouts s
 where nullif(btrim(s.school), '') is not null
   and not exists (select 1 from school_map m where lower(btrim(m.old_text)) = lower(btrim(s.school)))
on conflict ((lower(btrim(name)))) do nothing;

-- 3. Point every scout at its school.
update public.scouts sc
   set school_id = sh.id
  from (
        select s.id as scout_id,
               coalesce(m.clean_name, btrim(regexp_replace(s.school, '\s+', ' ', 'g'))) as target
          from public.scouts s
          left join school_map m on lower(btrim(m.old_text)) = lower(btrim(s.school))
         where nullif(btrim(s.school), '') is not null
       ) t
  join public.schools sh on lower(btrim(sh.name)) = lower(btrim(t.target))
 where sc.id = t.scout_id
   and sc.school_id is null;

drop table if exists pg_temp.school_map;

-- 4. Nothing lost: every scout with school text now has a school.
do $$
declare
  missing integer;
begin
  select count(*) into missing
    from public.scouts
   where nullif(btrim(school), '') is not null and school_id is null;
  if missing > 0 then
    raise exception 'schools backfill: % scout(s) with school text have no school_id', missing;
  end if;
end;
$$;
