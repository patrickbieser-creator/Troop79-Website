-- The leaders table has always done double duty: real adults AND sign-off
-- *sources* imported from the spreadsheet ("Turner Hall", "Council Clinic",
-- "Event", "Prior Troop", ...). That was harmless while leaders only fed
-- sign-off dropdowns, but Roll Call needs actual people. An explicit flag
-- beats inferring from `role` (most real people have role = null).

alter table public.leaders
  add column is_person boolean not null default true;

update public.leaders
set is_person = false
where role in (
    'External counselor',
    'Merit badge clinic',
    'Outside provider',
    'Prior council records',
    'Leadership position',
    'Service project record',
    'Summer camp staff',
    'Troop event',
    'Troop outing'
  )
   or name in ('Troop 105 St Vincent');
