-- Menu Monster keeps its own patrol list (Patrick, 2026-10-06: "Use [the roster's] data to populate the patrol
-- pull down picker in MM. Add a Tools & Utilities to the Menu Monster Admin screen that adds our first tool,
-- which is Resync Patrol List from Roster"). The planner's Patrol field reads this table; the admin tool
-- rewrites it from the roster (active scouts' patrols + "Whole troop"). Seeded here from the roster so the
-- picker is full before anyone runs the tool.
--
-- Service-role only like every mm_* table (D-239): RLS on, no policies. DEPLOY ORDER: DB-first.

create table if not exists public.mm_patrols (
  name       text primary key,
  sort_order integer not null default 0,
  synced_at  timestamptz not null default now()
);
alter table public.mm_patrols enable row level security;
comment on table public.mm_patrols is 'The planner''s patrol pull-down. Rewritten from scouts.patrol by the admin "Resync patrol list from roster" tool.';

insert into public.mm_patrols (name, sort_order)
select p, row_number() over (order by p)
from (select distinct btrim(patrol) as p from public.scouts where active and patrol is not null and btrim(patrol) <> '') x
on conflict (name) do nothing;
insert into public.mm_patrols (name, sort_order) values ('Whole troop', 1000) on conflict (name) do nothing;
