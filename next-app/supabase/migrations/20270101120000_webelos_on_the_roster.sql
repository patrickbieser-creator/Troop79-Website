-- Webelos on the roster (Plans/Webelos-On-The-Roster.md; Patrick 2026-11-12).
--
-- A Webelos is a youth on the way into the troop: a scouts row with a troop
-- ID (next cohort letter, kept for life), advancement TRACKED against it, but
-- not yet a scout. Shape: is_webelos = true AND active = false, with no
-- inactive_reason (that means "left"). Every scout-only feature already reads
-- active scouts, so a Webelos is excluded by default; the INCLUDE paths
-- (sign-up, households, roster, Fast Entry) opt in by name.
--
-- Crossing over is cross_over_webelos(): one transaction that makes the row an
-- active scout, stamps crossed_over_on, awards the Scout rank if its
-- requirements were all done as a Webelos, and writes the audit row.
-- undo_cross_over() reverses exactly that.
--
-- Additive for production data (no row is a Webelos yet). Deploy DB-first.

-- ── scouts ──────────────────────────────────────────────────────────────────
alter table public.scouts
  add column is_webelos boolean not null default false,
  add column crossed_over_on date;

comment on column public.scouts.is_webelos is
  'A Webelos on the way into the troop: tracked, never reported. Always active = false with no inactive_reason. Cleared by cross_over_webelos().';
comment on column public.scouts.crossed_over_on is
  'The day a Webelos crossed over into the troop (cross_over_webelos). Their tenure starts here.';

-- active = false used to mean "left" and so required a reason; a Webelos is
-- inactive without one.
alter table public.scouts drop constraint scouts_inactive_reason_only_when_inactive;
alter table public.scouts add constraint scouts_inactive_reason_only_when_inactive check (
  (active and inactive_reason is null)
  or (not active and is_webelos and inactive_reason is null)
  or (not active and not is_webelos and inactive_reason is not null)
);
alter table public.scouts add constraint scouts_webelos_not_active check (not (is_webelos and active));
alter table public.scouts add constraint scouts_crossed_over_only_when_not_webelos
  check (crossed_over_on is null or not is_webelos);
alter table public.scouts add constraint crossed_over_on_from_1900
  check (crossed_over_on is null or crossed_over_on >= date '1900-01-01');

-- ── person_directory: a webelos tab ─────────────────────────────────────────
-- Same columns; a Webelos gets tab 'webelos' (not 'inactive_scout') and stays
-- out of the adult picker like any youth.
create or replace view public.person_directory as
WITH scout_record AS (
         SELECT s.person_id,
            s.id AS scout_id,
            s.active,
            s.is_webelos,
            NULLIF(TRIM(BOTH FROM s.inactive_reason), ''::text) AS inactive_reason,
            p_1.birthdate,
            COALESCE(NULLIF(TRIM(BOTH FROM s.inactive_reason), ''::text), ''::text) = 'aged_out'::text OR p_1.birthdate IS NOT NULL AND p_1.birthdate <= (CURRENT_DATE - '18 years'::interval) AS no_longer_youth
           FROM scouts s
             JOIN people p_1 ON p_1.id = s.person_id
          WHERE s.person_id IS NOT NULL
        ), troop_role AS (
         SELECT r.person_id,
            bool_or(r.role = ANY (ARRAY['adult_leader'::text, 'committee_member'::text, 'chartered_org_rep'::text])) AS holds_troop_role,
            string_agg(DISTINCT r.role, ', '::text ORDER BY r.role) AS roles
           FROM person_roles r
          WHERE r.end_date IS NULL AND r.role <> 'youth_member'::text
          GROUP BY r.person_id
        )
 SELECT p.id AS person_id,
    p.display_name,
    p.primary_email,
    p.primary_phone,
    p.bsa_member_id,
    p.birthdate,
    sr.scout_id,
    sr.inactive_reason,
    COALESCE(cr.roles, ''::text) AS roles,
        CASE
            WHEN sr.scout_id IS NOT NULL AND sr.is_webelos THEN 'webelos'::text
            WHEN sr.scout_id IS NOT NULL AND sr.active AND NOT sr.no_longer_youth THEN 'active_scout'::text
            WHEN sr.scout_id IS NOT NULL AND NOT sr.active AND NOT sr.no_longer_youth THEN 'inactive_scout'::text
            WHEN COALESCE(cr.holds_troop_role, false) THEN 'leader'::text
            ELSE 'adult'::text
        END AS tab,
    p.active AND NOT (sr.scout_id IS NOT NULL AND sr.active AND NOT sr.no_longer_youth) AND NOT (sr.scout_id IS NOT NULL AND NOT sr.active AND NOT sr.no_longer_youth) AND NOT COALESCE(sr.is_webelos, false) AS in_picker,
    p.active,
    p.inactive_reason AS person_inactive_reason
   FROM people p
     LEFT JOIN scout_record sr ON sr.person_id = p.id
     LEFT JOIN troop_role cr ON cr.person_id = p.id
  WHERE p.merged_into_person_id IS NULL AND p.guest_host_household_id IS NULL;

-- ── reportable_ledger: what reports may count ───────────────────────────────
-- ledger_active minus Webelos rows. Advancement reports, the court of honor,
-- attention items, ledger audits and the Scoutbook export read THIS; Fast
-- Entry and a person's own record keep ledger_active (a Webelos's work is
-- tracked). tests/reportable-ledger-readers.test.ts holds the line.
create view public.reportable_ledger with (security_invoker = true) as
select la.*
  from public.ledger_active la
 where not exists (select 1 from public.scouts s where s.id = la.scout_id and s.is_webelos);

comment on view public.reportable_ledger is
  'ledger_active without Webelos rows: the advancement every report, export and public page may count.';
-- Service-role only, like every table and view since 2026-08-25.
revoke all on public.reportable_ledger from anon, authenticated;

-- ── scout_tenure: a crossed-over scout starts on crossover day ──────────────
create or replace view public.scout_tenure with (security_invoker = true) as
SELECT l.scout_id,
    COALESCE(max(s.crossed_over_on), min(l.date)) AS first_activity_date,
    max(l.date) AS last_activity_date
   FROM ledger_entries l
     LEFT JOIN scouts s ON s.id = l.scout_id
  WHERE l.deleted_at IS NULL AND l.archived_at IS NULL AND l.date >= '2000-01-01'::date
  GROUP BY l.scout_id;

-- ── Scout rank: never auto-awarded to a Webelos ─────────────────────────────
-- (cross_over_webelos awards it on crossover day if the work is all done.)
create or replace function public.trg_auto_scout_rank_award()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_total int;
  v_done int;
begin
  if new.code not like 'scout-%' then
    return null;
  end if;
  if new.archived_at is not null or new.deleted_at is not null then
    return null;
  end if;
  if exists (select 1 from public.scouts s where s.id = new.scout_id and s.is_webelos) then
    return null;
  end if;

  select count(*) into v_total from public.rank_requirements where rank_id = 'scout';

  select count(distinct le.code) into v_done
    from public.ledger_entries le
   where le.scout_id = new.scout_id
     and le.kind = 'rank_requirement'
     and le.code like 'scout-%'
     and le.archived_at is null
     and le.deleted_at is null;

  if v_done < v_total then
    return null;
  end if;

  if exists (
    select 1 from public.ledger_entries a
     where a.scout_id = new.scout_id
       and a.kind = 'rank_award'
       and a.code = 'scout'
       and a.archived_at is null
       and a.deleted_at is null
  ) then
    return null;
  end if;

  insert into public.ledger_entries (scout_id, date, kind, code, label, "by", entered_by, notes)
  select new.scout_id, new.date, 'rank_award', 'scout',
         r.display_name || ' — rank awarded (all requirements completed)',
         new."by", new.entered_by,
         'Auto-awarded when the final Scout rank requirement was recorded (ledger #' || new.id || ')'
    from public.ranks r
   where r.id = 'scout';

  return null;
end;
$function$;

-- ── Sign-up class: a Webelos signs up as a Webelos ──────────────────────────
create or replace function public.default_participant_class(p_person_id bigint, p_event_signup_id bigint)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  with ev as (
    select ce.entry_date
    from public.event_signups es
    join public.calendar_entries ce on ce.id = es.calendar_entry_id
    where es.id = p_event_signup_id
  ),
  sc as (
    select s.graduation_year, s.junior_leader_override, s.is_webelos
    from public.scouts s
    where s.person_id = p_person_id
    limit 1
  ),
  sye as (
    -- school-year end as of the event date: June 15 rollover
    select case
      when ev.entry_date >= make_date(extract(year from ev.entry_date)::int, 6, 15)
        then extract(year from ev.entry_date)::int + 1
      else extract(year from ev.entry_date)::int
    end as year_end
    from ev
  )
  select case
    when not exists (select 1 from sc) then 'adult'
    when (select is_webelos from sc) then 'webelos'
    when (select junior_leader_override from sc) = 'yes' then 'junior_leader'
    when (select junior_leader_override from sc) = 'no' then 'scout'
    when (select graduation_year from sc) is null then 'scout'
    when (select year_end from sye) is null then 'scout'
    when (12 - ((select graduation_year from sc) - (select year_end from sye))) between 9 and 12
      then 'junior_leader'
    else 'scout'
  end;
$function$;

-- ── Crossing over ───────────────────────────────────────────────────────────
create or replace function public.cross_over_webelos(
  p_scout_id text,
  p_on date,
  p_bsa_member_id text,
  p_actor_person_id bigint,
  p_actor_label text
) returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_scout public.scouts%rowtype;
  v_bsa text := nullif(trim(coalesce(p_bsa_member_id, '')), '');
  v_was_bsa text;
  v_total int;
  v_done int;
  v_awarded boolean := false;
begin
  if p_on is null then raise exception 'CROSSOVER_DATE_REQUIRED'; end if;
  select * into v_scout from public.scouts where id = p_scout_id for update;
  if not found then raise exception 'SCOUT_NOT_FOUND: %', p_scout_id; end if;
  if not v_scout.is_webelos then raise exception 'NOT_A_WEBELOS: % is already a scout', p_scout_id; end if;

  update public.scouts
     set is_webelos = false, active = true, inactive_reason = null, crossed_over_on = p_on
   where id = p_scout_id;

  select bsa_member_id into v_was_bsa from public.people where id = v_scout.person_id;
  if v_bsa is not null and v_bsa is distinct from v_was_bsa then
    update public.people set bsa_member_id = v_bsa, updated_at = now() where id = v_scout.person_id;
  end if;

  -- Scout rank done entirely as a Webelos is awarded today (it was held back).
  select count(*) into v_total from public.rank_requirements where rank_id = 'scout';
  select count(distinct le.code) into v_done
    from public.ledger_entries le
   where le.scout_id = p_scout_id and le.kind = 'rank_requirement' and le.code like 'scout-%'
     and le.archived_at is null and le.deleted_at is null;
  if v_total > 0 and v_done >= v_total and not exists (
    select 1 from public.ledger_entries a
     where a.scout_id = p_scout_id and a.kind = 'rank_award' and a.code = 'scout'
       and a.archived_at is null and a.deleted_at is null
  ) then
    insert into public.ledger_entries (scout_id, date, kind, code, label, "by", entered_by, notes)
    select p_scout_id, p_on, 'rank_award', 'scout',
           r.display_name || ' — rank awarded (all requirements completed)',
           coalesce(p_actor_label, 'Crossover'), coalesce(p_actor_label, 'Crossover'),
           'Awarded at crossover: Scout rank requirements were completed as a Webelos'
      from public.ranks r
     where r.id = 'scout';
    v_awarded := true;
  end if;

  insert into public.audit_log (actor_person_id, actor_label, area, action, entity_type, entity_id, summary, details)
  values (
    p_actor_person_id, coalesce(p_actor_label, 'system'), 'roster', 'cross_over', 'scout', p_scout_id,
    'Crossed over ' || v_scout.display_name || ' from Webelos to scout',
    jsonb_build_object(
      'people', jsonb_build_array(v_scout.person_id),
      'changes', jsonb_build_array(
        jsonb_build_object('field', 'Status', 'from', 'Webelos', 'to', 'Scout'),
        jsonb_build_object('field', 'Crossed over', 'from', '—', 'to', p_on::text)
      ) || case when v_bsa is not null and v_bsa is distinct from v_was_bsa
                then jsonb_build_array(jsonb_build_object('field', 'BSA member ID', 'from', coalesce(v_was_bsa, '—'), 'to', v_bsa))
                else '[]'::jsonb end
        || case when v_awarded
                then jsonb_build_array(jsonb_build_object('field', 'Scout rank', 'from', '—', 'to', 'Awarded'))
                else '[]'::jsonb end
    )
  );
end;
$function$;

create or replace function public.undo_cross_over(
  p_scout_id text,
  p_actor_person_id bigint,
  p_actor_label text
) returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_scout public.scouts%rowtype;
begin
  select * into v_scout from public.scouts where id = p_scout_id for update;
  if not found then raise exception 'SCOUT_NOT_FOUND: %', p_scout_id; end if;
  if v_scout.is_webelos or v_scout.crossed_over_on is null then
    raise exception 'NOT_CROSSED_OVER: % has no crossover to undo', p_scout_id;
  end if;
  -- Undo is for a mistake, not a rewrite: once they have left, or have troop
  -- advancement dated after crossover, flipping back would hide real work.
  if not v_scout.active then
    raise exception 'UNDO_SCOUT_LEFT: % is no longer active', p_scout_id;
  end if;
  if exists (
    select 1 from public.ledger_entries le
     where le.scout_id = p_scout_id and le.deleted_at is null and le.archived_at is null
       and le.date > v_scout.crossed_over_on
  ) then
    raise exception 'UNDO_HAS_TROOP_ADVANCEMENT: % has advancement recorded after crossover', p_scout_id;
  end if;

  -- The Scout rank this crossover awarded goes with it (soft delete, like any ledger removal).
  update public.ledger_entries
     set deleted_at = now(), deleted_by = coalesce(p_actor_label, 'system'), deleted_reason = 'Crossover undone'
   where scout_id = p_scout_id and kind = 'rank_award' and code = 'scout'
     and deleted_at is null and notes like 'Awarded at crossover%';

  update public.scouts
     set is_webelos = true, active = false, inactive_reason = null, crossed_over_on = null
   where id = p_scout_id;

  insert into public.audit_log (actor_person_id, actor_label, area, action, entity_type, entity_id, summary, details)
  values (
    p_actor_person_id, coalesce(p_actor_label, 'system'), 'roster', 'undo_cross_over', 'scout', p_scout_id,
    'Undid the crossover of ' || v_scout.display_name || ' (back to Webelos)',
    jsonb_build_object(
      'people', jsonb_build_array(v_scout.person_id),
      'changes', jsonb_build_array(jsonb_build_object('field', 'Status', 'from', 'Scout', 'to', 'Webelos'))
    )
  );
end;
$function$;

revoke execute on function public.cross_over_webelos(text, date, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.undo_cross_over(text, bigint, text) from public, anon, authenticated;

-- ── Teaching skills: a Webelos is youth, never an adult teacher ─────────────
-- Both checked "an ACTIVE scout" before refusing adults-only skills; a Webelos
-- (active = false) passed as an adult. Same bodies, the youth test widened.
CREATE OR REPLACE FUNCTION public.set_teaching_skills(p_person_id bigint, p_skill_ids text[], p_source text, p_changed_by_person_id bigint, p_changed_by_label text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_merged bigint;
  v_wanted text[] := array(select distinct w from unnest(coalesce(p_skill_ids, '{}')) w order by w);
  v_unknown text[];
  v_adult_only text[];
  v_added text[];
  v_removed text[];
begin
  if p_source not in ('member', 'admin') then
    raise exception 'Unknown source %', p_source;
  end if;
  select merged_into_person_id into v_merged from people where id = p_person_id for update;
  if not found then raise exception 'That person no longer exists.'; end if;
  if v_merged is not null then
    raise exception 'That person was merged into another record. Edit the one they were merged into.';
  end if;

  v_unknown := array(select w from unnest(v_wanted) w where not exists (select 1 from skills s where s.id = w));
  if cardinality(v_unknown) > 0 then
    raise exception 'Unknown skill: %', array_to_string(v_unknown, ', ');
  end if;
  if exists (select 1 from scouts where person_id = p_person_id and (active or is_webelos)) then
    v_adult_only := array(
      select s.name from skills s where s.id = any (v_wanted) and not s.youth_teachable order by s.sort_order
    );
    if cardinality(v_adult_only) > 0 then
      raise exception 'Adults only, so a scout can''t teach it: %', array_to_string(v_adult_only, ', ');
    end if;
  end if;

  v_removed := array(
    select t.skill_id from teaching_skills t where t.person_id = p_person_id and not (t.skill_id = any (v_wanted)) order by 1
  );
  v_added := array(
    select w from unnest(v_wanted) w
     where not exists (select 1 from teaching_skills t where t.person_id = p_person_id and t.skill_id = w)
     order by w
  );

  delete from teaching_skills where person_id = p_person_id and skill_id = any (v_removed);
  insert into teaching_skills (person_id, skill_id, authorized_by)
  select p_person_id, a, case when p_source = 'member' then 'self' else p_changed_by_label end from unnest(v_added) a;

  insert into teaching_skill_changes (person_id, skill_id, action, source, changed_by_person_id, changed_by_label, reviewed_at)
  select p_person_id, x.skill_id, x.action, p_source, p_changed_by_person_id, p_changed_by_label,
         case when p_source = 'member' then null else now() end
    from (
      select a as skill_id, 'added' as action from unnest(v_added) a
      union all
      select r, 'removed' from unnest(v_removed) r
    ) x;

  return jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
end;
$function$;

CREATE OR REPLACE FUNCTION public.undo_teaching_skill_change(p_change_id bigint, p_changed_by_person_id bigint, p_changed_by_label text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c teaching_skill_changes%rowtype;
  v_held boolean;
begin
  select * into c from teaching_skill_changes where id = p_change_id for update;
  if not found then return 'missing'; end if;
  if c.reverted_at is not null or c.source = 'undo' then return 'already'; end if;
  if exists (select 1 from people where id = c.person_id and merged_into_person_id is not null) then
    raise exception 'That person was merged into another record. Edit the one they were merged into.';
  end if;
  perform 1 from people where id = c.person_id for update;

  v_held := exists (select 1 from teaching_skills where person_id = c.person_id and skill_id = c.skill_id);
  -- Undoing an add removes the skill; undoing a remove restores it. If the skill already changed back, or a later
  -- change touched the same skill (only the latest one is reversible, so an old undo can't flip today's state), there
  -- is nothing to reverse: mark it reviewed and say so rather than logging a no-op.
  if (c.action = 'added' and not v_held) or (c.action = 'removed' and v_held)
     or exists (select 1 from teaching_skill_changes x where x.person_id = c.person_id and x.skill_id = c.skill_id and x.id > c.id) then
    update teaching_skill_changes set reviewed_at = coalesce(reviewed_at, now()) where id = c.id;
    return 'superseded';
  end if;
  if c.action = 'removed'
     and exists (select 1 from scouts where person_id = c.person_id and (active or is_webelos))
     and exists (select 1 from skills where id = c.skill_id and not youth_teachable) then
    raise exception 'Adults only, so a scout can''t teach it.';
  end if;

  if c.action = 'added' then
    delete from teaching_skills where person_id = c.person_id and skill_id = c.skill_id;
  else
    insert into teaching_skills (person_id, skill_id, authorized_by) values (c.person_id, c.skill_id, p_changed_by_label);
  end if;
  insert into teaching_skill_changes (person_id, skill_id, action, source, changed_by_person_id, changed_by_label, reviewed_at)
  values (c.person_id, c.skill_id, case when c.action = 'added' then 'removed' else 'added' end, 'undo',
          p_changed_by_person_id, p_changed_by_label, now());
  update teaching_skill_changes set reverted_at = now(), reviewed_at = coalesce(reviewed_at, now()) where id = c.id;
  return 'ok';
end;
$function$;
