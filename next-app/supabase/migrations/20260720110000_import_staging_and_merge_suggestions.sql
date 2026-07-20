-- Import staging + merge suggestions.
--
-- WHY (Patrick, 2026-07-20)
-- A 125-row roster CSV needs to land against the people spine. It fills gaps,
-- adds ~42 people not in the system at all, and — per the person who supplied
-- it — contains values that may be STALER than what is already stored. So
-- "newest file wins" is the wrong default, and a straight upsert is the wrong
-- shape entirely.
--
-- Every mature youth/CRM system that has done this arrives at the same answer:
-- imports are the primary source of duplicate humans, and the fix is not a
-- better matcher — it is staging, suggestion, and human acceptance, with the
-- resolution STORED so it never has to be re-derived. This schema is that.
--
-- Nothing here writes to scouts / leaders / scout_parents / people. A row in
-- merge_suggestions is a proposal; applying it is a separate, explicit act.
--
-- Provenance matters beyond this one file: data has already arrived from a
-- Scoutbook roster export, a Google Form attendance CSV, and hand entry.
-- import_batches means the next source's claims stay attributable rather than
-- dissolving into the tables.

create table if not exists public.import_batches (
  id bigserial primary key,
  source_label text not null,              -- "Roster CSV 2026-07-20"
  source_filename text,
  row_count integer not null default 0,
  notes text,
  status text not null default 'open' check (status in ('open', 'applied', 'abandoned')),
  created_at timestamptz not null default now()
);

create table if not exists public.import_rows (
  id bigserial primary key,
  batch_id bigint not null references public.import_batches(id) on delete cascade,
  line_no integer not null,
  -- Full original record, kept verbatim. Parsing decisions can be revisited
  -- without re-reading the file, and a reviewer can always see exactly what
  -- the source said rather than what we made of it.
  raw jsonb not null,
  -- Parsed convenience columns for display and matching. Intentionally a
  -- subset — anything not here is still in `raw`.
  bsa_member_id text,
  first_name text,
  last_name text,
  display_name text,
  role_code text,                          -- source's 'A','S','Inactive','Moved','Cub','W','J','P'
  birthdate date,
  gender text,
  school text,
  email text,
  phone text,
  address_line1 text,
  city text,
  state text,
  zip text,
  -- Free text, NEVER parsed. The source's 56 phrasings point in two directions
  -- (adult rows say "Mom of X"; scout rows say "Dad Patrick, Mom Jamie Lynn"),
  -- and a wrong automatic reading silently invents a family structure. Shown
  -- verbatim in review; relationships are entered by hand.
  relationship_text text,
  created_at timestamptz not null default now(),
  unique (batch_id, line_no)
);

create index if not exists import_rows_batch_idx on public.import_rows (batch_id);
create index if not exists import_rows_bsa_idx on public.import_rows (bsa_member_id);
create index if not exists import_rows_email_idx on public.import_rows (lower(trim(email)));

-- ── Suggestions ────────────────────────────────────────────────────────────
-- One row per (import_row, candidate person). An import row with three possible
-- matches gets three rows and the reviewer picks at most one; accepting one
-- supersedes its siblings. person_id null means "no match — create a new
-- person", which is a suggestion like any other and still requires acceptance.
create table if not exists public.merge_suggestions (
  id bigserial primary key,
  import_row_id bigint not null references public.import_rows(id) on delete cascade,
  person_id bigint references public.people(id) on delete cascade,

  -- Ranked strongest to weakest. 'name_only' is called out deliberately: it is
  -- the evidence class that produced both production duplicate-person bugs
  -- this week, so the UI must never pre-accept it. 'manual' is a target a
  -- reviewer chose by hand — the matcher never emits it, and it exists because
  -- the safe-direction matcher produces false negatives it cannot see: the
  -- roster's "Summer Curtis" is stored as "Summer Kimble", which no exact rule
  -- links, so a human has to say so.
  confidence text not null check (confidence in ('bsa_member_id', 'email', 'name_only', 'none', 'manual')),

  -- Which fields agreed, and on what values. Lets a reviewer see WHY something
  -- was suggested instead of trusting a score.
  evidence jsonb not null default '{}'::jsonb,

  -- Per-field comparison: [{field, csv_value, db_value, kind}] where kind is
  -- 'fill'      — DB is empty, CSV has a value (safe, additive)
  -- 'conflict'  — both have values and they differ (needs a human choice)
  -- 'same'      — agreed, recorded for completeness
  -- Stored rather than computed at render time so a decision is reproducible
  -- against what was actually shown at the time.
  field_changes jsonb not null default '[]'::jsonb,

  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'superseded')),
  decided_at timestamptz,
  decided_by text,
  decision_note text,
  created_at timestamptz not null default now(),

  -- Same candidate proposed twice for one row is always a bug.
  unique (import_row_id, person_id)
);

create index if not exists merge_suggestions_row_idx on public.merge_suggestions (import_row_id);
create index if not exists merge_suggestions_person_idx on public.merge_suggestions (person_id);
create index if not exists merge_suggestions_status_idx on public.merge_suggestions (status);

-- At most one ACCEPTED suggestion per import row. This is the constraint that
-- makes the review queue safe: whatever the UI does, one source row can never
-- resolve to two different humans.
create unique index if not exists merge_suggestions_one_accepted
  on public.merge_suggestions (import_row_id)
  where status = 'accepted';

-- ── Review queue ───────────────────────────────────────────────────────────
-- Undecided rows, best evidence first, with the counts a reviewer needs to
-- judge how much attention a row deserves.
create or replace view public.merge_review_queue as
select
  r.id                as import_row_id,
  r.batch_id,
  r.line_no,
  r.display_name      as import_name,
  r.role_code,
  r.email             as import_email,
  r.bsa_member_id     as import_bsa,
  r.relationship_text,
  s.id                as suggestion_id,
  s.person_id,
  p.display_name      as person_name,
  s.confidence,
  s.evidence,
  s.field_changes,
  s.status,
  (select count(*) from jsonb_array_elements(s.field_changes) fc
    where fc->>'kind' = 'conflict')                   as conflict_count,
  (select count(*) from jsonb_array_elements(s.field_changes) fc
    where fc->>'kind' = 'fill')                       as fill_count,
  (select count(*) from public.merge_suggestions s2
    where s2.import_row_id = r.id)                    as candidate_count
from public.import_rows r
join public.merge_suggestions s on s.import_row_id = r.id
left join public.people p on p.id = s.person_id
where s.status = 'pending'
  and not exists (
    select 1 from public.merge_suggestions done
    where done.import_row_id = r.id and done.status = 'accepted'
  )
order by
  case s.confidence
    when 'bsa_member_id' then 1
    when 'email' then 2
    when 'name_only' then 3
    else 4
  end,
  r.line_no;

-- ── Accepting a suggestion, atomically ─────────────────────────────────────
-- The first version did this as two separate client calls: patch `people`,
-- then flip the suggestion to accepted. They are not one transaction, so if
-- the second call failed — a network blip, or the merge_suggestions_one_accepted
-- index rejecting a concurrent second accept — the person record had ALREADY
-- been changed while the UI reported failure and the row still showed as
-- pending. The reviewer would then re-decide a row whose target had silently
-- moved under them. One function, one transaction, both writes or neither.
--
-- Takes field NAMES, never values: the values are read here from the row's own
-- stored field_changes, so nothing a browser sends can put arbitrary data into
-- a person record.
create or replace function public.accept_merge_suggestion(
  p_suggestion_id bigint,
  p_fields text[],
  p_decided_by text,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person bigint;
  v_row bigint;
  v_status text;
  v_changes jsonb;
  v_name text; v_email text; v_phone text; v_bsa text; v_birth text; v_gender text;
begin
  -- Locked for the duration so two reviewers cannot accept the same row twice.
  select person_id, import_row_id, status, field_changes
    into v_person, v_row, v_status, v_changes
  from merge_suggestions where id = p_suggestion_id for update;

  if not found then raise exception 'Suggestion not found'; end if;
  if v_status <> 'pending' then raise exception 'This row has already been decided'; end if;
  if v_person is null then raise exception 'No person on this suggestion — create a new person instead'; end if;

  select
    max(case when fc->>'field' = 'display_name'   then fc->>'csv_value' end),
    max(case when fc->>'field' = 'primary_email'  then fc->>'csv_value' end),
    max(case when fc->>'field' = 'primary_phone'  then fc->>'csv_value' end),
    max(case when fc->>'field' = 'bsa_member_id'  then fc->>'csv_value' end),
    max(case when fc->>'field' = 'birthdate'      then fc->>'csv_value' end),
    max(case when fc->>'field' = 'gender'         then fc->>'csv_value' end)
  into v_name, v_email, v_phone, v_bsa, v_birth, v_gender
  from jsonb_array_elements(coalesce(v_changes, '[]'::jsonb)) fc;

  update people set
    -- display_name is NOT NULL, so an empty file value can never blank it.
    display_name  = case when 'display_name'  = any(p_fields) and nullif(v_name, '') is not null
                         then v_name else display_name end,
    primary_email = case when 'primary_email' = any(p_fields) then nullif(v_email, '')  else primary_email end,
    primary_phone = case when 'primary_phone' = any(p_fields) then nullif(v_phone, '')  else primary_phone end,
    bsa_member_id = case when 'bsa_member_id' = any(p_fields) then nullif(v_bsa, '')    else bsa_member_id end,
    birthdate     = case when 'birthdate'     = any(p_fields) then nullif(v_birth, '')::date else birthdate end,
    gender        = case when 'gender'        = any(p_fields) then nullif(v_gender, '') else gender end,
    updated_at    = now()
  where id = v_person;

  update merge_suggestions
  set status = 'accepted', decided_at = now(), decided_by = p_decided_by, decision_note = p_note
  where id = p_suggestion_id;

  update merge_suggestions
  set status = 'superseded'
  where import_row_id = v_row and status = 'pending' and id <> p_suggestion_id;
end;
$$;
