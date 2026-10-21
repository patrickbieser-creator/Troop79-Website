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
/** The name the invite emails come from (Patrick: never a named leader). */
export const INVITE_SENDER_NAME = 'Troop 79 Bugler';

/** Patrick: an invite link lasts until 6:00 PM Central on the meeting day. DST-correct. */
export function inviteExpiresAt(meetingDate: string): string {
  return centralToInstant(meetingDate, '18:00');
}

export type InviteResponse = 'accepted' | 'declined' | 'changed';

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
  const out = new Map<string, InviteCounts>();
  const seen = new Set<string>();
  // A resend after 24 hours makes a second row; a person counts once per topic, by their latest answer.
  for (const r of rows) {
    const c = out.get(r.topic_key) ?? { invited: 0, accepted: 0, declined: 0 };
    const who = `${r.topic_key}:${r.invitee_person_id}`;
    if (!seen.has(who)) {
      seen.add(who);
      c.invited++;
    }
    if (r.response === 'accepted') c.accepted++;
    if (r.response === 'declined') c.declined++;
    out.set(r.topic_key, c);
  }
  return out;
}

export function inviteCountsText(c: InviteCounts | undefined): string {
  if (!c?.invited) return '';
  return [`Invited ${c.invited}`, c.accepted ? `${c.accepted} yes` : '', c.declined ? `${c.declined} no` : ''].filter(Boolean).join(' · ');
}
