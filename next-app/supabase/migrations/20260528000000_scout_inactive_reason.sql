-- Tracks why a scout is no longer active. Only meaningful when active=false.
-- Five canonical reasons; anything else uses 'other'.

alter table public.scouts
  add column if not exists inactive_reason text;

-- Constrain to the five enum-like values OR null. NULL is required when
-- active=true (an active scout can't have a reason); a reason is required
-- when active=false.
alter table public.scouts
  add constraint scouts_inactive_reason_valid
    check (
      inactive_reason is null
      or inactive_reason in ('dropped_out', 'transferred', 'moved_away', 'aged_out', 'other')
    );

alter table public.scouts
  add constraint scouts_inactive_reason_only_when_inactive
    check (
      (active = true and inactive_reason is null)
      or (active = false and inactive_reason is not null)
    );

comment on column public.scouts.inactive_reason is
  'Why the scout is no longer active. NULL when active=true; one of '
  'dropped_out, transferred, moved_away, aged_out, other when active=false.';
