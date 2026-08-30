/**
 * /advancement/report/[id] — permalink for one past published report
 * (Plans/Weekly-Advancement-Report.md, Decision 2 — the archive keeps each
 * week reachable, not just the latest). A permalink to a report that's
 * still a draft, or doesn't exist, is a 404 — same "no leaking unpublished
 * content through a permalink" rule as the event/calendar draft pages.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { loadPublishedReportById } from '@/lib/advancement-report-store';
import { PublicReportView } from '../_components/PublicReportView';
import { formatMonthDayYear } from '@/lib/advancement-report';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import reportStyles from '../report.module.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await loadPublishedReportById(createAdminClient(), Number(id));
  if (!report) return { title: 'Weekly Advancement Report — Scout Troop 79' };
  return {
    title: `${formatMonthDayYear(report.startDate)} – ${formatMonthDayYear(report.endDate)} Advancement Report — Scout Troop 79`
  };
}

export default async function ArchivedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reportId = Number(id);
  if (!Number.isInteger(reportId)) notFound();

  const report = await loadPublishedReportById(createAdminClient(), reportId);
  if (!report) notFound();

  return (
    <>
      <PageHeader
        kicker={
          <>
            <Link href="/advancement">Advancement</Link>
            <KickerSep />
            <Link href="/advancement/report/archive">Weekly Reports</Link>
          </>
        }
        title="Weekly Advancement Report"
        lede={
          <>
            {formatMonthDayYear(report.startDate)} – {formatMonthDayYear(report.endDate)}
          </>
        }
      />

      <PageShell width="narrow">
        {report.note && (
          <Notice tone="warning" className={reportStyles.noticeGap}>
            <strong>Editor&rsquo;s note:</strong> {report.note}
          </Notice>
        )}
        <PublicReportView report={report} basePath={`/advancement/report/${report.id}`} />
      </PageShell>
    </>
  );
}
