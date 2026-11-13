/**
 * /admin/finance/scout-accounts — every scout account's balance, and one account's ledger beside the list
 * (Patrick, 2026-11-12: "a listing of the current balance for each scout account … clicking a scout's name would
 * bring up a detailed history"; layout per Jenna's review). ?person=<personId> or ?account=scholarship picks the
 * account; none = the first one.
 *
 * finance.manage or finance.view, like the Financial Ledger; only finance.manage sees "Move to troop fund…" (and
 * the action checks it again — hiding a button is not the boundary).
 */
import { requireAnyOf } from '@/lib/require-capability';
import { SCHOLARSHIP_KEY } from '@/lib/scout-accounts';
import { PageTitle } from '../../_components/page-title';
import { listScoutAccountsAction } from './actions';
import { ScoutAccountsView } from './scout-accounts-view';

export const metadata = {
  title: 'Scout Accounts — Troop 79'
};

export default async function ScoutAccountsPage({ searchParams }: { searchParams: Promise<{ person?: string; account?: string }> }) {
  const actor = await requireAnyOf(['finance.manage', 'finance.view']);
  const { person, account } = await searchParams;
  const rows = await listScoutAccountsAction();
  const initialKey = account === 'scholarship' ? SCHOLARSHIP_KEY : person && /^\d+$/.test(person) ? `p${person}` : null;

  return (
    <>
      <PageTitle back={null} title="Scout Accounts" sub="Each scout's balance from fundraising, less what has been spent on events." />
      <ScoutAccountsView rows={rows} initialKey={initialKey} canManage={actor.capabilities.has('finance.manage')} />
    </>
  );
}
