-- Scoutbook-style demographics (Patrick, 2026-07-13).
--
--   * Birthdates for scouts AND leaders — age is always DERIVED, never
--     stored (same philosophy as current_rank and youth-leader status).
--   * School + graduation_year for scouts. Grade is DERIVED from
--     graduation_year (12 - (grad_year - current school year), Aug 1
--     rollover) so nobody has to bump 30 grade fields every September —
--     the editor accepts a grade and stores the class year.
--   * swim_class: Scoutbook's three-level swim classification — feeds
--     aquatics planning.
--   * Leaders: bsa_member_id (scouts already had one), and ypt_completed —
--     Youth Protection Training completion date; certification runs two
--     years, status (current / expiring / expired) is derived.
--
-- Deliberately NOT tracked: medical conditions/allergies — health form
-- dates only, the forms themselves stay on paper with the health officer.

alter table public.scouts
  add column birthdate date,
  add column gender text check (gender in ('M', 'F')),
  add column school text,
  add column graduation_year int,
  add column swim_class text check (swim_class in ('swimmer', 'beginner', 'nonswimmer'));

alter table public.leaders
  add column birthdate date,
  add column bsa_member_id text,
  add column ypt_completed date;
