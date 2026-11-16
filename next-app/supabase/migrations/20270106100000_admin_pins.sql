-- Pinned admin items (Plans/Admin-Portal-Nav.md phase 3): each leader's "+ Pin" choices from the rail's area menus,
-- shown under Pinned in the rail and first among Home's shortcuts. One row per person per feature; `position` orders
-- them (Edit pins reorders). `feature_key` is a key from the app's feature registry (feature-registry.ts); a key the
-- registry no longer has is skipped when read, never an error.
--
-- Additive: DB-first deploy. Posture (D-051 / D-239): RLS on with no policies, nothing granted to anon or
-- authenticated. Only the service role reads or writes; the server actions scope every read and write to the
-- signed-in actor's person_id and never take a person_id from the client.

create table if not exists public.admin_pins (
  person_id bigint not null references public.people(id) on delete cascade,
  feature_key text not null check (feature_key ~ '^[a-z][a-z0-9-]*(\.[a-z0-9-]+)?$' and length(feature_key) <= 80),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  constraint created_at_from_1900 check (created_at >= '1900-01-01'),
  primary key (person_id, feature_key)
);
create index if not exists admin_pins_person_position_idx on public.admin_pins (person_id, position);

alter table public.admin_pins enable row level security;
revoke all on public.admin_pins from anon, authenticated;
