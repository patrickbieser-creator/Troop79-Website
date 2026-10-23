-- Build a Plan B10c (Plans/Build-A-Plan.md "B10 spec"): talent discovery. The teacher's answer page asks "What else
-- would you enjoy teaching, now or in the future?"; the adult searches the whole catalog (requirements and merit
-- badges) and picks some, each with an optional short note. They land in a NEW table, teaching_interests, NOT in
-- teaching_skills, so a forwarded page link can never edit anyone's qualifications (tech-lead). Patrick: interests
-- don't expire; the adult removes them on /member/teaching. The engine and matcher ignore them.
--
-- 1. teaching_interests: one active row per (person, topic_key). topic_key is a top-level requirement key
--    ('<rankId>-<code>' or '<mbId>-<code>', the same keys meeting topics use) or a whole badge ('mb:<badgeId>').
--    note ≤ 140 (plain text; the app escapes it and never links it). source: 'teach_page' (the answer page) or
--    'member' (signed in on /member/teaching). calendar_entry_id: the meeting whose page it came from. Removing sets
--    removed_at (history stays); adding the same key again later makes a new row.
-- 2. _teaching_interest_key_ok: the catalog check. Unknown keys, sub-requirements, boards of review and freeform
--    topics are refused.
-- 3. _teaching_interest_add: the one writer. Up to 15 per submit, 40 active per person (both refuse the whole
--    submit with a message written for people). A key already active is kept (idempotent); a new note on it replaces
--    the old one. Locked per person so two submits can't race past the cap.
-- 4. teaching_interest_add_from_page: the answer page's "Save interests", TOKEN-scoped like
--    meeting_answer_teach_page: locks the page; refuses unknown / superseded / expired / over the submit cap (one
--    budget with the answers); re-checks the recipient (active, same session_epoch). The person is the page's
--    recipient, never a parameter. "Also this Sunday" keys (≤ 5, requirements only, each one of this submit's picks)
--    are validated here and handed back; the app then signs the adult up through teachTopic (meeting_teach_topic).
-- 5. teaching_interest_add_member / teaching_interest_remove: /member/teaching (the app passes the VERIFIED session's
--    person; remove only touches that person's own row).
-- 6. teaching_interest_catalog_search: whole badges by name, then requirements (focus search's matcher), every hit
--    mapped to its top-level requirement, 20 rows. teaching_interest_search_page wraps it for the answer page: page
--    open and under its cap of 60 searches (meeting_invite_pages.search_count, added by B10b).
--
-- DEPLOY ORDER: DB-first. Everything here is new; nothing the code in production (main f61c7b6b) reads or calls
-- changes. Posture (D-051 / D-239): RLS on, no policies; functions security invoker, search_path pinned, EXECUTE for
-- service_role only.

create table if not exists public.teaching_interests (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.people(id) on delete cascade,
  topic_key text not null,
  note text,
  source text not null,
  calendar_entry_id bigint references public.calendar_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint teaching_interests_source_check check (source in ('teach_page', 'member')),
  constraint teaching_interests_note_len check (note is null or char_length(note) <= 140),
  constraint teaching_interests_key_len check (char_length(topic_key) between 3 and 120)
);
create unique index if not exists teaching_interests_active_key on public.teaching_interests (person_id, topic_key) where removed_at is null;
create index if not exists teaching_interests_recent_idx on public.teaching_interests (created_at desc) where removed_at is null;
alter table public.teaching_interests enable row level security;
revoke all on public.teaching_interests from public, anon, authenticated;

-- ── 2. the catalog check ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._teaching_interest_key_ok(p_key text)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when p_key is null or char_length(p_key) not between 3 and 120 then false
    when p_key like 'mb:%' then exists (select 1 from merit_badges where id = substr(p_key, 4))
    else exists (select 1 from rank_requirements q where q.parent_id is null and lower(q.code) <> 'bor' and q.rank_id || '-' || q.code = p_key)
      or exists (select 1 from merit_badge_requirements q where q.parent_id is null and q.mb_id || '-' || q.code = p_key)
  end;
$$;
revoke all on function public._teaching_interest_key_ok(text) from public, anon, authenticated;
grant execute on function public._teaching_interest_key_ok(text) to service_role;

-- ── 3. the one writer ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._teaching_interest_add(p_person bigint, p_items jsonb, p_source text, p_entry bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_active integer;
  v_new text[];
begin
  if p_person is null or p_source not in ('teach_page', 'member') then raise exception 'Malformed interests.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Malformed interests.'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
              where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'key') <> 'string'
                 or coalesce(jsonb_typeof(e->'note'), 'null') not in ('string', 'null')) then
    raise exception 'Malformed interests.';
  end if;
  if (select count(distinct e->>'key') from jsonb_array_elements(p_items) e) > 15 then
    raise exception 'Pick up to 15 at a time.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where not public._teaching_interest_key_ok(e->>'key')) then
    raise exception 'That isn’t a requirement or merit badge we know.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(format('teaching_interests:%s', p_person), 0));
  select count(*) into v_active from teaching_interests where person_id = p_person and removed_at is null;
  select coalesce(array_agg(distinct e->>'key'), '{}') into v_new
    from jsonb_array_elements(p_items) e
   where not exists (select 1 from teaching_interests t where t.person_id = p_person and t.topic_key = e->>'key' and t.removed_at is null);
  if v_active + cardinality(v_new) > 40 then
    raise exception 'You can keep up to 40 things you’d enjoy teaching. Remove some on What I can teach first.';
  end if;
  -- The last note given for a key wins; a blank note keeps the one already saved.
  insert into teaching_interests (person_id, topic_key, note, source, calendar_entry_id)
  select p_person, x.key, x.note, p_source, p_entry
    from (select distinct on (e->>'key') e->>'key' as key, nullif(left(btrim(coalesce(e->>'note', '')), 140), '') as note, o
            from jsonb_array_elements(p_items) with ordinality as a(e, o)
           order by e->>'key', o desc) x
  on conflict (person_id, topic_key) where removed_at is null
  do update set note = coalesce(excluded.note, teaching_interests.note);
  return jsonb_build_object('added', to_jsonb(v_new));
end;
$$;
revoke all on function public._teaching_interest_add(bigint, jsonb, text, bigint) from public, anon, authenticated;
grant execute on function public._teaching_interest_add(bigint, jsonb, text, bigint) to service_role;

-- ── 4. from the answer page (token-scoped) ───────────────────────────────────────────────────────────────────────
create or replace function public.teaching_interest_add_from_page(p_token_hash text, p_items jsonb, p_now_keys text[])
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  p meeting_invite_pages%rowtype;
  v_now text[] := array(select distinct k from unnest(coalesce(p_now_keys, '{}'::text[])) k where k is not null);
  v_res jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Malformed interests.'; end if;
  if cardinality(v_now) > 5 then raise exception 'Offer up to 5 for this Sunday at a time.'; end if;
  if exists (select 1 from unnest(v_now) k where k like 'mb:%') then
    raise exception 'Only a requirement can be offered for this Sunday, not a whole badge.';
  end if;
  if exists (select 1 from unnest(v_now) k where not exists (select 1 from jsonb_array_elements(p_items) e where e->>'key' = k)) then
    raise exception 'Malformed interests.';
  end if;
  select * into p from meeting_invite_pages where token_hash = p_token_hash for update;
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  if p.superseded_at is not null then return jsonb_build_object('state', 'superseded'); end if;
  if p.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  if p.submit_count >= 10 then return jsonb_build_object('state', 'busy'); end if;
  if not exists (select 1 from people x where x.id = p.recipient_person_id and x.active and x.session_epoch = p.recipient_epoch) then
    return jsonb_build_object('state', 'void');
  end if;
  update meeting_invite_pages set submit_count = submit_count + 1 where id = p.id;
  v_res := public._teaching_interest_add(p.recipient_person_id, p_items, 'teach_page', p.calendar_entry_id);
  return jsonb_build_object('state', 'saved', 'page_id', p.id, 'entry', p.calendar_entry_id, 'recipient', p.recipient_person_id,
                            'added', v_res->'added', 'now', to_jsonb(v_now));
end;
$$;
revoke all on function public.teaching_interest_add_from_page(text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.teaching_interest_add_from_page(text, jsonb, text[]) to service_role;

-- ── 5. signed in (/member/teaching) ──────────────────────────────────────────────────────────────────────────────
create or replace function public.teaching_interest_add_member(p_person bigint, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return public._teaching_interest_add(p_person, p_items, 'member', null);
end;
$$;
revoke all on function public.teaching_interest_add_member(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.teaching_interest_add_member(bigint, jsonb) to service_role;

create or replace function public.teaching_interest_remove(p_person bigint, p_id bigint)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  update teaching_interests set removed_at = now()
   where id = p_id and person_id = p_person and removed_at is null
  returning topic_key into v_key;
  return v_key;
end;
$$;
revoke all on function public.teaching_interest_remove(bigint, bigint) from public, anon, authenticated;
grant execute on function public.teaching_interest_remove(bigint, bigint) to service_role;

-- ── 6. the search ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.teaching_interest_catalog_search(p_q text, p_limit integer default 20)
returns table (topic_key text, kind text, source_name text, code text, label text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with toks as (
    select t, replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') as pat
      from unnest((regexp_split_to_array(lower(btrim(left(coalesce(p_q, ''), 80))), '\s+'))[1:6]) t where t <> ''
  ), badges as (
    select 'mb:' || m.id as topic_key, 'badge'::text as kind, m.name as source_name, null::text as code, m.name as label,
           0 as grp, (lower(m.name) <> lower(btrim(coalesce(p_q, ''))))::int as rk, m.name as sort_name
      from merit_badges m
     where exists (select 1 from toks)
       and not exists (select 1 from toks where lower(m.name) not like '%' || toks.pat || '%' escape '\')
  ), hits as (
    select x.kind, x.source_id, x.source_name, x.code,
           row_number() over (order by x.exact desc, x.src_sort, x.source_name, x.top_sort, x.mid_sort, x.child_sort, x.code) as rn
      from public._focus_requirement_matches(p_q, 'all', null) x
     where exists (select 1 from toks)
  ), tops as (
    select coalesce(g.rank_id, pr.rank_id, q.rank_id) || '-' || coalesce(g.code, pr.code, q.code) as topic_key, 'rank'::text as kind,
           h.source_name, coalesce(g.code, pr.code, q.code) as code, coalesce(g.label, pr.label, q.label) as label, h.rn
      from hits h
      join rank_requirements q on h.kind = 'rank' and q.rank_id = h.source_id and q.code = h.code
      left join rank_requirements pr on pr.id = q.parent_id
      left join rank_requirements g on g.id = pr.parent_id
    union all
    select coalesce(g.mb_id, pr.mb_id, q.mb_id) || '-' || coalesce(g.code, pr.code, q.code), 'mb', h.source_name,
           coalesce(g.code, pr.code, q.code), coalesce(g.label, pr.label, q.label), h.rn
      from hits h
      join merit_badge_requirements q on h.kind = 'mb' and q.mb_id = h.source_id and q.code = h.code
      left join merit_badge_requirements pr on pr.id = q.parent_id
      left join merit_badge_requirements g on g.id = pr.parent_id
  ), reqs as (
    select distinct on (t.topic_key) t.topic_key, t.kind, t.source_name, t.code, t.label, t.rn
      from tops t
     where lower(t.code) <> 'bor'
     order by t.topic_key, t.rn
  )
  select topic_key, kind, source_name, code, label
    from (
      select b.topic_key, b.kind, b.source_name, b.code, b.label, 0 as grp, b.rk::bigint as o1, b.sort_name as o2 from badges b
      union all
      select r.topic_key, r.kind, r.source_name, r.code, r.label, 1, r.rn, '' from reqs r
    ) z
   order by grp, o1, o2
   limit least(greatest(coalesce(p_limit, 20), 1), 20);
$$;
revoke all on function public.teaching_interest_catalog_search(text, integer) from public, anon, authenticated;
grant execute on function public.teaching_interest_catalog_search(text, integer) to service_role;

create or replace function public.teaching_interest_search_page(p_token_hash text, p_q text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  p meeting_invite_pages%rowtype;
  v_rows jsonb;
begin
  select * into p from meeting_invite_pages where token_hash = p_token_hash for update;
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  if p.superseded_at is not null then return jsonb_build_object('state', 'superseded'); end if;
  if p.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  if p.search_count >= 60 then return jsonb_build_object('state', 'limit'); end if;
  update meeting_invite_pages set search_count = search_count + 1 where id = p.id;
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_rows
    from public.teaching_interest_catalog_search(left(coalesce(p_q, ''), 80), 20) s;
  return jsonb_build_object('state', 'ok', 'rows', v_rows);
end;
$$;
revoke all on function public.teaching_interest_search_page(text, text) from public, anon, authenticated;
grant execute on function public.teaching_interest_search_page(text, text) to service_role;

-- ── 7. words for keys (the lists on /member/teaching and the Invite tab) ─────────────────────────────────────────
-- skill_id: a rank requirement's skill, for "Add to what I can teach" (null for badges and badge requirements).
create or replace function public.teaching_interest_describe(p_keys text[])
returns table (topic_key text, kind text, source_name text, code text, label text, skill_id text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select 'mb:' || m.id, 'badge'::text, m.name, null::text, m.name, null::text
    from merit_badges m where 'mb:' || m.id = any(p_keys)
  union all
  select q.rank_id || '-' || q.code, 'rank', r.display_name, q.code, q.label, q.skill_id
    from rank_requirements q join ranks r on r.id = q.rank_id
   where q.parent_id is null and q.rank_id || '-' || q.code = any(p_keys)
  union all
  select q.mb_id || '-' || q.code, 'mb', m.name, q.code, q.label, null
    from merit_badge_requirements q join merit_badges m on m.id = q.mb_id
   where q.parent_id is null and q.mb_id || '-' || q.code = any(p_keys);
$$;
revoke all on function public.teaching_interest_describe(text[]) from public, anon, authenticated;
grant execute on function public.teaching_interest_describe(text[]) to service_role;
