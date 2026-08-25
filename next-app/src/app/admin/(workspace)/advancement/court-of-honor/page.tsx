/**
 * /admin/advancement/court-of-honor — Court of Honor report (Patrick,
 * 2026-08-17). Completed ranks + merit badges + special awards for a date
 * range, filtered by when each thing was actually EARNED — a ceremony
 * recognizes what happened in the period, not when a leader got around to
 * recording it (the opposite rule from the Weekly Advancement Report,
 * deliberately). Admin-only — not asked to be public-facing.
 */
import { requireCapability } from '@/lib/require-capability';
import { listCourtOfHonorReportsAction, getLastPublishedCohEndDateAction, getCourtOfHonorAction } from './actions';
import { CourtOfHonorWorkspace } from './court-of-honor-workspace';
import { PageTitle } from '../../_components/page-title';

export const metadata = {
  title: 'Court of Honor — Troop 79'
};

export default async function CourtOfHonorPage({
  searchParams
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  await requireCapability('advancement.write');
  const { id } = await searchParams;

  const [reports, lastPublishedEnd] = await Promise.all([
    listCourtOfHonorReportsAction(),
    getLastPublishedCohEndDateAction()
  ]);
  const reportId = id ? Number(id) : reports[0]?.status === 'draft' ? reports[0].id : null;
  const initialReport = reportId ? await getCourtOfHonorAction(reportId) : null;

  return (
    <>
      <PageTitle back={null}
        title="Court of Honor"
        sub={
          <>
            Completed ranks, merit badges, and special awards (Mile Swim and similar) for a date
            range — filtered by when each was actually earned, not when it was recorded. Individual
            requirements are never shown here; that&rsquo;s the Weekly Advancement Report&rsquo;s
            job.
          </>
        }
      />

      <CourtOfHonorWorkspace initialReport={initialReport} recentReports={reports} lastPublishedEnd={lastPublishedEnd} />
    </>
  );
}
