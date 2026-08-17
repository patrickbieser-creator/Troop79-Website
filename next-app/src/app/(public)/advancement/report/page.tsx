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
import styles from '../../library/library.module.css';
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
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>
          <Link href="/advancement">Advancement</Link>
          <span className={styles.kickerSep}>·</span>
          Weekly Report
        </p>
        <h1 className={styles.pageTitle}>Weekly Advancement Report</h1>
        {report && (
          <p className={styles.pageLede}>
            {formatMonthDayYear(report.startDate)} – {formatMonthDayYear(report.endDate)}
          </p>
        )}
        <div className={styles.headRule} />
      </div>

      <main className={styles.main}>
        {!report ? (
          <div className={reportStyles.emptyState}>
            <p>No report has been published yet — check back after the next one goes out.</p>
          </div>
        ) : (
          <>
            {report.note && (
              <div className={reportStyles.note}>
                <strong>Editor&rsquo;s note</strong>
                {report.note}
              </div>
            )}
            <PublicReportView report={report} basePath="/advancement/report" />
            <p style={{ marginTop: 24 }}>
              <Link className={styles.divLink} href="/advancement/report/archive">
                See past reports →
              </Link>
            </p>
          </>
        )}
      </main>
    </>
  );
}
