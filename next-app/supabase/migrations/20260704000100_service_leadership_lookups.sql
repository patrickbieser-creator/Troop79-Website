-- Service-project and leadership-position lookup tables. Same shape + rationale
-- as the events lookup (20260704000000): drive the Service and Leadership tab
-- pull-downs in Fast Entry so names are picked from a list instead of free-typed.
-- Just a name; hours (service) are entered per data-entry, leadership is name-only.
-- Neither is a foreign key for ledger_entries — rows keep their denormalized label.

create table if not exists public.service_projects (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);
alter table public.service_projects enable row level security;
create policy service_projects_read_all on public.service_projects for select using (true);

create table if not exists public.leadership_positions (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);
alter table public.leadership_positions enable row level security;
create policy leadership_positions_read_all on public.leadership_positions for select using (true);

-- Seed from distinct labels already in the ledger (deleted rows skipped).
insert into public.service_projects (name)
select distinct btrim(label)
from public.ledger_entries
where kind = 'service_hours'
  and label is not null
  and btrim(label) <> ''
  and deleted_at is null
on conflict (name) do nothing;

insert into public.leadership_positions (name)
select distinct btrim(label)
from public.ledger_entries
where kind = 'leadership'
  and label is not null
  and btrim(label) <> ''
  and deleted_at is null
on conflict (name) do nothing;
