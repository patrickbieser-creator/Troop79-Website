-- Reclassify the Lapham Peak ski outings from Campout to Day Outing.
--
-- WHY (Patrick, 2026-07-25)
-- Both years of the troop's Lapham Peak ski trip — EV:Ac003 "Skiing Lapham
-- March '23" (10 scouts) and EV:Ac016 "Skiing Lapham Feb '25" (24 scouts) —
-- were recorded during the historical spreadsheet backfill as camping_nights
-- (qty=2 nights). It was a day ski outing, never an overnight campout. The
-- legacy import source (data/advancement.json) actually tagged this entry
-- "Outing", not "Camp" — the backfill script categorized it wrong despite
-- its own source data saying otherwise.
--
-- Scoped to these two exact codes so nothing else recorded as camping_nights
-- is touched. qty/unit reset to the day_outing convention (1/event) used by
-- every other day_outing row in the ledger, per Patrick's confirmation this
-- was a pure day trip with no overnight component.
--
-- camping_nights / activity-thresholds are both derived live from
-- ledger_entries at read time (scout_summary view, ledger_active view) — no
-- separate recompute needed once this lands. Worth a spot-check of the
-- Second Class / First Class "campouts" activity-thresholds audit for any
-- affected scout who was borderline on that count.

update public.ledger_entries
set kind = 'day_outing',
    qty = 1,
    unit = 'event'
where code in ('EV:Ac003', 'EV:Ac016')
  and kind = 'camping_nights';
