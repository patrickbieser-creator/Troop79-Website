/**
 * /admin/events/[signupId] — retired as a page 2026-08-25 (Patrick: "I would
 * like to have calendar be the central point of activity"). The builder it
 * rendered is the same `BuilderPanels` the calendar entry workbench hosts in
 * its Signup tab (D-229), so this route now resolves the signup to its entry
 * and redirects there — every older link, bookmark and EventNav tab still
 * lands on the builder. `load-builder.ts` and `builder-panels.tsx` stay: the
 * workbench imports them.
 */

import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';

export default async function EventBuilderRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const signupId = Number(id);
  if (!Number.isInteger(signupId) || signupId < 1) notFound();

  // Same gate the page had: which entry a signup belongs to is leader data.
  await requireCapability('calendar.write');
  const { data } = await createAdminClient()
    .from('event_signups')
    .select('calendar_entry_id')
    .eq('id', signupId)
    .maybeSingle();
  if (!data) notFound();
  redirect(`/admin/calendar/${data.calendar_entry_id as number}?tab=signup`);
}
