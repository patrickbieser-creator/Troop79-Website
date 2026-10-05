-- Price changes on the Price book (Patrick, 2026-10-05): "Acknowledge" takes a change off the list once a
-- leader has seen it, so what is left is what nobody has looked at yet (and a typo can be caught and fixed
-- right there with Edit). Nothing else reads these columns.
--
-- DEPLOY ORDER: DB-first (additive; the new code selects acknowledged_at).

alter table public.mm_price_history
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by_person_id bigint references public.people (id) on delete set null;

comment on column public.mm_price_history.acknowledged_at is
  'A leader marked this applied/reverted change as seen; it leaves the Price changes list.';
