-- The admin calendar list's per-entry counts in ONE aggregate (2026-08-25,
-- Patrick: "the calendar page seems to be overloaded and is getting much
-- slower on prod"). The list used to pull every event_attendance row and every
-- "yes" signup_entries row across the wire (paginated, 1,000 at a time) plus
-- the scouts table, and reduce them in Node. This returns what it actually
-- needs: attendance split scouts/adults (the R pill) and the signup headcount
-- (the Going column — same definition as event_signup_headcount: yes + full,
-- guests included), one row per entry that has any of them.
create or replace function public.calendar_list_counts()
returns table (calendar_entry_id bigint, scouts int, adults int, going int)
language sql
stable
as $$
  with att as (
    select a.calendar_entry_id,
           count(*) filter (where s.person_id is not null)::int as scouts,
           count(*) filter (where s.person_id is null)::int as adults
    from public.event_attendance a
    left join public.scouts s on s.person_id = a.person_id
    group by a.calendar_entry_id
  ),
  sg as (
    select es.calendar_entry_id,
           coalesce(sum(1 + coalesce(se.guest_count, 0)), 0)::int as going
    from public.event_signups es
    join public.signup_entries se on se.event_signup_id = es.id
    where se.status = 'yes' and se.participation = 'full'
    group by es.calendar_entry_id
  )
  select coalesce(att.calendar_entry_id, sg.calendar_entry_id) as calendar_entry_id,
         coalesce(att.scouts, 0) as scouts,
         coalesce(att.adults, 0) as adults,
         coalesce(sg.going, 0) as going
  from att full outer join sg on sg.calendar_entry_id = att.calendar_entry_id;
$$;

revoke all on function public.calendar_list_counts() from public;
grant execute on function public.calendar_list_counts() to service_role;
