/**
 * Meeting invites (Plans/Matcher-Tune-Up.md T-5, P1 teachers): the pure rules, client-safe. A leader invites adults to
 * teach a wanted topic; the Troop 79 Bugler emails each a link that answers that ONE invite, yes or no, without signing
 * anyone in (qa-lead review 2026-10-20: a scoped capability, so a forwarded email can never become a session). The
 * database half is lib/meeting-invites-db.ts.
 */
import { centralToInstant } from '@/lib/dates';

/** People one send may reach; the action enforces it, not the dialog (qa-lead M3). */
export const INVITE_SEND_CAP = 40;
/** Someone invited to the same topic at the same meeting this recently is skipped on a resend. */
export const INVITE_DEDUPE_HOURS = 24;
/** Failed redeems one address may make an hour before the page stops answering (qa-lead M4). */
export const INVITE_FAILURES_PER_HOUR = 20;
/** P5b: people one reminder send may cover, and emails it may make ("Remind everyone" on a full board). */
export const REMINDER_SEND_CAP = 100;
/** The name the invite emails come from (Patrick: never a named leader). */
export const INVITE_SENDER_NAME = 'Troop 79 Bugler';

/** Patrick: an invite link lasts until 6:00 PM Central on the meeting day. DST-correct. */
export function inviteExpiresAt(meetingDate: string): string {
  return centralToInstant(meetingDate, '18:00');
}

export type InviteResponse = 'accepted' | 'declined' | 'changed' | 'superseded';

/** What a link shows: still open, already answered (and how), past its time, or nothing we recognise. */
export type InviteState = 'open' | 'answered' | 'expired' | 'void' | 'unknown';

export function inviteState(
  row: { expires_at: string; consumed_at: string | null; response: InviteResponse | null } | null,
  now: Date
): InviteState {
  if (!row) return 'unknown';
  if (row.consumed_at) return row.response ? 'answered' : 'void';
  return new Date(row.expires_at) <= now ? 'expired' : 'open';
}

/** Board counts per topic: "Invited 6 · 2 yes · 1 no". */
export interface InviteCounts {
  invited: number;
  accepted: number;
  declined: number;
}

export function countInvites(rows: readonly { topic_key: string; invitee_person_id: number; response: InviteResponse | null }[]): Map<string, InviteCounts> {
  // By person, not by row: a resend after 24 hours, or a scout's two parents, are several rows for one person. Yes wins
  // over no (one parent said no, the other yes = yes).
  const per = new Map<string, Map<number, { yes: boolean; no: boolean }>>();
  for (const r of rows) {
    const people = per.get(r.topic_key) ?? new Map<number, { yes: boolean; no: boolean }>();
    const p = people.get(r.invitee_person_id) ?? { yes: false, no: false };
    if (r.response === 'accepted') p.yes = true;
    if (r.response === 'declined') p.no = true;
    people.set(r.invitee_person_id, p);
    per.set(r.topic_key, people);
  }
  const out = new Map<string, InviteCounts>();
  for (const [key, people] of per) {
    const list = [...people.values()];
    out.set(key, { invited: list.length, accepted: list.filter((p) => p.yes).length, declined: list.filter((p) => p.no && !p.yes).length });
  }
  return out;
}

/** "Invited 6 · 2 yes · 1 no" (teachers); "Offered to 6 · …" (scouts). */
export function inviteCountsText(c: InviteCounts | undefined, lead = 'Invited'): string {
  if (!c?.invited) return '';
  return [`${lead} ${c.invited}`, c.accepted ? `${c.accepted} yes` : '', c.declined ? `${c.declined} no` : ''].filter(Boolean).join(' · ');
}
