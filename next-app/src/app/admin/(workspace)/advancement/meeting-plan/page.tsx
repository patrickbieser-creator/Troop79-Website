/**
 * /admin/advancement/meeting-plan — on-demand Meeting Plan generator.
 *
 * A leader picks a meeting date (defaults to next Sunday — the troop's
 * meeting day) and generates suggestions: what each scout could work on at
 * that meeting, grouped into patrol-sized sessions (max 8) with a qualified
 * teacher. One plan per meeting — each week's sign-offs reshape the next.
 * Nothing is generated automatically — themed MB nights and campout-prep
 * meetings simply don't get a plan. Publishing stores a snapshot in
 * `meeting_plans` that the public /meeting-plan page renders.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/require-role';
import { nextSunday } from '@/lib/dates';
import { PlanView, type PublishedPlanRow } from './plan-view';
import styles from './meeting-plan.module.css';

export const metadata = {
  title: 'Meeting Plan — Troop 79'
};

async function loadData(): Promise<{ published: PublishedPlanRow[] }> {
  const supabase = createAdminClient();

  const plansRes = await supabase
    .from('meeting_plans')
    .select('meeting_date, title, generated_at, generated_by')
    .eq('status', 'published')
    .order('meeting_date', { ascending: false })
    .limit(10);

  return {
    published: (plansRes.data ?? []) as PublishedPlanRow[]
  };
}

export default async function MeetingPlanPage() {
  await requireRole(['leader']);
  const { published } = await loadData();

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Meeting Plan</h1>
        <p>
          Suggested advancement for a troop meeting, generated on demand from the ledger:
          up to three meeting-doable requirements per scout, grouped into sessions of eight
          or fewer with a qualified teacher — adult leader or authorized scout instructor.
          Campout-only requirements stay visible in their own column. Review the result,
          then publish it to the public site.
        </p>
      </div>

      <PlanView published={published} defaultDate={nextSunday()} />
    </>
  );
}
