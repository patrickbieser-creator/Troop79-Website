/**
 * /admin/everything — Everything A–Z (Plans/Completed/Admin-Portal-Nav.md decision 9): every item this person can open, from
 * the feature registry, alphabetically. Opened from the rail's last entry.
 */
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { PageTitle } from '../_components/page-title';
import { visibleFeaturesFor } from '../_components/nav-visibility';
import { azEntries } from './az';
import { EverythingIndex } from './everything-index';

export const metadata = { title: 'Everything A–Z — Troop 79' };

export default async function EverythingPage() {
  const actor = await resolveAdminActor();
  if (!actor) redirect('/admin/login');
  const entries = azEntries(await visibleFeaturesFor(actor));
  return (
    <>
      <PageTitle back={null} title="Everything A–Z" sub={`All ${entries.length} screens, reports, tasks and setup pages you can open.`} />
      <EverythingIndex entries={entries} />
    </>
  );
}
