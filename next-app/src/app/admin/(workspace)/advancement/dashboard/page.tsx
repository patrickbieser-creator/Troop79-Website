/**
 * /admin/advancement/dashboard - the advancement overview on its own page (Patrick, 2026-10-13): the first card in Home's
 * Advancement group and the first Advancement tab. It used to render below a full copy of Home; bookmarks and
 * revalidatePath() calls to this URL keep working. advancement.write, as it always was; /admin itself admits every leader.
 */
import { requireCapability } from '@/lib/require-capability';
import { PageTitle } from '../../_components/page-title';
import { AdvancementOverview } from './advancement-overview';

export const metadata = {
  title: 'Dashboard — Troop 79'
};

export default async function DashboardPage() {
  await requireCapability('advancement.write');
  return (
    <>
      <PageTitle back={null} title="Dashboard" sub="Active scouts, the ledger, Court of Honor candidates and who has signed in." />
      <AdvancementOverview />
    </>
  );
}
