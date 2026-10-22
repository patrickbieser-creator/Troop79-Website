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
 * P5b reminders (kind 'remind', createReminders) share the table for the dedupe and the log, but carry no token and
 * link to /member/meeting: no redeem path can match one (LINK_KINDS), and the board's counts leave them out.
 * Sender permission is checked at SEND time only (the action's meeting_plan.use); a later loss of that capability
 * doesn't void invites already sent.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { centralToday } from '@/lib/dates';
import { deliverableEmailFor, hashSecret, identityForPerson } from '@/lib/identity-challenge';
import { teachTopic } from '@/lib/meeting-board-supply';
import { loadAdvancementCatalog, type AdvancementCatalog } from '@/lib/advancement-catalog';
import { carryJson, loadBoardScouts, loadEffectivePicks, loadIntents, loadMeetingById, loadScoutBoard } from '@/lib/meeting-board';
import { effectiveIntent } from '@/lib/meeting-board-shared';
import { teacherIntent } from '@/lib/meeting-board-teach';
import { pickableKeys } from '@/lib/meeting-board-picklist';
import { INVITE_DEDUPE_HOURS, INVITE_FAILURES_PER_HOUR, INVITE_SEND_CAP, inviteExpiresAt, REMINDER_SEND_CAP, inviteState, type InviteResponse, type InviteState } from '@/lib/meeting-invites';

/** 32 random bytes as LOWERCASE hex: mail gateways that lowercase URLs can't break it (see identity-challenge's
 *  randomLinkToken for the 2026-08-16 bug that set this rule). */
export function randomInviteToken(): string {
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
export async function upcomingMeeting(sb: SupabaseClient, entryId: number): Promise<MeetingRow | null> {
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
        recipient_epoch: who.epoch,
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
/** True when the rows are gone (or there were none). */
export async function deleteInvites(sb: SupabaseClient, inviteIds: readonly number[]): Promise<boolean> {
  if (!inviteIds.length) return true;
  const { error } = await sb.from('meeting_invites').delete().in('id', [...inviteIds]);
  return !error;
}

interface InviteRow {
  id: number;
  calendar_entry_id: number;
  topic_key: string;
  kind: 'teach' | 'pick';
  invitee_person_id: number;
  invitee_epoch: number;
  recipient_person_id: number;
  /** Null only on rows minted before 20261130100000 (backfilled there). */
  recipient_epoch: number | null;
  expires_at: string;
  consumed_at: string | null;
  response: InviteResponse | null;
}
/** The kinds a link can answer. A reminder ('remind') has no token and is never one of them (P5b). */
const LINK_KINDS = ['teach', 'pick'];
const INVITE_COLS = 'id, calendar_entry_id, topic_key, kind, invitee_person_id, invitee_epoch, recipient_person_id, recipient_epoch, expires_at, consumed_at, response';

export interface InviteView {
  id: number;
  entryId: number;
  kind: 'teach' | 'pick';
  topicKey: string;
  /** The teacher, or the scout a pick invite is about. */
  inviteeId: number;
  inviteeName: string;
  /** The person the link went to (a parent, for a scout's invite). */
  recipientName: string;
  recipientIsInvitee: boolean;
  meetingDate: string;
  response: InviteResponse | null;
}

/** Read-only: what a link is, for the GET of /i/<token>. Writes NOTHING (a scanner's prefetch must not spend it). */
export async function inspectInvite(sb: SupabaseClient, token: string, now: Date = new Date()): Promise<{ state: InviteState; invite: InviteView | null }> {
  if (!/^[0-9a-f]{64}$/i.test(token)) return { state: 'unknown', invite: null };
  const { data } = await sb.from('meeting_invites').select(INVITE_COLS).eq('token_hash', await hashSecret(token.toLowerCase())).in('kind', LINK_KINDS).maybeSingle();
  const row = data as InviteRow | null;
  if (!row) return { state: 'unknown', invite: null };
  const [{ data: people }, { data: entry }] = await Promise.all([
    sb.from('people').select('id, display_name').in('id', [row.invitee_person_id, row.recipient_person_id]),
    sb.from('calendar_entries').select('entry_date').eq('id', row.calendar_entry_id).maybeSingle()
  ]);
  const nameOf = new Map(((people ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name]));
  return {
    state: inviteState(row, now),
    invite: {
      id: row.id,
      entryId: row.calendar_entry_id,
      kind: row.kind,
      topicKey: row.topic_key,
      inviteeId: row.invitee_person_id,
      inviteeName: nameOf.get(row.invitee_person_id) ?? '',
      recipientName: nameOf.get(row.recipient_person_id) ?? '',
      recipientIsInvitee: row.recipient_person_id === row.invitee_person_id,
      meetingDate: (entry as { entry_date: string } | null)?.entry_date ?? '',
      response: row.response
    }
  };
}

export type RespondResult =
  | { ok: true; kind: 'teach' | 'pick'; response: InviteResponse; inviteId: number; inviteeId: number; recipientId: number }
  | { ok: false; state: InviteState; error?: string; code?: 'picks' | 'gone' | 'save' };

export interface RespondDeps {
  now?: Date;
  /** The advancement catalog (a scout's pick list). Injected so tests can pass the uncached fetch. */
  loadCatalog?: () => Promise<AdvancementCatalog>;
}

/** Answers an invite by its link, whichever kind it is. Single use; see the module header for what is re-checked. */
export async function respondToInvite(sb: SupabaseClient, token: string, answer: 'accept' | 'decline', deps: RespondDeps = {}): Promise<RespondResult> {
  if (!/^[0-9a-f]{64}$/i.test(token)) return { ok: false, state: 'unknown' };
  const hash = await hashSecret(token.toLowerCase());
  const { data } = await sb.from('meeting_invites').select('kind').eq('token_hash', hash).in('kind', LINK_KINDS).maybeSingle();
  const kind = (data as { kind: 'teach' | 'pick' } | null)?.kind;
  if (!kind) return { ok: false, state: 'unknown' };
  return kind === 'pick' ? answerPickInvite(sb, token, hash, answer, deps) : answerTeachInvite(sb, token, hash, answer, deps.now ?? new Date());
}

/** P1: yes adds the teaching commitment for the invitee; no records the no. */
async function answerTeachInvite(sb: SupabaseClient, token: string, hash: string, answer: 'accept' | 'decline', now: Date): Promise<RespondResult> {
  const at = now.toISOString();
  // The claim: one statement, so of two concurrent answers exactly one gets the row back.
  const { data: claimed } = await sb
    .from('meeting_invites')
    .update({ consumed_at: at })
    .eq('token_hash', hash)
    .eq('kind', 'teach')
    .is('consumed_at', null)
    .gt('expires_at', at)
    .select(INVITE_COLS);
  const row = ((claimed ?? []) as InviteRow[])[0];
  if (!row) return { ok: false, state: (await inspectInvite(sb, token, now)).state };

  // Re-check what may have changed since we sent it. A failure leaves the invite spent with no answer ('void').
  const who = await identityForPerson(sb, row.invitee_person_id, null);
  const meeting = await upcomingMeeting(sb, row.calendar_entry_id);
  if (!who || who.subjectKind !== 'adult' || who.epoch !== (row.recipient_epoch ?? row.invitee_epoch) || !meeting) {
    return { ok: false, state: 'void', error: 'This invite can’t be answered any more.' };
  }

  if (answer === 'accept') {
    const res = await teachTopic(sb, { personId: row.invitee_person_id, actorPersonId: row.invitee_person_id, leader: false }, [row.calendar_entry_id], { key: row.topic_key }, null);
    if (!res.ok) {
      // Nothing changed, so the invite stays answerable.
      const { error: reopen } = await sb.from('meeting_invites').update({ consumed_at: null }).eq('id', row.id);
      return reopen ? { ok: false, state: 'void', error: res.error } : { ok: false, state: 'open', error: res.error, code: 'save' };
    }
  }
  const response: InviteResponse = answer === 'accept' ? 'accepted' : 'declined';
  const { error: saved } = await sb.from('meeting_invites').update({ response, responded_at: at }).eq('id', row.id);
  // A yes is already a commitment on the board even if this write failed; retry it once so the link and the counts agree.
  if (saved) await sb.from('meeting_invites').update({ response, responded_at: at }).eq('id', row.id);
  return { ok: true, kind: 'teach', response, inviteId: row.id, inviteeId: row.invitee_person_id, recipientId: row.recipient_person_id };
}

/** The pick RPCs' messages that are written for people (meeting_board.sql); anything else stays private. */
const PICK_RPC_KNOWN = /^(You have 5|That meeting has passed|That meeting no longer exists|That isn't something you can pick|There are no picks|Picks are for scouts)/;

/**
 * P2: a scout's invite, answered by the scout or a parent. The whole answer is one database transaction
 * (meeting_answer_pick_invite): claim, re-check the recipient, add the pick as their #1 and mark them coming, close the
 * sibling links. Here only the scout's carried picks are worked out (the RPC needs them for a first write) and a topic
 * the scout can no longer pick (signed off since) is turned back without spending the link.
 */
async function answerPickInvite(sb: SupabaseClient, token: string, hash: string, answer: 'accept' | 'decline', deps: RespondDeps): Promise<RespondResult> {
  let carry: ReturnType<typeof carryJson> = [];
  if (answer === 'accept') {
    // A spent, superseded or expired link says so, before anything is worked out about the scout's list.
    const seen = await inspectInvite(sb, token);
    if (seen.state !== 'open') return { ok: false, state: seen.state };
    const { data } = await sb.from('meeting_invites').select(INVITE_COLS).eq('token_hash', hash).maybeSingle();
    const row = data as InviteRow | null;
    if (!row) return { ok: false, state: 'unknown' };
    const [meeting, scouts] = await Promise.all([loadMeetingById(sb, row.calendar_entry_id), loadBoardScouts(sb, [row.invitee_person_id])]);
    if (meeting && scouts[0]) {
      const catalog = await (deps.loadCatalog ?? loadAdvancementCatalog)();
      const board = await loadScoutBoard(sb, meeting, scouts[0], catalog, { viewerPersonId: row.recipient_person_id });
      const already = board.picks.some((p) => p.key === row.topic_key);
      if (!already && !pickableKeys(board.pickList).has(row.topic_key)) {
        return { ok: false, state: 'open', code: 'gone', error: 'That isn’t on their list any more; it may already be signed off.' };
      }
      carry = board.hasOwnList ? [] : carryJson(board.picks);
    }
  }
  const { data, error } = await sb.rpc('meeting_answer_pick_invite', { p_token_hash: hash, p_answer: answer, p_carry: carry });
  if (error) {
    // Only the pick RPCs' own sentences are ever passed on; anything else (a constraint, a dropped connection) is not
    // shown raw on a public page. The 5-pick refusal gets its own message on the card.
    const known = PICK_RPC_KNOWN.test(error.message) ? error.message : 'That didn’t save. Please try again.';
    return { ok: false, state: 'open', error: known, code: error.message.startsWith('You have 5') ? 'picks' : 'save' };
  }
  const res = data as { state: InviteState; response?: InviteResponse; invite_id?: number; invitee?: number; recipient?: number };
  if (res.response && res.invite_id && res.invitee && res.recipient) {
    return { ok: true, kind: 'pick', response: res.response, inviteId: res.invite_id, inviteeId: res.invitee, recipientId: res.recipient };
  }
  return { ok: false, state: res.state ?? (await inspectInvite(sb, token)).state };
}

export interface PickInviteScout {
  scoutId: number;
  scoutName: string;
  inviteId: number;
  /** For the email only; never stored or logged. */
  token: string;
}

/** One email: everyone it reaches about, with a link each. */
export interface PickInviteRecipient {
  recipientId: number;
  name: string;
  sentTo: string;
  /** The scout's own address (13 or older, verified). */
  isScout: boolean;
  scouts: PickInviteScout[];
}

export type CreatePickInvitesResult = { ok: true; recipients: PickInviteRecipient[]; skipped: SkippedInvite[] } | { ok: false; error: string };

/** Emails one send may make, whatever the scouts' families look like (qa-lead: cap emails, not only scouts). */
export const PICK_INVITE_EMAIL_CAP = 100;

/** A scout's own inbox only from 13, and only a verified address; younger scouts are reached through their parents. */
export function scoutMayBeMailed(birthdate: string | null, meetingDate: string): boolean {
  if (!birthdate) return false;
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [my, mm, md] = meetingDate.split('-').map(Number);
  const age = my - by - (mm < bm || (mm === bm && md < bd) ? 1 : 0);
  return age >= 13;
}

type FamilyPerson = { id: number; display_name: string; active: boolean; session_epoch: number; birthdate: string | null; primary_email: string | null };

/** The scouts, their parents (parent_of) and the scouts' own verified addresses: what scoutRecipients decides from. */
export interface ScoutFamilies {
  person: Map<number, FamilyPerson>;
  parentsOf: Map<number, number[]>;
  verifiedEmail: Map<number, string>;
}

export async function loadScoutFamilies(sb: SupabaseClient, scoutIds: readonly number[]): Promise<ScoutFamilies> {
  const ids = [...scoutIds];
  const parentsOf = new Map<number, number[]>();
  if (!ids.length) return { person: new Map(), parentsOf, verifiedEmail: new Map() };
  const { data: rels } = await sb.from('relationships').select('person_id, related_person_id').eq('type', 'parent_of').in('related_person_id', ids);
  for (const r of (rels ?? []) as { person_id: number; related_person_id: number }[]) parentsOf.set(r.related_person_id, [...(parentsOf.get(r.related_person_id) ?? []), r.person_id]);
  const everyone = [...new Set([...ids, ...[...parentsOf.values()].flat()])];
  const [{ data: peopleRows }, { data: verified }] = await Promise.all([
    sb.from('people').select('id, display_name, active, session_epoch, birthdate, primary_email').in('id', everyone),
    sb.from('person_emails').select('person_id, email').in('person_id', ids).eq('is_primary', true).not('verified_at', 'is', null).is('bounced_at', null).is('unsubscribed_at', null)
  ]);
  return {
    person: new Map(((peopleRows ?? []) as FamilyPerson[]).map((p) => [p.id, p])),
    parentsOf,
    verifiedEmail: new Map(((verified ?? []) as { person_id: number; email: string }[]).map((e) => [e.person_id, e.email]))
  };
}

/**
 * Who a scout's email goes to (P2 offers, P5b reminders; Decision 11): each parent who is still active, has an address,
 * and may act for the scout (an adult in their household, the rule an answer is held to), plus the scout from 13 with
 * a verified address of their own. The caller refuses a scout with no parent in the list.
 */
async function scoutRecipients(
  sb: SupabaseClient,
  family: ScoutFamilies,
  scoutId: number,
  meetingDate: string
): Promise<{ recipientId: number; sentTo: string; epoch: number; isScout: boolean }[]> {
  const out: { recipientId: number; sentTo: string; epoch: number; isScout: boolean }[] = [];
  for (const parentId of family.parentsOf.get(scoutId) ?? []) {
    const parent = family.person.get(parentId);
    if (!parent?.active || !parent.primary_email) continue;
    const { data: may } = await sb.rpc('_meeting_may_act_for', { p_actor: parentId, p_target: scoutId, p_leader: false });
    if (may !== true) continue;
    out.push({ recipientId: parentId, sentTo: parent.primary_email, epoch: parent.session_epoch, isScout: false });
  }
  const self = family.person.get(scoutId);
  const own = family.verifiedEmail.get(scoutId);
  if (self && own && scoutMayBeMailed(self.birthdate, meetingDate)) out.push({ recipientId: scoutId, sentTo: own, epoch: self.session_epoch, isScout: true });
  return out;
}

/** Who an email reaches: a scout's parent, the scout themself, or an adult. */
export interface MailRecipient {
  recipientId: number;
  sentTo: string;
  epoch: number;
  isScout: boolean;
}

/**
 * Build a Plan B3: scoutRecipients for many scouts in ONE round trip (meeting_may_act_for_many, the same rule per pair),
 * so the invite sheet and the digest send decide alike however many families there are. A scout with no parent in
 * their list is the caller's to refuse.
 */
export async function scoutRecipientsMany(sb: SupabaseClient, family: ScoutFamilies, scoutIds: readonly number[], meetingDate: string): Promise<Map<number, MailRecipient[]>> {
  const pairs = scoutIds.flatMap((target) =>
    (family.parentsOf.get(target) ?? []).filter((actor) => family.person.get(actor)?.active && family.person.get(actor)?.primary_email).map((actor) => ({ actor, target }))
  );
  const may = new Set<string>();
  if (pairs.length) {
    const { data, error } = await sb.rpc('meeting_may_act_for_many', { p_pairs: pairs });
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { actor: number; target: number }[]) may.add(`${r.actor}:${r.target}`);
  }
  const out = new Map<number, MailRecipient[]>();
  for (const scoutId of scoutIds) {
    const list: MailRecipient[] = [];
    for (const parentId of family.parentsOf.get(scoutId) ?? []) {
      const parent = family.person.get(parentId);
      if (!parent?.primary_email || !may.has(`${parentId}:${scoutId}`)) continue;
      list.push({ recipientId: parentId, sentTo: parent.primary_email, epoch: parent.session_epoch, isScout: false });
    }
    const self = family.person.get(scoutId);
    const own = family.verifiedEmail.get(scoutId);
    if (self && own && scoutMayBeMailed(self.birthdate, meetingDate)) list.push({ recipientId: scoutId, sentTo: own, epoch: self.session_epoch, isScout: true });
    out.set(scoutId, list);
  }
  return out;
}

/**
 * Build a Plan B3: the adults a teach ask may go to, in two reads (identityForPerson's rule, batched): an active person
 * in the directory who isn't an active scout, with a primary address. Anyone else is absent from the map.
 */
export async function adultRecipients(sb: SupabaseClient, personIds: readonly number[]): Promise<Map<number, MailRecipient & { name: string }>> {
  const ids = [...new Set(personIds)];
  const out = new Map<number, MailRecipient & { name: string }>();
  if (!ids.length) return out;
  const [{ data: dir, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
    sb.from('person_directory').select('person_id, tab').in('person_id', ids),
    sb.from('people').select('id, display_name, active, session_epoch, primary_email').in('id', ids)
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  const adult = new Set(((dir ?? []) as { person_id: number; tab: string }[]).filter((d) => d.tab !== 'active_scout').map((d) => d.person_id));
  for (const p of (rows ?? []) as { id: number; display_name: string; active: boolean; session_epoch: number | null; primary_email: string | null }[]) {
    const to = p.primary_email?.trim();
    if (!adult.has(p.id) || !p.active || p.session_epoch == null || !to) continue;
    out.set(p.id, { recipientId: p.id, sentTo: to, epoch: p.session_epoch, isScout: false, name: p.display_name });
  }
  return out;
}

/**
 * P2: offers one topic to the ticked scouts. Parents are ALWAYS copied (Patrick); the scout too when 13 or older with a
 * verified address. Everything about who is reached is decided here, never by the dialog: each scout must still be an
 * active scout who can pick the topic, each parent must still be their parent and an adult in their household (the
 * rule the answer is held to), and each address deliverable.
 */
export async function createPickInvites(
  sb: SupabaseClient,
  input: { entryId: number; topicKey: string; scoutIds: readonly number[]; sentBy: number | null },
  deps: { now?: Date; loadCatalog?: () => Promise<AdvancementCatalog> } = {}
): Promise<CreatePickInvitesResult> {
  const now = deps.now ?? new Date();
  const ids = [...new Set(input.scoutIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return { ok: false, error: 'Tick at least one scout.' };
  if (ids.length > INVITE_SEND_CAP) return { ok: false, error: `One send reaches at most ${INVITE_SEND_CAP} scouts.` };
  const topicKey = input.topicKey.trim();
  if (!topicKey || topicKey.length > 200) return { ok: false, error: 'That isn’t a topic on this board.' };
  const meetingRow = await upcomingMeeting(sb, input.entryId);
  const meeting = meetingRow ? await loadMeetingById(sb, input.entryId) : null;
  if (!meetingRow || !meeting) return { ok: false, error: 'That meeting has passed, or isn’t a troop meeting.' };
  if (meeting.closed) return { ok: false, error: 'This meeting has no picks.' };

  const since = new Date(now.getTime() - INVITE_DEDUPE_HOURS * 3600_000).toISOString();
  const { data: recent } = await sb
    .from('meeting_invites')
    .select('invitee_person_id')
    .eq('calendar_entry_id', input.entryId)
    .eq('topic_key', topicKey)
    .eq('kind', 'pick')
    .in('invitee_person_id', ids)
    .gt('sent_at', since);
  const invitedLately = new Set(((recent ?? []) as { invitee_person_id: number }[]).map((r) => r.invitee_person_id));

  const catalog = await (deps.loadCatalog ?? loadAdvancementCatalog)();
  const scouts = new Map((await loadBoardScouts(sb, ids)).map((s) => [s.personId, s]));
  const family = await loadScoutFamilies(sb, ids);
  const person = family.person;

  type Plan = { scoutId: number; scoutName: string; recipientId: number; sentTo: string; epoch: number; isScout: boolean };
  const plans: Plan[] = [];
  const skipped: SkippedInvite[] = [];
  for (const scoutId of ids) {
    const scout = scouts.get(scoutId);
    const name = person.get(scoutId)?.display_name ?? scout?.name ?? `Person ${scoutId}`;
    if (!scout) {
      skipped.push({ personId: scoutId, name, reason: 'not an active scout' });
      continue;
    }
    if (invitedLately.has(scoutId)) {
      skipped.push({ personId: scoutId, name, reason: `already invited in the last ${INVITE_DEDUPE_HOURS} hours` });
      continue;
    }
    const board = await loadScoutBoard(sb, meeting, scout, catalog, { viewerPersonId: null });
    if (!pickableKeys(board.pickList).has(topicKey)) {
      skipped.push({ personId: scoutId, name, reason: 'already done, or not something they can pick' });
      continue;
    }
    const mine = await scoutRecipients(sb, family, scoutId, meeting.date);
    if (!mine.some((m) => !m.isScout)) {
      skipped.push({ personId: scoutId, name, reason: 'no parent with an email in their household' });
      continue;
    }
    plans.push(...mine.map((m) => ({ ...m, scoutId, scoutName: name })));
  }
  const emails = new Set(plans.map((x) => x.recipientId)).size;
  if (emails > PICK_INVITE_EMAIL_CAP) return { ok: false, error: `That would send ${emails} emails; one send makes at most ${PICK_INVITE_EMAIL_CAP}.` };

  const recipients = new Map<number, PickInviteRecipient>();
  for (const x of plans) {
    const token = randomInviteToken();
    const { data, error } = await sb
      .from('meeting_invites')
      .insert({
        calendar_entry_id: input.entryId,
        topic_key: topicKey,
        kind: 'pick',
        invitee_person_id: x.scoutId,
        recipient_person_id: x.recipientId,
        sent_to: x.sentTo,
        invitee_epoch: person.get(x.scoutId)?.session_epoch ?? 0,
        recipient_epoch: x.epoch,
        token_hash: await hashSecret(token),
        expires_at: inviteExpiresAt(meeting.date),
        sent_by: input.sentBy
      })
      .select('id')
      .single();
    if (error || !data) continue;
    const r = recipients.get(x.recipientId) ?? { recipientId: x.recipientId, name: person.get(x.recipientId)?.display_name ?? '', sentTo: x.sentTo, isScout: x.isScout, scouts: [] };
    r.scouts.push({ scoutId: x.scoutId, scoutName: x.scoutName, inviteId: (data as { id: number }).id, token });
    recipients.set(x.recipientId, r);
  }
  return { ok: true, recipients: [...recipients.values()], skipped };
}

/** One reminder email: everyone it covers (a parent's unanswered scouts; an adult or a scout themself). */
export interface ReminderRecipient {
  recipientId: number;
  name: string;
  sentTo: string;
  /** The scout's own address (13 or older, verified). */
  isScout: boolean;
  people: { personId: number; name: string; inviteId: number }[];
}

export type CreateRemindersResult = { ok: true; recipients: ReminderRecipient[]; skipped: SkippedInvite[] } | { ok: false; error: string };

/**
 * P5b (Plans/Meeting-Planner-II.md Decision 11): one reminder row per (person, recipient) for the people who haven't
 * answered "Coming Sunday?". Everything is re-decided here, whatever the board sent: a scout who answered (or has a pick
 * for this meeting, which means Coming) or an adult who answered (or is teaching) is skipped, as is anyone reminded in
 * the last 24 hours. A scout's reminder goes to their parents and, from 13, to the scout (scoutRecipients); an adult's
 * to themselves. The rows carry no token: the email links to /member/meeting.
 */
export async function createReminders(
  sb: SupabaseClient,
  input: { entryId: number; personIds: readonly number[]; sentBy: number | null },
  deps: { now?: Date; loadCatalog?: () => Promise<AdvancementCatalog> } = {}
): Promise<CreateRemindersResult> {
  const now = deps.now ?? new Date();
  const ids = [...new Set(input.personIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return { ok: false, error: 'Choose at least one person.' };
  if (ids.length > REMINDER_SEND_CAP) return { ok: false, error: `One send reaches at most ${REMINDER_SEND_CAP} people.` };
  const meetingRow = await upcomingMeeting(sb, input.entryId);
  const meeting = meetingRow ? await loadMeetingById(sb, input.entryId) : null;
  if (!meetingRow || !meeting || meeting.closed) return { ok: false, error: 'That meeting has passed, or isn’t taking sign-ups.' };

  const since = new Date(now.getTime() - INVITE_DEDUPE_HOURS * 3600_000).toISOString();
  const catalog = await (deps.loadCatalog ?? loadAdvancementCatalog)();
  const scouts = await loadBoardScouts(sb, ids);
  const scoutIdSet = new Set(scouts.map((s) => s.personId));
  const [{ data: recent }, intents, picks, { data: topicTeachers }, { data: skillOffers }, family] = await Promise.all([
    sb.from('meeting_invites').select('invitee_person_id').eq('calendar_entry_id', input.entryId).eq('kind', 'remind').in('invitee_person_id', ids).gt('sent_at', since),
    loadIntents(sb, input.entryId, ids),
    loadEffectivePicks(sb, meeting, scouts, catalog),
    sb.from('meeting_topic_teachers').select('person_id').eq('calendar_entry_id', input.entryId).in('person_id', ids),
    sb.from('meeting_teaching_offers').select('person_id').eq('calendar_entry_id', input.entryId).in('person_id', ids),
    loadScoutFamilies(sb, [...scoutIdSet])
  ]);
  const remindedLately = new Set(((recent ?? []) as { invitee_person_id: number }[]).map((r) => r.invitee_person_id));
  const commitments = new Map<number, number>();
  for (const r of [...(topicTeachers ?? []), ...(skillOffers ?? [])] as { person_id: number }[]) commitments.set(r.person_id, (commitments.get(r.person_id) ?? 0) + 1);

  type Plan = { personId: number; name: string; recipientId: number; recipientName: string; sentTo: string; epoch: number; inviteeEpoch: number; isScout: boolean };
  const plans: Plan[] = [];
  const skipped: SkippedInvite[] = [];
  for (const personId of ids) {
    const isScout = scoutIdSet.has(personId);
    // The board's haventAnswered rule: effectiveIntent for a scout, teacherIntent for an adult.
    const answer = isScout ? effectiveIntent(intents.get(personId) ?? null, picks.get(personId)?.picks ?? []) : teacherIntent(intents.get(personId) ?? null, commitments.get(personId) ?? 0);
    if (isScout) {
      const self = family.person.get(personId);
      const name = self?.display_name ?? `Person ${personId}`;
      if (answer) {
        skipped.push({ personId, name, reason: 'already answered' });
        continue;
      }
      if (remindedLately.has(personId)) {
        skipped.push({ personId, name, reason: `reminded in the last ${INVITE_DEDUPE_HOURS} hours` });
        continue;
      }
      const mine = await scoutRecipients(sb, family, personId, meeting.date);
      if (!mine.some((m) => !m.isScout)) {
        skipped.push({ personId, name, reason: 'no parent with an email in their household' });
        continue;
      }
      for (const m of mine) {
        plans.push({ personId, name, recipientId: m.recipientId, recipientName: family.person.get(m.recipientId)?.display_name ?? '', sentTo: m.sentTo, epoch: m.epoch, inviteeEpoch: self?.session_epoch ?? 0, isScout: m.isScout });
      }
      continue;
    }
    const who = await identityForPerson(sb, personId, null);
    const name = who?.displayName ?? `Person ${personId}`;
    if (!who || who.subjectKind !== 'adult') {
      skipped.push({ personId, name, reason: 'not an active member' });
      continue;
    }
    if (answer) {
      skipped.push({ personId, name, reason: 'already answered' });
      continue;
    }
    if (remindedLately.has(personId)) {
      skipped.push({ personId, name, reason: `reminded in the last ${INVITE_DEDUPE_HOURS} hours` });
      continue;
    }
    const sentTo = await deliverableEmailFor(sb, personId);
    if (!sentTo) {
      skipped.push({ personId, name, reason: 'no email on file' });
      continue;
    }
    plans.push({ personId, name, recipientId: personId, recipientName: name, sentTo, epoch: who.epoch, inviteeEpoch: who.epoch, isScout: false });
  }
  const emails = new Set(plans.map((x) => x.recipientId)).size;
  if (emails > REMINDER_SEND_CAP) return { ok: false, error: `That would send ${emails} emails; one send makes at most ${REMINDER_SEND_CAP}.` };

  // The check above gives the plain reasons; meeting_mint_reminders is the backstop. Under a per-meeting lock it
  // re-checks the 24 hours and inserts in one statement, so a double-click or a second editor can't email twice.
  const recipients = new Map<number, ReminderRecipient>();
  if (!plans.length) return { ok: true, recipients: [], skipped };
  const expiresAt = inviteExpiresAt(meeting.date);
  const { data, error } = await sb.rpc('meeting_mint_reminders', {
    p_entry: input.entryId,
    p_since: since,
    p_rows: plans.map((x) => ({
      invitee_person_id: x.personId,
      recipient_person_id: x.recipientId,
      sent_to: x.sentTo,
      invitee_epoch: x.inviteeEpoch,
      recipient_epoch: x.epoch,
      expires_at: expiresAt,
      sent_by: input.sentBy
    }))
  });
  if (error) {
    for (const personId of new Set(plans.map((x) => x.personId))) skipped.push({ personId, name: plans.find((x) => x.personId === personId)!.name, reason: 'couldn’t be saved' });
    return { ok: true, recipients: [], skipped };
  }
  const minted = new Map(((data ?? []) as { invite_id: number; invitee: number; recipient: number }[]).map((m) => [`${m.invitee}:${m.recipient}`, m.invite_id]));
  const told = new Set<number>();
  for (const x of plans) {
    const inviteId = minted.get(`${x.personId}:${x.recipientId}`);
    if (inviteId == null) {
      // Someone else's send got there first.
      if (!told.has(x.personId)) skipped.push({ personId: x.personId, name: x.name, reason: `reminded in the last ${INVITE_DEDUPE_HOURS} hours` });
      told.add(x.personId);
      continue;
    }
    const r = recipients.get(x.recipientId) ?? { recipientId: x.recipientId, name: x.recipientName, sentTo: x.sentTo, isScout: x.isScout, people: [] };
    r.people.push({ personId: x.personId, name: x.name, inviteId });
    recipients.set(x.recipientId, r);
  }
  return { ok: true, recipients: [...recipients.values()], skipped };
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
export async function loadInviteRows(
  sb: SupabaseClient,
  entryId: number
): Promise<{ kind: 'teach' | 'pick'; topic_key: string; invitee_person_id: number; response: InviteResponse | null }[]> {
  // Reminders (P5b) ask nobody to teach or take anything, so they never count as asked.
  const { data } = await sb.from('meeting_invites').select('kind, topic_key, invitee_person_id, response, sent_at').eq('calendar_entry_id', entryId).in('kind', LINK_KINDS).order('sent_at');
  return (data ?? []) as { kind: 'teach' | 'pick'; topic_key: string; invitee_person_id: number; response: InviteResponse | null }[];
}
