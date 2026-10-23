/**
 * Build a Plan B3 (Plans/Build-A-Plan.md, "Invite…", Decision 2) and B6 (the Invite tab): the invite rules, PURE and
 * client-safe.
 *
 * Per offering, the teachers to ask and the scouts to offer it to, each with who their email would reach
 * (`recipients`). Sending groups every ticked invite by RECIPIENT, so the number on "Send N emails" is the size of the
 * union of the ticked people's recipients: the same grouping the digest send makes (one email per recipient).
 *
 * B6 adds: status chips from the whole meeting's invite history (inviteChips), the teacher tiers, the per-send caps with
 * overflow marked in place (sendPlan), the Review grouped by family (reviewGroups), and the By person view (byPerson).
 */

import { boardName, type Intent } from '@/lib/meeting-board-shared';

export interface InvitePerson {
  personId: number;
  name: string;
  /** One line: why they fit ('Teaches First aid', 'Working on Tenderfoot · Coming'). */
  reason: string;
  counselor?: boolean;
  /** Likely (lib/build-plan likelyFit); the rest sit behind "Show all eligible". Teachers are all likely. */
  likely: boolean;
  /** Who the email would go to: the adult themself; a scout's parents (and the scout from 13, verified). */
  recipients: number[];
  /** Why they can't be ticked ('asked in the last 24 hours', 'no parent with an email'), or null. */
  blocked: string | null;
  /** B6: where they stand on this offering, from the whole meeting's invite history (inviteChips). */
  chip?: InviteChip;
  /** B6: when they were last asked (a timestamptz), for "Asked Tue". */
  askedAt?: string | null;
  /**
   * B6 teachers: the assigned teacher (a locked line), a pending ask, the top 5 qualified adults, the rest of the
   * adults (behind "Show everyone who could teach"), and scouts who could teach (last, labelled; asked in person).
   */
  tier?: TeacherTier;
  /** B6: who gets the email, in words ('Parents: Dana R, Rob R', 'Maria L'); '' when nobody can be reached. */
  to?: string;
  /** A test scout (people.is_test): offered like anyone, left out of the Preview's teach lines (qa-lead B10a #1). */
  isTest?: boolean;
}

export type TeacherTier = 'assigned' | 'pending' | 'top' | 'more' | 'scout';

export interface InviteSection {
  key: string;
  teachers: InvitePerson[];
  scouts: InvitePerson[];
  /** B10a: expected minutes to teach it, for the Preview's teach line; null when unknown (a mix, a freeform topic). */
  minutes?: number | null;
}

/** B6: a recipient as the Review shows them: grouped by family, previewed by first name. */
export interface InviteRecipient {
  name: string;
  /** The name the email greets ('Dana'). */
  first: string;
  /** Their household's key, so one family's emails group together ('person:40' when in none). */
  family: string;
  /** 'Walters family'. */
  familyLabel: string;
  /** The scout's own address (13 or older, verified). */
  isScout: boolean;
}

/** B6: everything the Invite tab shows for a meeting's offerings. */
export interface InviteTabData {
  sections: InviteSection[];
  recipients: Record<number, InviteRecipient>;
}

export type InviteKind = 'teach' | 'pick';

/** A tick's id: one invite (teach or pick) of one person for one offering. */
export const tickId = (kind: InviteKind, key: string, personId: number) => `${kind}|${key}|${personId}`;

/** Offerings one send may cover. */
export const DIGEST_KEYS_MAX = 20;
/** Invites (person × offering) one send may mint. */
export const DIGEST_INVITE_CAP = 200;
/** Emails one send may make. */
export const DIGEST_EMAIL_CAP = 100;

// ── B6: status chips from the whole meeting's invite history ──────────────────────────────────────────────────────

export type InviteChip = 'recent' | 'asked' | 'yes' | 'cant' | 'picked';

export interface InviteHistoryRow {
  kind: 'teach' | 'pick';
  topic_key: string;
  invitee_person_id: number;
  response: string | null;
  sent_at?: string | null;
}

/** How long a fresh ask blocks a re-ask (the send's dedupe window). */
export const REASK_HOURS = 24;

/**
 * Each (kind, offering, invitee)'s chip from the meeting's whole invite history: their latest ask's answer (Yes,
 * Can't), or "Asked <24h" while it is fresh, or "Asked Tue" once it is older and still unanswered. Not in the map =
 * not asked. Keyed by tickId.
 */
export function inviteChips(rows: readonly InviteHistoryRow[], now: Date): Map<string, { chip: InviteChip; at: string | null }> {
  const latest = new Map<string, InviteHistoryRow>();
  for (const r of rows) {
    const id = tickId(r.kind, r.topic_key, r.invitee_person_id);
    const prev = latest.get(id);
    if (!prev || (r.sent_at ?? '') >= (prev.sent_at ?? '')) latest.set(id, r);
  }
  const out = new Map<string, { chip: InviteChip; at: string | null }>();
  for (const [id, r] of latest) {
    const at = r.sent_at ?? null;
    const fresh = at != null && now.getTime() - new Date(at).getTime() < REASK_HOURS * 3600_000;
    const chip: InviteChip = r.response === 'accepted' ? 'yes' : r.response === 'declined' ? 'cant' : fresh ? 'recent' : 'asked';
    out.set(id, { chip, at });
  }
  return out;
}

/** A chip's words: 'Not asked', 'Asked <24h', 'Asked Tue', 'Yes', 'Can’t', 'Picked it'. `day` formats an older ask. */
export function chipLabel(chip: InviteChip | undefined, at: string | null | undefined, day: (at: string) => string): string {
  switch (chip) {
    case 'recent':
      return 'Asked <24h';
    case 'asked':
      return at ? `Asked ${day(at)}` : 'Asked';
    case 'yes':
      return 'Yes';
    case 'cant':
      return 'Can’t';
    case 'picked':
      return 'Picked it';
    default:
      return 'Not asked';
  }
}

/** Chips that mean "already asked or answered": never ticked by default (a re-ask after 24 hours is the planner's call). */
const ASKED_OR_ANSWERED: ReadonlySet<InviteChip> = new Set<InviteChip>(['recent', 'asked', 'yes', 'cant', 'picked']);
const askedOrAnswered = (p: InvitePerson) => p.chip != null && ASKED_OR_ANSWERED.has(p.chip);

/**
 * The proposal (B6): teachers are ticked only on an offering with no teacher and no pending ask, and then only the top
 * qualified adults shown; likely scouts are ticked unless they were asked before (re-asking after 24 hours is allowed
 * but starts unticked), answered, or picked it. Nobody blocked.
 */
export function defaultTicks(sections: readonly InviteSection[], hasTeacher: (key: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const s of sections) {
    const pending = s.teachers.some((t) => t.tier === 'pending' || t.tier === 'assigned');
    if (!hasTeacher(s.key) && !pending) {
      for (const t of s.teachers) if (!t.blocked && (t.tier ?? 'top') === 'top' && !askedOrAnswered(t)) out.add(tickId('teach', s.key, t.personId));
    }
    for (const c of s.scouts) if (!c.blocked && c.likely && !askedOrAnswered(c)) out.add(tickId('pick', s.key, c.personId));
  }
  return out;
}

/**
 * The ticks after a send, from the tab's refreshed data (qa-lead B6 #1): an invite that now carries a fresh ask ("Asked
 * <24h") went out and comes off; everything else stays ticked, so a recipient the server skipped and the overflow past
 * a cap go in the next send. Pure.
 */
export function ticksAfterSend(ticks: ReadonlySet<string>, sections: readonly InviteSection[]): Set<string> {
  const went = new Set<string>();
  for (const s of sections) {
    for (const p of s.teachers) if (p.chip === 'recent') went.add(tickId('teach', s.key, p.personId));
    for (const p of s.scouts) if (p.chip === 'recent') went.add(tickId('pick', s.key, p.personId));
  }
  return new Set([...ticks].filter((id) => !went.has(id)));
}

/** The ticked invites the server is asked for (blocked people never, whatever the ticks say). */
export function selection(sections: readonly InviteSection[], ticks: ReadonlySet<string>): { teach: { key: string; personIds: number[] }[]; pick: { key: string; scoutIds: number[] }[] } {
  const on = (kind: InviteKind, key: string, p: InvitePerson) => !p.blocked && ticks.has(tickId(kind, key, p.personId));
  return {
    teach: sections.map((s) => ({ key: s.key, personIds: s.teachers.filter((p) => on('teach', s.key, p)).map((p) => p.personId) })).filter((x) => x.personIds.length),
    pick: sections.map((s) => ({ key: s.key, scoutIds: s.scouts.filter((p) => on('pick', s.key, p)).map((p) => p.personId) })).filter((x) => x.scoutIds.length)
  };
}

/** "Send N emails": one per distinct recipient across every ticked invite. */
export function digestEmails(sections: readonly InviteSection[], ticks: ReadonlySet<string>): number {
  const sel = selection(sections, ticks);
  const by = new Map(sections.map((s) => [s.key, s]));
  const to = new Set<number>();
  for (const t of sel.teach) for (const id of t.personIds) for (const r of by.get(t.key)?.teachers.find((p) => p.personId === id)?.recipients ?? []) to.add(r);
  for (const t of sel.pick) for (const id of t.scoutIds) for (const r of by.get(t.key)?.scouts.find((p) => p.personId === id)?.recipients ?? []) to.add(r);
  return to.size;
}

/** 'you', 'Anjali S and Finn S', or 'you and Anjali S' when the recipient is among the people the email is about. */
export function digestPeople(recipientId: number, isScout: boolean, about: readonly { personId: number; name: string }[]): string {
  if (isScout) return 'you';
  const self = about.some((p) => p.personId === recipientId);
  const others = [...new Set(about.filter((p) => p.personId !== recipientId).map((p) => p.name))];
  return [...(self ? ['you'] : []), ...others].join(' and ');
}

// ── B6: one send, within its caps ────────────────────────────────────────────────────────────────────────────────

export interface SendPlan {
  teach: { key: string; personIds: number[] }[];
  pick: { key: string; scoutIds: number[] }[];
  /** Ticks past a cap: kept ticked for the next send, marked in place. */
  overflow: Set<string>;
  /** Emails this send makes (one per recipient) and the families they reach. */
  emails: number;
  families: number;
  invites: number;
  offerings: number;
}

/**
 * What "Send N emails to M families" sends: the ticked, unblocked invites in screen order (each offering's teachers,
 * then its scouts), up to the per-send caps (DIGEST_KEYS_MAX offerings, DIGEST_INVITE_CAP invites, DIGEST_EMAIL_CAP
 * emails). An invite that would pass a cap is overflow: it stays ticked and goes in the next send.
 */
export function sendPlan(sections: readonly InviteSection[], ticks: ReadonlySet<string>, recipients: Readonly<Record<number, Pick<InviteRecipient, 'family'>>>): SendPlan {
  const keys = new Set<string>();
  const to = new Set<number>();
  const overflow = new Set<string>();
  const teach = new Map<string, number[]>();
  const pick = new Map<string, number[]>();
  let invites = 0;
  for (const s of sections) {
    const lists: [InviteKind, InvitePerson[]][] = [
      ['teach', s.teachers],
      ['pick', s.scouts]
    ];
    for (const [kind, list] of lists) {
      for (const p of list) {
        const id = tickId(kind, s.key, p.personId);
        if (p.blocked || p.tier === 'assigned' || !ticks.has(id)) continue;
        const fresh = p.recipients.filter((r) => !to.has(r)).length;
        if ((!keys.has(s.key) && keys.size >= DIGEST_KEYS_MAX) || invites >= DIGEST_INVITE_CAP || to.size + fresh > DIGEST_EMAIL_CAP) {
          overflow.add(id);
          continue;
        }
        keys.add(s.key);
        invites++;
        for (const r of p.recipients) to.add(r);
        const into = kind === 'teach' ? teach : pick;
        into.set(s.key, [...(into.get(s.key) ?? []), p.personId]);
      }
    }
  }
  const families = new Set([...to].map((r) => recipients[r]?.family ?? `person:${r}`));
  return {
    teach: [...teach].map(([key, personIds]) => ({ key, personIds })),
    pick: [...pick].map(([key, scoutIds]) => ({ key, scoutIds })),
    overflow,
    emails: to.size,
    families: families.size,
    invites,
    offerings: keys.size
  };
}

export interface ReviewItem {
  kind: InviteKind;
  key: string;
  inviteeId: number;
  inviteeName: string;
}

export interface ReviewGroup {
  family: string;
  label: string;
  /** One email each. */
  recipients: { recipientId: number; name: string; items: ReviewItem[] }[];
  /** Everyone this family's emails are about, once each, with their offerings. */
  about: { inviteeId: number; name: string; keys: string[] }[];
}

/** The Review rail (B6): what the send makes, grouped by family, then by recipient (one email each). */
export function reviewGroups(sections: readonly InviteSection[], plan: Pick<SendPlan, 'teach' | 'pick'>, recipients: Readonly<Record<number, InviteRecipient>>): ReviewGroup[] {
  const by = new Map(sections.map((s) => [s.key, s]));
  const groups = new Map<string, ReviewGroup>();
  const add = (kind: InviteKind, key: string, p: InvitePerson | undefined) => {
    if (!p) return;
    for (const r of p.recipients) {
      const info = recipients[r];
      const family = info?.family ?? `person:${r}`;
      const g = groups.get(family) ?? { family, label: info?.familyLabel || info?.name || '', recipients: [], about: [] };
      groups.set(family, g);
      let rec = g.recipients.find((x) => x.recipientId === r);
      if (!rec) {
        rec = { recipientId: r, name: info?.name ?? '', items: [] };
        g.recipients.push(rec);
      }
      rec.items.push({ kind, key, inviteeId: p.personId, inviteeName: p.name });
      let who = g.about.find((a) => a.inviteeId === p.personId);
      if (!who) {
        who = { inviteeId: p.personId, name: p.name, keys: [] };
        g.about.push(who);
      }
      if (!who.keys.includes(key)) who.keys.push(key);
    }
  };
  for (const t of plan.teach) for (const id of t.personIds) add('teach', t.key, by.get(t.key)?.teachers.find((p) => p.personId === id));
  for (const t of plan.pick) for (const id of t.scoutIds) add('pick', t.key, by.get(t.key)?.scouts.find((p) => p.personId === id));
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export interface PersonRow {
  personId: number;
  name: string;
  kind: InviteKind;
  entries: { key: string; person: InvitePerson }[];
}

/** By person (B6): one row per scout or adult, listing every offering they could be asked about. Teachers first. */
export function byPerson(sections: readonly InviteSection[]): PersonRow[] {
  const rows = new Map<string, PersonRow>();
  for (const s of sections) {
    const lists: [InviteKind, InvitePerson[]][] = [
      ['teach', s.teachers],
      ['pick', s.scouts]
    ];
    for (const [kind, list] of lists) {
      for (const p of list) {
        if (p.tier === 'assigned') continue;
        const id = `${kind}|${p.personId}`;
        const row = rows.get(id) ?? { personId: p.personId, name: p.name, kind, entries: [] };
        row.entries.push({ key: s.key, person: p });
        rows.set(id, row);
      }
    }
  }
  return [...rows.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'teach' ? -1 : 1));
}

/** An offering's status line (B6): "Maria L agreed · 5 likely · 2 asked · 1 yes". */
export function offeringLine(teachers: readonly string[], s: InviteSection | undefined): string {
  const scouts = s?.scouts ?? [];
  const everyone = [...(s?.teachers ?? []).filter((p) => p.tier !== 'assigned'), ...scouts];
  const asked = everyone.filter((p) => p.chip === 'recent' || p.chip === 'asked').length;
  const yes = everyone.filter((p) => p.chip === 'yes').length;
  const likely = scouts.filter((p) => p.likely && !p.chip).length;
  return [teachers.length ? `${teachers.join(', ')} agreed` : null, likely ? `${likely} likely` : null, asked ? `${asked} asked` : null, yes ? `${yes} yes` : null]
    .filter(Boolean)
    .join(' · ');
}

// ── B10a: the scouts a class would help, for the teacher digest ──────────────────────────────────────────────────

/** One scout as scoutsHelped reads them: picked it, or likely by the one rule (lib/build-plan likelyFit). */
export interface HelpedCandidate {
  name: string;
  picked: boolean;
  likely: boolean;
  /** Their answer to "Coming Sunday?"; Can't make it never counts. */
  intent?: Intent | null;
  /** people.is_test (qa-lead B10a #1): never named or counted. */
  isTest?: boolean;
}

export interface ScoutsHelped {
  count: number;
  /** Up to the cap, as boardName ('Finn P': the digest goes to adults, so the initial stays). */
  names: string[];
  /** How many past the cap ("and N more"). */
  more: number;
}

/** How many names a teach line shows before "and N more". */
export const HELPED_SHOWN = 5;

/**
 * Build a Plan B10a (Plans/Build-A-Plan.md "B10 spec"): the scouts a class would help. Those who PICKED it first, then
 * the likely ones, each group by name; anyone who said they can't make it is left out. Pure: the send (from
 * scoutCandidatesMany) and the Invite tab's Preview (from its sections) both go through it.
 */
export function scoutsHelped(candidates: readonly HelpedCandidate[], opts: { cap?: number } = {}): ScoutsHelped {
  const cap = opts.cap ?? HELPED_SHOWN;
  const going = candidates.filter((c) => c.intent !== 'not_coming' && !c.isTest);
  const byName = (a: HelpedCandidate, b: HelpedCandidate) => a.name.localeCompare(b.name);
  const all = [...going.filter((c) => c.picked).sort(byName), ...going.filter((c) => !c.picked && c.likely).sort(byName)].map((c) => boardName(c.name));
  return { count: all.length, names: all.slice(0, cap), more: Math.max(0, all.length - cap) };
}

/** '3 scouts (Finn P, Anjali S, Leo K)', '7 scouts (… and 2 more)', 'no scouts yet'. */
export function scoutsHelpedText(h: ScoutsHelped): string {
  if (!h.count) return 'no scouts yet';
  return `${h.count} ${h.count === 1 ? 'scout' : 'scouts'} (${h.names.join(', ')}${h.more ? ` and ${h.more} more` : ''})`;
}

/** The Invite tab's Preview: an offering's scouts as scoutsHelped reads them (a picked scout carries the Picked chip). */
export function sectionHelped(s: Pick<InviteSection, 'scouts'> | undefined): ScoutsHelped {
  return scoutsHelped((s?.scouts ?? []).map((p) => ({ name: p.name, picked: p.chip === 'picked', likely: p.likely, isTest: p.isTest })));
}
