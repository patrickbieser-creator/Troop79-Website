/**
 * Build a Plan B3 (Plans/Build-A-Plan.md, "Invite…", Decision 2): the invite sheet's rules, PURE and client-safe.
 *
 * The sheet lists, per offering, the teachers to ask and the scouts to offer it to, each with who their email would
 * reach (`recipients`). Sending groups every ticked invite by RECIPIENT, so the number on "Send N emails" is the size of
 * the union of the ticked people's recipients: the same grouping the digest send makes (one email per recipient).
 */

export interface InvitePerson {
  personId: number;
  name: string;
  /** One line: why they fit ('Teaches First aid', 'Working on Tenderfoot · coming'). */
  reason: string;
  counselor?: boolean;
  /** Shown first ("likely"); the rest sit behind "Also show others". Teachers are all likely. */
  likely: boolean;
  /** Who the email would go to: the adult themself; a scout's parents (and the scout from 13, verified). */
  recipients: number[];
  /** Why they can't be ticked ('asked in the last 24 hours', 'no parent with an email'), or null. */
  blocked: string | null;
}

export interface InviteSection {
  key: string;
  teachers: InvitePerson[];
  scouts: InvitePerson[];
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

/** The proposal: teachers ticked on an offering nobody teaches yet; likely scouts ticked; nobody blocked. */
export function defaultTicks(sections: readonly InviteSection[], hasTeacher: (key: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const s of sections) {
    if (!hasTeacher(s.key)) for (const t of s.teachers) if (!t.blocked) out.add(tickId('teach', s.key, t.personId));
    for (const c of s.scouts) if (!c.blocked && c.likely) out.add(tickId('pick', s.key, c.personId));
  }
  return out;
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
