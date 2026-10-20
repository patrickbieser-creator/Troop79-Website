-- BSA registration, as the my.scouts.org Roster Report states it (Patrick, 2026-10-20).
--
-- Written ONLY by the BSA Roster check (/admin/advancement/bsa-roster), on an
-- explicit Save, for people matched to the roster by BSA member id (or by a unique
-- name when we have no BSA id for them yet). BSA is the
-- source of truth for these five facts and nothing else; every other
-- disagreement is reported, never written.
--
-- Additive, nullable: deploy DB-first.

alter table public.people
  add column bsa_registration_expires date,
  add column bsa_registration_status text,
  add column bsa_positions text[],
  add column bsa_auto_renew_opted_out boolean,
  add column bsa_roster_as_of date;

comment on column public.people.bsa_registration_expires is
  'Registration expiry from the BSA Roster Report (expirydtstr).';
comment on column public.people.bsa_registration_status is
  'BSA registration status as worded on the roster: New, Re-Registered, Transfer, Multiple.';
comment on column public.people.bsa_positions is
  'Every position this person holds in the unit per the BSA roster.';
comment on column public.people.bsa_auto_renew_opted_out is
  'BSA cisautorenewaloptedout; null when BSA leaves it blank (New members).';
comment on column public.people.bsa_roster_as_of is
  'Date Report Generated of the roster these values came from.';
