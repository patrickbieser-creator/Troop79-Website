-- Correction to 20260716000000: the user confirmed the CSV
-- (MeritBadgeName-ID.csv) has a shifted-by-one block of IDs for this
-- specific cluster — the ledger cross-reference and the earlier pasted
-- table are correct instead. Climbing=27 (ledger-confirmed) also forces
-- Citizenship in Society away from the CSV's colliding 27 — the pasted
-- table's 154 is used instead.
--
-- The CSV rows below are removed from the reference table, not just left
-- wrong, because they now provably collide with a confirmed-correct ID
-- (e.g. "Backpacking" claimed 17, but 17 is confirmed to be Basketry) —
-- keeping a known-wrong row in an "authoritative" table is worse than a gap.
-- If the troop ever offers Archaeology/Artificial Intelligence/Automotive
-- Maintenance/Backpacking/Chemistry/Farm-Ranch Management/Fish and Wildlife,
-- its real Scoutbook ID needs independent verification first.

update public.merit_badges set scoutbook_id = '9'   where id = 'archery';
update public.merit_badges set scoutbook_id = '12'  where id = 'astronomy';
update public.merit_badges set scoutbook_id = '15'  where id = 'aviation';
update public.merit_badges set scoutbook_id = '17'  where id = 'basketry';
update public.merit_badges set scoutbook_id = '49'  where id = 'fingerprinting';
update public.merit_badges set scoutbook_id = '50'  where id = 'fire-safety';
update public.merit_badges set scoutbook_id = '51'  where id = 'first-aid';
update public.merit_badges set scoutbook_id = '53'  where id = 'fishing';
update public.merit_badges set scoutbook_id = '27'  where id = 'climbing';
update public.merit_badges set scoutbook_id = '154' where id = 'citizenship-society';

update public.scoutbook_merit_badge_reference set scoutbook_id = '9'   where name = 'Archery';
update public.scoutbook_merit_badge_reference set scoutbook_id = '12'  where name = 'Astronomy';
update public.scoutbook_merit_badge_reference set scoutbook_id = '15'  where name = 'Aviation';
update public.scoutbook_merit_badge_reference set scoutbook_id = '17'  where name = 'Basketry';
update public.scoutbook_merit_badge_reference set scoutbook_id = '49'  where name = 'Fingerprinting';
update public.scoutbook_merit_badge_reference set scoutbook_id = '50'  where name = 'Fire Safety';
update public.scoutbook_merit_badge_reference set scoutbook_id = '51'  where name = 'First Aid';
update public.scoutbook_merit_badge_reference set scoutbook_id = '53'  where name = 'Fishing';
update public.scoutbook_merit_badge_reference set scoutbook_id = '27'  where name = 'Climbing';
update public.scoutbook_merit_badge_reference set scoutbook_id = '154' where name = 'Citizenship in Society';

delete from public.scoutbook_merit_badge_reference
where name in (
  'Archaeology', 'Artificial Intelligence', 'Automotive Maintenance',
  'Backpacking', 'Chemistry', 'Farm/Ranch Management', 'Fish and Wildlife'
);
