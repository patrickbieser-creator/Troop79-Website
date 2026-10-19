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
 *
 * The first tab, This Sunday, is the live meeting board (Phase 1 of Plans/Meeting-Requests-And-Teaching-Offers.md):
 * who's coming and what scouts asked for, by name.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { nextSunday } from '@/lib/dates';
import { PlanView, type PublishedPlanRow } from './plan-view';
import { PageTitle } from '../../_components/page-title';
import { ThisSundayTab } from './this-sunday';

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
  await requireCapability('meeting_plan.use');
  const { published } = await loadData();

  return (
    <>
      <PageTitle back={null}
        title="Meeting Plan"
        sub="This Sunday shows who's coming to the next meeting and what scouts asked for, live. The other tabs
          generate suggested advancement from the ledger: up to three meeting-doable requirements per scout, in
          sessions of eight or fewer with a qualified teacher, to review and publish to the public site."
      />

      <PlanView published={published} defaultDate={nextSunday()} thisSunday={<ThisSundayTab />} />
    </>
  );
}
