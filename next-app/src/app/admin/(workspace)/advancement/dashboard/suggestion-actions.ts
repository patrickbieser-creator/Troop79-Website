'use server';

import { requireCapability } from '@/lib/require-capability';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email';
import { buildSuggestionEmail, suggestionRecipients, validateSuggestion } from '@/lib/suggestion-email';

export type SuggestionResult = { ok: true } | { ok: false; error: string };

/** The signed-in leader's name and primary email, for the dialog's
 *  "from" line and the message. Read once by the dashboard page. */
export async function loadSuggestionActor(): Promise<{ name: string; email: string | null }> {
  const actor = await resolveAdminActor();
  const name = actor?.label ?? 'Leader';
  if (actor?.personId == null) return { name, email: null };
  const { data } = await createAdminClient()
    .from('people')
    .select('primary_email')
    .eq('id', actor.personId)
    .maybeSingle();
  return { name, email: (data as { primary_email?: string | null } | null)?.primary_email ?? null };
}

/**
 * Sends a leader's website suggestion to the troop inbox + the site owner.
 * Identity comes from the session, never the form — the dialog shows the
 * name/email but does not post them.
 */
export async function sendSuggestionAction(raw: string): Promise<SuggestionResult> {
  await requireCapability('advancement.write');
  const v = validateSuggestion(raw);
  if (!v.ok) return v;

  const who = await loadSuggestionActor();
  const msg = buildSuggestionEmail({ name: who.name, email: who.email, text: v.text });
  const res = await sendEmail({
    to: suggestionRecipients(),
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    replyTo: msg.replyTo,
    confirm: true
  });
  if (res.status === 'error') return { ok: false, error: res.detail ?? 'Could not send. Please try again.' };
  if (res.status === 'skipped') return { ok: false, error: res.detail ?? 'Email is not configured on this server.' };
  // 'sent' with a detail = one of the two inboxes failed (qa-lead, 2026-08-28):
  // say so rather than report success for a half-delivered message.
  if (res.detail) return { ok: false, error: `Partly sent — ${res.detail}` };
  return { ok: true };
}
