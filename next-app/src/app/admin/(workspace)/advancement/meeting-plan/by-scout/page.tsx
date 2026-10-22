/**
 * /admin/advancement/meeting-plan/by-scout — By Scout and Teaching Roster (Build a Plan B4): the two views that only
 * ever lived inside Admin's retired generator. Read-only suggestions from the ledger for one meeting date.
 */
import { requireCapability } from '@/lib/require-capability';
import { nextSunday } from '@/lib/dates';
import { PlanView } from './scout-view';
import { PageTitle } from '../../../_components/page-title';

export const metadata = {
  title: 'By Scout & Teaching Roster — Troop 79'
};

export default async function ByScoutPage() {
  await requireCapability('meeting_plan.use');
  return (
    <>
      <PageTitle
        back={null}
        title="By Scout & Teaching Roster"
        sub="What each scout could work on at a meeting, from the ledger, and who is set up to teach. Planning the meeting itself happens in the Meeting Planner's Build a Plan."
      />
      <PlanView defaultDate={nextSunday()} />
    </>
  );
}
