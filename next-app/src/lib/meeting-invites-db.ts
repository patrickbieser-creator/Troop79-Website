/**
 * Meeting invites, the database half (Plans/Matcher-Tune-Up.md T-5, P1 teachers). Server only, service role.
 *
 * The link is a SCOPED capability (qa-lead review 2026-10-20): it answers its one invite, yes or no, and never signs
 * anyone in. So:
 *   - only the peppered hash is stored (unique), the raw token lives only in the email (M6);
 *   - reading a link (inspectInvite) writes nothing, so a mail scanner's prefetch can't spend it (M1);
 *   - answering is ONE atomic UPDATE ... WHERE consumed_at IS NULL AND expires_at > now, so two taps can't both win;
 *   - at answer time everything is re-checked: the invitee is still an active adult, their session_epoch is the one
 *     we sent to (a "sign out everywhere" voids invites too), and the meeting is still ahead (M2);
 *   - who and how many is checked here at send, never trusted from the dialog (M3); a decline is only ever recorded
 *     by the decline answer itself (M7).
 * Sender permission is checked at SEND time only (the action's meeting_plan.use); a later loss of that capability
 * doesn't void invites already sent.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { centralToday } from '@/lib/dates';
import { deliverableEmailFor, hashSecret, identityForPerson } from '@/lib/identity-challenge';
import { teachTopic } from '@/lib/meeting-board-supply';
import { INVITE_DEDUPE_HOURS, INVITE_FAILURES_PER_HOUR, INVITE_SEND_CAP, inviteExpiresAt, inviteState, type InviteResponse, type InviteState } from '@/lib/meeting-invites';

/** 32 random bytes as LOWERCASE hex: mail gateways that lowercase URLs can't break it (see identity-challenge's
 *  randomLinkToken for the 2026-08-16 bug that set this rule). */
function randomInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface MeetingRow {
  id: number;
  entry_date: string;
}

/** A troop meeting whose day hasn't passed (Central), or null. */
async function upcomingMeeting(sb: SupabaseClient, entryId: number): Promise<MeetingRow | null> {
  const { data } = await sb.from('calendar_entries').select('id, entry_date, category').eq('id', entryId).maybeSingle();
  const row = data as (MeetingRow & { category: string }) | null;
  if (!row || row.entry_date < centralToday()) return null;
  const { data: cat } = await sb.from('calendar_categories').select('behavior').eq('label', row.category).maybeSingle();
  return (cat as { behavior: string } | null)?.behavior === 'meeting' ? row : null;
}

export interface SentInvite {
  inviteId: number;
  personId: number;
  name: string;
  sentTo: string;
  /** The raw token, for the email only. Never stored, never logged. */
  token: string;
}

export interface SkippedInvite {
  personId: number;
  name: string;
  reason: string;
}

export type CreateInvitesResult = { ok: true; invites: SentInvite[]; skipped: SkippedInvite[] } | { ok: false; error: string };

/** Mints one teaching invite per person. Who may be invited is decided here, whatever the dialog sent. */
export async function createTeachInvites(
  sb: SupabaseClient,
  input: { entryId: number; topicKey: string; personIds: readonly number[]; sentBy: number | null },
  now: Date = new Date()
): Promise<CreateInvitesResult> {
  const ids = [...new Set(input.personIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return { ok: false, error: 'Tick at least one person to invite.' };
  if (ids.length > INVITE_SEND_CAP) return { ok: false, error: `One send reaches at most ${INVITE_SEND_CAP} people.` };
  const topicKey = input.topicKey.trim();
  if (!topicKey || topicKey.length > 200) return { ok: false, error: 'That isn’t a topic on this board.' };
  const meeting = await upcomingMeeting(sb, input.entryId);
  if (!meeting) return { ok: false, error: 'That meeting has passed, or isn’t a troop meeting.' };

  const since = new Date(now.getTime() - INVITE_DEDUPE_HOURS * 3600_000).toISOString();
  const { data: recent } = await sb
    .from('meeting_invites')
    .select('invitee_person_id')
    .eq('calendar_entry_id', input.entryId)
    .eq('topic_key', topicKey)
    .in('invitee_person_id', ids)
    .gt('sent_at', since);
  const invitedLately = new Set(((recent ?? []) as { invitee_person_id: number }[]).map((r) => r.invitee_person_id));

  const invites: SentInvite[] = [];
  const skipped: SkippedInvite[] = [];
  for (const personId of ids) {
    const who = await identityForPerson(sb, personId, null);
    const name = who?.displayName ?? `Person ${personId}`;
    if (!who) {
      skipped.push({ personId, name, reason: 'not an active member' });
      continue;
    }
    if (who.subjectKind !== 'adult') {
      skipped.push({ personId, name, reason: 'invites go to adults for now' });
      continue;
    }
    if (invitedLately.has(personId)) {
      skipped.push({ personId, name, reason: `already invited in the last ${INVITE_DEDUPE_HOURS} hours` });
      continue;
    }
    const sentTo = await deliverableEmailFor(sb, personId);
    if (!sentTo) {
      skipped.push({ personId, name, reason: 'no email on file' });
      continue;
    }
    const token = randomInviteToken();
    const { data, error } = await sb
      .from('meeting_invites')
      .insert({
        calendar_entry_id: input.entryId,
        topic_key: topicKey,
        kind: 'teach',
        invitee_person_id: personId,
        recipient_person_id: personId,
        sent_to: sentTo,
        invitee_epoch: who.epoch,
        token_hash: await hashSecret(token),
        expires_at: inviteExpiresAt(meeting.entry_date),
        sent_by: input.sentBy
      })
      .select('id')
      .single();
    if (error || !data) {
      skipped.push({ personId, name, reason: 'couldn’t be saved' });
      continue;
    }
    invites.push({ inviteId: (data as { id: number }).id, personId, name, sentTo, token });
  }
  return { ok: true, invites, skipped };
}

/** Undo a mint whose email never went out, so the board doesn't count it as invited. */
export async function deleteInvites(sb: SupabaseClient, inviteIds: readonly number[]): Promise<void> {
  if (inviteIds.length) await sb.from('meeting_invites').delete().in('id', [...inviteIds]);
}

interface InviteRow {
  id: number;
  calendar_entry_id: number;
  topic_key: string;
  kind: 'teach' | 'pick';
  invitee_person_id: number;
  invitee_epoch: number;
  expires_at: string;
  consumed_at: string | null;
  response: InviteResponse | null;
}
const INVITE_COLS = 'id, calendar_entry_id, topic_key, kind, invitee_person_id, invitee_epoch, expires_at, consumed_at, response';

export interface InviteView {
  id: number;
  entryId: number;
  topicKey: string;
  inviteeName: string;
  meetingDate: string;
  response: InviteResponse | null;
}

/** Read-only: what a link is, for the GET of /i/<token>. Writes NOTHING (a scanner's prefetch must not spend it). */
export async function inspectInvite(sb: SupabaseClient, token: string, now: Date = new Date()): Promise<{ state: InviteState; invite: InviteView | null }> {
  if (!/^[0-9a-f]{64}$/i.test(token)) return { state: 'unknown', invite: null };
  const { data } = await sb.from('meeting_invites').select(INVITE_COLS).eq('token_hash', await hashSecret(token.toLowerCase())).maybeSingle();
  const row = data as InviteRow | null;
  if (!row) return { state: 'unknown', invite: null };
  const [{ data: person }, { data: entry }] = await Promise.all([
    sb.from('people').select('display_name').eq('id', row.invitee_person_id).maybeSingle(),
    sb.from('calendar_entries').select('entry_date').eq('id', row.calendar_entry_id).maybeSingle()
  ]);
  return {
    state: inviteState(row, now),
    invite: {
      id: row.id,
      entryId: row.calendar_entry_id,
      topicKey: row.topic_key,
      inviteeName: (person as { display_name: string } | null)?.display_name ?? '',
      meetingDate: (entry as { entry_date: string } | null)?.entry_date ?? '',
      response: row.response
    }
  };
}

export type RespondResult =
  | { ok: true; response: InviteResponse; inviteId: number; inviteeId: number }
  | { ok: false; state: InviteState; error?: string; code?: 'full' | 'save' };

/** Answers an invite: yes adds the teaching commitment for the invitee; no records the no. Single use. */
export async function respondToInvite(sb: SupabaseClient, token: string, answer: 'accept' | 'decline', now: Date = new Date()): Promise<RespondResult> {
  if (!/^[0-9a-f]{64}$/i.test(token)) return { ok: false, state: 'unknown' };
  const hash = await hashSecret(token.toLowerCase());
  const at = now.toISOString();
  // The claim: one statement, so of two concurrent answers exactly one gets the row back.
  const { data: claimed } = await sb
    .from('meeting_invites')
    .update({ consumed_at: at })
    .eq('token_hash', hash)
    .is('consumed_at', null)
    .gt('expires_at', at)
    .select(INVITE_COLS);
  const row = ((claimed ?? []) as InviteRow[])[0];
  if (!row) return { ok: false, state: (await inspectInvite(sb, token, now)).state };

  // Re-check what may have changed since we sent it. A failure leaves the invite spent with no answer ('void').
  const who = await identityForPerson(sb, row.invitee_person_id, null);
  const meeting = await upcomingMeeting(sb, row.calendar_entry_id);
  if (!who || who.subjectKind !== 'adult' || who.epoch !== row.invitee_epoch || !meeting) {
    return { ok: false, state: 'void', error: 'This invite can’t be answered any more.' };
  }

  if (answer === 'accept') {
    const res = await teachTopic(sb, { personId: row.invitee_person_id, actorPersonId: row.invitee_person_id, leader: false }, [row.calendar_entry_id], { key: row.topic_key }, null);
    if (!res.ok) {
      // Nothing changed, so the invite stays answerable (they can drop another topic and come back).
      const { error: reopen } = await sb.from('meeting_invites').update({ consumed_at: null }).eq('id', row.id);
      const code = res.error?.startsWith('You’re teaching 2') ? 'full' : 'save';
      return reopen ? { ok: false, state: 'void', error: res.error } : { ok: false, state: 'open', error: res.error, code };
    }
  }
  const response: InviteResponse = answer === 'accept' ? 'accepted' : 'declined';
  const { error: saved } = await sb.from('meeting_invites').update({ response, responded_at: at }).eq('id', row.id);
  // A yes is already a commitment on the board even if this write failed; retry it once so the link and the counts agree.
  if (saved) await sb.from('meeting_invites').update({ response, responded_at: at }).eq('id', row.id);
  return { ok: true, response, inviteId: row.id, inviteeId: row.invitee_person_id };
}

/** Per-IP limit on failed answers (qa-lead M4). The raw token is never logged. */
export async function tooManyInviteFailures(sb: SupabaseClient, ip: string | null, now: Date = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - 3600_000).toISOString();
  const { count } = await sb.from('meeting_invite_failures').select('id', { count: 'exact', head: true }).eq('ip', ip ?? '').gt('at', since);
  return (count ?? 0) >= INVITE_FAILURES_PER_HOUR;
}

export async function recordInviteFailure(sb: SupabaseClient, ip: string | null, reason: string): Promise<void> {
  try {
    await sb.from('meeting_invite_failures').insert({ ip: ip ?? '', reason });
    // Only the last hour is ever read; keep a week for anyone looking into abuse, then let it go.
    await sb.from('meeting_invite_failures').delete().lt('at', new Date(Date.now() - 7 * 86400_000).toISOString());
  } catch {
    // Logging a failure must never turn into a failure of its own.
  }
}

/** Invites on one meeting, for the board's counts. */
export async function loadInviteRows(sb: SupabaseClient, entryId: number): Promise<{ topic_key: string; invitee_person_id: number; response: InviteResponse | null }[]> {
  const { data } = await sb.from('meeting_invites').select('topic_key, invitee_person_id, response, sent_at').eq('calendar_entry_id', entryId).order('sent_at');
  return (data ?? []) as { topic_key: string; invitee_person_id: number; response: InviteResponse | null }[];
}
