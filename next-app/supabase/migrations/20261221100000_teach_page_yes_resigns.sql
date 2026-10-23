-- B10b follow-up (Plans/Build-A-Plan.md "B10 spec"): a Yes on a teach-page line already marked 'accepted' still calls
-- meeting_teach_topic, so a teacher released elsewhere since (the planner's unteach, the board's "I can't teach this")
-- is signed back up when they say Yes again. The call is idempotent (meeting_teach_topic inserts on conflict do
-- nothing): a teacher still on the topic keeps one row and the line reads 'unchanged'; a re-sign-up reads 'yes'.
-- Only that one branch of meeting_answer_teach_page changes; everything else is as 20261220100000_teach_invite_pages.
--
-- DEPLOY ORDER: DB-first. Same signature and result shape; the code in production (main f61c7b6b) reads 'yes' and
-- 'unchanged' already. Posture (D-051 / D-239): security invoker, search_path pinned, EXECUTE for service_role only.

create or replace function public.meeting_answer_teach_page(p_token_hash text, p_answers jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  p meeting_invite_pages%rowtype;
  r meeting_invites%rowtype;
  a record;
  v_ok boolean;
  v_out jsonb := '[]'::jsonb;
  v_result text;
  v_err text;
  v_found boolean;
  v_had boolean;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) > 50 then
    raise exception 'Malformed answer.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_answers) e
              where jsonb_typeof(e->'invite_id') <> 'number' or coalesce(e->>'answer', '') not in ('yes', 'no')) then
    raise exception 'Malformed answer.';
  end if;
  select * into p from meeting_invite_pages where token_hash = p_token_hash for update;
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  if p.superseded_at is not null then return jsonb_build_object('state', 'superseded'); end if;
  if p.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  if p.submit_count >= 10 then return jsonb_build_object('state', 'busy'); end if;
  update meeting_invite_pages set submit_count = submit_count + 1 where id = p.id;

  -- The recipient, re-checked now: still active, the same session epoch. A "sign out everywhere" (or a merge) voids
  -- every line still open; answered lines keep their answer (the teaching sign-up stands until changed elsewhere).
  select exists (select 1 from people x where x.id = p.recipient_person_id and x.active and x.session_epoch = p.recipient_epoch) into v_ok;
  if not v_ok then
    update meeting_invites set consumed_at = now() where page_id = p.id and consumed_at is null;
    return jsonb_build_object('state', 'void');
  end if;

  for a in
    select distinct on ((e->>'invite_id')::bigint) (e->>'invite_id')::bigint as invite_id, e->>'answer' as answer
      from jsonb_array_elements(p_answers) e
  loop
    v_err := null;
    select * into r from meeting_invites
     where id = a.invite_id and page_id = p.id and kind = 'teach' and invitee_person_id = p.recipient_person_id
     for update;
    v_found := found;
    if not v_found then
      r := null;
      v_result := 'gone';
    elsif r.consumed_at is not null and r.response is null then
      v_result := 'void';
    elsif r.response is not null and r.response not in ('accepted', 'declined') then
      v_result := 'gone';
    elsif a.answer = 'yes' and r.response = 'accepted' then
      -- B10b follow-up: a Yes on a line already accepted still signs the teacher up. meeting_teach_topic is idempotent
      -- (on conflict do nothing), so a teacher still on the topic keeps their one row ('unchanged'); one released
      -- elsewhere since (the planner's unteach, the board's "I can't teach this") is back ('yes').
      select exists (
        select 1 from meeting_topic_teachers t join meeting_topics mt on mt.id = t.topic_id
         where mt.calendar_entry_id = r.calendar_entry_id and mt.topic_key = r.topic_key and t.person_id = r.invitee_person_id
      ) into v_had;
      begin
        perform public.meeting_teach_topic(array[r.calendar_entry_id], r.invitee_person_id, r.invitee_person_id, false, r.topic_key, null, null);
        v_result := case when v_had then 'unchanged' else 'yes' end;
        if not v_had then
          update meeting_invites set responded_at = now() where id = r.id;
        end if;
      exception when others then
        -- Still on the topic: nothing changed, whatever the teach rules say now.
        v_result := case when v_had then 'unchanged' else 'error' end;
        v_err := case when v_had then null else sqlerrm end;
      end;
    elsif a.answer = 'no' and r.response = 'declined' then
      v_result := 'unchanged';
    else
      begin
        if a.answer = 'yes' then
          perform public.meeting_teach_topic(array[r.calendar_entry_id], r.invitee_person_id, r.invitee_person_id, false, r.topic_key, null, null);
        elsif r.response = 'accepted' then
          perform public.meeting_unteach_topic(r.calendar_entry_id, r.invitee_person_id, r.invitee_person_id, false, r.topic_key);
        end if;
        update meeting_invites
           set consumed_at = coalesce(consumed_at, now()),
               response = case when a.answer = 'yes' then 'accepted' else 'declined' end,
               responded_at = now()
         where id = r.id;
        v_result := a.answer;
      exception when others then
        v_result := 'error';
        v_err := sqlerrm;
      end;
    end if;
    v_out := v_out || jsonb_build_object('invite_id', a.invite_id, 'topic_key', r.topic_key, 'result', v_result, 'error', v_err,
                                         'was', r.response);
  end loop;
  return jsonb_build_object('state', 'answered', 'page_id', p.id, 'entry', p.calendar_entry_id, 'recipient', p.recipient_person_id, 'lines', v_out);
end;
$$;
revoke all on function public.meeting_answer_teach_page(text, jsonb) from public, anon, authenticated;
grant execute on function public.meeting_answer_teach_page(text, jsonb) to service_role;
