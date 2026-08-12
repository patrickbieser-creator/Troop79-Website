-- Calendar categories become a managed lookup table (D-082).
--
-- WHY (Operator, 2026-08-12)
-- The taxonomy has been a hardcoded CHECK constraint since 20260712000000,
-- duplicated into photo_albums by 20260712050000 with the comment "reuses the
-- calendar_entries vocabulary verbatim — shared taxonomy, no parallel lookup
-- table". That duplication drifted exactly as duplication does: 20260718100000
-- renamed the calendar's categories and never touched photo_albums, so adding
-- an album under "Day Activity / Outing" failed outright until 20260721020000
-- hand-resynced the second CHECK. Two copies of one vocabulary, kept in step
-- by hand, plus a TypeScript union that is a third copy.
--
-- Patrick, mid-build of yet more hardcoded categories for off-calendar events
-- (D-080): "Hold off on hardcoded categories. Make it a lookup table so I can
-- enter it dynamically."
--
-- This is a deliberate reversal of the house instinct recorded in the
-- photo_albums header (and applied correctly to ledger_entries.kind, where the
-- event_types lookup WAS collapsed away). The difference is who owns the
-- vocabulary: `kind` is a closed set the CODE reasons about (Nights vs Miles
-- vs neither), so an enum is honest. Categories are an open set only HUMANS
-- reason about — they label and color a row, nothing branches on them — so
-- they belong to Patrick, not to a deploy.
--
-- Shape:
--   * `label` is the primary key, and calendar_entries/photo_albums keep
--     storing the label text. FK ON UPDATE CASCADE turns a rename into a
--     one-field edit that rewrites every referencing row for free; ON DELETE
--     RESTRICT makes deleting an in-use category impossible. (Modeled on
--     OMG-Website's Programs lookup, their D-019.)
--   * `behavior` replaces the three places that special-cased a category by
--     NAME. Renaming "No Meeting" to "No Meeting (Holiday)" used to silently
--     break the Meetings system; behavior is the stable handle, the label is
--     free to change. At most one row may carry each behavior.

create table public.calendar_categories (
  label text primary key,
  color text not null,
  sort_order int not null,
  -- Stable handles for the only two categories any code branches on.
  -- Everything else is pure presentation.
  behavior text check (behavior in ('meeting', 'no_meeting'))
);

comment on column public.calendar_categories.behavior is
  'Stable handle for categories the app branches on: meeting (the weekly troop meeting the Meetings system publishes agendas for) and no_meeting (a deliberately cancelled meeting week). Labels may be renamed freely; behavior must not be reassigned casually.';

-- At most one category may claim each behavior.
create unique index calendar_categories_behavior_key
  on public.calendar_categories (behavior)
  where behavior is not null;

-- Seeded from lib/calendar-shared.ts: colors are the Bugle's printed legend
-- (ported from the legacy calendar.html --clr-* variables, and preserved
-- through the 2026-07-18 renames so the printed legend never shifted), and
-- sort_order is that file's CATEGORIES display order.
insert into public.calendar_categories (label, color, sort_order, behavior) values
  ('Troop Meeting',          '#1e3a4a',  10, 'meeting'),
  ('Campout / Overnight',    '#3d5a3e',  20, null),
  ('Day Activity / Outing',  '#4a6741',  30, null),
  ('High Adventure',         '#2d6a4f',  40, null),
  ('Summer Camp',            '#527554',  50, null),
  ('Service Project',        '#6a5d3a',  60, null),
  ('Fundraiser',             '#8b6914',  70, null),
  ('Advancement Event',      '#2f6b7a',  80, null),
  ('Training',               '#7a4a6a',  90, null),
  ('Ceremony / Recognition', '#5a3d6a', 100, null),
  ('Leadership / Planning',  '#4c5c6a', 110, null),
  ('Recruiting / Outreach',  '#a04a3d', 120, null),
  ('Social Event',           '#8a6f4a', 130, null),
  ('No Meeting',             '#a0978a', 140, 'no_meeting');

-- Deleting a behavior-carrying row would break the Meetings system even if no
-- calendar entry currently references it (the FK's RESTRICT only fires on
-- rows in use — an empty September would leave "No Meeting" deletable).
create function public.calendar_categories_protect_behavior()
returns trigger
language plpgsql
as $$
begin
  if old.behavior is not null then
    raise exception
      'Cannot delete category "%": it carries the "%" behavior the app depends on. Rename it instead, or move the behavior to another category first.',
      old.label, old.behavior;
  end if;
  return old;
end;
$$;

create trigger calendar_categories_protect_behavior_del
  before delete on public.calendar_categories
  for each row execute function public.calendar_categories_protect_behavior();

-- calendar_entries: CHECK -> FK.
alter table public.calendar_entries
  drop constraint calendar_entries_category_check;

alter table public.calendar_entries
  add constraint calendar_entries_category_fkey
  foreign key (category) references public.calendar_categories (label)
  on update cascade on delete restrict;

-- photo_albums: the second copy of the taxonomy collapses into the same FK.
-- This is the coupling the 2026-07-21 drift bug was a symptom of; from here a
-- rename reaches albums automatically instead of needing a follow-up migration.
alter table public.photo_albums
  drop constraint photo_albums_category_check;

alter table public.photo_albums
  add constraint photo_albums_category_fkey
  foreign key (category) references public.calendar_categories (label)
  on update cascade on delete restrict;

-- The FK columns are the child side of an ON UPDATE CASCADE; without an index
-- Postgres seq-scans both tables on every rename.
create index calendar_entries_category_idx on public.calendar_entries (category);
create index photo_albums_category_idx on public.photo_albums (category);

-- Same posture as the tables it classifies (calendar_entries, photo_albums):
-- readable by anyone, written only through the service-role client.
alter table public.calendar_categories enable row level security;
create policy calendar_categories_read_all
  on public.calendar_categories for select using (true);
