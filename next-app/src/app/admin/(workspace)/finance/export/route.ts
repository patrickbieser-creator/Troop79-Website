/**
 * GET /admin/finance/export — full-ledger CSV download (Plans/Troop-Finances.md
 * Phase 2). Route Handler, not a Server Action — a real file download needs
 * a response with Content-Disposition, which a Server Action can't produce
 * directly (same reasoning as court-of-honor/export/route.ts).
 *
 * Treasurer-only (finance.manage, enforced inside exportLedgerCsvTextAction)
 * — this is the offline backup plan, not a family-facing feature.
 */
import { NextResponse } from 'next/server';
import { exportLedgerCsvTextAction } from '../actions';

import { centralToday } from '@/lib/dates';
export async function GET() {
  const csv = await exportLedgerCsvTextAction();
  const filename = `troop-finances-${centralToday()}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}
