-- Meeting invites, P2: scouts and parents (2026-10-20, Plans/Matcher-Tune-Up.md T-5; qa-lead design review).
--
-- A leader offers a requirement to scouts; the Troop 79 Bugler emails each scout's parents (always) and the scout
-- (13 or older, verified own address). Each recipient gets their own link for each scout: one row per (scout,
-- recipient). The link stays a SCOPED capability: it answers that one invite for that one scout and topic, nothing else.
--
-- 1. recipient_epoch: the epoch of the person whose inbox the link went to (P1 rows: invitee = recipient, backfilled).
--    Added rather than renaming invitee_epoch so the live P1 code keeps working through the deploy.
-- 2. response 'superseded': a sibling link (the other parent, the scout) closed because someone already said yes.
-- 3. meeting_answer_pick_invite(): the whole answer in ONE transaction (qa-lead MUST 2 and 4): claim the row
--    (FOR UPDATE; a second concurrent answer waits, then sees it spent), re-check the recipient by kind (the scout
--    themself, or still a parent of the scout AND an adult in their household per _meeting_may_act_for), then for
--    'accept': meeting_add_pick (mark coming) + meeting_set_pick_order with this key first, and close the siblings.
--    Any exception (5 picks already, the meeting passed) rolls the whole thing back, so the invite stays open and
--    the scout's list is untouched. 'decline' closes only the decliner's own row. The add/order RPCs re-check who may
--    act themselves.
--
-- DEPLOY ORDER: DB-first, then the code. Posture: invoker, search_path pinned, EXECUTE for service_role only.

alter table public.meeting_invites add column if not exists recipient_epoch integer;
update public.meeting_invites set recipient_epoch = invitee_epoch where recipient_epoch is null;

alter table public.meeting_invites drop constraint if exists meeting_invites_response_check;
alter table public.meeting_invites
  add constraint meeting_invites_response_check check (response in ('accepted', 'declined', 'changed', 'superseded'));

create or replace function public.meeting_answer_pick_invite(p_token_hash text, p_answer text, p_carry jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r meeting_invites%rowtype;
  v_ok boolean;
  v_keys text[];
begin
  if p_answer not in ('accept', 'decline') then
    raise exception 'Malformed answer.';
  end if;
  select * into r from meeting_invites where token_hash = p_token_hash and kind = 'pick' for update;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  if r.consumed_at is not null then
    return jsonb_build_object('state', case when r.response is null then 'void' else 'answered' end);
  end if;
  if r.expires_at <= now() then
    return jsonb_build_object('state', 'expired');
  end if;

  -- The recipient, re-checked now (qa-lead MUST 3): still active, the same session epoch, and either the scout
  -- themself or still their parent and an adult in their household.
  select exists (
    select 1 from people p
     where p.id = r.recipient_person_id and p.active
       and p.session_epoch = coalesce(r.recipient_epoch, r.invitee_epoch)
  ) and (
    r.recipient_person_id = r.invitee_person_id
    or (
      exists (select 1 from relationships x where x.type = 'parent_of' and x.person_id = r.recipient_person_id and x.related_person_id = r.invitee_person_id)
      and public._meeting_may_act_for(r.recipient_person_id, r.invitee_person_id, false)
    )
  ) into v_ok;
  if not v_ok then
    update meeting_invites set consumed_at = now() where id = r.id;
    return jsonb_build_object('state', 'void');
  end if;

  if p_answer = 'decline' then
    update meeting_invites set consumed_at = now(), response = 'declined', responded_at = now() where id = r.id;
    return jsonb_build_object('state', 'answered', 'response', 'declined', 'invite_id', r.id, 'invitee', r.invitee_person_id, 'recipient', r.recipient_person_id);
  end if;

  perform public.meeting_add_pick(r.calendar_entry_id, r.invitee_person_id, r.recipient_person_id, false, r.topic_key, false, true, p_carry);
  -- meeting_add_pick returns early when the topic is already picked, skipping its mark-coming; a yes still means coming.
  insert into meeting_intents (calendar_entry_id, person_id, intent, entered_by_person_id)
  values (r.calendar_entry_id, r.invitee_person_id, 'coming', r.recipient_person_id)
  on conflict (calendar_entry_id, person_id)
  do update set intent = 'coming', entered_by_person_id = excluded.entered_by_person_id, updated_at = now();
  -- This topic first, then their other picks in the order they had them (unranked ones after, by topic).
  v_keys := array(
    select t.topic_key
      from meeting_topic_picks p join meeting_topics t on t.id = p.topic_id
     where p.calendar_entry_id = r.calendar_entry_id and p.person_id = r.invitee_person_id
     order by (t.topic_key = r.topic_key) desc, p.priority nulls last, t.topic_key
  );
  perform public.meeting_set_pick_order(r.calendar_entry_id, r.invitee_person_id, r.recipient_person_id, false, v_keys, '[]'::jsonb);

  update meeting_invites set consumed_at = now(), response = 'accepted', responded_at = now() where id = r.id;
  update meeting_invites set consumed_at = now(), response = 'superseded', responded_at = now()
   where calendar_entry_id = r.calendar_entry_id and topic_key = r.topic_key and invitee_person_id = r.invitee_person_id
     and kind = 'pick' and consumed_at is null and id <> r.id;
  return jsonb_build_object('state', 'answered', 'response', 'accepted', 'invite_id', r.id, 'invitee', r.invitee_person_id, 'recipient', r.recipient_person_id);
end;
$$;

revoke all on function public.meeting_answer_pick_invite(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.meeting_answer_pick_invite(text, text, jsonb) to service_role;
