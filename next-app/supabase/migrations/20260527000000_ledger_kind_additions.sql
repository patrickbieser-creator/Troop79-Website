-- Adds two ledger_kind values needed for the spreadsheet import:
--   rank_award — completion of a rank (Scout → Eagle). The matching
--                rank_requirement rows record the individual req sign-offs;
--                this single row marks the BOR-approved rank itself.
--   award      — small recognitions (Firem'n Chit, Totin' Chip, Mile Swim
--                BSA, Stand Up Paddleboarding, etc.). Not merit badges.
--
-- alter type ... add value cannot run inside a transaction in pre-12 Postgres
-- but works in our Supabase 17. We split into two statements so partial
-- failure leaves the type in a known state.

alter type public.ledger_kind add value if not exists 'rank_award';
alter type public.ledger_kind add value if not exists 'award';
