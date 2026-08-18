/**
 * Court of Honor report (Patrick, 2026-08-17). A ceremony-oriented sibling
 * of the Weekly Advancement Report — same content shape and rendering
 * (buildReport/buildScoutView/toMarkdown/ScoutAccordion, all reused
 * directly, no duplication), but:
 *   - completed ranks + merit badges + special awards ONLY, never
 *     individual requirements (nothing to suppress here — buildReport
 *     naturally produces empty rankReqs/badgeReqs since this loader never
 *     loads a _requirement kind row).
 *   - filtered by `date` (earned), not `entered_at` — confirmed with
 *     Patrick this is deliberately different from the Weekly Report: a
 *     ceremony recognizes what actually happened in the period, regardless
 *     of when a leader got around to recording it.
 *   - "special awards" scoped to the `award` kind only, not leadership or
 *     the logistics kinds (camping nights/service hours/hiking miles) —
 *     those would read as noise at a ceremony even though the Weekly
 *     Report tracks them.
 *
 * IMPORT_BATCH_ENTERED_BY exclusion (advancement-report.ts) is deliberately
 * NOT applied here — that exclusion exists because entered_at is unreliable
 * for historical migration rows, but this loader never filters on
 * entered_at at all. `date` was independently verified correct for those
 * same rows, so a historical import's real earned date is legitimate
 * content for a retroactively-generated Court of Honor covering that period.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';
import {
  tagKind,
  shapeRankAwardRow,
  shapeBadgeAwardRow,
  buildReport,
  formatMonthDayYear,
  type AdvancementEntry,
  type AdvancementReport,
  type AwardGroup,
  type ReportRange,
  type RawLedgerRow
} from '@/lib/advancement-report';

function cleanLabel(label: string): string {
  return label.replace(/[.*]+$/, '').trim();
}

export async function loadCourtOfHonorEntries(supabase: SupabaseClient, range: ReportRange): Promise<AdvancementEntry[]> {
  const kinds = ['rank_award', 'merit_badge_award', 'award'];

  const rawRows = await fetchAllRows<RawLedgerRow>((from, to) =>
    supabase
      .from('ledger_entries')
      .select('id, scout_id, kind, code, label, qty, unit, date, entered_at')
      .in('kind', kinds)
      .gte('date', range.startDate)
      .lte('date', range.endDate)
      .is('archived_at', null)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, to)
  );
  if (rawRows.length === 0) return [];

  const scoutIds = Array.from(new Set(rawRows.map((r) => r.scout_id)));
  const [{ data: scoutRows }, { data: rankRows }, { data: mbRows }] = await Promise.all([
    supabase.from('scouts').select('id, display_name').in('id', scoutIds),
    supabase.from('ranks').select('id, display_name'),
    supabase.from('merit_badges').select('id, name, eagle')
  ]);

  const scoutNameById = new Map(((scoutRows ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const rankLabelById = new Map(((rankRows ?? []) as { id: string; display_name: string }[]).map((r) => [r.id, r.display_name]));
  const mbById = new Map(((mbRows ?? []) as { id: string; name: string; eagle: boolean }[]).map((m) => [m.id, m]));

  const out: AdvancementEntry[] = [];
  for (const r of rawRows) {
    const scoutName = scoutNameById.get(r.scout_id);
    if (!scoutName) continue; // scout record missing/merged — skip rather than crash a report

    if (r.kind === 'rank_award') {
      out.push(shapeRankAwardRow(r, scoutName, rankLabelById));
    } else if (r.kind === 'merit_badge_award') {
      out.push(shapeBadgeAwardRow(r, scoutName, mbById));
    } else {
      // 'award' — special/one-off recognitions (Mile Swim, religious
      // emblems, etc.) — same generic shaping as the Weekly Report's
      // Section 5 catch-all, minus the qty/unit detail string (that's a
      // logistics-kind-only concept; awards don't carry a qty).
      const label = cleanLabel(r.label ?? r.code);
      out.push(
        tagKind(
          {
            id: r.id,
            scoutId: r.scout_id,
            scoutName,
            code: r.code,
            label,
            group: label,
            eagle: false,
            enteredAt: r.entered_at.slice(0, 10),
            date: r.date,
            detail: null
          },
          'award'
        )
      );
    }
  }
  return out;
}

/** One-shot: load + build, what the admin's "Generate" action calls. No
 *  ScoutStanding needed (unlike the Weekly Report) — there are no
 *  individual requirement rows here to suppress in the first place. */
export async function generateCourtOfHonor(supabase: SupabaseClient, range: ReportRange): Promise<AdvancementReport> {
  const entries = await loadCourtOfHonorEntries(supabase, range);
  return buildReport(entries);
}

/** A leading =, +, -, or @ is interpreted as a formula by Excel/Sheets on
 *  open — CSV/formula injection (qa-lead review, 2026-08-17). Scout/award
 *  names are leader-entered, not public-submitted, so the risk here is low,
 *  but this file is explicitly downloaded and opened in Excel, so it's
 *  cheap insurance: prefix with a single quote, the standard mitigation,
 *  which Excel displays as plain text rather than evaluating. */
function csvField(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvRow(fields: string[]): string {
  return fields.map(csvField).join(',') + '\r\n';
}

/** Noon America/Chicago on a given yyyy-mm-dd, as a UTC ISO timestamp — DST
 *  aware via Intl rather than a hardcoded offset (CDT is -05:00, CST is
 *  -06:00; a fixed offset would only be right for half the year — same
 *  mistake this project's entered_at backfill migration deliberately
 *  avoided by letting Postgres's own tz database handle it; this is the
 *  JS-side equivalent for code that isn't writing raw SQL). */
export function noonCentralIso(dateStr: string): string {
  const offsetLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'shortOffset'
  })
    .formatToParts(new Date(`${dateStr}T12:00:00Z`))
    .find((p) => p.type === 'timeZoneName')?.value; // "GMT-5" or "GMT-6"
  const offsetHours = Number((offsetLabel ?? 'GMT-6').replace('GMT', ''));
  const padded = String(Math.abs(offsetHours)).padStart(2, '0');
  return `${dateStr}T12:00:00${offsetHours < 0 ? '-' : '+'}${padded}:00`;
}

/** Every ledger_entries id a report's ranks/badges/leadership/awards
 *  reference — pure, no DB — split out from markItemsPresented so the id
 *  collection itself (the part most likely to silently miss a section if
 *  this report shape ever grows a new one) is independently testable. */
export function collectPresentableEntryIds(report: AdvancementReport): number[] {
  return [
    ...report.ranksEarned.flatMap((g) => g.entries.map((e) => e.id)),
    ...report.badgesEarned.flatMap((g) => g.entries.map((e) => e.id)),
    ...report.leadership.flatMap((g) => g.entries.map((e) => e.id)),
    ...report.otherAwards.flatMap((g) => g.entries.map((e) => e.id))
  ];
}

/**
 * Stamp `presented_at`/`presented_by` on every ledger_entries row a
 * published Court of Honor includes (Patrick, 2026-08-17) — wiring publish
 * into the pre-existing "Submit & Present" system
 * (/admin/advancement/records, setPresented() in
 * app/admin/(workspace)/advancement/ledger/actions.ts) rather than
 * inventing a parallel concept. Two rules, both confirmed with Patrick:
 *   - presented_at is the CEREMONY date (the report's end_date), not the
 *     moment someone clicks Publish — a COH can take days of prep and
 *     discussion before it's finalized, but "presented" should reflect
 *     when the scout actually received it.
 *   - Only fills in rows where presented_at IS NULL — never overwrites an
 *     individual leader's earlier "handed out separately" mark. Matches
 *     ledger/actions.ts's own framing of `presented` as an independent,
 *     one-way human confirmation, not something a bulk action should undo.
 * Best-effort: a failure here must not undo the publish itself (the report
 * row is already saved by the time this runs) — logged, not thrown.
 */
export async function markItemsPresented(
  supabase: SupabaseClient,
  report: AdvancementReport,
  ceremonyEndDate: string,
  presentedBy: string
): Promise<void> {
  const ids = collectPresentableEntryIds(report);
  if (ids.length === 0) return;

  try {
    await supabase
      .from('ledger_entries')
      .update({ presented_at: noonCentralIso(ceremonyEndDate), presented_by: presentedBy })
      .in('id', ids)
      .is('presented_at', null);
  } catch (err) {
    console.error('markItemsPresented failed (non-fatal, COH is already published):', err);
  }
}

/** CSV export — one row per scout per item earned, grouped by type in the
 *  same order the category view renders (ranks, then badges, then
 *  awards). Each group's scoutNames are already alphabetically sorted by
 *  groupAward(), so this reads in a sensible deterministic order without
 *  needing its own sort pass. */
export function toCsv(report: AdvancementReport): string {
  let out = csvRow(['Scout', 'Type', 'Item', 'Date Earned']);

  function addGroup(groups: AwardGroup[], type: string) {
    for (const g of groups) {
      g.scoutNames.forEach((name, i) => {
        out += csvRow([name, type, g.name, formatMonthDayYear(g.entries[i].date)]);
      });
    }
  }

  addGroup(report.ranksEarned, 'Rank');
  addGroup(report.badgesEarned, 'Merit Badge');
  addGroup(report.leadership, 'Leadership');
  addGroup(report.otherAwards, 'Award');

  return out;
}
