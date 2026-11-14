/**
 * /health/access — the named list: the adults who may open anyone's health records (Plans/Health-Forms.md,
 * answer 1). Managed by the people already on it; the last name can't be removed. Not found for everyone else.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { healthAccess } from '@/lib/health-access';
import { listHealthViewers } from '@/lib/health-store';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { ViewerList } from '../health-controls';
import { grantHealthViewerAction, revokeHealthViewerAction } from '../actions';
import styles from '../health.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Who can open health records — Scout Troop 79',
  robots: { index: false, follow: false }
};

export default async function HealthAccessPage() {
  const access = await healthAccess();
  if (!access?.named) notFound();
  const supabase = createAdminClient();
  const [viewers, people, { data: scouts }] = await Promise.all([
    listHealthViewers(supabase),
    fetchAllRows<{ id: number; display_name: string }>((from, to) =>
      supabase.from('people').select('id, display_name').is('merged_into_person_id', null).is('guest_host_household_id', null).order('display_name').range(from, to)
    ),
    supabase.from('scouts').select('person_id').not('person_id', 'is', null).or('active.eq.true,is_webelos.eq.true')
  ]);
  // Adults only: current scouts and Webelos are left off the list of choices (the action refuses them too).
  const scoutIds = new Set(((scouts ?? []) as { person_id: number }[]).map((s) => Number(s.person_id)));
  const adults = people.filter((p) => !scoutIds.has(Number(p.id))).map((p) => ({ personId: Number(p.id), name: p.display_name }));

  return (
    <>
      <PageHeader kicker="Leaders" title="Who can open health records" />
      <PageShell>
        <div className={styles.wrap}>
          <p className={styles.links}>
            <Link href="/health">← Back to the list</Link>
          </p>
          <p className={styles.note}>
            These adults can open anyone&rsquo;s health records at any time. Parents always see their own family&rsquo;s, and adults
            on a trip see that trip&rsquo;s for a few days; neither needs to be here.
          </p>
          <ViewerList viewers={viewers} adults={adults} grant={grantHealthViewerAction} revoke={revokeHealthViewerAction} />
        </div>
      </PageShell>
    </>
  );
}
