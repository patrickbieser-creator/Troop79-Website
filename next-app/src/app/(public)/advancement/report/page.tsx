/**
 * /advancement/report — the latest published Weekly Advancement Report
 * (Plans/Weekly-Advancement-Report.md). Fully public, no gate — same
 * posture as /advancement and /library (D-040).
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { loadLatestPublishedReport } from '@/lib/advancement-report-store';
import { PublicReportView } from './_components/PublicReportView';
import { formatMonthDayYear } from '@/lib/advancement-report';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { EmptyState } from '@/app/_components/empty-state';
import reportStyles from './report.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Weekly Advancement Report — Scout Troop 79',
  description: 'What Troop 79 scouts earned this week — ranks, merit badges, and requirements signed off.'
};

export default async function LatestReportPage() {
  const report = await loadLatestPublishedReport(createAdminClient());

  return (
    <>
      <PageHeader
        kicker={
          <>
            <Link href="/advancement">Advancement</Link>
            <KickerSep />
            Weekly Report
          </>
        }
        title="Weekly Advancement Report"
        lede={
          report ? (
            <>
              {formatMonthDayYear(report.startDate)} – {formatMonthDayYear(report.endDate)}
            </>
          ) : undefined
        }
      />

      <PageShell>
        {!report ? (
          <EmptyState>No report has been published yet — check back after the next one goes out.</EmptyState>
        ) : (
          <>
            {report.note && (
              <Notice tone="warning" className={reportStyles.noticeGap}>
                <strong>Editor&rsquo;s note:</strong> {report.note}
              </Notice>
            )}
            <PublicReportView report={report} basePath="/advancement/report" />
            <p style={{ marginTop: 24 }}>
              <Button variant="ghost" href="/advancement/report/archive">
                See past reports →
              </Button>
            </p>
          </>
        )}
      </PageShell>
    </>
  );
}
