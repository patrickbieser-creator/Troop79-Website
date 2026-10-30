import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resend's delivery and engagement events, written to the meeting email log (meeting_emails: delivery_status,
 * delivered_at, opened_at — the Emails screen reads them as "Opened …" and "Failed · address bounced").
 *
 * Resend → Webhooks → endpoint https://www.troop-79.com/api/resend/webhook, events: email.delivered, email.opened,
 * email.clicked, email.bounced. Open/click tracking is per domain (Resend → Domains → Configuration).
 *
 * Rules:
 * 1. A row is found by its Resend id; failing that, by the meeting_email_id tag the sender adds, but only on a row
 *    with no Resend id yet (a send that timed out after Resend took it). That row then learns its id.
 * 2. Everything only moves forward: delivered never overwrites a bounce, a bounce overwrites delivered (a late bounce
 *    is the truth), and opened_at keeps the earliest time.
 * 3. A click counts as an open: a click proves the email was read, and opens are missed when images are blocked.
 * 4. Events for other email (sign-in codes, wreath receipts) match no row and are ignored, answered 200 so Resend
 *    doesn't retry them.
 */
export type EventTags = Record<string, string> | { name: string; value: string }[];

export interface ResendEmailEvent {
  type: string;
  created_at: string;
  data?: { email_id?: string; tags?: EventTags };
}

export type EventOutcome = 'updated' | 'unchanged' | 'no-match' | 'ignored';

const HANDLED = new Set(['email.delivered', 'email.opened', 'email.clicked', 'email.bounced']);

function tagOf(tags: EventTags | undefined, name: string): string | null {
  if (!tags) return null;
  if (Array.isArray(tags)) return tags.find((t) => t.name === name)?.value ?? null;
  return tags[name] ?? null;
}

async function findRow(sb: SupabaseClient, resendId: string, tagged: string | null): Promise<{ id: number; learn: boolean } | null> {
  const { data, error } = await sb.from('meeting_emails').select('id').eq('resend_id', resendId).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return { id: data.id as number, learn: false };
  const id = tagged && /^\d{1,18}$/.test(tagged) ? Number(tagged) : null;
  if (id === null) return null;
  const { data: t, error: e2 } = await sb.from('meeting_emails').select('id').eq('id', id).is('resend_id', null).maybeSingle();
  if (e2) throw new Error(e2.message);
  return t ? { id: t.id as number, learn: true } : null;
}

export async function applyResendEvent(sb: SupabaseClient, event: ResendEmailEvent): Promise<EventOutcome> {
  if (!HANDLED.has(event.type)) return 'ignored';
  const resendId = event.data?.email_id;
  if (!resendId) return 'ignored';
  const at = Number.isNaN(Date.parse(event.created_at)) ? new Date().toISOString() : new Date(event.created_at).toISOString();
  const tagged = tagOf(event.data?.tags, 'meeting_email_id');
  const row = await findRow(sb, resendId, tagged);
  if (!row) {
    // Untagged = other email, expected. Tagged but no row = a meeting email this database doesn't know.
    if (tagged) console.warn(`[resend] ${event.type} ${resendId}: meeting email ${tagged} not found`);
    return 'no-match';
  }
  if (row.learn) {
    const { error } = await sb.from('meeting_emails').update({ resend_id: resendId }).eq('id', row.id).is('resend_id', null);
    if (error) throw new Error(error.message);
  }

  let q;
  if (event.type === 'email.delivered') {
    q = sb.from('meeting_emails').update({ delivery_status: 'delivered', delivered_at: at }).eq('id', row.id).is('delivery_status', null);
  } else if (event.type === 'email.bounced') {
    q = sb.from('meeting_emails').update({ delivery_status: 'bounced' }).eq('id', row.id).or('delivery_status.is.null,delivery_status.eq.delivered');
  } else {
    q = sb.from('meeting_emails').update({ opened_at: at }).eq('id', row.id).or(`opened_at.is.null,opened_at.gt."${at}"`);
  }
  const { data, error } = await q.select('id');
  if (error) throw new Error(error.message);
  return data?.length || row.learn ? 'updated' : 'unchanged';
}
