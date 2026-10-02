-- Menu Monster scout workspace, Phase 1 (Plans/Menu-Monster-Scout-Workspace.md,
-- Patrick 2026-10-01/02): a verified scout's saved menus. Reverses D-266
-- ("plans are not persisted") for signed-in scouts; the anonymous planner
-- keeps its localStorage draft.
--
-- One row per menu. Meals ride as a jsonb array (nothing queries a meal on
-- its own, and a save is one atomic write); diets are the engine's
-- RestrictionKey map (gf / nut / dairy / veg), clamped in the app. The
-- snapshot is the priced shopping list built SERVER-side at save time, so a
-- menu still renders after a recipe or package is retired. Sharing, review
-- notes and copying add their columns in later phases.
--
-- DEPLOY ORDER: DB-first. Additive; nothing reads it until the workspace ships.
-- The audit_log CHECK widening must land with it — recordAuditAs swallows a
-- failed insert, so a missing 'menus' area would drop every scout audit row
-- silently.
--
-- RLS on, zero policies (D-239): service role only, through createAdminClient.

create table public.mm_menus (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: a menu is never cascade-deleted with its scout; people-merge
  -- re-points it like every other person reference.
  owner_person_id bigint not null references public.people (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  context text not null default 'camp' check (context in ('home', 'camp', 'trail')),
  -- The calendar outing (NOT public.events, the ledger-picker lookup). SET
  -- NULL: a leader deleting or merging an entry leaves scouts' menus intact.
  calendar_entry_id bigint references public.calendar_entries (id) on delete set null,
  -- Day labels when no outing is linked.
  start_date date,
  headcount integer not null check (headcount between 1 and 99),
  restrictions jsonb not null default '{}'::jsonb check (jsonb_typeof(restrictions) = 'object'),
  budget_per_person_meal numeric(6, 2) not null default 4 check (budget_per_person_meal >= 0),
  meals jsonb not null default '[]'::jsonb
    check (jsonb_typeof(meals) = 'array' and jsonb_array_length(meals) <= 60),
  snapshot jsonb,
  created_at timestamptz not null default now(),
  -- Set by the save action and compared on the next save (no silent
  -- overwrite from a second tab).
  updated_at timestamptz not null default now()
);

alter table public.mm_menus enable row level security;

create index mm_menus_owner_updated_idx on public.mm_menus (owner_person_id, updated_at desc);
create index mm_menus_calendar_entry_idx on public.mm_menus (calendar_entry_id) where calendar_entry_id is not null;

-- Scout menu actions get high-level audit rows (Decision 2).
alter table public.audit_log drop constraint audit_log_area_check;
alter table public.audit_log
  add constraint audit_log_area_check check (area in ('news', 'calendar', 'roster', 'library', 'menus'));
