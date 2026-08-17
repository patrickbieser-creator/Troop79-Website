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
import styles from '../../../library/library.module.css';
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
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>
          <Link href="/advancement">Advancement</Link>
          <span className={styles.kickerSep}>·</span>
          <Link href="/advancement/report/archive">Weekly Reports</Link>
        </p>
        <h1 className={styles.pageTitle}>Weekly Advancement Report</h1>
        <p className={styles.pageLede}>
          {formatMonthDayYear(report.startDate)} – {formatMonthDayYear(report.endDate)}
        </p>
        <div className={styles.headRule} />
      </div>

      <main className={styles.main}>
        {report.note && (
          <div className={reportStyles.note}>
            <strong>Editor&rsquo;s note</strong>
            {report.note}
          </div>
        )}
        <PublicReportView report={report} basePath={`/advancement/report/${report.id}`} />
      </main>
    </>
  );
}
