/**
 * Build a Plan B3 (Plans/Build-A-Plan.md "Invite…", Decision 2), the database half. Server-only, service role; the
 * caller gates (an adult holding meeting_planner.edit).
 *
 *   loadInviteTab       per offering, the teachers to ask and the scouts to offer it to, each with who the email would
 *                       reach (the Invite tab, B6). Bounded: the same round trips for one offering or all of them (pinned in a test).
 *   createInviteDigest  mints one row per invite (teach / pick, per recipient, as P1/P2 do) and groups them by
 *                       RECIPIENT: one email each. Who may be invited is re-decided here, whatever the sheet sent:
 *                       a teach ask goes to an active adult with an address; a pick to a scout who can still pick it
 *                       (not done, in reach, not coming = no), hasn't picked it, with a parent who may act for them.
 *                       The 24-hour dedupe per (meeting, kind, topic, invitee, RECIPIENT) is checked for the reasons and
 *                       again in meeting_mint_invites under a per-meeting lock, so a double-click can't email twice. Per
 *                       recipient (qa-lead B3 #3): when one parent's email went out and the other's failed (its rows
 *                       deleted), sending again inside 24 hours reaches the parent who missed it, and only them.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAdvancementCatalog, type AdvancementCatalog } from '@/lib/advancement-catalog';
import { loadMeetingById } from '@/lib/meeting-board';
import { nextRankOf, topicWords } from '@/lib/meeting-board-picklist';
import { INVITE_DEDUPE_HOURS, inviteExpiresAt } from '@/lib/meeting-invites';
import { hashSecret } from '@/lib/identity-challenge';
import { adultRecipients, loadInviteRows, loadScoutFamilies, NO_EMAIL_ON_FILE, randomInviteToken, scoutRecipientsMany, upcomingMeeting, type InviteHistory, type MailRecipient } from '@/lib/meeting-invites-db';
import { loadHouseholds } from '@/lib/households';
import { boardName } from '@/lib/meeting-board-shared';
import { scoutCandidatesMany } from '@/lib/meeting-invites-send';
import { loadTeacherChoicesMany } from '@/lib/build-plan-db';
import { likelyNames } from '@/lib/build-plan';
import { DIGEST_EMAIL_CAP, DIGEST_INVITE_CAP, DIGEST_KEYS_MAX, inviteChips, scoutsHelped, tickId, type InviteKind, type ScoutsHelped, type InvitePerson, type InviteRecipient, type InviteSection, type InviteTabData } from '@/lib/meeting-invite-digest';

const LINK_KINDS = ['teach', 'pick'];

/** Who was invited lately, as `${kind}|${key}|${invitee}|${recipient}`: one email reached that recipient about them. */
async function invitedLately(sb: SupabaseClient, entryId: number, keys: readonly string[], since: string): Promise<Set<string>> {
  const { data, error } = await sb
    .from('meeting_invites')
    .select('kind, topic_key, invitee_person_id, recipient_person_id')
    .eq('calendar_entry_id', entryId)
    .in('kind', LINK_KINDS)
    .in('topic_key', [...keys])
    .gt('sent_at', since);
  if (error) throw new Error(error.message);
  return new Set(
    ((data ?? []) as { kind: string; topic_key: string; invitee_person_id: number; recipient_person_id: number }[]).map(
      (r) => `${r.kind}|${r.topic_key}|${r.invitee_person_id}|${r.recipient_person_id}`
    )
  );
}

/**
 * Build a Plan's "Likely: …" line (Patrick, 2026-10-22): per key, the scouts Invite… would mark likely (who haven't
 * picked it), by name. One scoutCandidatesMany for every key, so the round trips don't grow with the plan (pinned).
 */
export async function loadLikelyScouts(
  sb: SupabaseClient,
  entryId: number,
  keys: readonly string[],
  deps: { loadCatalog?: () => Promise<AdvancementCatalog> } = {}
): Promise<Record<string, string[]>> {
  if (!keys.length) return {};
  const [catalog, cands] = await Promise.all([(deps.loadCatalog ?? loadAdvancementCatalog)(), scoutCandidatesMany(sb, { entryId, keys }, deps)]);
  if (!cands.ok) throw new Error(cands.error);
  return Object.fromEntries(keys.map((key) => [key, likelyNames(cands.byKey.get(key) ?? [], key, catalog.ranks)]));
}

/** How many qualified adults an offering shows before "Show everyone who could teach (n)" (B6). */
export const TOP_TEACHERS = 5;

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The Invite tab's data (B6) for some of a meeting's offerings, in a bounded number of round trips whatever the
 * number of offerings (pinned in a test): ONE scoutCandidatesMany for every key, ONE teacher-choices batch, ONE read
 * of the meeting's invite history (or the caller's, when it already read it), then the recipients' families.
 *
 *   Teachers, in tiers: whoever teaches it (a locked line), pending asks (asked, no answer yet), the top
 *   TOP_TEACHERS qualified adults (counselors first), the rest of the adults, then scouts who could teach (labelled,
 *   asked in person: a teach email goes to adults only).
 *   Scouts: every candidate (scoutCandidatesMany), "likely" by the one rule (lib/build-plan likelyFit), with a reason
 *   line ("Working on First Class · mix covers 4a, 5c · Coming") and who the email reaches ("Parents: Dana R, Rob R").
 *   Chips come from the whole history (inviteChips): Yes, Can't, Asked Tue, Asked <24h; Picked it from the board.
 *   Anyone reached about it in the last 24 hours, or whose email would reach nobody, is blocked with the reason.
 */
export async function loadInviteTab(
  sb: SupabaseClient,
  meeting: { entryId: number; date: string },
  keys: readonly string[],
  deps: { now?: Date; loadCatalog?: () => Promise<AdvancementCatalog>; history?: readonly InviteHistory[] } = {}
): Promise<InviteTabData> {
  if (!keys.length) return { sections: [], recipients: {} };
  const now = deps.now ?? new Date();
  const since = new Date(now.getTime() - INVITE_DEDUPE_HOURS * 3600_000).toISOString();
  const [catalog, teach, cands, history] = await Promise.all([
    (deps.loadCatalog ?? loadAdvancementCatalog)(),
    loadTeacherChoicesMany(sb, meeting, keys),
    scoutCandidatesMany(sb, { entryId: meeting.entryId, keys }, deps),
    deps.history ? Promise.resolve(deps.history) : loadInviteRows(sb, meeting.entryId)
  ]);
  if (!cands.ok) throw new Error(cands.error);
  const chips = inviteChips(history, now);
  const lately = new Set(history.filter((r) => (r.sent_at ?? '') > since).map((r) => `${r.kind}|${r.topic_key}|${r.invitee_person_id}|${r.recipient_person_id}`));
  const isAdult = (id: number) => teach.people.get(id)?.kind === 'adult';
  const teacherIds = [...new Set([...teach.choices.values()].flat().filter((c) => c.qualified && !c.teaching && isAdult(c.personId)).map((c) => c.personId))];
  const scoutIds = [...new Set([...cands.byKey.values()].flat().map((c) => c.personId))];
  const [adults, family, households] = await Promise.all([adultRecipients(sb, teacherIds), loadScoutFamilies(sb, scoutIds), loadHouseholds()]);
  const reach = await scoutRecipientsMany(sb, family, scoutIds, meeting.date);
  const recipientIds = [...new Set([...adults.to.keys(), ...[...reach.values()].flat().map((r) => r.recipientId)])];
  const { data: names } = recipientIds.length ? await sb.from('people').select('id, nickname, first_name, display_name').in('id', recipientIds) : { data: [] };
  const rankName = new Map(catalog.ranks.map((r) => [r.id, r.display_name]));

  const recipients: Record<number, InviteRecipient> = {};
  const scoutRecipient = new Set([...reach.values()].flat().filter((r) => r.isScout).map((r) => r.recipientId));
  for (const p of (names ?? []) as { id: number; nickname: string | null; first_name: string | null; display_name: string }[]) {
    const home = households.find((h) => h.scouts.some((x) => x.personId === p.id) || h.adults.some((x) => x.personId === p.id));
    recipients[p.id] = {
      name: boardName(p.display_name),
      first: p.nickname || p.first_name || p.display_name,
      family: home?.key ?? `person:${p.id}`,
      familyLabel: home?.label ?? boardName(p.display_name),
      isScout: scoutRecipient.has(p.id)
    };
  }
  const nameOf = (id: number) => recipients[id]?.name ?? '';
  const chipOf = (kind: 'teach' | 'pick', key: string, id: number) => chips.get(tickId(kind, key, id));

  const sections = keys.map((key): InviteSection => {
    const choices = (teach.choices.get(key) ?? []).filter((c) => c.qualified || c.teaching);
    let shown = 0;
    const teachers: InvitePerson[] = choices.map((c) => {
      const chip = chipOf('teach', key, c.personId);
      const base = { personId: c.personId, name: c.name, reason: c.reason ?? '', counselor: c.counselor, likely: true, chip: chip?.chip, askedAt: chip?.at ?? null };
      if (c.teaching) return { ...base, tier: 'assigned' as const, recipients: [], blocked: 'Teaching it', to: '' };
      if (!isAdult(c.personId)) return { ...base, reason: [c.reason, 'Scout'].filter(Boolean).join(' · '), tier: 'scout' as const, recipients: [], blocked: 'Ask a scout in person', to: '' };
      const to = adults.to.get(c.personId);
      const blocked = lately.has(`teach|${key}|${c.personId}|${c.personId}`) ? `asked in the last ${INVITE_DEDUPE_HOURS} hours` : !to ? (adults.why.get(c.personId) ?? NO_EMAIL_ON_FILE) : null;
      const pending = chip?.chip === 'recent' || chip?.chip === 'asked';
      const tier = pending ? ('pending' as const) : shown++ < TOP_TEACHERS ? ('top' as const) : ('more' as const);
      return { ...base, tier, recipients: to ? [c.personId] : [], blocked, to: to ? nameOf(c.personId) || c.name : '' };
    });
    const order: Record<string, number> = { assigned: 0, pending: 1, top: 2, more: 3, scout: 4 };
    teachers.sort((a, b) => order[a.tier!] - order[b.tier!]);

    const scouts: InvitePerson[] = (cands.byKey.get(key) ?? [])
      .map((c) => {
        const working = nextRankOf(c.currentRank ?? null, catalog.ranks);
        const all = reach.get(c.personId) ?? [];
        const hasParent = all.some((r) => !r.isScout);
        // Only the recipients not reached about this lately: after a partial failure, just the one who missed it.
        const to = all.filter((r) => !lately.has(`pick|${key}|${c.personId}|${r.recipientId}`)).map((r) => r.recipientId);
        const picked = !c.ticked;
        const blocked = picked ? 'Picked it already' : !hasParent ? 'no parent with an email' : !to.length ? `offered in the last ${INVITE_DEDUPE_HOURS} hours` : null;
        const answer = capital(c.note.split(' · ')[0]);
        const reason = [
          c.badge ? `${c.badge} in progress` : working ? `Working on ${rankName.get(working) ?? working}` : null,
          c.covers?.length ? `mix covers ${c.covers.join(', ')}` : null,
          answer
        ]
          .filter(Boolean)
          .join(' · ');
        const parents = all.filter((r) => !r.isScout).map((r) => nameOf(r.recipientId) || boardName(family.person.get(r.recipientId)?.display_name ?? ''));
        const self = all.some((r) => r.isScout);
        const words = [parents.length ? `${parents.length === 1 ? 'Parent' : 'Parents'}: ${parents.join(', ')}` : null, self ? `${c.name} (own email)` : null].filter(Boolean).join(' · ');
        const chip = picked ? { chip: 'picked' as const, at: null } : chipOf('pick', key, c.personId);
        return { personId: c.personId, name: c.name, reason, likely: !picked && (c.likely ?? false), recipients: hasParent && !picked ? to : [], blocked, chip: chip?.chip, askedAt: chip?.at ?? null, to: words, ...(c.isTest ? { isTest: true } : {}) };
      })
      .sort((a, b) => Number(b.likely) - Number(a.likely) || a.name.localeCompare(b.name));
    // B10a: the Preview's teach line shows the minutes the send would: the same topicWords call as inviteWords, with the
    // meeting's mixes from the board load already made (qa-lead B10a #2).
    const minutes = topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, cands.words?.titles, { mbReqs: catalog.meritBadgeRequirements, members: cands.words?.members })?.minutes ?? null;
    return { key, teachers, scouts, minutes };
  });
  return { sections, recipients };
}

export interface DigestInvite {
  inviteId: number;
  /** For the email only; never stored or logged. */
  token: string;
  kind: InviteKind;
  key: string;
  inviteeId: number;
  inviteeName: string;
}

/** One email: everything for one recipient. */
export interface DigestRecipient {
  recipientId: number;
  name: string;
  sentTo: string;
  /** The scout's own address (13 or older, verified). */
  isScout: boolean;
  invites: DigestInvite[];
}

export interface DigestSkip {
  personId: number;
  name: string;
  key: string;
  reason: string;
}

export interface DigestInput {
  entryId: number;
  teach: readonly { key: string; personIds: readonly number[] }[];
  pick: readonly { key: string; scoutIds: readonly number[] }[];
  sentBy: number | null;
}

export type CreateDigestResult =
  | {
      ok: true;
      recipients: DigestRecipient[];
      skipped: DigestSkip[];
      /** B10a: per teach key, the scouts it would help (scoutsHelped), snapshotted now, at send time. */
      helped?: Record<string, ScoutsHelped>;
    }
  | { ok: false; error: string };

const ids = (xs: readonly number[]) => [...new Set(xs.filter((n) => Number.isInteger(n) && n > 0))];

export async function createInviteDigest(
  sb: SupabaseClient,
  input: DigestInput,
  deps: { now?: Date; loadCatalog?: () => Promise<AdvancementCatalog> } = {}
): Promise<CreateDigestResult> {
  const teach = input.teach.map((t) => ({ key: t.key.trim(), ids: ids(t.personIds) })).filter((t) => t.ids.length);
  const pick = input.pick.map((p) => ({ key: p.key.trim(), ids: ids(p.scoutIds) })).filter((p) => p.ids.length);
  const keys = [...new Set([...teach, ...pick].map((x) => x.key))];
  if (!keys.length) return { ok: false, error: 'Tick at least one person.' };
  if (keys.length > DIGEST_KEYS_MAX || keys.some((k) => !k || k.length > 200)) return { ok: false, error: 'Malformed request' };
  const asked = [...teach, ...pick].reduce((n, x) => n + x.ids.length, 0);
  if (asked > DIGEST_INVITE_CAP) return { ok: false, error: `One send makes at most ${DIGEST_INVITE_CAP} invites.` };
  const meetingRow = await upcomingMeeting(sb, input.entryId);
  const meeting = meetingRow ? await loadMeetingById(sb, input.entryId) : null;
  if (!meetingRow || !meeting) return { ok: false, error: 'That meeting has passed, or isn’t a troop meeting.' };
  if (meeting.closed) return { ok: false, error: 'This meeting has no picks.' };

  const now = deps.now ?? new Date();
  const since = new Date(now.getTime() - INVITE_DEDUPE_HOURS * 3600_000).toISOString();
  // One scoutCandidatesMany for every key: the picks' checks and the teach lines' scouts (B10a) from one board load.
  const [lately, adults, cands] = await Promise.all([
    invitedLately(sb, input.entryId, keys, since),
    adultRecipients(sb, teach.flatMap((t) => t.ids)),
    scoutCandidatesMany(sb, { entryId: input.entryId, keys }, deps)
  ]);
  if (!cands.ok) return cands;
  const helped: Record<string, ScoutsHelped> = Object.fromEntries(
    [...new Set(teach.map((t) => t.key))].map((k) => [
      k,
      scoutsHelped((cands.byKey.get(k) ?? []).map((c) => ({ name: c.name, picked: !c.ticked, likely: c.likely ?? false, intent: c.intent, isTest: c.isTest })))
    ])
  );
  const lateReason = `already invited in the last ${INVITE_DEDUPE_HOURS} hours`;

  type Plan = MailRecipient & { kind: InviteKind; key: string; inviteeId: number; inviteeName: string; inviteeEpoch: number; recipientName: string };
  const plans: Plan[] = [];
  const skipped: DigestSkip[] = [];
  for (const t of teach) {
    for (const personId of t.ids) {
      const who = adults.to.get(personId);
      if (!who) {
        skipped.push({ personId, name: `Person ${personId}`, key: t.key, reason: adults.why.get(personId) ?? 'not an adult with an email on file' });
        continue;
      }
      if (lately.has(`teach|${t.key}|${personId}|${personId}`)) {
        skipped.push({ personId, name: who.name, key: t.key, reason: lateReason });
        continue;
      }
      plans.push({ ...who, kind: 'teach', key: t.key, inviteeId: personId, inviteeName: who.name, inviteeEpoch: who.epoch, recipientName: who.name });
    }
  }
  const byKey = cands.byKey;
  const passing: { key: string; scoutId: number; name: string }[] = [];
  for (const p of pick) {
    for (const scoutId of p.ids) {
      const c = (byKey.get(p.key) ?? []).find((x: { personId: number }) => x.personId === scoutId);
      if (!c) {
        skipped.push({ personId: scoutId, name: `Person ${scoutId}`, key: p.key, reason: 'already done, or not something they can pick' });
        continue;
      }
      if (!c.ticked) {
        skipped.push({ personId: scoutId, name: c.name, key: p.key, reason: 'already picked it' });
        continue;
      }
      passing.push({ key: p.key, scoutId, name: c.name });
    }
  }
  if (passing.length) {
    const scoutIds = [...new Set(passing.map((x) => x.scoutId))];
    const family = await loadScoutFamilies(sb, scoutIds);
    const reach = await scoutRecipientsMany(sb, family, scoutIds, meeting.date);
    for (const x of passing) {
      const mine = reach.get(x.scoutId) ?? [];
      if (!mine.some((m) => !m.isScout)) {
        skipped.push({ personId: x.scoutId, name: x.name, key: x.key, reason: 'no parent with an email in their household' });
        continue;
      }
      const fresh = mine.filter((m) => !lately.has(`pick|${x.key}|${x.scoutId}|${m.recipientId}`));
      if (!fresh.length) {
        skipped.push({ personId: x.scoutId, name: x.name, key: x.key, reason: lateReason });
        continue;
      }
      const epoch = family.person.get(x.scoutId)?.session_epoch ?? 0;
      for (const m of fresh) {
        plans.push({ ...m, kind: 'pick', key: x.key, inviteeId: x.scoutId, inviteeName: x.name, inviteeEpoch: epoch, recipientName: family.person.get(m.recipientId)?.display_name ?? '' });
      }
    }
  }
  const emails = new Set(plans.map((x) => x.recipientId)).size;
  if (emails > DIGEST_EMAIL_CAP) return { ok: false, error: `That would send ${emails} emails; one send makes at most ${DIGEST_EMAIL_CAP}.` };
  if (!plans.length) return { ok: true, recipients: [], skipped, helped };

  const tokens = await Promise.all(plans.map(async () => {
    const token = randomInviteToken();
    return { token, hash: await hashSecret(token) };
  }));
  const expiresAt = inviteExpiresAt(meeting.date);
  const { data, error } = await sb.rpc('meeting_mint_invites', {
    p_entry: input.entryId,
    p_since: since,
    p_rows: plans.map((x, i) => ({
      kind: x.kind,
      topic_key: x.key,
      invitee_person_id: x.inviteeId,
      recipient_person_id: x.recipientId,
      sent_to: x.sentTo,
      invitee_epoch: x.inviteeEpoch,
      recipient_epoch: x.epoch,
      token_hash: tokens[i].hash,
      expires_at: expiresAt,
      sent_by: input.sentBy
    }))
  });
  const told = new Set<string>();
  const tell = (x: Plan, reason: string) => {
    const id = `${x.kind}|${x.key}|${x.inviteeId}`;
    if (!told.has(id)) skipped.push({ personId: x.inviteeId, name: x.inviteeName, key: x.key, reason });
    told.add(id);
  };
  if (error) {
    for (const x of plans) tell(x, 'couldn’t be saved');
    return { ok: true, recipients: [], skipped, helped };
  }
  const minted = new Map(((data ?? []) as { invite_id: number; kind: string; topic_key: string; invitee: number; recipient: number }[]).map((m) => [`${m.kind}|${m.topic_key}|${m.invitee}|${m.recipient}`, m.invite_id]));
  const recipients = new Map<number, DigestRecipient>();
  plans.forEach((x, i) => {
    const inviteId = minted.get(`${x.kind}|${x.key}|${x.inviteeId}|${x.recipientId}`);
    if (inviteId == null) return tell(x, lateReason); // someone else's send got there first
    const r = recipients.get(x.recipientId) ?? { recipientId: x.recipientId, name: x.recipientName, sentTo: x.sentTo, isScout: x.isScout, invites: [] };
    r.invites.push({ inviteId, token: tokens[i].token, kind: x.kind, key: x.key, inviteeId: x.inviteeId, inviteeName: x.inviteeName });
    recipients.set(x.recipientId, r);
  });
  return { ok: true, recipients: [...recipients.values()], skipped, helped };
}
