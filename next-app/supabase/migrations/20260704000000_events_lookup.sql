-- Events lookup table. Drives the Events tab pull-down in Fast Entry so event
-- names are picked from a list instead of free-typed (prevents typos / dup
-- spellings like "Spring Camout" vs "Spring Campout").
--
-- Deliberately minimal: just a name. Nights / Miles / Hours are still entered
-- per data-entry. The table is NOT a foreign key for ledger_entries — ledger
-- rows keep their own denormalized label, so renaming/removing an event here
-- only affects the picker list, never historical entries.

create table if not exists public.events (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;
create policy events_read_all on public.events for select using (true);

-- Seed from events already in the ledger: distinct labels of the event-kind
-- rows (campouts, summer camps, hikes, meetings). Service hours are excluded —
-- those are the separate Service tab. Deleted rows are skipped so we don't seed
-- from erroneous entries.
insert into public.events (name)
select distinct btrim(label)
from public.ledger_entries
where kind in ('attendance', 'camping_nights', 'hiking_miles')
  and label is not null
  and btrim(label) <> ''
  and deleted_at is null
on conflict (name) do nothing;
