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

-- 3. meeting_mint_reminders (qa-lead, 2026-10-22): the 24-hour dedupe's database backstop. The app checks first (for the
--    plain "reminded in the last 24 hours" reasons), but a double-click or two editors could both pass that check and
--    email twice. This takes a per-meeting transaction advisory lock, then re-checks and inserts in one statement, so
--    a second send waits for the first to commit and then finds its rows. Returns the rows it made; a person reminded
--    since p_since gets none (the caller reports them). Posture: invoker, search_path pinned, service role only.
create or replace function public.meeting_mint_reminders(p_entry bigint, p_since timestamptz, p_rows jsonb)
returns table (invite_id bigint, invitee bigint, recipient bigint)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Malformed reminders.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_reminders:%s', p_entry), 0));
  return query
  with wanted as (
    select * from jsonb_to_recordset(p_rows) as w(
      invitee_person_id bigint, recipient_person_id bigint, sent_to text, invitee_epoch integer, recipient_epoch integer,
      expires_at timestamptz, sent_by bigint)
  ), made as (
    insert into meeting_invites (calendar_entry_id, topic_key, kind, invitee_person_id, recipient_person_id, sent_to,
                                 invitee_epoch, recipient_epoch, token_hash, expires_at, sent_by)
    select p_entry, 'reminder', 'remind', w.invitee_person_id, w.recipient_person_id, w.sent_to,
           w.invitee_epoch, w.recipient_epoch, null, w.expires_at, w.sent_by
      from wanted w
     where not exists (
       select 1 from meeting_invites m
        where m.calendar_entry_id = p_entry and m.kind = 'remind'
          and m.invitee_person_id = w.invitee_person_id and m.sent_at > p_since)
    returning meeting_invites.id, meeting_invites.invitee_person_id, meeting_invites.recipient_person_id
  )
  select made.id, made.invitee_person_id, made.recipient_person_id from made;
end;
$$;
revoke all on function public.meeting_mint_reminders(bigint, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.meeting_mint_reminders(bigint, timestamptz, jsonb) to service_role;
