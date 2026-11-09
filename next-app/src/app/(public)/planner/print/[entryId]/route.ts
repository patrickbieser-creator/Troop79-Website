/**
 * GET /planner/print/<entryId> — the meeting plan as a PDF, on demand, for any published troop meeting past or future
 * (Patrick, 2026-11-09). Same gate as the planner (meeting_planner view, edit or seed). Built AS OF THE MEETING: ranks
 * and advancement from ledger rows dated before it, so a reprint after sign-offs start still shows the plan.
 */
import { createElement, type ReactElement } from 'react';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { resolveAdminActor } from '@/lib/admin-actor';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { createAdminClient } from '@/lib/supabase/server';
import { loadMeetingById } from '@/lib/meeting-board';
import { loadPlannerLists } from '@/lib/people-lists';
import { loadThisWeekData } from '@/lib/this-week-db';
import { buildThisWeek } from '@/lib/this-week';
import { buildPrintPlan } from '@/lib/meeting-print';
import { fmtDateFull, fmtDateTime } from '@/lib/format-date';
import { PlanPdf } from './plan-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const actor = await resolveAdminActor();
  if (!actor) return new Response('Sign in to print a meeting plan.', { status: 401 });
  if (!plannerAccess(actor).canView) return new Response('You don’t have access to the Meeting Planner.', { status: 403 });

  const entryId = Number((await params).entryId);
  if (!Number.isInteger(entryId) || entryId <= 0) return new Response('No such meeting.', { status: 404 });

  const sb = createAdminClient();
  const lists = await loadPlannerLists();
  const [{ data: entry }, meeting] = await Promise.all([
    sb.from('calendar_entries').select('category, status').eq('id', entryId).maybeSingle(),
    loadMeetingById(sb, entryId)
  ]);
  const e = entry as { category: string | null; status: string } | null;
  if (!meeting || meeting.closed || !e || e.status !== 'published' || !lists.meetingLabels.includes(e.category ?? '')) {
    return new Response('No such meeting.', { status: 404 });
  }

  const data = await loadThisWeekData(sb, meeting, lists, undefined, { asOfMeeting: true });
  const plan = buildPrintPlan(buildThisWeek(data.input), {
    title: meeting.title,
    dateLabel: fmtDateFull(meeting.date),
    printedAt: fmtDateTime(new Date().toISOString(), { zone: true })
  });
  const pdf = await renderToBuffer(createElement(PlanPdf, { plan }) as unknown as ReactElement<DocumentProps>);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="troop79-meeting-plan-${meeting.date}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
