-- Meeting Planner III: "Unassigned" in a scout's Tonight (Patrick, 2026-10-30). A planner's hand choice that the scout
-- sits in no group tonight, and stays there: placement no longer puts them back. Stored as role 'none', no ref_key.
--
-- DEPLOY ORDER: DB-first. Additive only (a check widened); production's code never writes 'none'.

alter table public.meeting_scout_roles drop constraint if exists meeting_scout_roles_role_check;
alter table public.meeting_scout_roles add constraint meeting_scout_roles_role_check check (role in ('teach', 'group', 'request', 'none'));

alter table public.meeting_scout_roles drop constraint if exists meeting_scout_roles_ref;
alter table public.meeting_scout_roles add constraint meeting_scout_roles_ref check (
  case role
    when 'teach' then ref_key is null
    when 'none' then ref_key is null
    when 'group' then ref_key like 'fr:%'
    when 'request' then ref_key is not null and ref_key not like 'fr:%'
    else null
  end
);
