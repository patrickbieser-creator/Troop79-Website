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
 * Court of Honor — admin generate/edit/publish/correct (Patrick,
 * 2026-08-17). Sibling of the Weekly Advancement Report's actions.ts —
 * same shape, minus ScoutStanding (nothing to suppress; this report never
 * shows individual requirements in the first place) and plus a coh_history
 * upsert on publish (see publishCourtOfHonorAction).
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
    correctedBy: row.corrected_by
  };
}

const SELECT_COLUMNS =
  'id, start_date, end_date, status, content_json, content_md, note, generated_at, generated_by, published_at, published_by, corrected_at, corrected_by';

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
 *  COH (same reasoning as the Weekly Report's publishReportAction) — and,
 *  on success, marks every item it includes as presented in the existing
 *  Submit & Present system (see markItemsPresented in lib/court-of-honor.ts). */
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

  const published = data as unknown as RawRow;
  await markItemsPresented(supabase, published.content_json, published.end_date, actor.label);

  revalidate();
  return { ok: true, report: mapRow(published) };
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
