-- Family page F3b (Plans/Meeting-Planner-III-Family.md): a teacher's optional note with "Can't make it this week" on
-- the family page, the same limits as the email's decline note (meeting_invites_decline_note_check): 240 characters,
-- 3 lines. Planners read it under the teacher's group slot. Additive: deploy DB-first.

alter table public.meeting_intents add column if not exists note text;

alter table public.meeting_intents drop constraint if exists meeting_intents_note_check;
alter table public.meeting_intents add constraint meeting_intents_note_check check (
  note is null or (char_length(note) <= 240 and array_length(string_to_array(note, E'\n'), 1) <= 3)
);

-- A note belongs to "Can't make it": any other answer drops it, whichever path writes the answer.
create or replace function public._meeting_intents_note_follows_answer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.intent <> 'not_coming' then
    new.note := null;
  end if;
  return new;
end;
$$;
revoke all on function public._meeting_intents_note_follows_answer() from public, anon, authenticated;

drop trigger if exists meeting_intents_note_follows_answer on public.meeting_intents;
create trigger meeting_intents_note_follows_answer
  before insert or update on public.meeting_intents
  for each row execute function public._meeting_intents_note_follows_answer();
