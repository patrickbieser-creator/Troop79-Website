/**
 * /admin/advancement/bsa-roster — compare the my.scouting.org Roster Report
 * with our people, and keep each member's registration expiry
 * (Patrick, 2026-10-20). roster.manage, same as the Roster.
 *
 * Re-runnable: upload the latest export any time. Checking only reports;
 * Save writes registration dates for the matched people. Every other
 * difference is for a leader to fix on the person's record.
 */
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAllRegistrations } from '@/lib/bsa-roster-db';
import { centralToday } from '@/lib/dates';
import { PageTitle } from '../../_components/page-title';
import { checkBsaRosterAction, saveBsaRegistrationsAction } from './actions';
import { BsaRosterView } from './bsa-roster-view';

export const metadata = {
  title: 'BSA Roster — Troop 79'
};

export default async function BsaRosterPage() {
  await requireCapability('roster.manage');
  const registrations = await loadAllRegistrations(createAdminClient());

  return (
    <>
      <PageTitle
        back={null}
        title="BSA Roster"
        sub="Check the official roster against ours and keep everyone's registration dates. Checking changes nothing; differences are fixed on each person's record."
      />
      <BsaRosterView
        registrations={registrations}
        today={centralToday()}
        checkAction={checkBsaRosterAction}
        saveAction={saveBsaRegistrationsAction}
      />
    </>
  );
}
