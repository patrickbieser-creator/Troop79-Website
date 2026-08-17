/**
 * /admin/advancement/report — Weekly Advancement Report
 * (Plans/Weekly-Advancement-Report.md). Generate a consolidated summary of
 * a date range's sign-offs for the Bugle newsletter and the public site,
 * with a category view and a scout-centric accordion view, edit before
 * publishing, publish, or correct an already-published report.
 */
import { requireCapability } from '@/lib/require-capability';
import { listReportsAction, getLastPublishedEndDateAction, getReportAction } from './actions';
import { ReportWorkspace } from './report-workspace';
import styles from './report.module.css';

export const metadata = {
  title: 'Weekly Advancement Report — Troop 79'
};

export default async function AdvancementReportPage({
  searchParams
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  await requireCapability('advancement.write');
  const { id } = await searchParams;

  const [reports, lastPublishedEnd] = await Promise.all([listReportsAction(), getLastPublishedEndDateAction()]);
  const reportId = id ? Number(id) : reports[0]?.status === 'draft' ? reports[0].id : null;
  const initialReport = reportId ? await getReportAction(reportId) : null;

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Weekly Advancement Report</h1>
        <p>
          Generate a consolidated summary of what got signed off in a date range — for the Bugle
          and the public site. Filters on when a leader recorded something, not when the scout
          actually did it, so a late entry or correction always lands in the report you run this
          week, not a past one nobody re-runs.
        </p>
      </div>

      <ReportWorkspace initialReport={initialReport} recentReports={reports} lastPublishedEnd={lastPublishedEnd} />
    </>
  );
}
