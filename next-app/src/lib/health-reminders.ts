import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildHealthReminders, type HealthReminderGroup, type HealthTrip } from '@/lib/health-store';
import { recipientsForScouts } from '@/lib/email-recipients';
import { emailsForPeople } from '@/lib/person-emails';
import { renderEmail, type SendResult } from '@/lib/email';
import { fmtDate, fmtRange } from '@/lib/format-date';

/**
 * "Remind families" before a trip (Plans/Health-Forms.md): one email per family, naming only that family's people
 * and which documents are missing or run out. No medical detail is in the email, only the names of the documents.
 * A scout's reminder goes to their parents (never to the scout, answer 7); an adult's goes to the adult.
 *
 * Two steps, like every troop send: `confirm: false` resolves who would be written to and sends nothing.
 */
export interface HealthReminderDeps {
  supabase: SupabaseClient;
  send: (m: { to: string[]; subject: string; html: string; text: string; confirm: boolean }) => Promise<SendResult>;
  siteUrl: string;
  today: string;
}

export interface HealthReminderOutcome {
  /** Families that were (or would be) written to. */
  families: number;
  people: number;
  to: string[];
  /** People who need something but have no address on file. */
  noEmail: string[];
  /** Families whose send failed. */
  failed: number;
  sent: boolean;
}

/** A person's addresses: a scout's parents, or the adult's own. */
async function emailsFor(sb: SupabaseClient, personId: number): Promise<string[]> {
  const { data: scouts } = await sb.from('scouts').select('id').eq('person_id', personId);
  const scoutIds = ((scouts ?? []) as { id: string }[]).map((s) => s.id);
  if (scoutIds.length > 0) return (await recipientsForScouts(scoutIds)).map((r) => r.email);
  // An adult's own addresses, under the same rule as every troop send: never one that bounced or unsubscribed.
  const rows = (await emailsForPeople(sb, [personId])).get(personId);
  if (rows) return rows.filter((r) => !r.bouncedAt && !r.unsubscribedAt).map((r) => r.email);
  // No address rows at all (someone from before that table): their primary address.
  const { data } = await sb.from('people').select('primary_email').eq('id', personId).maybeSingle();
  const email = (data as { primary_email: string | null } | null)?.primary_email;
  return email ? [email] : [];
}

export function healthReminderEmail(trip: Pick<HealthTrip, 'title' | 'entryDate' | 'endDate'>, group: HealthReminderGroup, siteUrl: string): { subject: string; html: string; text: string } {
  const when = fmtRange(trip.entryDate, trip.endDate ?? trip.entryDate);
  const { html, text } = renderEmail({
    heading: `Health forms for ${trip.title}`,
    intro: `${trip.title} is coming up (${when}). Before the trip we still need these for your family:`,
    bullets: group.people.map((p) => `${p.name}: ${p.needs.join('; ')}`),
    actionUrl: `${siteUrl}/member/health-forms`,
    actionLabel: 'Add them now',
    outro: 'Take a photo of each page with your phone, or choose a PDF. If you already handed in paper forms, reply and tell us.'
  });
  return { subject: `Troop 79: health forms needed for ${trip.title}`, html, text };
}

export async function remindFamilies(trip: HealthTrip, confirm: boolean, deps: HealthReminderDeps): Promise<HealthReminderOutcome> {
  const { groups, noEmail } = await buildHealthReminders(deps.supabase, trip, deps.today, (id) => emailsFor(deps.supabase, id), fmtDate);
  const outcome: HealthReminderOutcome = {
    families: groups.length,
    people: groups.reduce((n, g) => n + g.people.length, 0),
    to: [...new Set(groups.flatMap((g) => g.to))],
    noEmail,
    failed: 0,
    sent: false
  };
  if (!confirm) return outcome;
  for (const g of groups) {
    const mail = healthReminderEmail(trip, g, deps.siteUrl);
    const res = await deps.send({ to: g.to, ...mail, confirm: true }).catch(() => ({ status: 'error' as const }));
    // 'skipped' (mail not configured) is a failure here: the leader pressed Send and nothing went.
    if (res.status !== 'sent') outcome.failed += 1;
  }
  outcome.sent = true;
  return outcome;
}
