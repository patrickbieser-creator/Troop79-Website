-- Meeting Plan: skills taxonomy, venue tags, teaching authorization, and
-- published plan snapshots.
--
-- Design notes (Plans/Meeting-Plan-Advancement-Suggestions.md):
--   * `venue` encodes BSA's own requirement wording — 'outing' rows literally
--     say "does not include troop or patrol meetings" (or need water/trail/
--     campsite). Everything else stays 'either'; the planner suggests any
--     non-'outing' leaf.
--   * `skills.youth_teachable` is a property of the SKILL, not the requirement.
--     First Aid, Woods Tools sign-off, Fire Safety, and Aquatics are adult-
--     instruction skills per the Guide to Safe Scouting and stay false.
--   * Older-scout teaching authorization is blanket per-skill
--     (`scout_instructors`), not per-meeting.
--   * `meeting_plans` stores one published snapshot per meeting date so the
--     public page has something stable to render.

-- ── skills ────────────────────────────────────────────────────────────────

create table public.skills (
  id text primary key,
  name text not null unique,
  youth_teachable boolean not null default false,
  sort_order int not null default 0
);

alter table public.skills enable row level security;
create policy skills_read_all on public.skills for select using (true);

insert into public.skills (id, name, youth_teachable, sort_order) values
  ('first-aid',   'First Aid',               false,  10),
  ('knots',       'Knots & Lashings',        true,   20),
  ('woods-tools', 'Woods Tools',             false,  30),
  ('fire-safety', 'Fire Safety',             false,  40),
  ('cooking',     'Cooking & Meal Planning', true,   50),
  ('navigation',  'Navigation & Maps',       true,   60),
  ('fitness',     'Fitness',                 true,   70),
  ('camping',     'Camping Skills',          true,   80),
  ('aquatics',    'Aquatics',                false,  90),
  ('nature',      'Nature & Weather',        true,  100),
  ('citizenship', 'Citizenship & Community', true,  110),
  ('teaching',    'Teaching (EDGE)',         true,  120),
  ('safety',      'Safety & Awareness',      true,  130);

-- ── venue + skill columns on the requirement catalogs ─────────────────────

alter table public.rank_requirements
  add column venue text not null default 'either'
    check (venue in ('meeting', 'outing', 'either')),
  add column skill_id text references public.skills(id);

alter table public.merit_badge_requirements
  add column venue text not null default 'either'
    check (venue in ('meeting', 'outing', 'either'));

-- ── leader_skills ─────────────────────────────────────────────────────────

create table public.leader_skills (
  leader_code text not null references public.leaders(code) on delete cascade,
  skill_id text not null references public.skills(id) on delete cascade,
  primary key (leader_code, skill_id)
);

alter table public.leader_skills enable row level security;
create policy leader_skills_read_all on public.leader_skills for select using (true);

-- ── scout_instructors (blanket per-skill authorization, Star+) ────────────

create table public.scout_instructors (
  scout_id text not null references public.scouts(id) on delete cascade,
  skill_id text not null references public.skills(id) on delete cascade,
  authorized_by text,
  authorized_at timestamptz not null default now(),
  primary key (scout_id, skill_id)
);

alter table public.scout_instructors enable row level security;
create policy scout_instructors_read_all on public.scout_instructors for select using (true);

-- ── meeting_plans (published snapshots) ───────────────────────────────────

create table public.meeting_plans (
  id bigint generated always as identity primary key,
  meeting_date date not null unique,
  title text not null default 'Troop Meeting',
  status text not null default 'published' check (status in ('draft', 'published')),
  payload jsonb not null,
  generated_at timestamptz not null default now(),
  generated_by text
);

alter table public.meeting_plans enable row level security;
-- Public (anon) sees published snapshots only; admin writes go through the
-- service-role client which bypasses RLS.
create policy meeting_plans_read_published on public.meeting_plans
  for select using (status = 'published');

-- ── venue curation: rank requirements ─────────────────────────────────────
-- Only clear campout/outing-dependent leaves get 'outing'. Sub-requirement
-- rows share the parent's code prefix (e.g. 4a → 4a.1), hence the like-list.

-- Tenderfoot: campout prep/tenting/cooking + buddy system on an outing
update public.rank_requirements set venue = 'outing'
  where rank_id = 'tenderfoot'
    and (code in ('1a', '1b', '1c', '2a', '2b', '2c', '5a') or code like '2a.%');

-- Tenderfoot: 1-hour service project happens at an event, not a meeting
update public.rank_requirements set venue = 'outing'
  where rank_id = 'tenderfoot' and code = '7b';

-- Second Class: activity count, campsite/tent, campout breakfast, 5-mile
-- compass course, swim test/rescues, service hours
update public.rank_requirements set venue = 'outing'
  where rank_id = 'second-class'
    and code in ('1a', '1c', '2e', '3b', '5b', '5c', '5d', '8e');

-- First Class: activity count, campout cooking, orienteering course,
-- geocaching, swim test, watercraft work, line rescue, service hours
update public.rank_requirements set venue = 'outing'
  where rank_id = 'first-class'
    and code in ('1a', '2e', '4a', '4b', '6a', '6d', '6e', '9d');

-- Star/Life: service hours are event work
update public.rank_requirements set venue = 'outing'
  where rank_id in ('star', 'life') and code = '4';

-- ── skill curation: rank requirements ─────────────────────────────────────
-- skill_id drives teacher matching and the teaching roster. Null = generic
-- (still suggestible; grouped by exact code, no teacher matching).

-- Knots & Lashings
update public.rank_requirements set skill_id = 'knots'
  where (rank_id = 'scout' and code in ('4a', '4b'))
     or (rank_id = 'tenderfoot' and code in ('3a', '3b', '3c'))
     or (rank_id = 'second-class' and code in ('2f', '2g'))
     or (rank_id = 'first-class' and (code in ('3a', '3b', '3c', '3d') or code like '3c.%'));

-- Woods Tools
update public.rank_requirements set skill_id = 'woods-tools'
  where (rank_id = 'scout' and code = '5')
     or (rank_id = 'tenderfoot' and code = '3d');

-- First Aid
update public.rank_requirements set skill_id = 'first-aid'
  where (rank_id = 'tenderfoot' and (code in ('4a', '4d') or code like '4a.%'))
     or (rank_id = 'second-class' and (code in ('6a', '6b') or code like '6a.%'))
     or (rank_id = 'first-class' and (code in ('7a', '7b', '7c') or code like '7a.%'));

-- Fire Safety
update public.rank_requirements set skill_id = 'fire-safety'
  where rank_id = 'second-class' and code in ('2a', '2b', '2c', '2d');

-- Cooking & Meal Planning
update public.rank_requirements set skill_id = 'cooking'
  where (rank_id = 'tenderfoot' and (code in ('2a', '2b', '2c') or code like '2a.%'))
     or (rank_id = 'second-class' and code = '2e')
     or (rank_id = 'first-class' and code in ('2a', '2b', '2c', '2d', '2e'));

-- Navigation & Maps
update public.rank_requirements set skill_id = 'navigation'
  where (rank_id = 'second-class' and code in ('3a', '3b', '3c', '3d'))
     or (rank_id = 'first-class' and code in ('4a', '4b'));

-- Fitness
update public.rank_requirements set skill_id = 'fitness'
  where (rank_id = 'tenderfoot' and (code in ('6a', '6b', '6c') or code like '6a.%' or code like '6c.%'))
     or (rank_id = 'second-class' and code in ('7a', '7b'))
     or (rank_id = 'first-class' and code in ('8a', '8b'));

-- Camping Skills
update public.rank_requirements set skill_id = 'camping'
  where (rank_id = 'tenderfoot' and code in ('1a', '1b', '1c'))
     or (rank_id = 'second-class' and code in ('1a', '1b', '1c'))
     or (rank_id = 'first-class' and code in ('1a', '1b'));

-- Aquatics
update public.rank_requirements set skill_id = 'aquatics'
  where (rank_id = 'second-class' and code in ('5a', '5b', '5c', '5d'))
     or (rank_id = 'first-class' and code in ('6a', '6b', '6c', '6d', '6e'));

-- Nature & Weather
update public.rank_requirements set skill_id = 'nature'
  where (rank_id = 'tenderfoot' and code = '4b')
     or (rank_id = 'second-class' and code = '4')
     or (rank_id = 'first-class' and code in ('5a', '5b', '5c', '5d'));

-- Citizenship & Community (flag work, ceremonies, civic discussions)
update public.rank_requirements set skill_id = 'citizenship'
  where (rank_id = 'tenderfoot' and code = '7a')
     or (rank_id = 'second-class' and code in ('8a', '8b'))
     or (rank_id = 'first-class' and code in ('9a', '9b', '9c'));

-- Teaching (EDGE)
update public.rank_requirements set skill_id = 'teaching'
  where rank_id = 'tenderfoot' and code = '8';

-- Safety & Awareness
update public.rank_requirements set skill_id = 'safety'
  where (rank_id = 'scout' and code = '6')
     or (rank_id = 'tenderfoot' and (code in ('4c', '5a', '5b', '5c')))
     or (rank_id = 'second-class' and code in ('6c', '6d', '6e', '7c', '9a', '9b'))
     or (rank_id = 'first-class' and code in ('7d', '7e', '7f'))
     or (rank_id = 'star' and code = '6');

-- ── venue curation: Eagle-required merit badges (targeted pass) ───────────
-- Only the obviously outing-bound leaves; everything else stays 'either'.
-- Full MB catalog curation is a later slice.

update public.merit_badge_requirements set venue = 'outing'
  where mb_id = 'cooking' and code in ('5b', '5c', '5d', '6b');

update public.merit_badge_requirements set venue = 'outing'
  where mb_id = 'camping' and code like '9%';

update public.merit_badge_requirements set venue = 'outing'
  where mb_id in ('swimming', 'lifesaving');

update public.merit_badge_requirements set venue = 'outing'
  where mb_id = 'environmental-science' and code in ('2a', '2b');
