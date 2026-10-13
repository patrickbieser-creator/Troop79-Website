/**
 * /admin/advancement/dashboard — the old Leader Dashboard URL. Home moved to /admin
 * (Plans/Admin-Home-And-Nav.md, Wave 1) and this route renders the same page so
 * bookmarks, links and revalidatePath() calls keep working. Still advancement.write,
 * as it always was; /admin itself admits every leader.
 */
import { requireCapability } from '@/lib/require-capability';
import { AdminHome } from './admin-home';

export const metadata = {
  title: 'Home — Troop 79'
};

export default async function DashboardPage() {
  await requireCapability('advancement.write');
  return <AdminHome overview />;
}
