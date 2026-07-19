-- Explicit households + multi-address parent contacts.
--
-- WHY HOUSEHOLDS BECOME EXPLICIT (Patrick, 2026-07-19)
-- The signup flow originally derived households at runtime by linking scouts
-- that share a normalized parent email. That is correct against today's data
-- (26 households, all four sibling pairs) but it is fragile in exactly the way
-- that matters: parents hand over whichever address they think of that day —
-- work on one form, personal on the next. The moment two siblings' parent rows
-- carry different addresses, the household silently SPLITS and each half sees
-- a partial family. A wrong answer that looks right.
--
-- So membership becomes a stored fact a leader can correct, not an inference
-- re-run on every page load. The email derivation is kept, but demoted to what
-- it is good at: seeding this table once, and suggesting a household for a
-- newly added scout.

create table if not exists public.households (
  id bigserial primary key,
  label text not null,                        -- "Kowalski", "Barry / Kingston"
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nullable: a scout with no household yet still works everywhere, and the
-- signup picker falls back to a household-of-one.
alter table public.scouts
  add column if not exists household_id bigint references public.households(id) on delete set null;

create index if not exists scouts_household_idx on public.scouts (household_id);

-- ── Parent contact addresses ───────────────────────────────────────────────
-- One row per address rather than email2/email3/email4 columns, chosen for the
-- eventual "export the family email list to our mail program" job:
--   * export is one select, already deduped, instead of an unpivot;
--   * `label` and `is_primary` say WHICH address to send troop mail to, which
--     a column named email3 cannot;
--   * bounces and unsubscribes come back per-address from the mail provider
--     and are recorded here rather than needing bounced2/bounced3 columns.
create table if not exists public.scout_parent_emails (
  id bigserial primary key,
  scout_parent_id bigint not null references public.scout_parents(id) on delete cascade,
  email text not null,
  label text not null default 'home' check (label in ('home', 'work', 'other')),
  is_primary boolean not null default false,
  -- Set from the mail provider's feedback; excluded from future sends.
  bounced_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Same address twice on one parent is always a mistake.
  unique (scout_parent_id, email)
);

create index if not exists scout_parent_emails_parent_idx
  on public.scout_parent_emails (scout_parent_id);
-- At most one primary per parent.
create unique index if not exists scout_parent_emails_one_primary
  on public.scout_parent_emails (scout_parent_id)
  where is_primary;

-- ── Backfill ───────────────────────────────────────────────────────────────
-- Existing scout_parents.email becomes the primary address. The legacy column
-- is deliberately LEFT IN PLACE: other screens still read it, and dropping it
-- in the same migration that introduces its replacement would turn a data
-- model change into an app-wide breakage.
insert into public.scout_parent_emails (scout_parent_id, email, label, is_primary)
select p.id, lower(trim(p.email)), 'home', true
from public.scout_parents p
where p.email is not null and trim(p.email) <> ''
on conflict (scout_parent_id, email) do nothing;

-- ── One-time household bootstrap from the email derivation ─────────────────
-- Connected components over "scouts sharing a parent email". Each scout gets
-- the smallest scout id reachable from it, which becomes the component key.
-- This runs ONCE; from here on membership is edited, not inferred.
with recursive edges as (
  select a.scout_id as x, b.scout_id as y
  from public.scout_parents a
  join public.scout_parents b
    on lower(trim(a.email)) = lower(trim(b.email))
  where a.email is not null and trim(a.email) <> ''
),
reach (x, y) as (
  select s.id, s.id from public.scouts s
  union
  select r.x, e.y from reach r join edges e on e.x = r.y
),
component as (
  select x as scout_id, min(y) as root from reach group by x
),
labelled as (
  select c.root,
         string_agg(distinct s.last_name, ' / ' order by s.last_name) as label
  from component c
  join public.scouts s on s.id = c.scout_id
  where s.last_name is not null and s.last_name <> ''
  group by c.root
),
created as (
  insert into public.households (label)
  select coalesce(l.label, 'Household ' || l.root) from labelled l
  returning id, label
)
update public.scouts s
set household_id = c.id
from component comp
join labelled l on l.root = comp.root
join created c on c.label = coalesce(l.label, 'Household ' || l.root)
where s.id = comp.scout_id
  and s.household_id is null;

-- Any scout the derivation missed (no parent row at all) gets its own
-- household, so nobody is unreachable in the signup picker.
with orphans as (
  select id, coalesce(nullif(last_name, ''), display_name) as label
  from public.scouts where household_id is null
),
made as (
  insert into public.households (label)
  select label from orphans
  returning id, label
)
update public.scouts s
set household_id = m.id
from orphans o join made m on m.label = o.label
where s.id = o.id and s.household_id is null;
