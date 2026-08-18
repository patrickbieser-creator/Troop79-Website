/**
 * GET /admin/advancement/court-of-honor/export?id={reportId} — CSV
 * download for a Court of Honor report (Patrick, 2026-08-17). A Route
 * Handler rather than a Server Action because triggering a real file
 * download from a click needs a response with Content-Disposition, which
 * a Server Action can't produce directly.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import type { AdvancementReport } from '@/lib/advancement-report';
import { toCsv } from '@/lib/court-of-honor';

export async function GET(request: NextRequest) {
  await requireCapability('advancement.write');

  const id = Number(request.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Missing or invalid id' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('court_of_honor_reports')
    .select('start_date, end_date, content_json')
    .eq('id', id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

  const row = data as { start_date: string; end_date: string; content_json: AdvancementReport };
  const csv = toCsv(row.content_json);
  const filename = `court-of-honor-${row.start_date}-to-${row.end_date}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}
