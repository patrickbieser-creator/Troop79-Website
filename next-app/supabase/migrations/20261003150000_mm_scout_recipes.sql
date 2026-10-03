-- Menu Monster Phase 4A: scout recipes (Plans/Menu-Monster-Scout-Workspace.md,
-- "Phase 4 design (revised 2026-10-02 …)").
--
-- A verified scout writes a recipe: a private draft (usable at once in their own
-- menus), then "Share with the troop" publishes it with a frozen "Sam K." credit.
-- A leader can retire it and edit the credit. Typed-in ingredients are 4B.
--
-- Adds to mm_recipes: author_person_id, attribution_label, shared_at,
-- origin_recipe_id, equipment (column now; its UI is 4C). Two RPCs,
-- mm_save_scout_recipe and mm_share_scout_recipe, both security definer and
-- reachable only with the service role (EXECUTE revoked), like mm_save_recipe.
-- merge_people re-points mm_recipes.author_person_id.
--
-- DEPLOY ORDER: DB-first (additive; existing code never selects the new columns).
-- Posture (D-239): RLS stays on with zero policies.

-- ── 1. mm_recipes columns ─────────────────────────────────────────────────

alter table public.mm_recipes
  add column author_person_id bigint references public.people (id) on delete restrict,
  add column attribution_label text check (attribution_label is null or char_length(attribution_label) between 1 and 40),
  add column shared_at timestamptz,
  add column origin_recipe_id text references public.mm_recipes (id) on delete set null,
  add column equipment text[] not null default '{}'
    check (cardinality(equipment) <= 20);

-- A scout recipe has an S-<8 hex> id AND an author; a leader recipe has neither.
alter table public.mm_recipes
  add constraint mm_recipes_scout_id_author_chk
    check ((author_person_id is null) = (id !~ '^S-[0-9a-f]{8}$'));

-- A published scout recipe always carries its share date and credit, so a
-- leader's status change can never publish a scout draft without them.
alter table public.mm_recipes
  add constraint mm_recipes_scout_published_credit_chk
    check (status <> 'published' or author_person_id is null or (shared_at is not null and attribution_label is not null));

create index mm_recipes_author_updated_idx on public.mm_recipes (author_person_id, updated_at desc)
  where author_person_id is not null;

-- ── 2. Text check shared by the scout RPCs ─────────────────────────────────
-- Scout text is shown publicly once shared: no control characters, no links,
-- within its length. The TS sanitizer strips these first; this refuses anything
-- that got past it (the RPC is the last line, not the only one).

create or replace function public.mm_scout_text_ok(p_text text, p_max integer)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_text is not null
     and char_length(p_text) <= p_max
     and p_text !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'
     and p_text !~* '(https?://|www\.)';
$$;

revoke execute on function public.mm_scout_text_ok(text, integer) from public, anon, authenticated;

-- ── 3. mm_save_scout_recipe ───────────────────────────────────────────────
-- Creates or updates the scout's recipe and replaces its lines. p_person is the
-- verified scout resolved on the server — never a client value. Never touches
-- status, shared_at or the credit (sharing is its own RPC). Lost-update guard:
-- p_expected_updated_at must match the stored updated_at for an existing row.
-- Returns the new updated_at.

create or replace function public.mm_save_scout_recipe(
  p_person bigint,
  p_recipe jsonb,
  p_lines jsonb,
  p_expected_updated_at timestamptz
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := p_recipe->>'id';
  v_name text := btrim(coalesce(p_recipe->>'name', ''));
  v_steps text := coalesce(p_recipe->>'steps_md', '');
  v_existing mm_recipes%rowtype;
  v_count integer;
  v_line jsonb;
  v_pos integer := 0;
  v_ing text;
  v_qty numeric;
  v_now timestamptz := now();
begin
  if p_person is null then
    raise exception 'MM_SCOUT_REQUIRED';
  end if;
  if v_id is null or v_id !~ '^S-[0-9a-f]{8}$' then
    raise exception 'MM_BAD_RECIPE_ID';
  end if;
  if char_length(v_name) < 1 or not mm_scout_text_ok(v_name, 60) then
    raise exception 'MM_BAD_TEXT: name';
  end if;
  if not mm_scout_text_ok(v_steps, 4000) then
    raise exception 'MM_BAD_TEXT: steps';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 40 then
    raise exception 'MM_BAD_LINES';
  end if;

  -- One scout's saves run one at a time (cap check + ownership).
  perform pg_advisory_xact_lock(hashtextextended('mm_scout_recipe', p_person));

  select * into v_existing from mm_recipes where id = v_id for update;
  if found then
    if v_existing.author_person_id is distinct from p_person then
      raise exception 'MM_NOT_YOURS';
    end if;
    if v_existing.status = 'retired' then
      raise exception 'MM_RETIRED';
    end if;
    if p_expected_updated_at is null or v_existing.updated_at <> p_expected_updated_at then
      raise exception 'MM_STALE';
    end if;
    update mm_recipes set
      name        = v_name,
      meal_fit    = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_recipe->'meal_fit', '[]'::jsonb)) x), '{}'::text[]),
      food_groups = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_recipe->'food_groups', '[]'::jsonb)) x), '{}'::text[]),
      steps_md    = nullif(v_steps, ''),
      updated_at  = v_now
    where id = v_id;
  else
    select count(*) into v_count from mm_recipes where author_person_id = p_person and status <> 'retired';
    if v_count >= 25 then
      raise exception 'MM_RECIPE_CAP';
    end if;
    insert into mm_recipes (id, name, status, meal_fit, food_groups, camp, trail, steps_md, sort_order,
                            author_person_id, origin_recipe_id, created_at, updated_at)
    values (
      v_id,
      v_name,
      'draft',
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_recipe->'meal_fit', '[]'::jsonb)) x), '{}'::text[]),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_recipe->'food_groups', '[]'::jsonb)) x), '{}'::text[]),
      true,
      false,
      nullif(v_steps, ''),
      1000,
      p_person,
      (select r.id from mm_recipes r where r.id = nullif(p_recipe->>'origin_recipe_id', '') and r.status = 'published'),
      v_now,
      v_now
    );
  end if;

  -- Lines: everyone-lines on live price-book ingredients (scouts don't author
  -- diet rules); a retired ingredient is refused, locked so a leader can't retire
  -- it underneath this save.
  delete from mm_recipe_lines where recipe_id = v_id;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    v_qty := (v_line->>'qty_per_person')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 1000 then
      raise exception 'MM_BAD_LINES';
    end if;
    select i.id into v_ing from mm_ingredients i
      where i.id = v_line->>'ingredient_id' and i.retired_at is null
      for share;
    if v_ing is null then
      raise exception 'MM_BAD_INGREDIENT: %', v_line->>'ingredient_id';
    end if;
    insert into mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
    values (v_id, v_pos, v_ing, v_qty, nullif(v_line->>'unit_key', ''), 'everyone', '{}'::text[]);
  end loop;

  return v_now;
end;
$$;

revoke execute on function public.mm_save_scout_recipe(bigint, jsonb, jsonb, timestamptz) from public, anon, authenticated;

-- ── 4. mm_share_scout_recipe ──────────────────────────────────────────────
-- Publishes the scout's own draft, freezing the credit. Sharing an already
-- shared recipe is a no-op; re-sharing one a leader set back to draft keeps the
-- first credit and date (only a leader's credit edit changes it).

create or replace function public.mm_share_scout_recipe(
  p_person bigint,
  p_id text,
  p_label text
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row mm_recipes%rowtype;
  v_lines integer;
begin
  if p_person is null then
    raise exception 'MM_SCOUT_REQUIRED';
  end if;
  if p_label is null or char_length(btrim(p_label)) < 1 or not mm_scout_text_ok(btrim(p_label), 40) then
    raise exception 'MM_BAD_TEXT: credit';
  end if;

  select * into v_row from mm_recipes where id = p_id for update;
  if not found or v_row.author_person_id is distinct from p_person then
    raise exception 'MM_NOT_YOURS';
  end if;
  if v_row.status = 'retired' then
    raise exception 'MM_RETIRED';
  end if;
  if v_row.status = 'published' then
    return v_row.shared_at;
  end if;
  select count(*) into v_lines from mm_recipe_lines where recipe_id = p_id;
  if v_lines = 0 or cardinality(v_row.meal_fit) = 0 then
    raise exception 'MM_NOT_READY';
  end if;

  -- A recipe a leader set back to draft keeps its first credit and share date.
  update mm_recipes set
    status = 'published',
    shared_at = coalesce(shared_at, now()),
    attribution_label = coalesce(attribution_label, btrim(p_label))
  where id = p_id
  returning shared_at into v_row.shared_at;
  return v_row.shared_at;
end;
$$;

revoke execute on function public.mm_share_scout_recipe(bigint, text, text) from public, anon, authenticated;

-- ── 5. merge_people: + mm_recipes.author_person_id ─────────────────────────
-- Body is the 20261003100100 definition plus the one line marked "Phase 4".
-- attribution_label is NOT touched: the credit is frozen text by design.

CREATE OR REPLACE FUNCTION public.merge_people(p_survivor bigint, p_loser bigint, p_decided_by text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_survivor people%rowtype;
  v_loser people%rowtype;
  v_conflict_event bigint;
begin
  if p_survivor = p_loser then
    raise exception 'Cannot merge a person into themselves';
  end if;

  select * into v_survivor from people where id = p_survivor for update;
  if not found then raise exception 'Person to keep not found'; end if;
  select * into v_loser from people where id = p_loser for update;
  if not found then raise exception 'Duplicate not found'; end if;

  if v_survivor.merged_into_person_id is not null then
    raise exception 'The person you are keeping has itself already been merged away';
  end if;
  if v_loser.merged_into_person_id is not null then
    raise exception 'That duplicate has already been merged';
  end if;

  -- Guest promotion (Plans/Guests-As-People.md): the merged identity is a
  -- member if either side was one.
  if v_survivor.guest_host_household_id is not null and v_loser.guest_host_household_id is null then
    update people set guest_host_household_id = null, updated_at = now() where id = p_survivor;
  end if;
  if v_loser.guest_host_household_id is not null then
    update people set guest_host_household_id = null where id = p_loser;
  end if;

  update people set
    first_name    = coalesce(first_name, v_loser.first_name),
    last_name     = coalesce(last_name, v_loser.last_name),
    birthdate     = coalesce(birthdate, v_loser.birthdate),
    gender        = coalesce(gender, v_loser.gender),
    primary_email = coalesce(nullif(primary_email, ''), v_loser.primary_email),
    primary_phone = coalesce(nullif(primary_phone, ''), v_loser.primary_phone),
    bsa_member_id = coalesce(nullif(bsa_member_id, ''), v_loser.bsa_member_id),
    updated_at    = now()
  where id = p_survivor;

  update scouts        set person_id = p_survivor where person_id = p_loser;

  -- mm_*: Menu Monster workspace references (menus a scout owns, prices they
  -- reported or a leader decided, packages they added).
  update public.mm_menus set owner_person_id = p_survivor where owner_person_id = p_loser;
  update public.mm_price_history set reported_by_person_id = p_survivor where reported_by_person_id = p_loser;
  update public.mm_price_history set decided_by_person_id = p_survivor where decided_by_person_id = p_loser;
  update public.mm_packages set added_by_person_id = p_survivor where added_by_person_id = p_loser;
  -- Phase 4: recipes a scout wrote (the frozen credit text stays as it was).
  update public.mm_recipes set author_person_id = p_survivor where author_person_id = p_loser;
  update leaders        set person_id = p_survivor where person_id = p_loser;

  -- Addresses: the loser's person_emails move to the survivor. A duplicate
  -- address merges its flags; the loser's primary stays primary only if the
  -- survivor has none (the one-primary index forbids two).
  update public.person_emails surv
  set bounced_at = coalesce(surv.bounced_at, dup.bounced_at),
      unsubscribed_at = coalesce(surv.unsubscribed_at, dup.unsubscribed_at),
      verified_at = coalesce(surv.verified_at, dup.verified_at)
  from public.person_emails dup
  where surv.person_id = p_survivor and dup.person_id = p_loser
    and lower(trim(dup.email)) = lower(trim(surv.email));
  update public.person_emails pe
  set person_id = p_survivor,
      is_primary = pe.is_primary and not exists (
        select 1 from public.person_emails x where x.person_id = p_survivor and x.is_primary
      )
  where pe.person_id = p_loser
    and not exists (
      select 1 from public.person_emails x
      where x.person_id = p_survivor and lower(trim(x.email)) = lower(trim(pe.email))
    );
  delete from public.person_emails where person_id = p_loser;

  insert into household_members (household_id, person_id)
  select hm.household_id, p_survivor
  from household_members hm where hm.person_id = p_loser
  on conflict do nothing;
  delete from household_members where person_id = p_loser;

  insert into person_roles (person_id, role, start_date, end_date, notes)
  select p_survivor, r.role, r.start_date, r.end_date, r.notes
  from person_roles r
  where r.person_id = p_loser
    and not exists (
      select 1 from person_roles x where x.person_id = p_survivor and x.role = r.role
    );
  delete from person_roles where person_id = p_loser;

  insert into relationships (person_id, related_person_id, type, is_guardian, source_label)
  select p_survivor, r.related_person_id, r.type, r.is_guardian, r.source_label
  from relationships r
  where r.person_id = p_loser and r.related_person_id <> p_survivor
  on conflict (person_id, related_person_id, type) do nothing;

  insert into relationships (person_id, related_person_id, type, is_guardian, source_label)
  select r.person_id, p_survivor, r.type, r.is_guardian, r.source_label
  from relationships r
  where r.related_person_id = p_loser and r.person_id <> p_survivor
  on conflict (person_id, related_person_id, type) do nothing;

  delete from relationships where person_id = p_loser or related_person_id = p_loser;

  select se_loser.event_signup_id into v_conflict_event
  from signup_entries se_loser
  join signup_entries se_survivor
    on se_survivor.event_signup_id = se_loser.event_signup_id
   and se_survivor.person_id = p_survivor
   and se_survivor.status <> 'cancelled'
  where se_loser.person_id = p_loser
    and se_loser.status <> 'cancelled'
  limit 1;

  if v_conflict_event is not null then
    raise exception 'MERGE_BLOCKED_DUPLICATE_SIGNUP: both people already have a live signup for event_signup_id % — cancel one via the event Roster before merging', v_conflict_event;
  end if;

  update signup_entries set person_id = p_survivor, updated_at = now() where person_id = p_loser;

  update merge_suggestions m set person_id = p_survivor
  where m.person_id = p_loser
    and not exists (
      select 1 from merge_suggestions m2
      where m2.import_row_id = m.import_row_id and m2.person_id = p_survivor
    );
  delete from merge_suggestions where person_id = p_loser and status = 'pending';

  update people set
    merged_into_person_id = p_survivor,
    -- The loser is a retired identity: it must drop out of every
    -- active-filtered list (rosters, pickers, counts). Found 2026-08-26 —
    -- all 13 merged-away rows were still active.
    active = false,
    notes = trim(coalesce(notes, '') || ' [merged into person ' || p_survivor
            || ' by ' || p_decided_by || ' on ' || now()::date || ']'),
    updated_at = now()
  where id = p_loser;
end;
$function$;
