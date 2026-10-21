-- Meeting Planner: an Assign is made for the scouts waiting on a topic (Patrick, 2026-10-21). Mark it, so that when
-- the last of those picks is removed the assignment goes too. A teacher who signed up on their own, or was added
-- through "Add an offer", is never marked and stays.
alter table public.meeting_topic_teachers
  add column for_picks boolean not null default false;

comment on column public.meeting_topic_teachers.for_picks is
  'Set by the planner''s Assign: this teacher was put on the topic for the scouts who picked it, and comes off when no scout picks it any more.';
