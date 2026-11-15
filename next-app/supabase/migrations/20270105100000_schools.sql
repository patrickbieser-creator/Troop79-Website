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
-- ║ Confirmed by Patrick 2026-11-15. Old text is matched case-insensitively, trimmed, runs of spaces collapsed. ║
-- ║ A NULL clean name leaves the scout with no school: plain "Shorewood" was a stopgap for Lake Bluff, Atwater ║
-- ║ or Shorewood Intermediate, and Patrick fixes those five by hand. Any value NOT listed becomes its own school.║
-- ║ "Reagan … <- Fernwood" recorded the previous school: it is copied into "things we should know" (step 0).   ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
drop table if exists pg_temp.school_map;
create temp table school_map (old_text text not null, clean_name text, short_name text);
insert into school_map (old_text, clean_name, short_name) values
  ('Audubon HS',                              'Audubon High School',                     null),
  ('Bay View Elementry',                      'Bay View Elementary',                     null),
  ('Bayview Montessori',                      'Bay View Montessori',                     null),
  ('Deer Creek Intermediate School',          'Deer Creek Intermediate School',          null),
  ('Fernwood Montessori',                     'Fernwood Montessori School',              null),
  ('Fernwood Montessori School',              'Fernwood Montessori School',              null),
  ('Lake Bluff Elementry',                    'Lake Bluff School',                       null),
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
  ('Shorewood',                               null,                                      null),
  ('Shorewood High School',                   'Shorewood High School',                   null),
  ('Shorewood Intermediate School (SIS)',     'Shorewood Intermediate School',           'SIS'),
  ('St Jude catholic school',                 'St. Jude the Apostle',                    null),
  ('St Jude the Apostle',                     'St. Jude the Apostle',                    null);
-- ── end of mapping ───────────────────────────────────────────────────────────────────────────────────────────────

create or replace function pg_temp.school_key(t text) returns text language sql immutable as
$$ select lower(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'))) $$;

-- 0. "Reagan HS <- Fernwood Montessori": keep the earlier school in the scout's "things we should know" (Patrick
--    2026-11-15). Idempotent: skipped when the line is already there.
update public.people p
   set things_we_should_know = concat_ws(chr(10), nullif(btrim(p.things_we_should_know), ''),
                                         'Previous school: ' || btrim(split_part(s.school, '<-', 2))),
       updated_at = now()
  from public.scouts s
 where s.person_id = p.id
   and s.school like '%<-%'
   and nullif(btrim(split_part(s.school, '<-', 2)), '') is not null
   and coalesce(p.things_we_should_know, '') not like '%Previous school: ' || btrim(split_part(s.school, '<-', 2)) || '%';

-- 1. The clean list (one row per clean name; a short name wins over none), plus the Shorewood-area schools
--    Patrick asked for so the "Shorewood" five can be fixed by hand.
insert into public.schools (name, short_name)
select clean_name, max(short_name)
  from school_map
 where clean_name is not null
 group by clean_name
on conflict ((lower(btrim(name)))) do nothing;
insert into public.schools (name) values
  ('Atwater School'),
  ('Lake Bluff School'),
  ('Shorewood Intermediate School'),
  ('Shorewood High School')
on conflict ((lower(btrim(name)))) do nothing;

-- 2. Anything the mapping doesn't name becomes its own school, trimmed and with runs of spaces collapsed.
insert into public.schools (name)
select distinct btrim(regexp_replace(s.school, '\s+', ' ', 'g'))
  from public.scouts s
 where nullif(btrim(s.school), '') is not null
   and not exists (select 1 from school_map m where pg_temp.school_key(m.old_text) = pg_temp.school_key(s.school))
on conflict ((lower(btrim(name)))) do nothing;

-- 3. Point every scout at its school.
update public.scouts sc
   set school_id = sh.id
  from (
        select s.id as scout_id,
               coalesce(m.clean_name, btrim(regexp_replace(s.school, '\s+', ' ', 'g'))) as target
          from public.scouts s
          left join school_map m on pg_temp.school_key(m.old_text) = pg_temp.school_key(s.school)
         where nullif(btrim(s.school), '') is not null
           and not (m.old_text is not null and m.clean_name is null)
       ) t
  join public.schools sh on lower(btrim(sh.name)) = lower(btrim(t.target))
 where sc.id = t.scout_id
   and sc.school_id is null;

-- 4. Nothing lost: every scout with school text now has a school, apart from the ones mapped to none.
do $$
declare
  missing integer;
begin
  select count(*) into missing
    from public.scouts s
   where nullif(btrim(s.school), '') is not null and s.school_id is null
     and not exists (select 1 from school_map m
                      where m.clean_name is null and pg_temp.school_key(m.old_text) = pg_temp.school_key(s.school));
  if missing > 0 then
    raise exception 'schools backfill: % scout(s) with school text have no school_id', missing;
  end if;
end;
$$;

drop table if exists pg_temp.school_map;
