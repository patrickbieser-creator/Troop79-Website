/**
 * /admin/calendar/[entryId]/roll-call — retired as a page 2026-08-24
 * (Patrick: "When clicking on the roll call tab when editing an event,
 * display the take roll editor right away"). The sheet (`roll-call.tsx`) and
 * its actions now render inside the entry workbench's Roll Call tab; this
 * route redirects there so every older link and bookmark still lands on it.
 */

import { notFound, redirect } from 'next/navigation';

export default async function RollCallRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId) || entryId <= 0) notFound();
  redirect(`/admin/calendar/${entryId}?tab=roll-call`);
}
