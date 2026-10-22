-- Meeting teach guard: neutral "can't teach" wording (2026-10-22, "align the teach wording").
--
-- The app decides who may teach (loadTeacherPeople: an adult, or a scout canOfferToTeach admits — First Class+ or a
-- Junior Leader) and says so in one message (NOT_A_TEACHER, src/lib/can-offer-to-teach.ts). This guard is only the
-- backstop: _meeting_teacher_kind admits any adult in the picker and ANY active scout, with no rank or grade check,
-- so "Teaching is for adults and Junior Leaders." did not describe its own rule. It now says only what is true.
-- Rule unchanged. Re-created from the current definition (20261210100000) with ONLY the message changed;
-- CREATE OR REPLACE keeps the existing grants (service_role only).

CREATE OR REPLACE FUNCTION public._meeting_teach_guard(p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_op text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_kind text;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  if p_actor is null or not (coalesce(p_leader, false) or p_actor = p_person) then
    raise exception 'You can only sign up to teach for yourself.';
  end if;
  v_kind := public._meeting_teacher_kind(p_person);
  if v_kind is null and p_op = 'add' then
    raise exception 'That person can’t teach at troop meetings.';
  end if;
  if p_op = 'add' and public.meeting_board_mode(p_entry) <> 'rank' then
    raise exception 'There’s no teaching sign-up for this meeting.';
  end if;
  return v_kind;
end;
$function$;
