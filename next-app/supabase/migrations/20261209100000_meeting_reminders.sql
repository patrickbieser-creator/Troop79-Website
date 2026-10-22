-- Meeting Planner II, P5b: reminders (2026-10-21, Plans/Meeting-Planner-II.md Decision 11).
--
-- An adult editor reminds the people who haven't answered "Coming Sunday?". The Troop 79 Bugler emails each one
-- (a scout's parents always, and the scout too from 13 with a verified address), one email per recipient naming
-- everyone it covers. A reminder rides the meeting_invites pipeline so the 24-hour dedupe and the "who did we email"
-- log stay in one table, but it carries NO token: its link is the plain /member/meeting page. So:
--
-- 1. kind gains 'remind'. Reminder rows use topic_key 'reminder' (they are about the meeting, not one topic).
-- 2. token_hash is nullable, and null exactly for a reminder: check ((kind = 'remind') = (token_hash is null)).
--    The unique constraint still holds for teach/pick links (nulls never collide). Every redeem path looks a row up
--    by token_hash = <hash> (never matches null) and the code also filters kind in ('teach', 'pick'), so a reminder
--    can never be answered by any link.
--
-- Additive only: no existing row changes (every current row is teach/pick with a token). DEPLOY ORDER: DB-first, then
-- the code. Posture unchanged (D-051 / D-239): RLS on, no policies, service role only.

alter table public.meeting_invites drop constraint if exists meeting_invites_kind_check;
alter table public.meeting_invites
  add constraint meeting_invites_kind_check check (kind in ('teach', 'pick', 'remind'));

alter table public.meeting_invites alter column token_hash drop not null;

alter table public.meeting_invites drop constraint if exists meeting_invites_remind_has_no_token;
alter table public.meeting_invites
  add constraint meeting_invites_remind_has_no_token check ((kind = 'remind') = (token_hash is null));

-- The reminder dedupe reads (entry, kind, invitee, sent_at).
create index if not exists meeting_invites_entry_kind_invitee_idx on public.meeting_invites (calendar_entry_id, kind, invitee_person_id, sent_at);
