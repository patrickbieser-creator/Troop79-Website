/**
 * The Meeting Planner's Who's coming board, design 1a (Plans/Meeting-Planner-II.md; prototypes/meeting-plan-II/README.md
 * "Screen 1"). PURE and client-safe: the loader (lib/meeting-planner-load.ts) gathers v1's demand and supply, this
 * turns them into the board, and the tests read it without a database.
 *
 * No matcher here (tech-lead, 2026-10-21). The board is demand against supply: "Ready to teach" is a topic with a
 * teacher and at least one scout. Meeting Live owns where everyone goes (Decision 8).
 *
 * The rules, all v1's:
 *   - A scout's answer is effectiveIntent: a pick for this meeting means Coming. A scout who can't make it keeps their
 *     picks for later, so they ask for nothing this week (summarizeBoard).
 *   - An adult's answer is teacherIntent: a teaching commitment means Coming.
 *   - "Can teach this" is everyone qualified (assessTeacher, done by the loader; for a focus group, canTeachFocusGroup:
 *     a skill covering one of its parts), grouped Coming / Not sure yet / Haven't answered, sorted by name, with
 *     Can't-make-it people left out. There is no best-fit ranking yet.
 *   - Seeded focus (P3): a seeded topic is on the board even with no scout. No teacher → Requests with no teacher
 *     ("Seeded focus · no scouts picked it yet"); a teacher and no scout → Offered, no takers. The Focus strip lists
 *     every seeded topic with its teacher and how many scouts picked it.
 *   - Likely fits for an offer nobody picked: scouts working on that rank who haven't picked it, haven't finished it,
 *     and can still come (the same people the nudge list offers it to).
 */
import { effectiveIntent, type BoardPick, type Intent } from '@/lib/meeting-board-shared';
import { teacherIntent, weeksAsked } from '@/lib/meeting-board-teach';

export interface PlannerTopic {
  key: string;
  /** 'Tenderfoot 4a', 'Electricity 5', 'Merit badge', 'Offered this week'. */
  codeLabel: string;
  title: string;
  kind: 'rank' | 'mb' | 'ff' | 'focus';
  minutes: number | null;
  /** The rank a rank requirement belongs to (for likely fits); null otherwise. */
  rankId: string | null;
}

export interface PlannerScoutIn {
  personId: number;
  name: string;
  /** The rank they're working on, for display ('Second Class'); null when unknown. */
  workingOn: string | null;
  workingOnRankId: string | null;
  intent: Intent | null;
  picks: readonly BoardPick[];
}

export interface PlannerAdultIn {
  personId: number;
  name: string;
  intent: Intent | null;
  /** Has teaching skills or counsels a badge: the Everyone wall's "Can teach". */
  canTeach: boolean;
}

export interface PlannerInput {
  /** 'YYYY-MM-DD'. */
  meetingDate: string;
  scouts: readonly PlannerScoutIn[];
  /** Adults on the board: leaders, anyone who can teach, and anyone who answered or signed up. */
  adults: readonly PlannerAdultIn[];
  topics: ReadonlyMap<string, PlannerTopic>;
  /** Each teaching commitment on this meeting (a topic someone signed up to teach), Can't-make-it teachers included. */
  commitments: readonly { key: string; personId: number }[];
  /** Who is teaching each key (v1's teachersFor: commitments plus covering skill offers, Can't-make-it left out). */
  teachersFor: ReadonlyMap<string, readonly number[]>;
  /** Everyone qualified to teach each wanted key (assessTeacher), any answer. */
  qualified: ReadonlyMap<string, readonly number[]>;
  /** `${key}:${personId}` for each teacher request already sent this meeting. */
  requested: ReadonlySet<string>;
  /** `${key}:${personId}` for an offered requirement the scout has finished or can't take up yet (left out of likely fits). */
  finished?: ReadonlySet<string>;
  /** Seeded topics (P3) by key, with who seeded them ('Mindy K'; null once that person is gone). */
  seeded?: ReadonlyMap<string, { by: string | null }>;
}

export interface PlannerPerson {
  personId: number;
  name: string;
}

export interface AttendanceCounts {
  coming: number;
  undecided: number;
  notComing: number;
  noAnswer: number;
  total: number;
}

export interface ReadyRow {
  key: string;
  codeLabel: string;
  title: string;
  kind: PlannerTopic['kind'];
  minutes: number | null;
  teachers: PlannerPerson[];
  scouts: PlannerPerson[];
  /** Who seeded it ('Mindy K'); undefined when not seeded, null when the seeder is gone. */
  seededBy?: string | null;
}

export interface CanTeachPerson extends PlannerPerson {
  /** 'Coming', 'Coming · teaching 1', 'Not sure yet', 'Hasn't answered · a request invites them'. */
  status: string;
  requested: boolean;
}

export interface NoTeacherRow {
  key: string;
  codeLabel: string;
  title: string;
  kind: PlannerTopic['kind'];
  minutes: number | null;
  waiting: PlannerPerson[];
  /** Weeks running it has been asked for (at least 1). */
  weeks: number;
  canTeach: { coming: CanTeachPerson[]; undecided: CanTeachPerson[]; noAnswer: CanTeachPerson[]; total: number };
  /** Seeded: who seeded it ('Mindy K', or '' when that person is gone); null when it isn't seeded. */
  seededBy?: string | null;
}

export interface OfferedRow {
  key: string;
  codeLabel: string;
  title: string;
  kind: PlannerTopic['kind'];
  teachers: PlannerPerson[];
  likelyFits: PlannerPerson[];
  /** Seeded: who seeded it ('Mindy K', or '' when that person is gone); null when it isn't seeded. */
  seededBy?: string | null;
}

export interface ComingRow extends PlannerPerson {
  detail: string;
  /** Nothing picked (a scout) or not teaching (an adult): the detail line is a nudge. */
  nothingYet: boolean;
}

export interface WallTile extends PlannerPerson {
  tag: string;
}

export interface WallColumns {
  coming: WallTile[];
  undecided: WallTile[];
  notComing: WallTile[];
  noAnswer: WallTile[];
}

export interface PlannerBoard {
  attendance: { scouts: AttendanceCounts; adults: AttendanceCounts };
  ready: ReadyRow[];
  noTeacher: NoTeacherRow[];
  offered: OfferedRow[];
  haventAnswered: { scouts: PlannerPerson[]; adults: PlannerPerson[] };
  whosComing: { scouts: ComingRow[]; adults: ComingRow[] };
  notSure: PlannerPerson[];
  cantMakeIt: (PlannerPerson & { saved: number })[];
  everyone: { scouts: WallColumns; adults: WallColumns };
}

type Answer = Intent | null;
const byName = <T extends PlannerPerson>(a: T, b: T) => a.name.localeCompare(b.name);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function counts(answers: readonly Answer[]): AttendanceCounts {
  return {
    coming: answers.filter((a) => a === 'coming').length,
    undecided: answers.filter((a) => a === 'undecided').length,
    notComing: answers.filter((a) => a === 'not_coming').length,
    noAnswer: answers.filter((a) => a == null).length,
    total: answers.length
  };
}

function wall<T extends PlannerPerson & { answer: Answer }>(people: readonly T[], tag: (p: T) => string): WallColumns {
  const col = (a: Answer) => people.filter((p) => p.answer === a).map((p) => ({ personId: p.personId, name: p.name, tag: tag(p) })).sort(byName);
  return { coming: col('coming'), undecided: col('undecided'), notComing: col('not_coming'), noAnswer: col(null) };
}

export function buildPlannerBoard(input: PlannerInput): PlannerBoard {
  const titleOf = (key: string) => input.topics.get(key)?.title ?? key;
  const topicOf = (key: string): PlannerTopic => input.topics.get(key) ?? { key, codeLabel: '', title: key, kind: 'ff', minutes: null, rankId: null };

  // Scouts: their effective answer and the picks that count for this meeting.
  const scouts = input.scouts.map((s) => {
    const answer = effectiveIntent(s.intent, s.picks);
    const now = answer === 'not_coming' ? [] : s.picks.filter((p) => !p.later);
    return { ...s, answer, now };
  });
  const demand = new Map<string, number[]>();
  const firstAsked = new Map<string, string[]>();
  for (const s of scouts)
    for (const p of s.now) {
      demand.set(p.key, [...(demand.get(p.key) ?? []), s.personId]);
      firstAsked.set(p.key, [...(firstAsked.get(p.key) ?? []), p.firstAskedOn]);
    }

  // Adults: a commitment means Coming.
  const commitsOf = new Map<number, string[]>();
  for (const c of input.commitments) commitsOf.set(c.personId, [...(commitsOf.get(c.personId) ?? []), c.key]);
  const adults = input.adults.map((a) => ({ ...a, commits: commitsOf.get(a.personId) ?? [], answer: teacherIntent(a.intent, commitsOf.get(a.personId)?.length ?? 0) }));

  // Anyone who may teach: an adult, or a Junior Leader (a scout).
  const nameOf = new Map<number, string>([...input.scouts.map((s) => [s.personId, s.name] as const), ...input.adults.map((a) => [a.personId, a.name] as const)]);
  const answerOf = new Map<number, Answer>([...scouts.map((s) => [s.personId, s.answer] as const), ...adults.map((a) => [a.personId, a.answer] as const)]);
  const person = (id: number): PlannerPerson => ({ personId: id, name: nameOf.get(id) ?? `Person ${id}` });
  const teachersOf = (key: string) => (input.teachersFor.get(key) ?? []).map(person);

  const seededBy = (key: string): string | null => {
    const s = input.seeded?.get(key);
    return s ? (s.by ?? '') : null;
  };
  // A seeded topic nobody picked yet is on the board too, with nobody waiting.
  const rows = new Map(demand);
  for (const key of input.seeded?.keys() ?? []) if (!rows.has(key) && !teachersOf(key).length) rows.set(key, []);

  const ready: ReadyRow[] = [];
  const noTeacher: NoTeacherRow[] = [];
  for (const [key, ids] of rows) {
    const t = topicOf(key);
    const base = { key, codeLabel: t.codeLabel, title: t.title, kind: t.kind, minutes: t.minutes };
    const waiting = ids.map(person).sort(byName);
    if (teachersOf(key).length) {
      ready.push({ ...base, teachers: teachersOf(key), scouts: waiting, ...(seededBy(key) != null ? { seededBy: seededBy(key) } : {}) });
      continue;
    }
    const canTeach: NoTeacherRow['canTeach'] = { coming: [], undecided: [], noAnswer: [], total: 0 };
    for (const id of input.qualified.get(key) ?? []) {
      const answer = answerOf.get(id) ?? null;
      if (answer === 'not_coming') continue;
      const n = commitsOf.get(id)?.length ?? 0;
      const said = answer === 'coming' ? 'Coming' : answer === 'undecided' ? 'Not sure yet' : 'Hasn’t answered · a request invites them';
      const row = { ...person(id), status: n && answer ? `${said} · teaching ${n}` : said, requested: input.requested.has(`${key}:${id}`) };
      (answer === 'coming' ? canTeach.coming : answer === 'undecided' ? canTeach.undecided : canTeach.noAnswer).push(row);
      canTeach.total++;
    }
    canTeach.coming.sort(byName);
    canTeach.undecided.sort(byName);
    canTeach.noAnswer.sort(byName);
    noTeacher.push({ ...base, waiting, weeks: weeksAsked(firstAsked.get(key) ?? [], input.meetingDate), canTeach, seededBy: seededBy(key) });
  }
  ready.sort((a, b) => a.codeLabel.localeCompare(b.codeLabel));
  noTeacher.sort((a, b) => b.waiting.length - a.waiting.length || b.weeks - a.weeks || a.codeLabel.localeCompare(b.codeLabel));

  // Offered, no takers: a topic someone is teaching that no scout picked (a seeded one too).
  const offeredKeys = [...new Set([...input.commitments.map((c) => c.key), ...(input.seeded?.keys() ?? [])])].filter((k) => !demand.has(k) && teachersOf(k).length);
  const offered: OfferedRow[] = offeredKeys
    .map((key) => {
      const t = topicOf(key);
      const likelyFits = t.rankId
        ? scouts
            .filter((s) => s.workingOnRankId === t.rankId && s.answer !== 'not_coming' && !s.picks.some((p) => p.key === key) && !input.finished?.has(`${key}:${s.personId}`))
            .map((s) => person(s.personId))
            .sort(byName)
        : [];
      return { key, codeLabel: t.codeLabel, title: t.title, kind: t.kind, teachers: teachersOf(key), likelyFits, seededBy: seededBy(key) };
    })
    .sort((a, b) => a.codeLabel.localeCompare(b.codeLabel));

  const sortedScouts = [...scouts].sort(byName);
  const sortedAdults = [...adults].sort(byName);
  const pick = (p: PlannerPerson): PlannerPerson => ({ personId: p.personId, name: p.name });

  return {
    attendance: { scouts: counts(scouts.map((s) => s.answer)), adults: counts(adults.map((a) => a.answer)) },
    ready,
    noTeacher,
    offered,
    haventAnswered: { scouts: sortedScouts.filter((s) => s.answer == null).map(pick), adults: sortedAdults.filter((a) => a.answer == null).map(pick) },
    whosComing: {
      scouts: sortedScouts
        .filter((s) => s.answer === 'coming')
        .map((s) => ({ ...pick(s), detail: s.now.length ? s.now.map((p) => titleOf(p.key)).join(', ') : 'Nothing picked: will be placed by rank', nothingYet: !s.now.length })),
      adults: sortedAdults
        .filter((a) => a.answer === 'coming')
        .map((a) => ({ ...pick(a), detail: a.commits.length ? `Teaching: ${a.commits.map(titleOf).join(', ')}` : 'Not teaching yet: free to assign', nothingYet: !a.commits.length }))
    },
    notSure: [...sortedScouts.filter((s) => s.answer === 'undecided'), ...sortedAdults.filter((a) => a.answer === 'undecided')].map(pick),
    cantMakeIt: [
      ...sortedScouts.filter((s) => s.answer === 'not_coming').map((s) => ({ ...pick(s), saved: s.picks.length })),
      ...sortedAdults.filter((a) => a.answer === 'not_coming').map((a) => ({ ...pick(a), saved: 0 }))
    ],
    everyone: {
      scouts: wall(scouts, (s) => {
        if (s.answer === 'coming' && s.now.length) return plural(s.now.length, 'pick');
        if (s.answer === 'not_coming' && s.picks.length) return 'Picks saved';
        return s.workingOn ?? '';
      }),
      adults: wall(adults, (a) => (a.answer === 'coming' ? (a.commits.length ? `Teaching ${a.commits.length}` : 'Free') : a.canTeach ? 'Can teach' : ''))
    }
  };
}
