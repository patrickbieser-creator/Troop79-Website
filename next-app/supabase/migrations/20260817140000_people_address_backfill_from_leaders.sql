-- Fill in adults' missing address/phone/email from the legacy `leaders`
-- table where `people` has nothing — the same bug class as
-- `20260817120000_people_ypt_health_notes.sql`, found the same way
-- (Patrick noticed live on production, 2026-08-17): `leaders` has always had
-- its own address_line1/2/city/state/zip/phone/email columns
-- (`20260528000100_demographics_parents_counselors.sql`), and
-- `20260725000000_people_address_columns.sql` only ever backfilled `people`
-- from `scout_parents` — never from `leaders`. An adult leader with no scout
-- in the troop (a committee member, an ASM with no kids on the roster) has
-- no `scout_parents` row at all, so their address had no path onto the
-- spine even though it was sitting right there on `leaders`, entered and
-- correct.
--
-- FILL ONLY, NEVER OVERWRITE. Several leaders already carry a DIFFERENT,
-- newer value on `people` than what's frozen on `leaders` (Patrick's own
-- address: `leaders` has a pre-move address, `people` the current one,
-- confirmed with Patrick 2026-08-17 — deliberately left alone by this
-- migration). Each column is its own UPDATE, guarded independently on that
-- column being blank on `people`, so a person with SOME fields already on
-- `people` and others missing gets exactly the missing ones filled, never
-- their existing data clobbered.
--
-- Verified against production before writing this: 3 adults recoverable
-- this way (Becky Vest, Jason Porter, Tyler Brauhn — full address, all
-- previously blank on `people`). Everyone else either already matches, has
-- a people-side value that's ahead of leaders, or has nothing on EITHER
-- table (genuinely missing — no migration can recover data that was never
-- entered anywhere).

update public.people p
set address_line1 = l.address_line1
from public.leaders l
where l.person_id = p.id
  and coalesce(nullif(trim(p.address_line1), ''), '') = ''
  and coalesce(nullif(trim(l.address_line1), ''), '') <> '';

update public.people p
set address_line2 = l.address_line2
from public.leaders l
where l.person_id = p.id
  and coalesce(nullif(trim(p.address_line2), ''), '') = ''
  and coalesce(nullif(trim(l.address_line2), ''), '') <> '';

update public.people p
set city = l.city
from public.leaders l
where l.person_id = p.id
  and coalesce(nullif(trim(p.city), ''), '') = ''
  and coalesce(nullif(trim(l.city), ''), '') <> '';

update public.people p
set state = l.state
from public.leaders l
where l.person_id = p.id
  and coalesce(nullif(trim(p.state), ''), '') = ''
  and coalesce(nullif(trim(l.state), ''), '') <> '';

update public.people p
set zip = l.zip
from public.leaders l
where l.person_id = p.id
  and coalesce(nullif(trim(p.zip), ''), '') = ''
  and coalesce(nullif(trim(l.zip), ''), '') <> '';

update public.people p
set primary_phone = l.phone
from public.leaders l
where l.person_id = p.id
  and coalesce(nullif(trim(p.primary_phone), ''), '') = ''
  and coalesce(nullif(trim(l.phone), ''), '') <> '';

update public.people p
set primary_email = l.email
from public.leaders l
where l.person_id = p.id
  and coalesce(nullif(trim(p.primary_email), ''), '') = ''
  and coalesce(nullif(trim(l.email), ''), '') <> '';
