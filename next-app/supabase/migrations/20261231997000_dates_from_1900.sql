-- No date before 1900, anywhere (Patrick, 2026-11-01).
--
-- Eight ledger entries went in as year 0025 and a birthdate as 0991 (both fixed in production by hand the same
-- day). The date fields now refuse such a year and say so on the field (lib/date-entry EARLIEST_YEAR); this is the
-- backstop for every path no field sees: CSV imports, scripts, Fast Entry, server actions.
--
-- One CHECK per date / timestamp column in public, named <column>_from_1900, so the error names the column.
-- tests/date-floor-db.test.ts fails on any later column that lacks it. Production had no violating row when this
-- was written (surveyed 2026-11-01), so each constraint validates.

do $$
declare r record; cname text;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.data_type in ('date', 'timestamp with time zone', 'timestamp without time zone')
    order by 1, 2
  loop
    cname := left(r.column_name || '_from_1900', 63);
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', r.table_name)::regclass and conname = cname
    ) then
      execute format('alter table public.%I add constraint %I check (%I >= date ''1900-01-01'')',
                     r.table_name, cname, r.column_name);
    end if;
  end loop;
end $$;
