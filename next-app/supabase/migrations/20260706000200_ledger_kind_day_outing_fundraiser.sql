-- Day Outing and Fundraiser become real ledger_kind values, same footing as
-- camping_nights/hiking_miles. There is no evidence this ledger ever tracks
-- generic meeting attendance — every historical `attendance` row is a
-- fundraiser (checked live) — so `attendance` was only ever standing in for
-- "no quantity to tally," the same redundancy camping_nights/hiking_miles
-- already resolved for Camping/Hike. `attendance` stays in the enum as the
-- fallback for a check-in with no specific type picked, but it should now be
-- rare rather than the default bucket for two whole categories.
--
-- Split into its own migration/transaction from the follow-up data migration
-- + table drop (20260706000300) since ADD VALUE and using the new value are
-- safest kept apart across a commit boundary.
alter type public.ledger_kind add value if not exists 'day_outing';
alter type public.ledger_kind add value if not exists 'fundraiser';
