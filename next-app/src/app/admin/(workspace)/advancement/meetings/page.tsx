/**
 * /admin/advancement/meetings — retired 2026-08-24 (Patrick: "Merge 'roll
 * call and agendas' into 'calendar' … Our goal is to eliminate this section").
 *
 * The Roll Call work list now IS the Calendar list: every entry shows its
 * agenda / signup / roll-call state as letter pills that open the layer's own
 * screen. The route stays as a redirect so old bookmarks and the nav's muscle
 * memory land somewhere useful. The agenda editor (/[id]) and the Attendance
 * Report (/report, now under Reports & Exports) keep their routes.
 */

import { redirect } from 'next/navigation';

export default function RetiredRollCallListPage() {
  redirect('/admin/calendar');
}
