import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { PatrolScout } from '@/lib/patrol-assign';
import type { RosterPrintRank } from '@/lib/roster-print';
import { PageTitle } from '../../../_components/page-title';
import { PatrolTable } from './patrol-table';
import { savePatrolAssignments } from './actions';

/**
 * /admin/advancement/roster/patrols — put every scout in a patrol in one pass.
 *
 * Built because 23 of 28 active scouts had no patrol: the only way to set one
 * was the per-scout Roster editor, and 28 individual saves is a chore that
 * never gets done. The Patrols page on the printable family roster is correct
 * and useless until this is filled in.
 *
 * The decisions live in lib/patrol-assign.ts (pure, 27 tests); this file loads
 * rows and hands them to the board.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Patrol assignments — Troop 79'
};

const SCOUT_COLS = 'id, display_name, patrol, current_rank, graduation_year, active';

export default async function PatrolsPage() {
  await requireCapability('roster.manage');

  const supabase = createAdminClient();
  const [scouts, ranks] = await Promise.all([
    fetchAllRows<PatrolScout>((f, t) => supabase.from('scouts').select(SCOUT_COLS).range(f, t)),
    fetchAllRows<RosterPrintRank>((f, t) =>
      supabase.from('ranks').select('id, display_name').range(f, t)
    )
  ]);

  return (
    <>
      <PageTitle
        back={{ label: 'Roster', href: '/admin/advancement/roster' }}
        title="Patrol assignments"
        sub="Select scouts, pick a patrol, assign — nothing saves until you press Save. Patrol names are free text: type a new one once and it joins the list."
      />

      <PatrolTable scouts={scouts} ranks={ranks} onSave={savePatrolAssignments} />
    </>
  );
}
