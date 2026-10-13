/**
 * /admin/reports — every report the leader can open, built from the Reports folder in nav-data (never a second list).
 * Adding a report to nav-data (folder: 'Reports') puts it here, on Home's Reports card and nowhere else to maintain.
 * Each report still guards itself with requireCapability(); this page only stops offering links that would refuse.
 */
import { resolveAdminActor } from '@/lib/admin-actor';
import { PageTitle } from '../_components/page-title';
import { ReportsLanding } from '../_components/reports-landing';
import { SECTIONS, visibleNavSections, folderEntries, isFullAdmin } from '../_components/nav-data';

export const metadata = {
  title: 'Reports — Troop 79'
};

export default async function ReportsPage() {
  const actor = await resolveAdminActor();
  const visible = actor
    ? visibleNavSections(SECTIONS, { fullAdmin: isFullAdmin(actor), capabilities: actor.capabilities })
    : [];

  return (
    <>
      <PageTitle back={null} title="Reports" sub="Audits, the weekly report, Court of Honor and exports." />
      <ReportsLanding entries={folderEntries(visible, 'Reports')} />
    </>
  );
}
