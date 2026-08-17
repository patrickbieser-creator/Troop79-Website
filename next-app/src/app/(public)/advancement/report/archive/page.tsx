/**
 * /advancement/report/archive — every published Weekly Advancement Report,
 * newest first (Plans/Weekly-Advancement-Report.md, Decision 2).
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { loadPublishedArchive } from '@/lib/advancement-report-store';
import { formatMonthDayYear } from '@/lib/advancement-report';
import styles from '../../../library/library.module.css';
import reportStyles from '../report.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Advancement Report Archive — Scout Troop 79',
  description: 'Every past Weekly Advancement Report for Scout Troop 79.'
};

export default async function ReportArchivePage() {
  const reports = await loadPublishedArchive(createAdminClient());

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>
          <Link href="/advancement">Advancement</Link>
          <span className={styles.kickerSep}>·</span>
          <Link href="/advancement/report">Weekly Report</Link>
        </p>
        <h1 className={styles.pageTitle}>Report Archive</h1>
        <p className={styles.pageLede}>Every Weekly Advancement Report Troop 79 has published.</p>
        <div className={styles.headRule} />
      </div>

      <main className={styles.main}>
        {reports.length === 0 ? (
          <div className={reportStyles.emptyState}>
            <p>No reports have been published yet.</p>
          </div>
        ) : (
          <ul className={reportStyles.archiveList}>
            {reports.map((r) => (
              <li key={r.id}>
                <Link href={`/advancement/report/${r.id}`} className={reportStyles.archiveRow}>
                  <span className={reportStyles.archiveRange}>
                    {formatMonthDayYear(r.startDate)} – {formatMonthDayYear(r.endDate)}
                  </span>
                  <span className={reportStyles.archiveDate}>
                    Published {formatMonthDayYear(r.publishedAt.slice(0, 10))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
