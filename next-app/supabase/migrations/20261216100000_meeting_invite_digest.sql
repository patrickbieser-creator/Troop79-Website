-- Build a Plan B3 (Plans/Build-A-Plan.md Decision 2): invites go out as ONE digest email per recipient.
--
-- An adult editor ticks teachers and scouts across the meeting's offerings and sends; each recipient (an adult teacher
-- themself; a scout's parents always, and the scout from 13 with a verified address) gets one email listing every
-- invite for them, each with its own /i/<token> link. Rows stay one per invite (teach / pick, per recipient), exactly
-- as P1/P2 mint them, so the board's "who did we ask" counts and the link rules don't change.
--
-- 1. meeting_mint_invites: the 24-hour dedupe's database backstop, like meeting_mint_reminders. Under a per-meeting
--    transaction advisory lock it inserts the rows it was given except where the same (meeting, kind, topic, invitee,
--    RECIPIENT) was invited since p_since, in one statement, so a double-click or a second editor can't email twice.
--    Per recipient (qa-lead B3 #3): when one parent's email went out and the other's failed (its rows deleted), a send
--    again inside 24 hours reaches the parent who missed it. Rows for one invitee in the same call all go in (the NOT
--    EXISTS sees the statement's snapshot). Returns what it made.
-- 2. meeting_may_act_for_many: _meeting_may_act_for over many (actor, target) pairs in one round trip, so the sheet and
--    the send decide a scout's recipients with one call however many families there are. Same rule, same answers.
--
-- Additive only (new functions). DEPLOY ORDER: DB-first, then the code.
-- Posture (D-051 / D-239): security invoker, search_path pinned, EXECUTE for service_role only.

create or replace function public.meeting_mint_invites(p_entry bigint, p_since timestamptz, p_rows jsonb)
returns table (invite_id bigint, kind text, topic_key text, invitee bigint, recipient bigint)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Malformed invites.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e where e->>'kind' not in ('teach', 'pick') or coalesce(e->>'token_hash', '') = '') then
    raise exception 'Malformed invites.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_invites:%s', p_entry), 0));
  return query
  with wanted as (
    select * from jsonb_to_recordset(p_rows) as w(
      kind text, topic_key text, invitee_person_id bigint, recipient_person_id bigint, sent_to text,
      invitee_epoch integer, recipient_epoch integer, token_hash text, expires_at timestamptz, sent_by bigint)
  ), made as (
    insert into meeting_invites (calendar_entry_id, topic_key, kind, invitee_person_id, recipient_person_id, sent_to,
                                 invitee_epoch, recipient_epoch, token_hash, expires_at, sent_by)
    select p_entry, w.topic_key, w.kind, w.invitee_person_id, w.recipient_person_id, w.sent_to,
           w.invitee_epoch, w.recipient_epoch, w.token_hash, w.expires_at, w.sent_by
      from wanted w
     where not exists (
       select 1 from meeting_invites m
        where m.calendar_entry_id = p_entry and m.kind = w.kind and m.topic_key = w.topic_key
          and m.invitee_person_id = w.invitee_person_id and m.recipient_person_id = w.recipient_person_id
          and m.sent_at > p_since)
    returning meeting_invites.id, meeting_invites.kind, meeting_invites.topic_key, meeting_invites.invitee_person_id,
              meeting_invites.recipient_person_id
  )
  select made.id, made.kind, made.topic_key, made.invitee_person_id, made.recipient_person_id from made;
end;
$$;
revoke all on function public.meeting_mint_invites(bigint, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.meeting_mint_invites(bigint, timestamptz, jsonb) to service_role;

create or replace function public.meeting_may_act_for_many(p_pairs jsonb)
returns table (actor bigint, target bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.actor, p.target
    from jsonb_to_recordset(coalesce(p_pairs, '[]'::jsonb)) as p(actor bigint, target bigint)
   where public._meeting_may_act_for(p.actor, p.target, false);
$$;
revoke all on function public.meeting_may_act_for_many(jsonb) from public, anon, authenticated;
grant execute on function public.meeting_may_act_for_many(jsonb) to service_role;
