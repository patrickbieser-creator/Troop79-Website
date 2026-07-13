-- Reintroduce meeting attendance as a first-class ledger kind.
--
-- History: an 'attendance' kind existed in early drafts and was removed in
-- 20260706000400 when event categories folded into `kind`. This is NOT that
-- kind coming back — 'meeting_attendance' is specifically "scout was present
-- at a troop meeting" (admin-only display; the public site ignores it).
-- Convention: code = 'MTG:<meeting_date>' (date-based, no FK — ledger house
-- rule), qty 1, unit 'meeting', present-only (absence = no row).
--
-- Kept in its own migration: a new enum value cannot be used inside the
-- transaction that adds it (house precedent: 20260706000200).

alter type public.ledger_kind add value if not exists 'meeting_attendance';
