/**
 * /admin — Home (Plans/Admin-Home-And-Nav.md, Wave 1): "Needs you today" for every
 * leader, filtered to what they can open, then the tinted card grid (the advancement overview is the
 * Dashboard card, on its own page, so /admin stays light). Reached from the rail's Home, bookmarks, typed URLs
 * and login's ?next=/admin. The workspace layout has already refused anyone with
 * no capability, so no page-level guard is needed beyond what each row's target enforces.
 */
import { AdminHome } from './advancement/dashboard/admin-home';

export const metadata = {
  title: 'Home — Troop 79'
};

export default function AdminHomePage() {
  return <AdminHome />;
}
