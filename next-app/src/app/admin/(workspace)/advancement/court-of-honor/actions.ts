'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import {
  toMarkdown,
  removeScoutFromReport,
  type AdvancementReport,
  type ReportRange,
  type RemoveScoutTarget
} from '@/lib/advancement-report';
import { generateCourtOfHonor, markItemsPresented } from '@/lib/court-of-honor';

/**
 * Court of Honor — admin generate/edit/publish/present (Patrick,
 * 2026-08-17). Sibling of the Weekly Advancement Report's actions.ts —
 * same shape, minus ScoutStanding (nothing to suppress; this report never
 * shows individual requirements in the first place).
 *
 * PUBLISH and PRESENT ARE DELIBERATELY SEPARATE ACTIONS, not one step
 * (Patrick, 2026-08-17, after the first version bundled them): Court of
 * Honor ceremonies happen outdoors and get rained out/rescheduled.
 * Publishing finalizes the report's content — useful for printing and prep
 * ahead of the actual ceremony, and nothing about it should imply the
 * ceremony happened. Only markCourtOfHonorPresentedAction, an explicit
 * separate click a leader makes AFTER the ceremony actually occurred,
 * stamps ledger_entries.presented_at/presented_by (via
 * lib/court-of-honor.ts's markItemsPresented). It takes the presentation
 * date as an argument rather than assuming the report's own end_date, so a
 * reschedule doesn't leave the wrong date on record.
 */

const PATHS = ['/admin/advancement/court-of-honor'];
function revalidate() {
  for (const p of PATHS) revalidatePath(p);
}

interface Result {
  ok: boolean;
  error?: string;
}

export interface CourtOfHonorRow {
  id: number;
  startDate: string;
  endDate: string;
  status: 'draft' | 'published';
  contentJson: AdvancementReport;
  contentMd: string;
  note: string | null;
  generatedAt: string;
  generatedBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  correctedAt: string | null;
  correctedBy: string | null;
  presentedAt: string | null;
  presentedBy: string | null;
}

interface RawRow {
  id: number;
  start_date: string;
  end_date: string;
  status: 'draft' | 'published';
  content_json: AdvancementReport;
  content_md: string;
  note: string | null;
  generated_at: string;
  generated_by: string | null;
  published_at: string | null;
  published_by: string | null;
  corrected_at: string | null;
  corrected_by: string | null;
  presented_at: string | null;
  presented_by: string | null;
}

function mapRow(row: RawRow): CourtOfHonorRow {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    contentJson: row.content_json,
    contentMd: row.content_md,
    note: row.note,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    correctedAt: row.corrected_at,
    correctedBy: row.corrected_by,
    presentedAt: row.presented_at,
    presentedBy: row.presented_by
  };
}

const SELECT_COLUMNS =
  'id, start_date, end_date, status, content_json, content_md, note, generated_at, generated_by, published_at, published_by, corrected_at, corrected_by, presented_at, presented_by';

export async function generateCourtOfHonorAction(
  startDate: string,
  endDate: string
): Promise<Result & { report?: CourtOfHonorRow }> {
  const actor = await requireCapability('advancement.write');
  if (!startDate || !endDate) return { ok: false, error: 'Pick a start and end date.' };
  if (startDate > endDate) return { ok: false, error: 'The start date must be on or before the end date.' };

  const supabase = createAdminClient();
  const range: ReportRange = { startDate, endDate };
  const report = await generateCourtOfHonor(supabase, range);
  const contentMd = toMarkdown(report, range, null);

  const { data, error } = await supabase
    .from('court_of_honor_reports')
    .insert({
      start_date: startDate,
      end_date: endDate,
      status: 'draft',
      content_json: report,
      content_md: contentMd,
      generated_by: actor.label
    })
    .select(SELECT_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not generate the report.' };

  revalidate();
  return { ok: true, report: mapRow(data as unknown as RawRow) };
}

export async function regenerateCourtOfHonorAction(
  reportId: number,
  startDate: string,
  endDate: string
): Promise<Result & { report?: CourtOfHonorRow }> {
  const actor = await requireCapability('advancement.write');
  if (startDate > endDate) return { ok: false, error: 'The start date must be on or before the end date.' };

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('court_of_honor_reports')
    .select('status, note')
    .eq('id', reportId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Report not found.' };
  if (existing.status === 'published') {
    return { ok: false, error: 'This report is already published — use Correct instead of regenerating.' };
  }

  const range: ReportRange = { startDate, endDate };
  const report = await generateCourtOfHonor(supabase, range);
  const contentMd = toMarkdown(report, range, existing.note ?? null);

  const { data, error } = await supabase
    .from('court_of_honor_reports')
    .update({
      start_date: startDate,
      end_date: endDate,
      content_json: report,
      content_md: contentMd,
      generated_at: new Date().toISOString(),
      generated_by: actor.label
    })
    .eq('id', reportId)
    .select(SELECT_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not regenerate the report.' };

  revalidate();
  return { ok: true, report: mapRow(data as unknown as RawRow) };
}

export async function removeScoutFromCohAction(
  reportId: number,
  target: RemoveScoutTarget
): Promise<Result & { report?: CourtOfHonorRow }> {
  const actor = await requireCapability('advancement.write');
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('court_of_honor_reports')
    .select(SELECT_COLUMNS)
    .eq('id', reportId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Report not found.' };

  const row = existing as unknown as RawRow;
  const report = row.content_json;
  removeScoutFromReport(report, target);
  const range: ReportRange = { startDate: row.start_date, endDate: row.end_date };
  const contentMd = toMarkdown(report, range, row.note);

  const patch: Record<string, unknown> = { content_json: report, content_md: contentMd };
  if (row.status === 'published') {
    patch.corrected_at = new Date().toISOString();
    patch.corrected_by = actor.label;
  }

  const { data, error } = await supabase
    .from('court_of_honor_reports')
    .update(patch)
    .eq('id', reportId)
    .select(SELECT_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save that change.' };

  revalidate();
  return { ok: true, report: mapRow(data as unknown as RawRow) };
}

export async function saveCohNoteAction(reportId: number, note: string): Promise<Result & { report?: CourtOfHonorRow }> {
  const actor = await requireCapability('advancement.write');
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('court_of_honor_reports')
    .select(SELECT_COLUMNS)
    .eq('id', reportId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Report not found.' };

  const row = existing as unknown as RawRow;
  const trimmed = note.trim() || null;
  const range: ReportRange = { startDate: row.start_date, endDate: row.end_date };
  const contentMd = toMarkdown(row.content_json, range, trimmed);

  const patch: Record<string, unknown> = { note: trimmed, content_md: contentMd };
  if (row.status === 'published') {
    patch.corrected_at = new Date().toISOString();
    patch.corrected_by = actor.label;
  }

  const { data, error } = await supabase
    .from('court_of_honor_reports')
    .update(patch)
    .eq('id', reportId)
    .select(SELECT_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the note.' };

  revalidate();
  return { ok: true, report: mapRow(data as unknown as RawRow) };
}

/** Publish a draft. Refuses if its date range overlaps an already-published
 *  COH (same reasoning as the Weekly Report's publishReportAction).
 *  Finalizes the report's CONTENT only — never touches
 *  ledger_entries.presented_at. See markCourtOfHonorPresentedAction below
 *  for the separate, explicit confirmation that the ceremony happened. */
export async function publishCourtOfHonorAction(reportId: number): Promise<Result & { report?: CourtOfHonorRow }> {
  const actor = await requireCapability('advancement.write');
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('court_of_honor_reports')
    .select('start_date, end_date, status')
    .eq('id', reportId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Report not found.' };
  if (existing.status === 'published') return { ok: false, error: 'This report is already published.' };

  const { data: overlaps } = await supabase
    .from('court_of_honor_reports')
    .select('start_date, end_date')
    .eq('status', 'published')
    .lte('start_date', existing.end_date)
    .gte('end_date', existing.start_date)
    .limit(1);
  if (overlaps && overlaps.length > 0) {
    const o = overlaps[0] as { start_date: string; end_date: string };
    return {
      ok: false,
      error: `This date range overlaps an already-published Court of Honor (${o.start_date} – ${o.end_date}). Adjust the range and regenerate before publishing.`
    };
  }

  const { data, error } = await supabase
    .from('court_of_honor_reports')
    .update({ status: 'published', published_at: new Date().toISOString(), published_by: actor.label })
    .eq('id', reportId)
    .select(SELECT_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not publish the report.' };

  revalidate();
  return { ok: true, report: mapRow(data as unknown as RawRow) };
}

/**
 * The explicit, separate confirmation that the ceremony actually happened
 * (Patrick, 2026-08-17 — see the module header for why this is not folded
 * into publish). Only callable on an already-published report — presenting
 * something whose content isn't even finalized yet doesn't make sense.
 * `presentationDate` defaults to the report's own end_date in the UI but is
 * a real argument here, not re-derived, so a rain-delay reschedule can be
 * confirmed with the ACTUAL date the awards went out. Safe to click more
 * than once (e.g. after a late correction adds a scout back in) — the
 * underlying markItemsPresented only fills ledger rows not already marked.
 */
export async function markCourtOfHonorPresentedAction(
  reportId: number,
  presentationDate: string
): Promise<Result & { report?: CourtOfHonorRow }> {
  const actor = await requireCapability('advancement.write');
  if (!presentationDate) return { ok: false, error: 'Pick the date the awards were actually presented.' };

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('court_of_honor_reports')
    .select(SELECT_COLUMNS)
    .eq('id', reportId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Report not found.' };

  const row = existing as unknown as RawRow;
  if (row.status !== 'published') {
    return { ok: false, error: 'Publish this report before confirming it was presented.' };
  }

  await markItemsPresented(supabase, row.content_json, presentationDate, actor.label);

  const { data, error } = await supabase
    .from('court_of_honor_reports')
    .update({ presented_at: new Date().toISOString(), presented_by: actor.label })
    .eq('id', reportId)
    .select(SELECT_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Marked the items, but could not save the confirmation.' };

  revalidate();
  return { ok: true, report: mapRow(data as unknown as RawRow) };
}

export async function listCourtOfHonorReportsAction(): Promise<CourtOfHonorRow[]> {
  await requireCapability('advancement.write');
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('court_of_honor_reports')
    .select(SELECT_COLUMNS)
    .order('end_date', { ascending: false })
    .limit(30);
  return ((data ?? []) as unknown as RawRow[]).map(mapRow);
}

export async function getCourtOfHonorAction(reportId: number): Promise<CourtOfHonorRow | null> {
  await requireCapability('advancement.write');
  const supabase = createAdminClient();
  const { data } = await supabase.from('court_of_honor_reports').select(SELECT_COLUMNS).eq('id', reportId).maybeSingle();
  return data ? mapRow(data as unknown as RawRow) : null;
}

/** The most recent PUBLISHED Court of Honor's end date — default next
 *  start date, same "remember the last one" pattern as the Weekly Report. */
export async function getLastPublishedCohEndDateAction(): Promise<string | null> {
  await requireCapability('advancement.write');
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('court_of_honor_reports')
    .select('end_date')
    .eq('status', 'published')
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { end_date: string } | null)?.end_date ?? null;
}
