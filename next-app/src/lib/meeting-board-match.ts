/**
 * The meeting board's live matcher (Phase 3a of Plans/Meeting-Requests-And-Teaching-Offers.md, "Matching rules", rank
 * mode). A PURE, deterministic function over the board: picks, answers, teachers and skill offers in, teaching blocks
 * and the unmatched lists out. No I/O and client-safe, so This Sunday, the meeting editor's tray,
 * /member/meeting and the tests all read one definition. Same input (in any order) = same output.
 *
 *   1. Teachers: a person committed to a topic teaches it (an unqualified one is allowed, with the Phase 2 flags); a
 *      skill offer teaches every requirement in that skill the offerer qualifies for (rank_requirements.skill_id).
 *      Can't-make-it teachers and people who no longer qualify are left out.
 *   2. Sessions: one per (teacher, topic). Sibling picks in the same rank sharing the teacher's skill merge into the
 *      same session (Tenderfoot 4a-4d, all first aid). A skill offer makes one session per rank it reaches, up to the
 *      teacher's SESSIONS_PER_TEACHER. A session is live once a scout asked for it for THIS meeting: one scout is enough
 *      (Patrick, R1: one-scout sessions are allowed), so the plan's "2 picks, 1 for a merit badge make-up" is not a gate.
 *   3. Teaching blocks (Patrick, 2026-10-20): a block IS a session, one adult teaching one group, with no clock; how
 *      long one takes can't be predicted, so nothing is bound to a time period. Up to MAX_BLOCKS a meeting; a teacher
 *      leads up to SESSIONS_PER_TEACHER. A session over 8 splits into a Group B led again by the same teacher. Blocks
 *      are numbered first half, then second (HALF_LABEL: a rough guide, never a constraint), biggest first.
 *   4. Scouts: at most TWO sessions (Decision 1); 8 a session. Everyone gets one before anyone gets a second. A
 *      contested seat goes by the scout's own ranking of it
 *      (an unranked pick after any ranked one), then closest to finishing their next rank, then longest asked
 *      (first_asked_on), then the person id (only so the result never depends on input order).
 *   5. "Not sure yet" scouts are placed after everyone who said Coming: by their own picks if they have any, otherwise
 *      into a live session from the engine's own rule (next-rank, meeting-doable, unfinished: lib/rank-calculus
 *      openRankTops). "Not sure yet" adults are offered the wanted-no-teacher topics their skills cover.
 *   6. Unmatched: wanted with no teacher (weeks asked; who on file could teach it), offered with no takers, coming with
 *      nothing assigned (with the engine's next suggestion).
 *   7. "Later" picks and Can't-make-it scouts are ignored here; their picks are kept for the next board.
 */
import type { AdvancementCatalog, CatalogRank, CatalogRankRequirement } from '@/lib/advancement-catalog';
import { nextRankOf, topicWords, type TopicPart, type TopicWords, type TopicWordsMore } from '@/lib/meeting-board-picklist';
import { effectiveIntent, orderPicks, type BoardPick, type Intent } from '@/lib/meeting-board-shared';
import { assessTeacher, teacherName, topicSkill, weeksAsked, type SupplyInput, type TeachFlag, type TeacherPerson } from '@/lib/meeting-board-teach';
import { openRankTops, rankLeafCompletion } from '@/lib/rank-calculus';

/** Scouts per session: the engine's group cap. */
export const SESSION_CAP = 8;
/** Topics a scout is matched to (Decision 1). */
export const MAX_TOPICS_PER_SCOUT = 2;
/** Teaching blocks (sessions) a meeting can hold; unused ones show as "Not filled" (Patrick, 2026-10-20). */
export const MAX_BLOCKS = 12;
/** Sessions one teacher leads, one after the other: the commitment cap. */
export const SESSIONS_PER_TEACHER = 2;
/** The rough halves a session is suggested for (MatchSession.half): a guide, never a constraint. */
export const HALF_LABEL = ['First half, about 4:15', 'Second half, about 4:45'] as const;

export interface MatchScout {
  personId: number;
  currentRank: string | null;
  /** Rank-requirement ledger codes ('tenderfoot-3a'): completion for the tie-break, and the engine's placement. */
  rankCodes: ReadonlySet<string>;
  /** The explicit answer; a pick for this meeting implies Coming (effectiveIntent). */
  intent: Intent | null;
  picks: readonly BoardPick[];
}

export interface MatchInput {
  meetingDate: string;
  scouts: readonly MatchScout[];
  supply: SupplyInput;
  /** Explicit answers of the people in supply.people (for "Not sure yet" adults). */
  teacherIntents: ReadonlyMap<number, Intent>;
}

export interface MatchSeat {
  personId: number;
  /** The topic of theirs this seat answers. */
  key: string;
  /** Their own rank for it (1-5) when they ranked their picks; null when unranked or placed. */
  pickNo: number | null;
  /** 'pick' = they asked for it; 'placed' = a "Not sure yet" scout put here by the engine's rule. */
  via: 'pick' | 'placed';
}

export interface MatchSession {
  /** Stable across recomputes of the same board: lead teacher + first key (+ group). */
  id: string;
  /** Sessions split from one oversubscribed topic share it. */
  unitId: string;
  /** Topic keys taught here, catalog order (several when sibling picks merged). */
  keys: string[];
  /** 0-based teaching block: the session's number, first half then second, biggest first. */
  block: number;
  /** The rough half it's suggested for (0 ≈ 4:15, 1 ≈ 4:45): a guide for the order, never a constraint. */
  half: 0 | 1;
  /** The Rotation it is in, said to people (P4: the matcher's half + 1; a saved Live placement's own rotation, null
   *  when the class is Not scheduled). */
  rotation: number | null;
  /** A saved class's own title (a snapshot for merged sibling picks), over the topic's words. */
  title?: string | null;
  /** 'A', 'B' when an oversubscribed topic split; null otherwise. */
  group: string | null;
  /** Null only for a saved Live class nobody teaches yet. */
  teacherId: number | null;
  /** Others committed to the same topic. */
  coTeacherIds: number[];
  /** 'topic' = a commitment; 'offer' = a broad skill offer. */
  via: 'topic' | 'offer';
  /** The lead teacher's flags across the keys ("sign-off needs a counselor", "not in their skills"…). */
  flags: TeachFlag[];
  scouts: MatchSeat[];
}

export interface MatchResult {
  /** Teaching blocks available (MAX_BLOCKS); `sessions` fill the first of them. */
  blockCount: number;
  /** Live sessions in block order. */
  sessions: MatchSession[];
  /** Each scout's seats, by block. Only scouts with at least one. */
  assignments: { personId: number; seats: (MatchSeat & { sessionId: string; block: number })[] }[];
  /** Asked for, nobody to teach it (a teacher already leading their limit, or every block taken, counts: they're named
   *  in blockedTeacherIds). */
  wanted: { key: string; scoutIds: number[]; weeks: number; canTeach: number[]; blockedTeacherIds: number[] }[];
  /** Put on the board by a teacher, asked for by nobody: a topic (key) or a skill offer (skillId). */
  offeredNoTakers: { personId: number; key: string | null; skillId: string | null }[];
  /** "Not sure yet" scouts and whether the matcher found them a place. */
  undecidedScouts: { personId: number; placed: boolean }[];
  /** "Not sure yet" adults and the wanted topics their skills cover. */
  undecidedAdults: { personId: number; fits: string[] }[];
  /** Coming (said, or by picking), nothing assigned, not teaching: the engine's next suggestion for them, if any. */
  comingNothing: { personId: number; suggestion: string | null }[];
}

type Ctx = SupplyInput['ctx'];

/** Catalog order of a topic key: rank order, then requirement order; badges, then freeform, after every rank. */
export function topicOrder(ranks: readonly CatalogRank[], rankReqs: readonly CatalogRankRequirement[]): (key: string) => number {
  const rankSort = new Map(ranks.map((r) => [r.id, r.sort_order]));
  const at = new Map<string, number>();
  for (const r of rankReqs) if (r.parent_id == null) at.set(`${r.rank_id}-${r.code}`, (rankSort.get(r.rank_id) ?? 99) * 100_000 + r.sort_order);
  return (key) => at.get(key) ?? (key.startsWith('mb:') ? 1e9 : 2e9);
}

const rankOfKey = (key: string, ranks: readonly CatalogRank[]) =>
  key.startsWith('mb:') || key.startsWith('ff:') ? null : ([...ranks].sort((a, b) => b.id.length - a.id.length).find((r) => key.startsWith(`${r.id}-`))?.id ?? null);

/** How far a scout is through their next rank (0-1): the tie-break "closest to rank completion". */
export function nextRankCompletion(s: Pick<MatchScout, 'currentRank' | 'rankCodes'>, ctx: Ctx): number {
  const next = nextRankOf(s.currentRank, ctx.ranks);
  if (!next) return 1;
  return rankLeafCompletion(ctx.trees.get(next) ?? [], next, s.rankCodes as Set<string>, '');
}

/** The engine's rule for a scout's next things (pass 1, rank half): next-rank meeting-doable unfinished, in order. */
export function engineSuggestions(s: Pick<MatchScout, 'currentRank' | 'rankCodes'>, ctx: Ctx): string[] {
  const next = nextRankOf(s.currentRank, ctx.ranks);
  if (!next) return [];
  return openRankTops(ctx.trees.get(next) ?? [], next, s.rankCodes as Set<string>).meeting.map((t) => `${next}-${t.code}`);
}

interface Demand {
  personId: number;
  key: string;
  priority: number | null;
  firstAskedOn: string;
}

interface Unit {
  id: string;
  keys: string[];
  teacherId: number;
  coTeacherIds: number[];
  via: 'topic' | 'offer';
}

interface Section {
  unit: Unit;
  group: string | null;
  coTeacherIds: number[];
  seats: MatchSeat[];
}

const byNum = (a: number, b: number) => a - b;

export function matchBoard(input: MatchInput): MatchResult {
  const { supply } = input;
  const ctx = supply.ctx;
  const cap = MAX_TOPICS_PER_SCOUT;
  const order = topicOrder(ctx.ranks, ctx.rankReqs);
  const keyCmp = (a: string, b: string) => order(a) - order(b) || a.localeCompare(b);

  // ── demand: this meeting's picks of everyone who isn't "Can't make it", the scout's own order ──────────────────
  const scouts = [...input.scouts].sort((a, b) => a.personId - b.personId);
  const intentOf = new Map(scouts.map((s) => [s.personId, effectiveIntent(s.intent, s.picks)]));
  const prefs = new Map<number, Demand[]>();
  for (const s of scouts) {
    if (intentOf.get(s.personId) === 'not_coming') continue;
    const here = orderPicks(
      s.picks.filter((p) => !p.later),
      order
    );
    if (here.length) prefs.set(s.personId, here.map((p) => ({ personId: s.personId, key: p.key, priority: p.priority, firstAskedOn: p.firstAskedOn })));
  }
  const demand = new Map<string, Demand[]>();
  for (const list of prefs.values()) for (const d of list) demand.set(d.key, [...(demand.get(d.key) ?? []), d]);
  const demanders = (keys: readonly string[]) => new Set(keys.flatMap((k) => (demand.get(k) ?? []).map((d) => d.personId)));

  // ── supply: who may teach (coming, still qualifies), commitments by topic ─────────────────────────────────────
  const canTeachHere = (personId: number) => !supply.notComing.has(personId) && supply.people.has(personId) && supply.people.get(personId)!.eligible !== false;
  const committed = new Map<string, number[]>();
  for (const t of supply.topicTeachers) {
    if (!canTeachHere(t.personId)) continue;
    const list = committed.get(t.key) ?? [];
    if (!list.includes(t.personId)) committed.set(t.key, [...list, t.personId].sort(byNum));
  }

  // ── units: a teacher and the topics they teach together ──────────────────────────────────────────────────────
  const units: Unit[] = [];
  const unitOfKey = new Map<string, Unit>();
  const offeredNoTakers: MatchResult['offeredNoTakers'] = [];
  const sameRankSkill = (a: string, b: string) => {
    const s = topicSkill(a, ctx.ranks, ctx.rankReqs);
    return s != null && s === topicSkill(b, ctx.ranks, ctx.rankReqs) && rankOfKey(a, ctx.ranks) === rankOfKey(b, ctx.ranks);
  };
  for (const key of [...committed.keys()].sort(keyCmp)) {
    if (unitOfKey.has(key)) continue;
    const [lead, ...co] = committed.get(key)!;
    const leadP = supply.people.get(lead)!;
    // Sibling picks sharing the skill join: asked for, no other unit yet, and nobody else leads them.
    const siblings = [...demand.keys()]
      .filter((k) => k !== key && !unitOfKey.has(k) && sameRankSkill(key, k))
      .filter((k) => (committed.get(k)?.[0] ?? lead) === lead && assessTeacher(leadP, k, ctx).qualified)
      .sort(keyCmp);
    const coTeachers = [...new Set([...co, ...siblings.flatMap((k) => committed.get(k) ?? [])])].filter((id) => id !== lead).sort(byNum);
    const unit: Unit = { id: `${lead}:${key}`, keys: [key, ...siblings].sort(keyCmp), teacherId: lead, coTeacherIds: coTeachers, via: 'topic' };
    for (const k of unit.keys) unitOfKey.set(k, unit);
    if (!demanders(unit.keys).size) {
      offeredNoTakers.push({ personId: lead, key, skillId: null });
      continue;
    }
    units.push(unit);
  }
  const ledBy = (personId: number) => units.filter((u) => u.teacherId === personId).length;
  const offers = [...supply.skillOffers].filter((o) => canTeachHere(o.personId)).sort((a, b) => a.personId - b.personId || a.skillId.localeCompare(b.skillId));
  for (const o of offers) {
    const p = supply.people.get(o.personId)!;
    const byRank = new Map<string, string[]>();
    for (const k of [...demand.keys()].sort(keyCmp)) {
      if (unitOfKey.has(k) || topicSkill(k, ctx.ranks, ctx.rankReqs) !== o.skillId || !assessTeacher(p, k, ctx).qualified) continue;
      const r = rankOfKey(k, ctx.ranks)!;
      byRank.set(r, [...(byRank.get(r) ?? []), k]);
    }
    const groups = [...byRank.values()].sort((a, b) => demanders(b).size - demanders(a).size || keyCmp(a[0], b[0]));
    if (!groups.length) {
      offeredNoTakers.push({ personId: o.personId, key: null, skillId: o.skillId });
      continue;
    }
    // One broad offer is one commitment, and makes as many sessions as the teacher can still lead.
    for (const keys of groups.slice(0, Math.max(0, SESSIONS_PER_TEACHER - ledBy(o.personId)))) {
      const unit: Unit = { id: `${o.personId}:${keys[0]}`, keys, teacherId: o.personId, coTeacherIds: [], via: 'offer' };
      for (const k of keys) unitOfKey.set(k, unit);
      units.push(unit);
    }
  }

  // ── teaching blocks: a session each, no clock; MAX_BLOCKS a meeting, SESSIONS_PER_TEACHER a teacher ────────────
  const sections: Section[] = [];
  const led = new Map<number, number>(); // teacher → sessions they lead
  const room = (unit: Unit) => sections.length < MAX_BLOCKS && (led.get(unit.teacherId) ?? 0) < SESSIONS_PER_TEACHER;
  const place = (unit: Unit) => {
    led.set(unit.teacherId, (led.get(unit.teacherId) ?? 0) + 1);
    sections.push({ unit, group: null, coTeacherIds: unit.coTeacherIds, seats: [] });
  };
  const blocked = new Map<string, number[]>(); // key → teachers with no room left for it
  const bySize = (a: Unit, b: Unit) => demanders(b.keys).size - demanders(a.keys).size || a.id.localeCompare(b.id);
  for (const unit of [...units].sort(bySize)) {
    if (!room(unit)) {
      for (const k of unit.keys) blocked.set(k, [...(blocked.get(k) ?? []), unit.teacherId]);
      for (const k of unit.keys) unitOfKey.delete(k);
      continue;
    }
    place(unit);
  }
  // An oversubscribed topic splits into a Group B (C…), led again by the same teacher while they and the meeting have room.
  for (const unit of [...units].sort(bySize)) {
    const mine = sections.filter((s) => s.unit === unit);
    if (!mine.length) continue;
    while (mine.length * SESSION_CAP < demanders(unit.keys).size && room(unit)) {
      place(unit);
      mine.push(sections[sections.length - 1]);
    }
    if (mine.length > 1) mine.forEach((s, i) => (s.group = String.fromCharCode(65 + i)));
  }

  // ── assignment ───────────────────────────────────────────────────────────────────────────────────────────────
  const scoutById = new Map(scouts.map((s) => [s.personId, s]));
  const completion = new Map(scouts.map((s) => [s.personId, nextRankCompletion(s, ctx)]));
  const seatsOf = new Map<number, (MatchSeat & { section: Section })[]>();
  const has = (personId: number, unit: Unit) => (seatsOf.get(personId) ?? []).some((x) => x.section.unit === unit);
  // No clock, so the only clash is a Junior Leader's own session.
  const freeIn = (personId: number, s: Section) => s.unit.teacherId !== personId && !s.coTeacherIds.includes(personId);
  const sectionsOf = new Map<Unit, Section[]>();
  for (const s of sections) sectionsOf.set(s.unit, [...(sectionsOf.get(s.unit) ?? []), s]);
  const contest = (a: Demand, b: Demand) =>
    (a.priority ?? 99) - (b.priority ?? 99) ||
    (completion.get(b.personId) ?? 0) - (completion.get(a.personId) ?? 0) ||
    a.firstAskedOn.localeCompare(b.firstAskedOn) ||
    a.personId - b.personId;

  /** Rounds of "everyone gets one before anyone gets another"; within a round, everyone's first choice is settled
   *  before anyone's second, so a scout's own ranking decides who gets a contested seat. */
  const assign = (who: readonly number[], listOf: (personId: number) => Demand[], via: MatchSeat['via']) => {
    for (let round = 0; round < cap; round++) {
      const placedThisRound = new Set<number>();
      const maxLen = Math.max(0, ...who.map((id) => listOf(id).length));
      for (let level = 0; level < maxLen; level++) {
        const claims = new Map<Unit, Demand[]>();
        for (const id of who) {
          if (placedThisRound.has(id) || (seatsOf.get(id)?.length ?? 0) > round || (seatsOf.get(id)?.length ?? 0) >= cap) continue;
          const d = listOf(id)[level];
          const unit = d ? unitOfKey.get(d.key) : undefined;
          if (!d || !unit || !sectionsOf.has(unit) || has(id, unit)) continue;
          claims.set(unit, [...(claims.get(unit) ?? []), d]);
        }
        for (const unit of [...claims.keys()].sort((a, b) => a.id.localeCompare(b.id))) {
          for (const d of claims.get(unit)!.sort(contest)) {
            // Split groups fill evenly: the open group with the fewest scouts, then Group A before B.
            const section = sectionsOf
              .get(unit)!
              .filter((s) => s.seats.length < SESSION_CAP && freeIn(d.personId, s))
              .sort((x, y) => x.seats.length - y.seats.length || (x.group ?? '').localeCompare(y.group ?? ''))[0];
            if (!section) continue;
            const seat: MatchSeat = { personId: d.personId, key: d.key, pickNo: via === 'pick' ? d.priority : null, via };
            section.seats.push(seat);
            seatsOf.set(d.personId, [...(seatsOf.get(d.personId) ?? []), { ...seat, section }]);
            placedThisRound.add(d.personId);
          }
        }
      }
    }
  };
  const withPicks = (it: Intent) => scouts.filter((s) => intentOf.get(s.personId) === it && prefs.has(s.personId)).map((s) => s.personId);
  assign(withPicks('coming'), (id) => prefs.get(id)!, 'pick');
  assign(withPicks('undecided'), (id) => prefs.get(id)!, 'pick');
  const undecidedBare = scouts.filter((s) => intentOf.get(s.personId) === 'undecided' && !prefs.has(s.personId)).map((s) => s.personId);
  const suggested = new Map(undecidedBare.map((id) => [id, engineSuggestions(scoutById.get(id)!, ctx).map((key) => ({ personId: id, key, priority: null, firstAskedOn: '9999-12-31' }))]));
  assign(undecidedBare, (id) => suggested.get(id)!, 'placed');

  // ── output ───────────────────────────────────────────────────────────────────────────────────────────────────
  const sessionId = (s: Section) => (s.group ? `${s.unit.id}:${s.group}` : s.unit.id);
  const flagsOf = (u: Unit): TeachFlag[] => {
    const p = supply.people.get(u.teacherId)!;
    return [...new Set(u.keys.flatMap((k) => assessTeacher(p, k, ctx).flags))].sort();
  };
  // A session nobody ended up in (everyone who asked was placed elsewhere, or full up) is not a session: its teacher
  // goes on "Offered, no takers" (once per unit), and it never reaches the tray.
  for (const unit of units) {
    const mine = sections.filter((s) => s.unit === unit);
    if (mine.length && mine.every((s) => !s.seats.length)) {
      offeredNoTakers.push({ personId: unit.teacherId, key: unit.keys[0], skillId: null });
    }
  }
  // Rough halves (Patrick: about 4:15-4:45 and 4:45-5:15, "by no means locked"): a guide for the order, never a
  // constraint. Biggest first, each session goes to the half where fewer of its people (teachers and scouts) already
  // are, then to the emptier half. Blocks are then numbered first half, then second, biggest first within each.
  const unitSize = (u: Unit) => sections.filter((s) => s.unit === u).reduce((n, s) => n + s.seats.length, 0);
  const bigFirst = (a: Section, b: Section) =>
    unitSize(b.unit) - unitSize(a.unit) || a.unit.id.localeCompare(b.unit.id) || (a.group ?? '').localeCompare(b.group ?? '');
  const halfOf = new Map<Section, 0 | 1>();
  const inHalf = [new Set<number>(), new Set<number>()];
  const perHalf = [0, 0];
  for (const s of sections.filter((x) => x.seats.length > 0).sort(bigFirst)) {
    const people = [s.unit.teacherId, ...s.coTeacherIds, ...s.seats.map((x) => x.personId)];
    const clash = (h: 0 | 1) => people.filter((id) => inHalf[h].has(id)).length;
    const h: 0 | 1 = clash(0) !== clash(1) ? (clash(0) < clash(1) ? 0 : 1) : perHalf[0] <= perHalf[1] ? 0 : 1;
    halfOf.set(s, h);
    perHalf[h]++;
    for (const id of people) inHalf[h].add(id);
  }
  const live = [...halfOf.keys()].sort((a, b) => halfOf.get(a)! - halfOf.get(b)! || bigFirst(a, b));
  const blockOf = new Map(live.map((s, i) => [s, i]));
  const out: MatchSession[] = live.map((s, i) => ({
    id: sessionId(s),
    unitId: s.unit.id,
    keys: s.unit.keys,
    block: i,
    half: halfOf.get(s)!,
    rotation: halfOf.get(s)! + 1,
    group: s.group,
    teacherId: s.unit.teacherId,
    coTeacherIds: s.coTeacherIds,
    via: s.unit.via,
    flags: flagsOf(s.unit),
    scouts: [...s.seats].sort((a, b) => a.personId - b.personId)
  }));

  const assignments = [...seatsOf]
    .sort(([a], [b]) => a - b)
    .map(([personId, seats]) => ({
      personId,
      seats: seats
        .map(({ section, ...seat }) => ({ ...seat, sessionId: sessionId(section), block: blockOf.get(section)! }))
        .sort((a, b) => a.block - b.block)
    }));

  const teachingIds = new Set(out.flatMap((s) => [s.teacherId, ...s.coTeacherIds]));
  const pool = [...supply.people.values()].filter((p) => canTeachHere(p.personId)).sort((a, b) => a.personId - b.personId);
  const wanted = [...demand.keys()]
    .filter((k) => !unitOfKey.has(k))
    .sort(keyCmp)
    .map((key) => {
      const ds = demand.get(key)!;
      return {
        key,
        scoutIds: ds.map((d) => d.personId).sort(byNum),
        weeks: weeksAsked(ds.map((d) => d.firstAskedOn), input.meetingDate),
        canTeach: pool.filter((p) => { const a = assessTeacher(p, key, ctx); return a.qualified && !a.refused; }).map((p) => p.personId),
        blockedTeacherIds: (blocked.get(key) ?? []).sort(byNum)
      };
    })
    .sort((a, b) => b.scoutIds.length - a.scoutIds.length || b.weeks - a.weeks || keyCmp(a.key, b.key));

  const adultsUndecided = [...supply.people.values()]
    .filter((p) => p.kind === 'adult' && p.eligible !== false && input.teacherIntents.get(p.personId) === 'undecided')
    .sort((a, b) => a.personId - b.personId)
    .map((p) => ({ personId: p.personId, fits: wanted.filter((w) => { const a = assessTeacher(p, w.key, ctx); return a.qualified && !a.refused; }).map((w) => w.key) }));

  return {
    blockCount: MAX_BLOCKS,
    sessions: out,
    assignments,
    wanted,
    offeredNoTakers: offeredNoTakers.sort((a, b) => a.personId - b.personId || (a.key ?? a.skillId ?? '').localeCompare(b.key ?? b.skillId ?? '')),
    undecidedScouts: scouts.filter((s) => intentOf.get(s.personId) === 'undecided').map((s) => ({ personId: s.personId, placed: (seatsOf.get(s.personId)?.length ?? 0) > 0 })),
    undecidedAdults: adultsUndecided,
    comingNothing: scouts
      .filter((s) => intentOf.get(s.personId) === 'coming' && !seatsOf.has(s.personId) && !teachingIds.has(s.personId))
      .map((s) => ({ personId: s.personId, suggestion: engineSuggestions(s, ctx)[0] ?? null }))
  };
}

/**
 * What a session is called: one topic is its own label ("Knots", "Tenderfoot 3a"); merged siblings are their skill
 * ("First Aid", "Tenderfoot 4a, 4b"). Same words on This Sunday, the tray and the member page.
 */
export function sessionWords(
  keys: readonly string[],
  catalog: Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'meritBadges'>,
  skillNames: ReadonlyMap<string, string>,
  freeformTitles?: ReadonlyMap<string, string>,
  /** P3: merit badge requirements and focus groups' members, for seeded topics. */
  more?: TopicWordsMore
): { title: string; codeLabel: string; kind: 'rank' | 'mb' | 'ff' | 'focus'; skillId: string | null; parts: TopicPart[]; minutes: number | null } {
  const words = (k: string): TopicWords =>
    topicWords(k, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, freeformTitles, more) ?? { label: k, codeLabel: '', kind: 'rank', parts: [], minutes: null };
  const all = keys.map(words);
  const first = all[0] ?? words('');
  const skillId = keys.length ? topicSkill(keys[0], catalog.ranks, catalog.rankRequirements) : null;
  // T-3/T-4: a session's sub-requirements and time are its topics' together.
  const parts = all.flatMap((w) => w.parts);
  const timed = all.filter((w) => w.minutes != null);
  const minutes = timed.length ? timed.reduce((n, w) => n + w.minutes!, 0) : null;
  if (keys.length < 2) return { title: first.label, codeLabel: first.codeLabel, kind: first.kind, skillId, parts, minutes };
  const rank = rankOfKey(keys[0], catalog.ranks);
  const rankName = catalog.ranks.find((r) => r.id === rank)?.display_name ?? '';
  const codes = keys.map((k) => (rank ? k.slice(rank.length + 1) : k));
  return { title: (skillId && skillNames.get(skillId)) || first.label, codeLabel: `${rankName} ${codes.join(', ')}`.trim(), kind: first.kind, skillId, parts, minutes };
}

/** A line on /member/meeting: a scout's matched session, or a session a teacher is teaching. */
export interface MatchLine {
  /** 'Rotation 2': the rotation it is in (P4: the troop's word); null when not scheduled yet. */
  block: string | null;
  title: string;
  codeLabel: string;
  /** The scout's own number for it, when they ranked their picks. */
  pickNo: number | null;
  /** A "Not sure yet" scout the matcher placed. */
  placed: boolean;
  /** Scout-facing: "Mr. Vest", or a Junior Leader "Maya S". */
  teacher: string;
  /** Teachers' lines: who is in it, first name + last initial. Always empty on a scout's own line. */
  scouts: string[];
  /** Its sub-requirements, as the Clipboard lists them (T-4). */
  parts?: TopicPart[];
  /** Expected minutes to teach it (T-3); null for a whole badge or freeform topic. */
  minutes?: number | null;
}

interface LineSources {
  catalog: Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'meritBadges' | 'skills'> & Partial<Pick<AdvancementCatalog, 'meritBadgeRequirements'>>;
  people: ReadonlyMap<number, Pick<TeacherPerson, 'kind' | 'displayName' | 'lastName' | 'gender'>>;
  freeformTitles?: ReadonlyMap<string, string>;
  /** P3: focus groups' items by key. */
  members?: ReadonlyMap<string, readonly string[]>;
  scoutNames: ReadonlyMap<number, string>;
}

function lineFor(match: MatchResult, s: MatchSession, src: LineSources, seat?: MatchSeat): MatchLine {
  const w = sessionWords(s.keys, src.catalog, new Map(src.catalog.skills.map((k) => [k.id, k.name])), src.freeformTitles, { mbReqs: src.catalog.meritBadgeRequirements, members: src.members });
  const t = s.teacherId != null ? src.people.get(s.teacherId) : undefined;
  return {
    block: s.rotation != null ? `Rotation ${s.rotation}` : null,
    title: s.title ?? w.title,
    codeLabel: s.group ? `${w.codeLabel} · Group ${s.group}` : w.codeLabel,
    pickNo: seat?.pickNo ?? null,
    placed: seat?.via === 'placed',
    teacher: t ? teacherName(t, 'scout') : '',
    // Classmates are a teacher's view only; a scout's own line carries none.
    scouts: seat ? [] : s.scouts.map((x) => src.scoutNames.get(x.personId) ?? '').filter(Boolean).sort(),
    parts: w.parts,
    minutes: w.minutes
  };
}

/** "You're in First aid, your #2": a scout's matched sessions as their page says them, by block. */
export function seatLines(match: MatchResult, personId: number, src: LineSources): MatchLine[] {
  return seatsFor(match, personId).flatMap((seat) => {
    const s = match.sessions.find((x) => x.id === seat.sessionId);
    return s ? [lineFor(match, s, src, seat)] : [];
  });
}

/** The sessions a teacher is in the match for, by block. */
export function teachingLines(match: MatchResult, personId: number, src: LineSources): MatchLine[] {
  return teachingFor(match, personId).map((s) => lineFor(match, s, src));
}

/** One scout's seats, by block ("You're in First aid, your #2"). */
export function seatsFor(match: MatchResult, personId: number) {
  return match.assignments.find((a) => a.personId === personId)?.seats ?? [];
}

/** The sessions a teacher leads or co-teaches, by block. */
export function teachingFor(match: MatchResult, personId: number): MatchSession[] {
  return match.sessions.filter((s) => s.teacherId === personId || s.coTeacherIds.includes(personId));
}
