-- Youth leaders: link sign-off initials to the scout they belong to.
--
-- The leaders table holds three populations: adults, youth leaders (older
-- scouts with their own sign-off initials), and non-person record sources
-- (is_person = false, added by the Roll Call migration). This adds the
-- missing distinction: a leader row with scout_id set belongs to a scout.
--
-- Definition used everywhere downstream (one source of truth, no age flag):
--   youth leader = scout_id IS NOT NULL AND that scout is ACTIVE
--   adult person = is_person AND NOT youth
-- So "promoting" a scout who turns 18 is just marking their scout row
-- inactive (reason 'aged_out') — their initials automatically start counting
-- as an adult in the Meeting Plan teacher pool, the Leader Skills picker,
-- and leader Roll Call, while the link preserves who they were as a scout.

alter table public.leaders
  add column scout_id text references public.scouts(id) on delete set null;

update public.leaders set scout_id = 'B12' where code = 'FP';   -- Finn Paltzer
update public.leaders set scout_id = 'A14' where code = 'HS';   -- Hazel Stollenwerk
update public.leaders set scout_id = 'A03' where code = 'JPII'; -- Jack Porter
update public.leaders set scout_id = 'C05' where code = 'KP';   -- Kevin Pieper
update public.leaders set scout_id = 'A01' where code = 'MST';  -- Maya Sankpal-Tatera
update public.leaders set scout_id = 'A05' where code = 'OV';   -- Oliver Vest
update public.leaders set scout_id = 'A12' where code = 'VK';   -- Veronica Kleinfeldt
