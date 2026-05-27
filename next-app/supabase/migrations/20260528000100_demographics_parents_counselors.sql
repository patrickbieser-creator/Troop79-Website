-- Adds demographic + contact + health-form columns to scouts and leaders.
-- Adds two relational tables: scout_parents (a scout has many parents/guardians)
-- and merit_badge_counselors (an MB has many counselors, ordered).
-- Also makes scouts.current_rank derived from rank_award ledger entries via a
-- trigger, so the editor's "Current Rank" field can be read-only.

-- ── Demographic + contact columns ─────────────────────────────────────────

alter table public.scouts add column if not exists address_line1 text;
alter table public.scouts add column if not exists address_line2 text;
alter table public.scouts add column if not exists city text;
alter table public.scouts add column if not exists state text;
alter table public.scouts add column if not exists zip text;
alter table public.scouts add column if not exists phone text;
alter table public.scouts add column if not exists email text;
alter table public.scouts add column if not exists health_form_date date;

alter table public.leaders add column if not exists address_line1 text;
alter table public.leaders add column if not exists address_line2 text;
alter table public.leaders add column if not exists city text;
alter table public.leaders add column if not exists state text;
alter table public.leaders add column if not exists zip text;
alter table public.leaders add column if not exists phone text;
alter table public.leaders add column if not exists email text;
alter table public.leaders add column if not exists health_form_date date;

-- ── scout_parents ─────────────────────────────────────────────────────────

create table if not exists public.scout_parents (
  id bigserial primary key,
  scout_id text not null references public.scouts(id) on delete cascade,
  name text not null,
  relationship text,
  phone text,
  email text,
  same_address_as_scout boolean not null default true,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  sort_order int not null default 0
);
create index if not exists scout_parents_scout_idx on public.scout_parents (scout_id);

alter table public.scout_parents enable row level security;
create policy scout_parents_read_all on public.scout_parents for select using (true);

-- ── merit_badge_counselors ────────────────────────────────────────────────

create table if not exists public.merit_badge_counselors (
  mb_id text not null references public.merit_badges(id) on delete cascade,
  leader_code text not null references public.leaders(code) on delete cascade,
  sort_order int not null default 0,
  primary key (mb_id, leader_code)
);
create index if not exists mb_counselors_leader_idx on public.merit_badge_counselors (leader_code);

alter table public.merit_badge_counselors enable row level security;
create policy mb_counselors_read_all on public.merit_badge_counselors for select using (true);

-- ── current_rank trigger ─────────────────────────────────────────────────
--
-- Recomputes scouts.current_rank as the highest rank_award (by ranks.sort_order)
-- among the scout's non-archived, non-deleted ledger_entries. Fires on every
-- ledger_entries change where kind = 'rank_award'.

create or replace function public.recompute_scout_current_rank(p_scout_id text)
  returns void as $func$
declare
  v_rank text;
begin
  select le.code into v_rank
    from public.ledger_entries le
    join public.ranks r on r.id = le.code
   where le.scout_id = p_scout_id
     and le.kind = 'rank_award'
     and le.archived_at is null
     and le.deleted_at is null
   order by r.sort_order desc
   limit 1;
  update public.scouts set current_rank = v_rank where id = p_scout_id;
end;
$func$ language plpgsql;

create or replace function public.trg_refresh_scout_rank()
  returns trigger as $func$
begin
  if (tg_op = 'INSERT') then
    if new.kind = 'rank_award' then
      perform public.recompute_scout_current_rank(new.scout_id);
    end if;
  elsif (tg_op = 'DELETE') then
    if old.kind = 'rank_award' then
      perform public.recompute_scout_current_rank(old.scout_id);
    end if;
  elsif (tg_op = 'UPDATE') then
    if new.kind = 'rank_award' or old.kind = 'rank_award' then
      perform public.recompute_scout_current_rank(new.scout_id);
      if old.scout_id is distinct from new.scout_id then
        perform public.recompute_scout_current_rank(old.scout_id);
      end if;
    end if;
  end if;
  return null;
end;
$func$ language plpgsql;

drop trigger if exists ledger_rank_award_refresh on public.ledger_entries;
create trigger ledger_rank_award_refresh
  after insert or update or delete on public.ledger_entries
  for each row
  execute function public.trg_refresh_scout_rank();
