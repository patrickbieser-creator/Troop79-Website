/**
 * The teacher side of the meeting board (Phase 2 of Plans/Meeting-Requests-And-Teaching-Offers.md): the rules, pure and
 * client-safe (no directive, no server imports), so /member/meeting, the admin "This Sunday" tab and their tests read
 * one definition.
 *
 *   - Each adult or Junior Leader teaches one or two things per meeting: a topic ("I'll teach this", a requirement
 *     offer, a freeform offer) or a broad skill offer, which counts as ONE of the two (Prototype feedback item 3). The
 *     RPCs enforce the cap; this file only mirrors it for the screen.
 *   - Qualification is shown, never enforced (matcher rule 1): qualified = the person's teaching skills cover the
 *     topic's skill (the top-level requirement's rank_requirements.skill_id); a Junior Leader must also have finished
 *     it themselves and never teaches an adults-only skill (that one the database refuses). A merit badge topic is
 *     flagged "sign-off needs a counselor" when the person isn't a counselor for that badge. A self-entered skill counts
 *     the moment it is saved: nothing here caches skills.
 *   - A skill offer is a teacher on every requirement in that skill the offerer qualifies for.
 *   - Names: scout-facing screens show adults formally ("Mr. Vest", from gender + last name, falling back to "Dan V");
 *     Junior Leaders and every admin surface use first name + last initial (Prototype feedback, Brad's question 1).
 *   - A person who said "Can't make it" is left out of the supply, and their rows are kept (Decision 4).
 */
import type { CatalogRank, CatalogRankRequirement } from '@/lib/advancement-catalog';
import { isPickFinished, rankOfKey, type rankTrees } from '@/lib/meeting-board-picklist';
import { isBorKey } from '@/lib/rank-calculus';
import { boardName, type Intent } from '@/lib/meeting-board-shared';

export type TeacherKind = 'adult' | 'junior';

/** Commitments per person per meeting, topics and skill offers together. The RPC enforces it. */
/** The freeform title the RPC stores (trimmed, inner whitespace collapsed, at most 80 characters). */
export const FREEFORM_MAX = 80;

export interface TeacherPerson {
  personId: number;
  kind: TeacherKind;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  /** people.gender: 'M' | 'F' | null. Only used for the formal name on scout screens. */
  gender: string | null;
  /** teaching_skills skill ids. */
  skills: ReadonlySet<string>;
  /** Merit badge ids this person is a registered counselor for. */
  counselorFor: ReadonlySet<string>;
  /** False for someone who holds rows but no longer qualifies to teach (deactivated, out of the picker, a scout the
   *  Junior Leader rule no longer admits): they are listed so they (or a leader) can take the rows back, and they can't
   *  add any. Undefined = may teach. */
  eligible?: boolean;
  /** Junior Leaders: their current rank and rank-requirement ledger codes, for "finished it themselves". */
  currentRank: string | null;
  rankCodes: ReadonlySet<string>;
}

/** "Mr. Vest" for a man, "Ms. Vest" for a woman; anyone else (no gender, no last name) is "Dan V". */
export function formalName(p: Pick<TeacherPerson, 'displayName' | 'lastName' | 'gender'>): string {
  const last = p.lastName?.trim();
  const g = p.gender?.trim().toUpperCase();
  if (last && g === 'M') return `Mr. ${last}`;
  if (last && g === 'F') return `Ms. ${last}`;
  return boardName(p.displayName);
}

/** How a teacher is named: formally to scouts when an adult, first name + last initial otherwise and on admin. */
export function teacherName(p: Pick<TeacherPerson, 'kind' | 'displayName' | 'lastName' | 'gender'>, audience: 'scout' | 'admin'): string {
  return audience === 'scout' && p.kind === 'adult' ? formalName(p) : boardName(p.displayName);
}

export function freeformTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').slice(0, FREEFORM_MAX);
}

/** 'ff:knife sharpening': the same rule as the SQL _meeting_freeform_topic_id(). Empty title = ''. */
export function freeformKey(title: string): string {
  const t = freeformTitle(title);
  return t ? `ff:${t.toLowerCase()}` : '';
}

/** The topic's skill: its top-level requirement's skill_id. Null for a badge, a freeform topic, a focus group, a merit
 *  badge requirement, or no skill. */
export function topicSkill(key: string, ranks: readonly CatalogRank[], rankReqs: readonly CatalogRankRequirement[]): string | null {
  const rank = rankOfKey(key, ranks);
  if (!rank) return null;
  const code = key.slice(rank.id.length + 1);
  return rankReqs.find((r) => r.rank_id === rank.id && r.code === code && r.parent_id == null)?.skill_id ?? null;
}

export type TeachFlag = 'not_in_skills' | 'needs_counselor' | 'not_finished';

export interface TeachContext {
  ranks: readonly CatalogRank[];
  rankReqs: readonly CatalogRankRequirement[];
  trees: ReturnType<typeof rankTrees>;
  /** skills.youth_teachable by skill id. */
  youthTeachable: ReadonlyMap<string, boolean>;
}

export interface TeachAssessment {
  qualified: boolean;
  flags: TeachFlag[];
  /** The database would refuse it: a Junior Leader and an adults-only skill. */
  refused: boolean;
}

export function assessTeacher(p: TeacherPerson, key: string, ctx: TeachContext): TeachAssessment {
  if (key.startsWith('mb:')) {
    const counselor = p.counselorFor.has(key.slice(3));
    return { qualified: p.kind === 'adult', flags: counselor ? [] : ['needs_counselor'], refused: false };
  }
  // A freeform topic, a focus group or a merit badge requirement (P3; counselor-first ordering is deferred): anyone.
  // A board of review too: anyone may run one, never blocked or flagged (Patrick, 2026-10-21).
  if (!rankOfKey(key, ctx.ranks) || isBorKey(key)) return { qualified: true, flags: [], refused: false };
  const skill = topicSkill(key, ctx.ranks, ctx.rankReqs);
  if (p.kind === 'junior' && skill && ctx.youthTeachable.get(skill) === false) return { qualified: false, flags: [], refused: true };
  const flags: TeachFlag[] = [];
  if (skill && !p.skills.has(skill)) flags.push('not_in_skills');
  if (p.kind === 'junior') {
    const done = isPickFinished(key, { currentRank: p.currentRank, ranks: ctx.ranks, trees: ctx.trees, rankCodes: p.rankCodes, awardedMbs: new Set() });
    if (!done) flags.push('not_finished');
  }
  return { qualified: flags.length === 0, flags, refused: false };
}

const FLAG_SELF: Record<TeachFlag, string> = {
  not_in_skills: 'not in what you’ve said you can teach',
  needs_counselor: 'sign-off needs a counselor',
  not_finished: 'finish it yourself first'
};
const FLAG_ADMIN: Record<TeachFlag, string> = {
  not_in_skills: 'not in their skills',
  needs_counselor: 'sign-off needs a counselor',
  not_finished: 'hasn’t finished it'
};
export function flagText(flags: readonly TeachFlag[], who: 'self' | 'admin'): string[] {
  return flags.map((f) => (who === 'self' ? FLAG_SELF : FLAG_ADMIN)[f]);
}

/** An adult's answer: explicit wins; otherwise any commitment on this meeting means Coming. */
export function teacherIntent(explicit: Intent | null, commitments: number): Intent | null {
  return explicit ?? (commitments > 0 ? 'coming' : null);
}

export interface TopicTeacherRow {
  key: string;
  personId: number;
  note: string | null;
}
export interface SkillOfferRow {
  personId: number;
  skillId: string;
  note: string | null;
}

export interface SupplyInput {
  topicTeachers: readonly TopicTeacherRow[];
  skillOffers: readonly SkillOfferRow[];
  people: ReadonlyMap<number, TeacherPerson>;
  /** Teachers who said "Can't make it" for this meeting: left out of the supply. */
  notComing: ReadonlySet<number>;
  ctx: TeachContext;
}

export interface TopicTeacher {
  personId: number;
  /** 'topic' = committed to this topic; 'offer' = a matching skill offer. */
  via: 'topic' | 'offer';
}

/** Who is teaching a key this meeting: committed teachers first, then skill offers that cover it (qualified only). */
export function teachersFor(key: string, s: SupplyInput): TopicTeacher[] {
  const out: TopicTeacher[] = [];
  const seen = new Set<number>();
  for (const t of s.topicTeachers) {
    if (t.key !== key || s.notComing.has(t.personId) || seen.has(t.personId)) continue;
    seen.add(t.personId);
    out.push({ personId: t.personId, via: 'topic' });
  }
  const skill = topicSkill(key, s.ctx.ranks, s.ctx.rankReqs);
  if (!skill) return out;
  for (const o of s.skillOffers) {
    if (o.skillId !== skill || s.notComing.has(o.personId) || seen.has(o.personId)) continue;
    const p = s.people.get(o.personId);
    if (!p || !assessTeacher(p, key, s.ctx).qualified) continue;
    seen.add(o.personId);
    out.push({ personId: o.personId, via: 'offer' });
  }
  return out;
}

/** Commitments each person holds on this meeting (topics + skill offers), the number the 2-cap counts. */
export function commitmentCounts(s: Pick<SupplyInput, 'topicTeachers' | 'skillOffers'>): Map<number, number> {
  const n = new Map<number, number>();
  for (const t of s.topicTeachers) n.set(t.personId, (n.get(t.personId) ?? 0) + 1);
  for (const o of s.skillOffers) n.set(o.personId, (n.get(o.personId) ?? 0) + 1);
  return n;
}

/**
 * Supply against demand for one meeting. wanted = topics scouts asked for with no teacher (the recruiting list),
 * offered = topics a teacher put on the board that nobody asked for, idleOffers = skill offers that cover nothing
 * asked for yet.
 */
export function matchSupply(demand: ReadonlyMap<string, readonly number[]>, s: SupplyInput) {
  const teachers = new Map<string, TopicTeacher[]>();
  for (const key of demand.keys()) teachers.set(key, teachersFor(key, s));
  const wanted = [...demand.keys()].filter((k) => !teachers.get(k)!.length);
  const offered = [...new Set(s.topicTeachers.filter((t) => !s.notComing.has(t.personId) && !(demand.get(t.key)?.length)).map((t) => t.key))];
  for (const k of offered) teachers.set(k, teachersFor(k, s));
  const idleOffers = s.skillOffers.filter(
    (o) => !s.notComing.has(o.personId) && ![...demand.keys()].some((k) => teachers.get(k)!.some((t) => t.via === 'offer' && t.personId === o.personId) && topicSkill(k, s.ctx.ranks, s.ctx.rankReqs) === o.skillId)
  );
  return { teachers, wanted, offered, idleOffers };
}

/** "asked 3 weeks": from the earliest first-asked date among the scouts who want it, at least 1. */
export function weeksAsked(firstAsked: readonly string[], meetingDate: string): number {
  if (!firstAsked.length) return 1;
  const earliest = [...firstAsked].sort()[0];
  const days = (Date.parse(`${meetingDate}T00:00:00Z`) - Date.parse(`${earliest}T00:00:00Z`)) / 86_400_000;
  return Math.max(1, Math.ceil(days / 7));
}

/** One line of live state for a teacher on the next meeting (the /member card): "Coming · teaching 1 of 2". */
export function teacherLine(explicit: Intent | null, commitments: number): string {
  const it = teacherIntent(explicit, commitments);
  if (it === 'not_coming') return 'Can’t make it';
  const said = it === 'coming' ? 'Coming' : it === 'undecided' ? 'Not sure yet' : 'No answer yet';
  return commitments > 0 ? `${said} · teaching ${commitments}` : said;
}
