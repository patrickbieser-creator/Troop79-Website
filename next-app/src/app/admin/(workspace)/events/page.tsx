/**
 * /admin/events — the Event Signups list, retired 2026-08-25 (Patrick: "I
 * would like to have calendar be the central point of activity"; after
 * walking the flow with the links removed: "All needed functionality is
 * working as expected"). What it showed lives on the Calendar list now — the
 * S pill for signup status, the Going column for headcount — and enabling a
 * signup happens on the entry's own Signup tab. This route redirects there
 * so bookmarks land somewhere useful. `actions.ts` and `[id]/` stay: the
 * workbench uses the actions and the builder panels, and `[id]` is itself a
 * redirect into the workbench.
 */

import { redirect } from 'next/navigation';

export default function EventSignupsRedirect() {
  redirect('/admin/calendar');
}
