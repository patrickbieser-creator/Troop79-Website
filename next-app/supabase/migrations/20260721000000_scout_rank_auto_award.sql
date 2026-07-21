-- Auto-award Scout rank on completing all its requirements.
--
-- WHY (Patrick, 2026-07-21)
-- Every other rank (Tenderfoot through Eagle) auto-awards when a leader
-- records a `<rank>-BoR` requirement, because a Board of Review is the real,
-- distinct final step for those ranks (20260712040000). Scout rank has no
-- BoR — the Scoutmaster Conference (requirement 7) caps it, per BSA policy —
-- so that migration deliberately left Scout on a manual award entry. In
-- practice that manual step gets missed: Lily Porter completed all 17 Scout
-- requirements (including her Scoutmaster Conference) with no rank_award
-- ledger entry ever recorded, so the public site correctly, but confusingly,
-- showed her as not having earned a rank she had actually finished.
--
-- Mechanism: mirrors the BoR trigger's shape, but the completion SIGNAL is
-- different — instead of one specific requirement code, it's "every
-- requirement `rank_requirements` currently lists for Scout now has a live
-- ledger row for this scout." Total is read from rank_requirements at
-- trigger time, not hardcoded, so it stays correct if the requirement tree
-- is ever edited.
--
-- Notes (matching the BoR trigger's conventions):
--   * Idempotent: no award is created when a non-archived one already exists.
--   * One-way: archiving/deleting a requirement does NOT retract the award —
--     that stays a deliberate leader action in the ledger.
--   * Only reacts to rank_requirement rows for Scout; the row it inserts is
--     a rank_award, so there's no recursion.

create or replace function public.trg_auto_scout_rank_award()
  returns trigger as $func$
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
$func$ language plpgsql;

drop trigger if exists ledger_auto_scout_rank_award on public.ledger_entries;
create trigger ledger_auto_scout_rank_award
  after insert on public.ledger_entries
  for each row
  when (new.kind = 'rank_requirement' and new.code like 'scout-%')
  execute function public.trg_auto_scout_rank_award();

-- Backfill: award Scout rank to anyone who already has every requirement on
-- record without an award (as of this migration: Lily Porter). Credited to
-- whoever recorded that scout's most recent Scout-rank requirement, on that
-- requirement's date — the same "the last human action confers the award"
-- logic the live trigger applies going forward.
with qualifying as (
  select s.id as scout_id
  from public.scouts s
  where s.active
    and (select count(*) from public.rank_requirements where rank_id = 'scout')
        = (
          select count(distinct le.code) from public.ledger_entries le
          where le.scout_id = s.id and le.kind = 'rank_requirement' and le.code like 'scout-%'
            and le.archived_at is null and le.deleted_at is null
        )
    and not exists (
      select 1 from public.ledger_entries a
      where a.scout_id = s.id and a.kind = 'rank_award' and a.code = 'scout'
        and a.archived_at is null and a.deleted_at is null
    )
),
last_entry as (
  select distinct on (q.scout_id)
         q.scout_id, le.date, le."by", le.entered_by, le.id as source_ledger_id
  from qualifying q
  join public.ledger_entries le
    on le.scout_id = q.scout_id and le.kind = 'rank_requirement' and le.code like 'scout-%'
   and le.archived_at is null and le.deleted_at is null
  order by q.scout_id, le.date desc, le.id desc
)
insert into public.ledger_entries (scout_id, date, kind, code, label, "by", entered_by, notes)
select le.scout_id, le.date, 'rank_award', 'scout',
       r.display_name || ' — rank awarded (all requirements completed)',
       le."by", le.entered_by,
       'Auto-award backfill: all Scout rank requirements were already on record without an award (ledger #' || le.source_ledger_id || ')'
  from last_entry le
  join public.ranks r on r.id = 'scout';
