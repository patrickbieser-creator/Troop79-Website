-- One-off backfill for the family-link rule (20270105110000_household_links.sql): add the
-- parent/guardian and sibling links every current household is missing. Dry run on production
-- 2026-11-15 found 12 rows (8 one-way or missing sibling links, plus Joe and Mindy
-- Stollenwerk -> Jasper Stollenwerk); Patrick reviews that list before this ships.
-- Each added link writes a 'system' History row (audit_household_link).
do $$
declare
  h bigint;
begin
  for h in select id from public.households where system_key is null order by id loop
    perform public.link_household_relationships(h);
  end loop;
end;
$$;
