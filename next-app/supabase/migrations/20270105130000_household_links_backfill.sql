-- One-off backfill for the family-link rule (20270105110000_household_links.sql): add the
-- parent/guardian and sibling links current households are missing. The dry run on production
-- (2026-11-15) found 12 rows. Patrick approved them EXCEPT the parent links in the
-- "Stollenwerk (Hazel)" household (Joe and Mindy Stollenwerk -> Jasper), which wait until he has
-- checked that household (it is split in two, and Mindy has a duplicate record). Its sibling link
-- (Hazel <-> Jasper) is added. Note the rule itself still applies there: the next insert into that
-- household links the parents too.
-- Each added link writes a 'system' History row (audit_household_link).
do $$
declare
  h record;
  g record;
begin
  for h in select id, label from public.households where system_key is null order by id loop
    for g in select * from public.household_link_gaps(h.id) loop
      continue when h.label = 'Stollenwerk (Hazel)' and g.type in ('parent_of', 'guardian_of');
      insert into public.relationships (person_id, related_person_id, type, is_guardian)
      values (g.person_id, g.related_person_id, g.type, false)
      on conflict (person_id, related_person_id, type) do nothing;
      if found then
        perform public.audit_household_link(g.person_id, g.related_person_id, g.type);
      end if;
    end loop;
  end loop;
end;
$$;
