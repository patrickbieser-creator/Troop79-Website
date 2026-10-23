-- Build a Plan B10b (Plans/Build-A-Plan.md "B10 spec"): the teacher digest's ONE answer page.
--
-- A teacher's digest email lists every class they are asked to teach at one meeting, with no per-line links, and ONE
-- "Choose what you'll teach →" button to /i/teach/<token>. That page lists the classes; they say Yes / Not this week per
-- class and submit once. Until the 6 PM expiry they may come back and change a line (Patrick, 2026-10-22): a Yes → No
-- releases the teaching sign-up through meeting_unteach_topic, as the board's own "I can't teach this" does.
--
-- The page token is a SCOPED capability like an invite link (qa-lead, 2026-10-20), never a sign-in: only the peppered
-- hash is stored (unique, lowercase hex); it answers only the invites linked to it (page_id), for its one recipient,
-- for its one meeting; it expires 6:00 PM Central on the meeting day; the recipient's session_epoch is re-checked on
-- every submit; a resend supersedes it (only once the new email has gone out); submits are capped.
--
-- 1. meeting_invite_pages: one row per (recipient, meeting, send). `lines` is the send's snapshot of each class (its
--    short code, title, minutes and the scouts it would help, test scouts already left out): the page reads only that.
--    search_count is B10c's (the talent search), unused here.
-- 2. meeting_invites.page_id: a teach row minted for a page carries the page and NO token. The token rule becomes:
--      remind -> no token, no page;  pick -> a token, no page;  teach -> a token XOR a page.
--    Every existing row is teach/pick with a token (no page) or remind without: all still pass. Redeem paths look a row
--    up by token_hash = <hash> (never matches null), so no /i/<token> can reach a page's row.
-- 3. meeting_mint_teach_page: mints a page and that recipient's teach rows on it, in ONE transaction, under the same
--    per-meeting advisory lock and 24-hour dedupe as meeting_mint_invites. No rows made = no page.
-- 4. meeting_supersede_teach_pages: after the new email went out, the recipient's older live pages for that meeting
--    are superseded and their lines move to the new page (one place to answer everything).
-- 5. meeting_answer_teach_page: the submit, one transaction. Locks the page; refuses unknown / superseded / expired /
--    over the cap; re-checks the recipient (active, same session_epoch: a "sign out everywhere" voids the page's open
--    lines); then per answered line (only lines on THIS page): Yes = meeting_teach_topic as the teacher, No = record
--    it, Yes -> No = meeting_unteach_topic first. A line nobody answered stays open. One line the teach rules refuse
--    (a subtransaction) doesn't undo the others; its message is returned for that line.
--
-- DEPLOY ORDER: DB-first. The code now in production (main 1c974e51) never reads page_id, still mints teach rows WITH
-- a token through meeting_mint_invites (unchanged) or createTeachInvites, and those rows satisfy the new check.
-- Posture (D-051 / D-239): RLS on, no policies; functions security invoker, search_path pinned, EXECUTE for
-- service_role only.

create table if not exists public.meeting_invite_pages (
  id bigint generated always as identity primary key,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  recipient_person_id bigint not null references public.people(id) on delete cascade,
  recipient_epoch integer not null,
  token_hash text not null,
  expires_at timestamptz not null,
  superseded_at timestamptz,
  submit_count integer not null default 0,
  search_count integer not null default 0,
  lines jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint meeting_invite_pages_token_hash_key unique (token_hash),
  constraint meeting_invite_pages_token_hash_hex check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint meeting_invite_pages_lines_object check (jsonb_typeof(lines) = 'object')
);
create index if not exists meeting_invite_pages_entry_recipient_idx on public.meeting_invite_pages (calendar_entry_id, recipient_person_id);
alter table public.meeting_invite_pages enable row level security;
revoke all on public.meeting_invite_pages from public, anon, authenticated;

-- A page deleted (its email never went out) takes its never-sent rows with it.
alter table public.meeting_invites add column if not exists page_id bigint references public.meeting_invite_pages(id) on delete cascade;
create index if not exists meeting_invites_page_idx on public.meeting_invites (page_id) where page_id is not null;

alter table public.meeting_invites drop constraint if exists meeting_invites_remind_has_no_token;
alter table public.meeting_invites drop constraint if exists meeting_invites_token_or_page;
alter table public.meeting_invites
  add constraint meeting_invites_token_or_page check (
    case kind
      when 'remind' then token_hash is null and page_id is null
      when 'teach' then (token_hash is null) <> (page_id is null)
      else token_hash is not null and page_id is null
    end
  );

-- ── 3. mint ──────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.meeting_mint_teach_page(
  p_entry bigint, p_since timestamptz, p_recipient bigint, p_recipient_epoch integer, p_token_hash text,
  p_expires_at timestamptz, p_lines jsonb, p_rows jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_page bigint;
  v_made jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Malformed page.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Malformed page.'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'object' then raise exception 'Malformed page.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_invites:%s', p_entry), 0));
  insert into meeting_invite_pages (calendar_entry_id, recipient_person_id, recipient_epoch, token_hash, expires_at, lines)
  values (p_entry, p_recipient, p_recipient_epoch, p_token_hash, p_expires_at, p_lines)
  returning id into v_page;
  with wanted as (
    select * from jsonb_to_recordset(p_rows) as w(topic_key text, sent_to text, invitee_epoch integer, sent_by bigint)
  ), made as (
    insert into meeting_invites (calendar_entry_id, topic_key, kind, invitee_person_id, recipient_person_id, sent_to,
                                 invitee_epoch, recipient_epoch, token_hash, page_id, expires_at, sent_by)
    select p_entry, w.topic_key, 'teach', p_recipient, p_recipient, w.sent_to, w.invitee_epoch, p_recipient_epoch, null,
           v_page, p_expires_at, w.sent_by
      from wanted w
     where not exists (
       select 1 from meeting_invites m
        where m.calendar_entry_id = p_entry and m.kind = 'teach' and m.topic_key = w.topic_key
          and m.invitee_person_id = p_recipient and m.recipient_person_id = p_recipient and m.sent_at > p_since)
    returning meeting_invites.id, meeting_invites.topic_key
  )
  select coalesce(jsonb_agg(jsonb_build_object('invite_id', made.id, 'topic_key', made.topic_key)), '[]'::jsonb) into v_made from made;
  if jsonb_array_length(v_made) = 0 then
    delete from meeting_invite_pages where id = v_page;
    return jsonb_build_object('page_id', null, 'invites', '[]'::jsonb);
  end if;
  return jsonb_build_object('page_id', v_page, 'invites', v_made);
end;
$$;
revoke all on function public.meeting_mint_teach_page(bigint, timestamptz, bigint, integer, text, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.meeting_mint_teach_page(bigint, timestamptz, bigint, integer, text, timestamptz, jsonb, jsonb) to service_role;

-- ── 4. supersede (after the new email went out) ──────────────────────────────────────────────────────────────────
create or replace function public.meeting_supersede_teach_pages(p_page bigint)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  p meeting_invite_pages%rowtype;
  v_old bigint[];
  v_lines jsonb;
begin
  select * into p from meeting_invite_pages where id = p_page for update;
  if not found or p.superseded_at is not null then return 0; end if;
  select array_agg(o.id order by o.id) into v_old
    from meeting_invite_pages o
   where o.calendar_entry_id = p.calendar_entry_id and o.recipient_person_id = p.recipient_person_id
     and o.id < p.id and o.superseded_at is null;
  if v_old is null then return 0; end if;
  perform 1 from meeting_invite_pages where id = any(v_old) for update;
  -- The older snapshots first, so this send's words win for a class asked again.
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_lines
    from (select o.id, x.key, x.value from meeting_invite_pages o, jsonb_each(o.lines) x where o.id = any(v_old) order by o.id) e;
  update meeting_invite_pages set lines = v_lines || p.lines where id = p.id;
  update meeting_invites set page_id = p.id where page_id = any(v_old);
  update meeting_invite_pages set superseded_at = now() where id = any(v_old);
  return cardinality(v_old);
end;
$$;
revoke all on function public.meeting_supersede_teach_pages(bigint) from public, anon, authenticated;
grant execute on function public.meeting_supersede_teach_pages(bigint) to service_role;

-- ── 5. answer ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.meeting_answer_teach_page(p_token_hash text, p_answers jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  p meeting_invite_pages%rowtype;
  r meeting_invites%rowtype;
  a record;
  v_ok boolean;
  v_out jsonb := '[]'::jsonb;
  v_result text;
  v_err text;
  v_found boolean;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) > 50 then
    raise exception 'Malformed answer.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_answers) e
              where jsonb_typeof(e->'invite_id') <> 'number' or coalesce(e->>'answer', '') not in ('yes', 'no')) then
    raise exception 'Malformed answer.';
  end if;
  select * into p from meeting_invite_pages where token_hash = p_token_hash for update;
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  if p.superseded_at is not null then return jsonb_build_object('state', 'superseded'); end if;
  if p.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  if p.submit_count >= 10 then return jsonb_build_object('state', 'busy'); end if;
  update meeting_invite_pages set submit_count = submit_count + 1 where id = p.id;

  -- The recipient, re-checked now: still active, the same session epoch. A "sign out everywhere" (or a merge) voids
  -- every line still open; answered lines keep their answer (the teaching sign-up stands until changed elsewhere).
  select exists (select 1 from people x where x.id = p.recipient_person_id and x.active and x.session_epoch = p.recipient_epoch) into v_ok;
  if not v_ok then
    update meeting_invites set consumed_at = now() where page_id = p.id and consumed_at is null;
    return jsonb_build_object('state', 'void');
  end if;

  for a in
    select distinct on ((e->>'invite_id')::bigint) (e->>'invite_id')::bigint as invite_id, e->>'answer' as answer
      from jsonb_array_elements(p_answers) e
  loop
    v_err := null;
    select * into r from meeting_invites
     where id = a.invite_id and page_id = p.id and kind = 'teach' and invitee_person_id = p.recipient_person_id
     for update;
    v_found := found;
    if not v_found then
      r := null;
      v_result := 'gone';
    elsif r.consumed_at is not null and r.response is null then
      v_result := 'void';
    elsif r.response is not null and r.response not in ('accepted', 'declined') then
      v_result := 'gone';
    elsif a.answer = 'yes' and r.response = 'accepted' then
      v_result := 'unchanged';
    elsif a.answer = 'no' and r.response = 'declined' then
      v_result := 'unchanged';
    else
      begin
        if a.answer = 'yes' then
          perform public.meeting_teach_topic(array[r.calendar_entry_id], r.invitee_person_id, r.invitee_person_id, false, r.topic_key, null, null);
        elsif r.response = 'accepted' then
          perform public.meeting_unteach_topic(r.calendar_entry_id, r.invitee_person_id, r.invitee_person_id, false, r.topic_key);
        end if;
        update meeting_invites
           set consumed_at = coalesce(consumed_at, now()),
               response = case when a.answer = 'yes' then 'accepted' else 'declined' end,
               responded_at = now()
         where id = r.id;
        v_result := a.answer;
      exception when others then
        v_result := 'error';
        v_err := sqlerrm;
      end;
    end if;
    v_out := v_out || jsonb_build_object('invite_id', a.invite_id, 'topic_key', r.topic_key, 'result', v_result, 'error', v_err,
                                         'was', r.response);
  end loop;
  return jsonb_build_object('state', 'answered', 'page_id', p.id, 'entry', p.calendar_entry_id, 'recipient', p.recipient_person_id, 'lines', v_out);
end;
$$;
revoke all on function public.meeting_answer_teach_page(text, jsonb) from public, anon, authenticated;
grant execute on function public.meeting_answer_teach_page(text, jsonb) to service_role;
