/**
 * /admin/health-forms/log — the health records access log (Plans/Admin-Health-Forms.md; moved from /health/log).
 * Health viewers only. The last 500 lines; nothing here can be edited.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { healthAdminAccess } from '@/lib/health-access';
import { healthLogRecent } from '@/lib/health-store';
import { HEALTH_KIND, isHealthKind, pageName } from '@/lib/health-records';
import { PageTitle } from '../../_components/page-title';
import { Notice } from '../../_components/notice';
import { HealthLogTable, type HealthLogRow } from './health-log-table';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Health records access log — Troop 79 Admin'
};

const BACK = { label: 'Health Forms', href: '/admin/health-forms' };
const VERB: Record<string, string> = { upload: 'Added', replace: 'Replaced', delete: 'Removed', view: 'Opened', download: 'Downloaded', print: 'Printed' };
const VIA: Record<string, string> = { family: 'Family', named: 'Named leader', trip: 'Adult on the trip' };

export default async function HealthLogPage() {
  const access = await healthAdminAccess();
  if (!access?.named) {
    return (
      <>
        <PageTitle back={BACK} title="Access log" />
        <Notice variant="info">The access log is for leaders on the health records list.</Notice>
      </>
    );
  }
  const lines = await healthLogRecent(createAdminClient(), 500);
  const rows: HealthLogRow[] = lines.map((l) => ({
    at: l.at,
    who: l.viewerName,
    how: VIA[l.via] ?? l.via,
    did: VERB[l.action] ?? l.action,
    whose: l.personName,
    doc: isHealthKind(l.kind) ? `${HEALTH_KIND[l.kind].label}${l.page ? `, ${pageName(l.kind, l.page).toLowerCase()}` : ''}` : 'Whole record'
  }));
  return (
    <>
      <PageTitle back={BACK} title="Access log" sub={`The last ${rows.length} entries. Nothing here can be edited.`} />
      <HealthLogTable rows={rows} />
    </>
  );
}
