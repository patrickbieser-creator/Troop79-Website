-- Sync photo_albums.category to the current calendar_entries taxonomy.
--
-- WHY (Operator, 2026-07-21)
-- photo_albums.category was designed to "reuse the calendar_entries
-- vocabulary verbatim" (20260712050000), but calendar_entries' taxonomy was
-- overhauled in 20260718100000 (13 types, several renamed — e.g. 'Outing'
-- became 'Day Activity / Outing', 'Campout' became 'Campout / Overnight').
-- That migration updated calendar_entries' own rows and CHECK constraint but
-- never touched photo_albums, which kept the OLD 11-value list. Adding a new
-- album under any of the renamed current categories (e.g. "Day Activity /
-- Outing") failed outright with photo_albums_category_check — reported
-- 2026-07-21 while adding "Klondike Derby - Oh-Da-Ko-Ta".
--
-- Remaps existing rows the same way calendar_entries' own rows were remapped
-- (Campout -> Campout / Overnight, Outing -> Day Activity / Outing,
-- Committee Meeting -> Leadership / Planning, Court of Honor / Ceremony ->
-- Ceremony / Recognition), then replaces the CHECK constraint with the exact
-- current calendar_entries_category_check list.

alter table public.photo_albums drop constraint photo_albums_category_check;

update public.photo_albums set category = 'Campout / Overnight'   where category = 'Campout';
update public.photo_albums set category = 'Day Activity / Outing' where category = 'Outing';
update public.photo_albums set category = 'Leadership / Planning' where category = 'Committee Meeting';
update public.photo_albums set category = 'Ceremony / Recognition' where category in ('Court of Honor', 'Ceremony');

alter table public.photo_albums add constraint photo_albums_category_check check (category in (
  'Troop Meeting',
  'Campout / Overnight',
  'Day Activity / Outing',
  'High Adventure',
  'Summer Camp',
  'Service Project',
  'Fundraiser',
  'Advancement Event',
  'Training',
  'Ceremony / Recognition',
  'Leadership / Planning',
  'Recruiting / Outreach',
  'Social Event',
  'No Meeting'
));
