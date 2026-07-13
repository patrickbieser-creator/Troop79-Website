-- Auto rank award on Board of Review completion (Patrick, 2026-07-12).
--
-- Completing a rank's BoR is the final human step — there is no reason the
-- award should require a second manual ledger entry (Hazel's Star BoR was
-- recorded today with no award, leaving her displayed as First Class).
--
-- Mechanism: recording a `rank_requirement` row with code `<rank>-BoR`
-- auto-inserts the matching `rank_award` row (same date/by/entered_by),
-- which in turn fires the existing recompute_scout_current_rank trigger.
-- rank_award stays the single promotion signal for all displays and
-- history — BoR simply confers it automatically now.
--
-- Notes:
--   * Scout rank has no BoR (Scoutmaster conference caps it, per BSA) and
--     keeps its manual award entry.
--   * Idempotent: no award is created when a non-archived one already
--     exists for that scout+rank.
--   * One-way: archiving/deleting a BoR row does NOT retract the award —
--     that stays a deliberate leader action in the ledger.
--   * No recursion: this trigger only reacts to rank_requirement rows;
--     the row it inserts is a rank_award.

create or replace function public.trg_auto_rank_award()
  returns trigger as $func$
declare
  v_rank text;
begin
  if new.code not like '%-BoR' then
    return null;
  end if;
  if new.archived_at is not null or new.deleted_at is not null then
    return null;
  end if;
  v_rank := left(new.code, length(new.code) - 4);
  if not exists (select 1 from public.ranks r where r.id = v_rank) then
    return null;
  end if;
  if exists (
    select 1 from public.ledger_entries a
     where a.scout_id = new.scout_id
       and a.kind = 'rank_award'
       and a.code = v_rank
       and a.archived_at is null
       and a.deleted_at is null
  ) then
    return null;
  end if;

  insert into public.ledger_entries (scout_id, date, kind, code, label, "by", entered_by, notes)
  select new.scout_id, new.date, 'rank_award', v_rank,
         r.display_name || ' — rank awarded at Board of Review',
         new."by", new.entered_by,
         'Auto-awarded when the Board of Review was recorded (ledger #' || new.id || ')'
    from public.ranks r
   where r.id = v_rank;

  return null;
end;
$func$ language plpgsql;

drop trigger if exists ledger_auto_rank_award on public.ledger_entries;
create trigger ledger_auto_rank_award
  after insert on public.ledger_entries
  for each row
  when (new.kind = 'rank_requirement')
  execute function public.trg_auto_rank_award();

-- Backfill: award any rank whose BoR is already recorded without an award
-- (as of this migration: exactly one row — Hazel Stollenwerk's Star).
insert into public.ledger_entries (scout_id, date, kind, code, label, "by", entered_by, notes)
select le.scout_id, le.date, 'rank_award', left(le.code, length(le.code) - 4),
       r.display_name || ' — rank awarded at Board of Review',
       le."by", le.entered_by,
       'Auto-award backfill: Board of Review was on record without a rank award (ledger #' || le.id || ')'
  from public.ledger_entries le
  join public.ranks r on r.id = left(le.code, length(le.code) - 4)
 where le.kind = 'rank_requirement'
   and le.code like '%-BoR'
   and le.archived_at is null
   and le.deleted_at is null
   and not exists (
     select 1 from public.ledger_entries a
      where a.scout_id = le.scout_id
        and a.kind = 'rank_award'
        and a.code = left(le.code, length(le.code) - 4)
        and a.archived_at is null
        and a.deleted_at is null
   );
