-- Scoutbook AdvancementID corrections (2026-07-18), from Patrick (SME),
-- fixing errors in the low-number block of scoutbook_merit_badge_reference
-- (which was built from a CSV with documented parsing errors).
--
--   * BSA renamed "Indian Lore" to "American Indian Culture"; the badge kept
--     its Scoutbook AdvancementID 65. The reference table wrongly had it at 7,
--     and wrongly had 65 assigned to American Heritage.
--   * American Heritage's correct ID is 3. Agribusiness (also 3 in the
--     reference) is removed entirely — it is no longer a merit badge.
--   * "Signs, Signals, and Codes" = 151 (already the value on the badge, now
--     confirmed). The reference table had a corrupt ('Signs','Signals')
--     CSV-comma-split row instead of a clean entry.
--
-- All statements are idempotent.

-- Live catalog ---------------------------------------------------------------
update public.merit_badges
  set name = 'American Indian Culture', scoutbook_id = '65'
  where id = 'indian-lore';

update public.merit_badges
  set name = 'Signs, Signals, and Codes'
  where id = 'signs-signals-codes';  -- scoutbook_id already 151

-- Reference table ------------------------------------------------------------
update public.scoutbook_merit_badge_reference set scoutbook_id = '65' where name = 'American Indian Culture';
update public.scoutbook_merit_badge_reference set scoutbook_id = '3'  where name = 'American Heritage';

delete from public.scoutbook_merit_badge_reference where name = 'Signs' and scoutbook_id = 'Signals';
delete from public.scoutbook_merit_badge_reference where name = 'Agribusiness';

insert into public.scoutbook_merit_badge_reference (name, scoutbook_id)
  values ('Signs, Signals, and Codes', '151')
  on conflict (name) do update set scoutbook_id = excluded.scoutbook_id;

-- ---------------------------------------------------------------------------
-- Second batch (2026-07-18), from Patrick (SME): AdvancementID corrections and
-- retirement of names that are no longer merit badges, working through the
-- reference table's remaining duplicate IDs.
-- ---------------------------------------------------------------------------

-- Live catalog: Canoeing was colliding with Citizenship in the Nation at 25.
-- Canoeing's correct ID is 21; Citizenship in the Nation keeps 25.
update public.merit_badges set scoutbook_id = '21' where id = 'canoeing';
-- Basketry is 17 (already the value in prod; pinned here to override the stale
-- `basketry = 18` line in migration 20260716 on a fresh deploy).
update public.merit_badges set scoutbook_id = '17' where id = 'basketry';
-- Climbing (17->27... i.e. 28->27) and Citizenship in Society (27->154) were
-- also hand-corrected in prod after 20260716; pinned so a fresh deploy matches.
update public.merit_badges set scoutbook_id = '27'  where id = 'climbing';
update public.merit_badges set scoutbook_id = '154' where id = 'citizenship-society';

-- The rest of the "+1-shift" cluster (migration 20260716 loaded CSV values that
-- were each one too high; prod was hand-corrected to the ledger-verified values
-- afterward). Pinned here so a fresh deploy matches prod.
update public.merit_badges set scoutbook_id = '9'  where id = 'archery';
update public.merit_badges set scoutbook_id = '12' where id = 'astronomy';
update public.merit_badges set scoutbook_id = '15' where id = 'aviation';
update public.merit_badges set scoutbook_id = '49' where id = 'fingerprinting';
update public.merit_badges set scoutbook_id = '50' where id = 'fire-safety';
update public.merit_badges set scoutbook_id = '51' where id = 'first-aid';
update public.merit_badges set scoutbook_id = '53' where id = 'fishing';

-- Reference value corrections
update public.scoutbook_merit_badge_reference set scoutbook_id = '21' where name = 'Canoeing';
update public.scoutbook_merit_badge_reference set scoutbook_id = '18' where name = 'Bird Study';
update public.scoutbook_merit_badge_reference set scoutbook_id = '19' where name = 'Bugling';
update public.scoutbook_merit_badge_reference set scoutbook_id = '29' where name = 'Collections';
update public.scoutbook_merit_badge_reference set scoutbook_id = '54' where name = 'Fly Fishing';
update public.scoutbook_merit_badge_reference set scoutbook_id = '57' where name = 'Genealogy';
-- Forestry(55), Geocaching(58), Geology(59), Mammal Study(73), Metalwork(75),
-- Rifle Shooting(99), Shotgun Shooting(107), Robotics(132), Programming(144),
-- Mining in Society(147) already held their correct IDs — no change.

-- Badge renamed by BSA: Reptile Study -> Reptile and Amphibian Study (keeps 98)
delete from public.scoutbook_merit_badge_reference where name = 'Reptile Study';
update public.scoutbook_merit_badge_reference set name = 'Reptile and Amphibian Study' where name = 'Reptile/Amphibian Study';

-- No longer offered under these names (dropped, or replaced by a name already
-- present in the table): Medicine->Health Care Professions(155),
-- Cinematography->Moviemaking(23), Skiing retired.
delete from public.scoutbook_merit_badge_reference
  where name in ('Consumer Buying','Metals Engineering','Pathfinding','Rabbit Raising',
                 'Signaling','Medicine','Cinematography','Skiing',
                 'Beekeeping','Bookbinding');

-- Snow Sports renamed to its current BSA name, Winter Sports (keeps ID 110).
update public.merit_badges set name = 'Winter Sports' where id = 'snow-sports';
update public.scoutbook_merit_badge_reference set name = 'Winter Sports' where name = 'Snow Sports';

-- ---------------------------------------------------------------------------
-- Third batch (2026-07-18), from Patrick (SME): finishing the reference dupes.
-- ---------------------------------------------------------------------------
update public.scoutbook_merit_badge_reference set scoutbook_id = '56' where name = 'Gardening';
-- Genealogy already 57.

-- Game Design's correct ID is 140 (was colliding with Gardening at 56); live
-- catalog badge, so corrected in both tables.
update public.merit_badges set scoutbook_id = '140' where id = 'game-design';
update public.scoutbook_merit_badge_reference set scoutbook_id = '140' where name = 'Game Design';

-- No longer merit badges.
delete from public.scoutbook_merit_badge_reference
  where name in ('Carpentry','Coin Collecting','Rifle/Shotgun','Print/Communications','Machinery','General Science','Food Systems');
