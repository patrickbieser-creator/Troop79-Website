-- Sign-off initials on the person record (Plans/Sign-Off-Initials.md): add, rename and retire a person's
-- leaders.code without a database edit.
--
-- 1. leaders.retired_at: a retired code drops out of the Signed-Off By pickers but keeps naming its old entries.
-- 2. One code per spelling ignoring case (KP and Kp can't both exist), and one code per person.
-- 3. The three foreign keys into leaders.code follow a rename (ON UPDATE CASCADE).
-- 4. ledger_rank_award_refresh fires only on the columns that change a scout's rank, so rewriting `by` on
--    thousands of entries doesn't recompute ranks thousands of times. recompute_scout_current_rank reads
--    scout_id, kind, code, archived_at and deleted_at — exactly the list below.
-- 5. add_leader_initials / rename_leader_initials / set_leader_initials_retired: one lock, checks and writes in one
--    transaction (the set_teaching_skills shape). A refusal the screen may show raises SQLSTATE T7901 with the
--    sentence in the message; anything else is a bug and the screen shows a generic error.
--
-- Reuse (Patrick, 2026-10-26): a retired code may go to a new person once its newest ledger entry is 5 years old.
-- The old row is archived as {code}~{year} with its counselor links. It stops being a person's row (person_id moves
-- to archived_person_id, is_person and can_login go false), so every reader that looks a person up by person_id, or
-- builds the adult and login pools, never sees it — a person has at most one non-archived row. archived_person_id
-- still says who held it. Old entries keep the text, which now names the new holder — the accepted cost.
--
-- Posture (D-051 / D-239): functions are invoker and not executable by anon/authenticated (service role only).

alter table public.leaders add column if not exists retired_at timestamptz;
alter table public.leaders add column if not exists archived_person_id bigint references public.people(id) on delete set null;
alter table public.leaders drop constraint if exists retired_at_from_1900;
alter table public.leaders add constraint retired_at_from_1900 check (retired_at >= '1900-01-01');

create unique index if not exists leaders_code_lower_key on public.leaders (lower(code));
-- One row per person, active or retired: Add refuses while a retired one exists (Restore instead), and an archived
-- reuse row gives up its person_id. So every person_id lookup gets at most one row.
create unique index if not exists leaders_one_per_person on public.leaders (person_id) where person_id is not null;

alter table public.merit_badge_counselors drop constraint merit_badge_counselors_leader_code_fkey,
  add constraint merit_badge_counselors_leader_code_fkey foreign key (leader_code)
    references public.leaders(code) on update cascade on delete cascade;
alter table public.leader_skills drop constraint leader_skills_leader_code_fkey,
  add constraint leader_skills_leader_code_fkey foreign key (leader_code)
    references public.leaders(code) on update cascade on delete cascade;
alter table public.library_superusers drop constraint library_superusers_leader_code_fkey,
  add constraint library_superusers_leader_code_fkey foreign key (leader_code)
    references public.leaders(code) on update cascade on delete cascade;

drop trigger if exists ledger_rank_award_refresh on public.ledger_entries;
create trigger ledger_rank_award_refresh
  after insert or delete or update of scout_id, kind, code, archived_at, deleted_at on public.ledger_entries
  for each row execute function public.trg_refresh_scout_rank();

-- ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

-- The shape a code may take: 2–5 letters, optionally one digit 2–9 (the suggestion's "KP2" when KP is taken).
create or replace function public._initials_check_shape(p_code text)
returns void
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_code is null or p_code !~ '^[A-Za-z]{2,5}[2-9]?$' then
    raise exception using errcode = 'T7901', message = 'Initials are 2–5 letters, like PB or KrP.';
  end if;
end;
$$;

-- Frees p_code for p_person_id or refuses with the reason. p_own is the caller's own row (a rename may change only
-- the case of its own code). A retired person's code unused for 5 years is archived as {code}~{year}.
create or replace function public._initials_claim(p_code text, p_own text)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row leaders%rowtype;
  v_holder text;
  v_newest date;
  v_reuse date;
  v_archive text;
  v_n int := 1;
begin
  select * into v_row from leaders where lower(code) = lower(p_code) and code is distinct from p_own;
  if not found then return; end if;

  if not v_row.is_person then
    raise exception using errcode = 'T7901',
      message = format('%s is the code for %s, not a person.', v_row.code, v_row.name);
  end if;
  if v_row.retired_at is null then
    select coalesce(p.display_name, v_row.name) into v_holder from people p where p.id = v_row.person_id;
    raise exception using errcode = 'T7901',
      message = format('%s already belongs to %s.', v_row.code, coalesce(v_holder, v_row.name));
  end if;

  select max(date) into v_newest from ledger_entries where by = v_row.code;
  if v_newest is not null then
    v_reuse := (v_newest + interval '5 years')::date;
    if v_reuse > (now() at time zone 'America/Chicago')::date then
      raise exception using errcode = 'T7901',
        message = format('%s signed an entry on %s; it can be reused from %s.',
                         v_row.code, to_char(v_newest, 'FMMon FMDD, YYYY'), to_char(v_reuse, 'FMMon FMDD, YYYY'));
    end if;
  end if;

  v_archive := v_row.code || '~' || extract(year from v_row.retired_at)::int;
  while exists (select 1 from leaders where lower(code) = lower(v_archive)) loop
    v_n := v_n + 1;
    v_archive := v_row.code || '~' || extract(year from v_row.retired_at)::int || '-' || v_n;
  end loop;
  update leaders
     set code = v_archive, archived_person_id = person_id, person_id = null, is_person = false, can_login = false
   where code = v_row.code;
end;
$$;

-- ── add ───────────────────────────────────────────────────────────────────────────────────────────────────────

-- p_can_login: false from the person record (a code is for signing off; admin access stays on Access & Permissions);
-- Promote to adult passes true, as its insert always did.
create or replace function public.add_leader_initials(p_person_id bigint, p_code text, p_can_login boolean default false)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_code text := btrim(p_code);
  v_person people%rowtype;
  v_have text;
begin
  perform pg_advisory_xact_lock(hashtext('leader_initials'));
  perform _initials_check_shape(v_code);

  select * into v_person from people where id = p_person_id for update;
  if not found then raise exception using errcode = 'T7901', message = 'That person no longer exists.'; end if;
  if v_person.merged_into_person_id is not null then
    raise exception using errcode = 'T7901',
      message = 'That person was merged into another record. Edit the one they were merged into.';
  end if;
  if v_person.guest_host_household_id is not null then
    raise exception using errcode = 'T7901', message = 'A guest can''t have sign-off initials.';
  end if;

  select code into v_have from leaders where person_id = p_person_id and retired_at is null;
  if found then
    raise exception using errcode = 'T7901', message = format('%s already has initials %s.', v_person.display_name, v_have);
  end if;
  select code into v_have from leaders where person_id = p_person_id and retired_at is not null and code !~ '~';
  if found then
    raise exception using errcode = 'T7901',
      message = format('%s has retired initials %s. Restore them instead.', v_person.display_name, v_have);
  end if;

  perform _initials_claim(v_code, null);
  insert into leaders (code, name, is_person, can_login, person_id)
  values (v_code, v_person.display_name, true, p_can_login, p_person_id);
  return jsonb_build_object('code', v_code);
end;
$$;

-- ── rename ────────────────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.rename_leader_initials(p_person_id bigint, p_new_code text)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_new text := btrim(p_new_code);
  v_old text;
  v_entries int;
begin
  perform pg_advisory_xact_lock(hashtext('leader_initials'));
  perform _initials_check_shape(v_new);

  select code into v_old from leaders where person_id = p_person_id and retired_at is null for update;
  if not found then
    raise exception using errcode = 'T7901', message = 'This person has no initials to change.';
  end if;
  if v_old = v_new then
    return jsonb_build_object('from', v_old, 'to', v_new, 'entries', 0);
  end if;

  perform _initials_claim(v_new, v_old);
  update leaders set code = v_new where code = v_old; -- links follow (ON UPDATE CASCADE)
  update ledger_entries set by = v_new where by = v_old;
  get diagnostics v_entries = row_count;
  return jsonb_build_object('from', v_old, 'to', v_new, 'entries', v_entries);
end;
$$;

-- ── retire / restore ──────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.set_leader_initials_retired(p_person_id bigint, p_retired boolean)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('leader_initials'));
  if p_retired then
    update leaders set retired_at = now() where person_id = p_person_id and retired_at is null returning code into v_code;
    if v_code is null then
      raise exception using errcode = 'T7901', message = 'This person has no initials to retire.';
    end if;
  else
    if exists (select 1 from leaders where person_id = p_person_id and retired_at is null) then
      raise exception using errcode = 'T7901', message = 'This person already has initials in use.';
    end if;
    update leaders set retired_at = null
     where code = (select code from leaders where person_id = p_person_id and retired_at is not null and code !~ '~'
                    order by retired_at desc limit 1)
    returning code into v_code;
    if v_code is null then
      raise exception using errcode = 'T7901', message = 'This person has no retired initials to restore.';
    end if;
  end if;
  return jsonb_build_object('code', v_code, 'retired', p_retired);
end;
$$;

revoke all on function public._initials_check_shape(text) from public, anon, authenticated;
revoke all on function public._initials_claim(text, text) from public, anon, authenticated;
revoke all on function public.add_leader_initials(bigint, text, boolean) from public, anon, authenticated;
revoke all on function public.rename_leader_initials(bigint, text) from public, anon, authenticated;
revoke all on function public.set_leader_initials_retired(bigint, boolean) from public, anon, authenticated;
