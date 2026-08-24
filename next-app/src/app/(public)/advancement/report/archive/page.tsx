/**
 * /advancement/report/archive — every published Weekly Advancement Report,
 * newest first (Plans/Weekly-Advancement-Report.md, Decision 2).
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { loadPublishedArchive } from '@/lib/advancement-report-store';
import { formatMonthDayYear } from '@/lib/advancement-report';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { EmptyState } from '@/app/_components/empty-state';
import { fmtDateLong } from '@/lib/format-date';
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
      <PageHeader
        kicker={
          <>
            <Link href="/advancement">Advancement</Link>
            <KickerSep />
            <Link href="/advancement/report">Weekly Report</Link>
          </>
        }
        title="Report Archive"
        lede="Every Weekly Advancement Report Troop 79 has published."
      />

      <PageShell>
        {reports.length === 0 ? (
          <EmptyState>No reports have been published yet.</EmptyState>
        ) : (
          <ul className={reportStyles.archiveList}>
            {reports.map((r) => (
              <li key={r.id}>
                <Link href={`/advancement/report/${r.id}`} className={reportStyles.archiveRow}>
                  <span className={reportStyles.archiveRange}>
                    {formatMonthDayYear(r.startDate)} – {formatMonthDayYear(r.endDate)}
                  </span>
                  <span className={reportStyles.archiveDate}>
                    Published {fmtDateLong(r.publishedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageShell>
    </>
  );
}
