/**
 * Meeting Planner: a past meeting, view only (Patrick, 2026-11-09). Pure pieces, no DB.
 *
 * The plan screen derives its groups from advancement, so a past meeting is shown as of the night itself: ranks and
 * requirement leaves from ledger rows dated BEFORE the meeting (the same rule the printed snapshot uses). "What
 * happened" comes from roll call and the sign-offs dated that day; requirement sign-offs are dated, never linked to a
 * meeting, so a sign-off at another event the same day lands here too.
 */

export interface PastMeetingRef {
  entryId: number;
  /** 'YYYY-MM-DD'. */
  date: string;
}

/** How many past meetings the strip shows at once. */
export const PAST_PAGE = 6;

/**
 * The page of past meetings that holds `selectedId`, oldest first, from a newest-first list. `olderId` / `newerId`
 * open the meeting just past either end (null at the ends). Null when the meeting isn't in the list.
 */
export function pastWeekPage(
  pastNewestFirst: readonly PastMeetingRef[],
  selectedId: number,
  size: number = PAST_PAGE
): { weeks: PastMeetingRef[]; olderId: number | null; newerId: number | null } | null {
  const i = pastNewestFirst.findIndex((m) => m.entryId === selectedId);
  if (i < 0) return null;
  const start = Math.floor(i / size) * size;
  const page = pastNewestFirst.slice(start, start + size);
  return {
    weeks: [...page].reverse(),
    olderId: pastNewestFirst[start + size]?.entryId ?? null,
    newerId: start > 0 ? pastNewestFirst[start - 1].entryId : null
  };
}

/** Each scout's highest rank awarded strictly before `before` ('YYYY-MM-DD'). A scout with none is left out (new scout). */
export function rankAsOf(
  awards: readonly { scoutId: string; code: string; date: string }[],
  before: string,
  ranks: readonly { id: string; sort_order: number }[]
): Map<string, string> {
  const order = new Map(ranks.map((r) => [r.id, r.sort_order]));
  const out = new Map<string, string>();
  for (const a of awards) {
    if (a.date >= before || !order.has(a.code)) continue;
    const held = out.get(a.scoutId);
    if (held == null || order.get(a.code)! > order.get(held)!) out.set(a.scoutId, a.code);
  }
  return out;
}

/** Whether a requirement key was on the meeting's plan: a focus member, a single seeded by hand, or any requirement of
 *  a badge of the night. */
export function plannedKeyTest(plan: {
  focus: readonly { members: readonly string[] }[];
  seededSingles: readonly string[];
  nightBadges: readonly string[];
}): (key: string) => boolean {
  const keys = new Set([...plan.focus.flatMap((f) => f.members), ...plan.seededSingles]);
  return (key) => keys.has(key) || plan.nightBadges.some((mb) => key.startsWith(`${mb}-`));
}

export interface HappenedLedgerRow {
  scoutId: string;
  kind: string;
  code: string;
}

export interface Happened {
  attended: { scouts: string[]; adults: string[] };
  /** Requirements signed off that day, most scouts first; `planned` = on the meeting's plan. */
  signedOff: { key: string; label: string; names: string[]; planned: boolean }[];
  /** Ranks and merit badges earned that day. */
  earned: { label: string; names: string[] }[];
}

const REQUIREMENT_KINDS = new Set(['rank_requirement', 'merit_badge_requirement']);
const AWARD_KINDS = new Set(['rank_award', 'merit_badge_award']);
const byName = (a: string, b: string) => a.localeCompare(b);

export function buildHappened(input: {
  /** Roll call: person ids marked present. */
  attendance: readonly number[];
  scoutPersonIds: ReadonlySet<number>;
  personNames: ReadonlyMap<number, string>;
  scoutNames: ReadonlyMap<string, string>;
  ledger: readonly HappenedLedgerRow[];
  planned: (key: string) => boolean;
  /** A requirement key in words ('Tenderfoot 4a Show first aid for…'). */
  words: (key: string) => string;
  /** An award code in words ('Tenderfoot', 'Climbing merit badge'). */
  awardWords: (code: string, kind: string) => string;
}): Happened {
  const nameOf = (id: number) => input.personNames.get(id) ?? 'Someone';
  const present = [...new Set(input.attendance)];
  const attended = {
    scouts: present.filter((id) => input.scoutPersonIds.has(id)).map(nameOf).sort(byName),
    adults: present.filter((id) => !input.scoutPersonIds.has(id)).map(nameOf).sort(byName)
  };

  const reqs = new Map<string, Set<string>>();
  const awards = new Map<string, { label: string; names: Set<string> }>();
  for (const r of input.ledger) {
    const name = input.scoutNames.get(r.scoutId) ?? 'A former scout';
    if (REQUIREMENT_KINDS.has(r.kind)) reqs.set(r.code, (reqs.get(r.code) ?? new Set()).add(name));
    else if (AWARD_KINDS.has(r.kind)) {
      const id = `${r.kind}:${r.code}`;
      const a = awards.get(id) ?? { label: input.awardWords(r.code, r.kind), names: new Set<string>() };
      awards.set(id, { ...a, names: a.names.add(name) });
    }
  }
  const signedOff = [...reqs]
    .map(([key, names]) => ({ key, label: input.words(key), names: [...names].sort(byName), planned: input.planned(key) }))
    .sort((a, b) => b.names.length - a.names.length || a.label.localeCompare(b.label));
  const earned = [...awards.values()].map((a) => ({ label: a.label, names: [...a.names].sort(byName) })).sort((a, b) => a.label.localeCompare(b.label));
  return { attended, signedOff, earned };
}
