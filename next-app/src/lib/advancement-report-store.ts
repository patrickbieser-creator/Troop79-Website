/**
 * Plain reads of `advancement_reports` — shared between the public report
 * pages and anywhere else that just needs to look one up, no capability
 * gate. Mutations and gated reads (drafts, the recent-reports list) live in
 * admin/advancement/report/actions.ts instead — that file is 'use server'
 * and every export requires `advancement.write`; this one is a plain
 * library module a Server Component can call directly, same split as
 * lib/library-data.ts vs admin/library/actions.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdvancementReport } from './advancement-report';

export interface PublishedReport {
  id: number;
  startDate: string;
  endDate: string;
  contentJson: AdvancementReport;
  contentMd: string;
  note: string | null;
  publishedAt: string;
}

interface RawRow {
  id: number;
  start_date: string;
  end_date: string;
  content_json: AdvancementReport;
  content_md: string;
  note: string | null;
  published_at: string;
}

function mapRow(row: RawRow): PublishedReport {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    contentJson: row.content_json,
    contentMd: row.content_md,
    note: row.note,
    publishedAt: row.published_at
  };
}

const SELECT_COLUMNS = 'id, start_date, end_date, content_json, content_md, note, published_at';

export async function loadLatestPublishedReport(supabase: SupabaseClient): Promise<PublishedReport | null> {
  const { data } = await supabase
    .from('advancement_reports')
    .select(SELECT_COLUMNS)
    .eq('status', 'published')
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? mapRow(data as unknown as RawRow) : null;
}

export async function loadPublishedReportById(supabase: SupabaseClient, id: number): Promise<PublishedReport | null> {
  const { data } = await supabase
    .from('advancement_reports')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle();
  return data ? mapRow(data as unknown as RawRow) : null;
}

export interface ArchiveEntry {
  id: number;
  startDate: string;
  endDate: string;
  publishedAt: string;
}

export async function loadPublishedArchive(supabase: SupabaseClient): Promise<ArchiveEntry[]> {
  const { data } = await supabase
    .from('advancement_reports')
    .select('id, start_date, end_date, published_at')
    .eq('status', 'published')
    .order('end_date', { ascending: false });
  return ((data ?? []) as { id: number; start_date: string; end_date: string; published_at: string }[]).map((r) => ({
    id: r.id,
    startDate: r.start_date,
    endDate: r.end_date,
    publishedAt: r.published_at
  }));
}
