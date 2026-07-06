-- Event type lookup table. Drives an "Event Type" tag on ledger rows
-- (Camping / Day Outing / Hike / Fundraiser / …) so events entered through
-- Fast Entry's Events tab can be distinguished from actual campouts — e.g. a
-- fundraiser like a pancake breakfast shouldn't count as camping just
-- because it happened to be logged with a Nights value.
--
-- Same shape/precedent as public.events: editable via Lookups & Admin, not a
-- required field, and event_type_id is nullable on ledger_entries since most
-- rows (rank/MB requirements, awards, leadership) never have one.

create table if not exists public.event_types (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.event_types enable row level security;
create policy event_types_read_all on public.event_types for select using (true);

insert into public.event_types (name) values
  ('Camping'),
  ('Day Outing'),
  ('Hike'),
  ('Fundraiser')
on conflict (name) do nothing;

alter table public.ledger_entries
  add column if not exists event_type_id bigint references public.event_types(id) on delete set null;
