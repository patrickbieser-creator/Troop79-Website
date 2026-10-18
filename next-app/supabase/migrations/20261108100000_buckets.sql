-- Buckets (Plans/Buckets-Lookup.md, Release 1 — additive, DB-first).
-- One managed lookup for every money theme: an event (High Cliff Fall '26), a fundraiser (Can Drive),
-- or a standing non-event bucket (Dividends). Money rows and calendar entries point at one by id.
-- Reverses the 2026-08-18 "no activities lookup table" decision (Patrick, 2026-10-17).
--
-- Until Release 2 drops financial_transactions.activity_label, the sync trigger keeps the label and
-- bucket_id in step, so a writer that still sends text (wreath RPCs, event-fee actions, imports) can't
-- leave a gap: the event's bucket wins, else the label names one (created when new), and the label is
-- always rewritten to the bucket's own name.

-- ── Table ───────────────────────────────────────────────────────────────────
create or replace function public.bucket_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$ select lower(btrim(regexp_replace(p, '\s+', ' ', 'g'))) $$;

create table if not exists public.buckets (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  created_by_person_id bigint references public.people(id) on delete set null
);
create unique index if not exists buckets_name_key on public.buckets (public.bucket_key(name));
alter table public.buckets enable row level security;
comment on table public.buckets is
  'Money themes (Plans/Buckets-Lookup.md). Service-role only. Rename = update name (rows follow); merge = merge_buckets().';

alter table public.financial_transactions
  add column if not exists bucket_id bigint references public.buckets(id) on delete restrict;
create index if not exists financial_transactions_bucket_id_idx on public.financial_transactions (bucket_id);

alter table public.calendar_entries
  add column if not exists bucket_id bigint references public.buckets(id) on delete restrict;
create index if not exists calendar_entries_bucket_id_idx on public.calendar_entries (bucket_id);

-- ── Backfill ────────────────────────────────────────────────────────────────
do $$
declare
  v_labels int;
  v_buckets int;
begin
  update public.financial_transactions set activity_label = null where btrim(activity_label) = '';

  select count(distinct public.bucket_key(activity_label)) into v_labels
    from public.financial_transactions where activity_label is not null;

  -- One bucket per normalised label; its name is the most-used spelling. Voided rows count too
  -- (finance_activity_labels() includes them, so history never splits).
  insert into public.buckets (name)
  select distinct on (k) regexp_replace(btrim(label), '\s+', ' ', 'g')
    from (
      select public.bucket_key(activity_label) as k, activity_label as label, count(*) as n
        from public.financial_transactions
       where activity_label is not null
       group by 1, 2
    ) s
   order by k, n desc, label
  on conflict do nothing;

  update public.financial_transactions f
     set bucket_id = b.id, activity_label = b.name
    from public.buckets b
   where f.activity_label is not null
     and f.bucket_id is null
     and public.bucket_key(f.activity_label) = public.bucket_key(b.name);

  -- A calendar entry takes the bucket its money is in — only when that is exactly one bucket.
  update public.calendar_entries c
     set bucket_id = s.bucket_id
    from (
      select calendar_entry_id, min(bucket_id) as bucket_id
        from public.financial_transactions
       where calendar_entry_id is not null and bucket_id is not null
       group by 1
      having count(distinct bucket_id) = 1
    ) s
   where c.id = s.calendar_entry_id and c.bucket_id is null;

  select count(*) into v_buckets from public.buckets;
  raise notice 'buckets backfill: % distinct labels -> % buckets', v_labels, v_buckets;

  if exists (select 1 from public.financial_transactions where activity_label is not null and bucket_id is null) then
    raise exception 'buckets backfill: labelled rows left without a bucket';
  end if;
end $$;

-- ── Sync trigger (dropped with activity_label in Release 2) ─────────────────
create or replace function public.financial_transactions_sync_bucket()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_label text := nullif(btrim(new.activity_label), '');
  v_entry_bucket bigint;
  v_bucket bigint;
begin
  if tg_op = 'UPDATE' then
    if new.bucket_id is distinct from old.bucket_id then
      -- An explicit bucket change wins; clearing the bucket clears the label.
      if new.bucket_id is null then
        new.activity_label := null;
        v_label := null;
      end if;
    elsif v_label is distinct from nullif(btrim(old.activity_label), '') then
      -- A legacy writer changed the label: re-resolve, unless it still names the same bucket
      -- (a bucket rename relabels its rows through here).
      if v_label is null
         or new.bucket_id is null
         or not exists (select 1 from buckets b where b.id = new.bucket_id and bucket_key(b.name) = bucket_key(v_label)) then
        new.bucket_id := null;
      end if;
    end if;
  end if;

  if new.bucket_id is null and new.calendar_entry_id is not null then
    select c.bucket_id into v_entry_bucket from calendar_entries c where c.id = new.calendar_entry_id;
    new.bucket_id := v_entry_bucket;
  end if;

  if new.bucket_id is null and v_label is not null then
    select b.id into v_bucket from buckets b where bucket_key(b.name) = bucket_key(v_label);
    if v_bucket is null then
      insert into buckets (name) values (regexp_replace(v_label, '\s+', ' ', 'g')) returning id into v_bucket;
    end if;
    new.bucket_id := v_bucket;
    if new.calendar_entry_id is not null then
      update calendar_entries set bucket_id = v_bucket where id = new.calendar_entry_id and bucket_id is null;
    end if;
  end if;

  if new.bucket_id is not null then
    select b.name into new.activity_label from buckets b where b.id = new.bucket_id;
  end if;
  return new;
end;
$$;

-- Fires after financial_transactions_fill_event (triggers run in name order), so a fee row's
-- calendar_entry_id is already filled from its signup entry.
drop trigger if exists financial_transactions_sync_bucket on public.financial_transactions;
create trigger financial_transactions_sync_bucket
  before insert or update of activity_label, bucket_id, calendar_entry_id on public.financial_transactions
  for each row execute function public.financial_transactions_sync_bucket();

-- ── Rename: rows follow the bucket's name ───────────────────────────────────
create or replace function public.buckets_relabel_rows()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update financial_transactions set activity_label = new.name where bucket_id = new.id;
  return null;
end;
$$;

drop trigger if exists buckets_relabel_rows on public.buckets;
create trigger buckets_relabel_rows
  after update of name on public.buckets
  for each row when (old.name is distinct from new.name)
  execute function public.buckets_relabel_rows();

-- ── Merge: move rows and calendar entries, then delete the source — one transaction ──
create or replace function public.merge_buckets(p_from bigint, p_into bigint)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_moved integer;
begin
  if p_from = p_into then
    raise exception 'merge_buckets: a bucket cannot be merged into itself';
  end if;
  if not exists (select 1 from buckets where id = p_from) or not exists (select 1 from buckets where id = p_into) then
    raise exception 'merge_buckets: bucket not found';
  end if;
  update financial_transactions set bucket_id = p_into where bucket_id = p_from;
  get diagnostics v_moved = row_count;
  update calendar_entries set bucket_id = p_into where bucket_id = p_from;
  delete from buckets where id = p_from;
  return v_moved;
end;
$$;

revoke execute on function public.merge_buckets(bigint, bigint) from public, anon, authenticated;
grant execute on function public.merge_buckets(bigint, bigint) to service_role;
revoke execute on function public.financial_transactions_sync_bucket() from public, anon, authenticated;
revoke execute on function public.buckets_relabel_rows() from public, anon, authenticated;
revoke execute on function public.bucket_key(text) from public, anon, authenticated;
grant execute on function public.bucket_key(text) to service_role;

-- ── Picker list: every bucket, whether an event points at it, and when it was last used ──
create or replace function public.bucket_list()
returns table (id bigint, name text, is_event boolean, last_used date)
language sql
stable
set search_path = public
as $$
  select b.id, b.name,
         exists (select 1 from calendar_entries c where c.bucket_id = b.id),
         (select max(f.occurred_on) from financial_transactions f where f.bucket_id = b.id and f.voided_at is null)
    from buckets b
$$;
revoke execute on function public.bucket_list() from public, anon, authenticated;
grant execute on function public.bucket_list() to service_role;
