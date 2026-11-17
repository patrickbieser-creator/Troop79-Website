import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildHealthReminders, recordHealthReminders, tripReminderScope, type HealthReminderGroup, type HealthReminderScope, type HealthTrip } from '@/lib/health-store';
import { recipientsForScouts } from '@/lib/email-recipients';
import { emailsForPeople } from '@/lib/person-emails';
import { renderEmail, type SendResult } from '@/lib/email';
import { fmtDate, fmtRange } from '@/lib/format-date';

/**
 * Health-form reminders (Plans/Health-Forms.md; any time, Plans/Admin-Health-Record-Sheet-Redesign.md decision 13):
 * one email per family, naming only that family's people and which documents are missing or run out. No medical
 * detail is in the email, only the names of the documents. A scout's reminder goes to their parents (never to the
 * scout, answer 7); an adult's goes to the adult. Each send is recorded per person, so the sheet can say who was
 * emailed and when.
 *
 * Two steps, like every troop send: `confirm: false` resolves who would be written to and sends nothing.
 */
export interface HealthReminderDeps {
  supabase: SupabaseClient;
  send: (m: { to: string[]; subject: string; html: string; text: string; confirm: boolean }) => Promise<SendResult>;
  siteUrl: string;
  today: string;
  /** Who pressed Send: recorded with each reminder. */
  sentBy: { personId: number; name: string };
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

/** The email for one family. With a trip it names the trip; without one it is a plain "we still need" note. */
export function healthReminderEmail(
  trip: Pick<HealthTrip, 'title' | 'entryDate' | 'endDate'> | null,
  group: HealthReminderGroup,
  siteUrl: string
): { subject: string; html: string; text: string } {
  const bullets = group.people.map((p) => `${p.name}: ${p.needs.join('; ')}`);
  const shared = {
    bullets,
    actionUrl: `${siteUrl}/member/health-forms`,
    actionLabel: 'Add them now',
    outro: 'Take a photo of each page with your phone, or choose a PDF. If you already handed in paper forms, reply and tell us.'
  };
  if (!trip) {
    const { html, text } = renderEmail({
      heading: 'Health forms',
      intro: 'Every outing needs current health forms and an insurance card. We still need these for your family:',
      ...shared
    });
    return { subject: 'Troop 79: health forms needed', html, text };
  }
  const when = fmtRange(trip.entryDate, trip.endDate ?? trip.entryDate);
  const { html, text } = renderEmail({
    heading: `Health forms for ${trip.title}`,
    intro: `${trip.title} is coming up (${when}). Before the trip we still need these for your family:`,
    ...shared
  });
  return { subject: `Troop 79: health forms needed for ${trip.title}`, html, text };
}

async function remind(trip: HealthTrip | null, scope: HealthReminderScope, confirm: boolean, deps: HealthReminderDeps): Promise<HealthReminderOutcome> {
  const { groups, noEmail } = await buildHealthReminders(deps.supabase, scope, deps.today, (id) => emailsFor(deps.supabase, id), fmtDate);
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
    if (res.status !== 'sent') {
      outcome.failed += 1;
      continue;
    }
    // A failed record must not read as a failed send: the email went.
    await recordHealthReminders(deps.supabase, { personIds: g.people.map((p) => p.personId), to: g.to, by: deps.sentBy, eventId: trip?.eventId ?? null }).catch((e) =>
      console.error('[health] reminder not recorded:', e instanceof Error ? e.message : e)
    );
  }
  outcome.sent = true;
  return outcome;
}

/** "Remind families" before a trip: its attendees, rated for the trip (Part C when it asks, good to its last day). */
export function remindFamilies(trip: HealthTrip, confirm: boolean, deps: HealthReminderDeps): Promise<HealthReminderOutcome> {
  return remind(trip, tripReminderScope(trip), confirm, deps);
}

/** A reminder any time, about these people (the sheet's Email reminder is one person): everything the sheet shows in
 *  red today, Part C and the immunization record included (Patrick, 2026-11-17). */
export function remindPeople(personIds: number[], confirm: boolean, deps: HealthReminderDeps): Promise<HealthReminderOutcome> {
  return remind(null, { personIds, needsPartC: true, immunization: true }, confirm, deps);
}
