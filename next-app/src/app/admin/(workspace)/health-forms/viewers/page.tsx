/**
 * /admin/health-forms/viewers — Who can open health records (Plans/Admin-Health-Forms.md; moved from /health/access).
 * Health viewers only. The choices are adults: current scouts and Webelos are left off (the store refuses them too).
 */
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { healthAdminAccess } from '@/lib/health-access';
import { listHealthViewers } from '@/lib/health-store';
import { PageTitle } from '../../_components/page-title';
import { Notice } from '../../_components/notice';
import { grantHealthViewerAdminAction, revokeHealthViewerAdminAction } from '../actions';
import { HealthViewersAdmin } from './health-viewers-admin';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Who can open health records — Troop 79 Admin'
};

const BACK = { label: 'Health Forms', href: '/admin/health-forms' };

export default async function HealthViewersPage() {
  const access = await healthAdminAccess();
  if (!access?.named) {
    return (
      <>
        <PageTitle back={BACK} title="Who can open health records" />
        <Notice variant="info">This list is for leaders already on it.</Notice>
      </>
    );
  }
  const supabase = createAdminClient();
  const [viewers, people, { data: scouts }] = await Promise.all([
    listHealthViewers(supabase),
    fetchAllRows<{ id: number; display_name: string }>((from, to) =>
      supabase.from('people').select('id, display_name').is('merged_into_person_id', null).is('guest_host_household_id', null).order('display_name').order('id').range(from, to)
    ),
    supabase.from('scouts').select('person_id').not('person_id', 'is', null).or('active.eq.true,is_webelos.eq.true')
  ]);
  const scoutIds = new Set(((scouts ?? []) as { person_id: number }[]).map((s) => Number(s.person_id)));
  const adults = people.filter((p) => !scoutIds.has(Number(p.id))).map((p) => ({ personId: Number(p.id), name: p.display_name }));

  return (
    <>
      <PageTitle
        back={BACK}
        title="Who can open health records"
        sub="These adults can open anyone’s health records at any time. Parents always see their own family’s, and adults on a trip see that trip’s for a few days."
      />
      <HealthViewersAdmin viewers={viewers} adults={adults} grant={grantHealthViewerAdminAction} revoke={revokeHealthViewerAdminAction} />
    </>
  );
}
