/**
 * Meeting Plan suggestion engine — pure functions, no I/O. Lives in lib/ since Build a Plan B0 (Plans/Build-A-Plan.md)
 * so the planner can suggest from it; every session and suggestion carries the board's topic key.
 *
 * Same batch shape as audits/checks/bor-requirements.ts: raw catalog rows →
 * buildReqTree → isGroupSatisfied walk against per-scout ledger code sets.
 *
 * Rules (Plans/Meeting-Plan-Advancement-Suggestions.md):
 *   - Suggest next-rank TOP-LEVEL requirements with venue ≠ 'outing'; max 3
 *     per scout. Sub-requirements roll up to their parent (taught together).
 *   - Prefer requirements shared by several scouts (they make group sessions).
 *   - Older scouts (next rank Star+) also get merit badge suggestions,
 *     Eagle-required first, drawn from badges in progress or with a counselor:
 *     one top-level requirement each ('first-aid-2'), never a whole badge.
 *   - Group sessions need ≥2 scouts; cohorts over 8 split by patrol.
 *   - Teacher matching: requirement skill → teaching_skills, keyed to people
 *     (Phase 0a of Plans/Meeting-Requests-And-Teaching-Offers.md): adults —
 *     leaders and parents alike — and, when the skill is youth-teachable,
 *     scouts who canOfferToTeach (First Class+ or Junior Leader).
 *   - Campout-only outstanding items are reported separately (needsOuting).
 *   - Every scout is reported (B9): one with no suggestion carries a reason code (NoSuggestionReason), never skipped.
 */

import { buildReqTree, type ReqNode } from '@/lib/mb-helpers';
import { canOfferToTeach } from '@/lib/can-offer-to-teach';
import {
  mbNodeSatisfied,
  openRankTops,
  rankBorPickable,
  rankLeafCompletion,
  rankNodeSatisfied,
  SM_CONFERENCE_CODES,
  SM_CONFERENCE_THRESHOLD
} from '@/lib/rank-calculus';
import type { ReqVenue, Skill } from '@/lib/supabase/types';
import {
  type MeetingPlanPayload,
  type NoSuggestionReason,
  type PlanByScout,
  type PlanScoutRef,
  type PlanSession,
  type PlanTeacher,
  type ScoutSuggestion,
  type TierId
} from '@/lib/meeting-plan-types';

const MAX_SUGGESTIONS_PER_SCOUT = 3;
const MAX_GROUP_SIZE = 8;
const MAX_OUTING_ITEMS = 3;
const MAX_ADULT_TEACHERS = 3;
const MAX_SCOUT_TEACHERS = 2;
const MAX_MB_CANDIDATES_PER_SCOUT = 2;

// ── input row shapes ───────────────────────────────────────────────────────

export interface EngineRankReqRow {
  id: number;
  rank_id: string;
  parent_id: number | null;
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  sort_order: number;
  venue: ReqVenue;
  skill_id: string | null;
}

export interface EngineMbReqRow {
  id: number;
  mb_id: string;
  parent_id: number | null;
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  sort_order: number;
  venue: ReqVenue;
}

export interface EngineInput {
  meetingDate: string;
  title: string;
  generatedAt: string;
  scouts: {
    id: string;
    display_name: string;
    patrol: string | null;
    current_rank: string | null;
    person_id: number | null;
    graduation_year: number | null;
    junior_leader_override: 'yes' | 'no' | null;
  }[];
  ranks: { id: string; display_name: string; sort_order: number }[];
  rankReqs: EngineRankReqRow[];
  mbs: { id: string; name: string; eagle: boolean }[];
  mbReqs: EngineMbReqRow[];
  mbProgress: { mb_id: string; scout_id: string; awarded: boolean; has_any_req: boolean }[];
  /** ledger_active rows, kind = rank_requirement (code "tenderfoot-3a"). */
  rankReqLedger: { scout_id: string; code: string }[];
  /** ledger_active rows, kind = merit_badge_requirement (code "first-aid-1a"). */
  mbReqLedger: { scout_id: string; code: string }[];
  skills: Skill[];
  /** Adults who may teach: leaders and parents, never an active scout. */
  adults: { personId: number; name: string; role: string | null }[];
  /** teaching_skills: adults' and scouts' skills, one table keyed to people. */
  teachingSkills: { person_id: number; skill_id: string }[];
  /** A counselor is a person, or a non-person source such as Summer Camp (council camp staff): leader_code, no person. */
  counselors: { mb_id: string; person_id: number | null; leader_code?: string | null }[];
  /** Names for the non-person counselor sources, by leader code. */
  counselorSources?: { code: string; name: string }[];
}

function tierForRank(rankId: string | null): TierId {
  if (rankId === 'scout' || rankId === 'tenderfoot') return 'new';
  if (rankId === 'second-class' || rankId === 'first-class') return 'experienced';
  return 'older';
}

/** Short display code: "tenderfoot" + "3a" → "TF 3a". */
const RANK_ABBR: Record<string, string> = {
  scout: 'SC',
  tenderfoot: 'TF',
  'second-class': '2C',
  'first-class': '1C',
  star: 'Star',
  life: 'Life',
  eagle: 'Eagle'
};

// ── satisfaction walk (bor-requirements pattern) ───────────────────────────
// The rank half (rankNodeSatisfied, NOT_PLANNABLE, the 95% SM-conference gate) lives in lib/rank-calculus, shared
// with the meeting board's pick list (one completion calculus).

type RankNode = ReqNode<EngineRankReqRow>;
type MbNode = ReqNode<EngineMbReqRow>;

function collectMissingMbLeaves(node: MbNode, mbId: string, codes: Set<string>, out: EngineMbReqRow[]) {
  if (node.children.length === 0) {
    if (!codes.has(`${mbId}-${node.code}`)) out.push(node);
    return;
  }
  for (const child of node.children) {
    if (!mbNodeSatisfied(child, mbId, codes)) {
      collectMissingMbLeaves(child, mbId, codes, out);
    }
  }
}

// ── candidates ─────────────────────────────────────────────────────────────

interface Candidate {
  /** Grouping key: `rank:tenderfoot-3a` or `mb:first-aid-2` (one top-level requirement, never a whole badge). */
  key: string;
  /** The planner board's topic key: `tenderfoot-3a` or `first-aid-2`. */
  boardKey: string;
  /** The rank or merit badge the requirement belongs to. */
  sourceId: string;
  /** The requirement's own code: `3a`, `2`. */
  code: string;
  kind: 'rank' | 'mb';
  codeLabel: string;
  label: string;
  eagle: boolean;
  skillId: string | null;
  sortOrder: number;
}

export function buildMeetingPlan(input: EngineInput): MeetingPlanPayload {
  const ranksSorted = [...input.ranks].sort((a, b) => a.sort_order - b.sort_order);
  const rankLabel = new Map(ranksSorted.map((r) => [r.id, r.display_name]));
  const rankSort = new Map(ranksSorted.map((r) => [r.id, r.sort_order]));
  const firstClassSort = rankSort.get('first-class') ?? Number.MAX_SAFE_INTEGER;

  const skillById = new Map(input.skills.map((s) => [s.id, s]));
  const mbById = new Map(input.mbs.map((m) => [m.id, m]));
  const adultByPerson = new Map(input.adults.map((a) => [a.personId, a]));
  const scoutByPerson = new Map(input.scouts.filter((s) => s.person_id != null).map((s) => [s.person_id as number, s]));

  // Requirement trees (exclude the synthetic BoR rows, as bor-requirements does).
  const rankRowsByRank = new Map<string, EngineRankReqRow[]>();
  for (const r of input.rankReqs) {
    if (r.code.toLowerCase() === 'bor') continue;
    const list = rankRowsByRank.get(r.rank_id) ?? [];
    list.push(r);
    rankRowsByRank.set(r.rank_id, list);
  }
  const rankTree = new Map<string, RankNode[]>();
  for (const [rankId, rows] of rankRowsByRank) rankTree.set(rankId, buildReqTree(rows));

  const mbRowsByMb = new Map<string, EngineMbReqRow[]>();
  for (const r of input.mbReqs) {
    const list = mbRowsByMb.get(r.mb_id) ?? [];
    list.push(r);
    mbRowsByMb.set(r.mb_id, list);
  }
  const mbTree = new Map<string, MbNode[]>();
  for (const [mbId, rows] of mbRowsByMb) mbTree.set(mbId, buildReqTree(rows));

  // Per-scout ledger code sets.
  const rankCodesByScout = new Map<string, Set<string>>();
  for (const row of input.rankReqLedger) {
    const set = rankCodesByScout.get(row.scout_id) ?? new Set<string>();
    set.add(row.code);
    rankCodesByScout.set(row.scout_id, set);
  }
  const mbCodesByScout = new Map<string, Set<string>>();
  for (const row of input.mbReqLedger) {
    const set = mbCodesByScout.get(row.scout_id) ?? new Set<string>();
    set.add(row.code);
    mbCodesByScout.set(row.scout_id, set);
  }

  // MB progress lookups for the older-scout pass.
  const inProgressByScout = new Map<string, Set<string>>();
  const awardedByScout = new Map<string, Set<string>>();
  for (const row of input.mbProgress) {
    if (row.awarded) {
      const set = awardedByScout.get(row.scout_id) ?? new Set<string>();
      set.add(row.mb_id);
      awardedByScout.set(row.scout_id, set);
    } else if (row.has_any_req) {
      const set = inProgressByScout.get(row.scout_id) ?? new Set<string>();
      set.add(row.mb_id);
      inProgressByScout.set(row.scout_id, set);
    }
  }
  const counseledMbs = new Set(input.counselors.map((c) => c.mb_id));
  const sourceName = new Map((input.counselorSources ?? []).map((src) => [src.code, src.name]));
  const counselorsByMb = new Map<string, PlanTeacher[]>();
  for (const c of input.counselors) {
    let t: PlanTeacher | null = null;
    if (c.person_id != null) {
      if (adultByPerson.has(c.person_id)) t = { code: String(c.person_id), name: adultByPerson.get(c.person_id)!.name };
    } else if (c.leader_code && sourceName.has(c.leader_code)) {
      t = { code: c.leader_code, name: sourceName.get(c.leader_code)! };
    }
    if (t) counselorsByMb.set(c.mb_id, [...(counselorsByMb.get(c.mb_id) ?? []), t]);
  }

  // ── pass 1: candidate pool per scout ────────────────────────────────────

  const scoutRefs = new Map<string, PlanScoutRef>();
  const nextRankByScout = new Map<string, string | null>();
  const candidatesByScout = new Map<string, Candidate[]>();
  const outingByScout = new Map<string, EngineRankReqRow[]>();
  /** Older scouts: how many badges the MB pass could draw from (in progress, or Eagle-required with a counselor). */
  const mbPoolSize = new Map<string, number>();
  const reasonByScout = new Map<string, { reason: NoSuggestionReason; rankId: string | null }>();

  /**
   * B9: why a scout with no candidate has none, first match wins: a board of review is next; (Star and up) no badge to
   * work on; the conference waits for 95%; only non-plannable or campout items left; otherwise finished.
   */
  const noSuggestionReason = (scoutId: string, next: string | null, codes: Set<string>): { reason: NoSuggestionReason; rankId: string | null } => {
    const tree = next ? (rankTree.get(next) ?? []) : [];
    if (next && rankBorPickable(tree, next, codes)) return { reason: 'bor-next', rankId: next };
    if (tierForRank(next) === 'older' && (mbPoolSize.get(scoutId) ?? 0) === 0) return { reason: 'no-mb', rankId: null };
    const open = next ? tree.filter((t) => t.code.toLowerCase() !== 'bor' && !rankNodeSatisfied(t, next, codes)) : [];
    const smc = open.find((t) => SM_CONFERENCE_CODES.has(`${next}-${t.code}`));
    if (smc && next && rankLeafCompletion(tree, next, codes, smc.code) < SM_CONFERENCE_THRESHOLD) return { reason: 'smc-waiting', rankId: next };
    if (open.length > 0 || (mbPoolSize.get(scoutId) ?? 0) > 0) return { reason: 'not-plannable', rankId: next };
    return { reason: 'finished', rankId: null };
  };

  for (const scout of input.scouts) {
    scoutRefs.set(scout.id, {
      id: scout.id,
      name: scout.display_name,
      patrol: scout.patrol,
      rankId: scout.current_rank,
      rankLabel: scout.current_rank ? (rankLabel.get(scout.current_rank) ?? scout.current_rank) : '—'
    });

    // Next rank: first rank when unranked; otherwise the one after current.
    let next: string | null;
    if (!scout.current_rank) {
      next = ranksSorted[0]?.id ?? null;
    } else {
      const idx = ranksSorted.findIndex((r) => r.id === scout.current_rank);
      next = idx >= 0 && idx + 1 < ranksSorted.length ? ranksSorted[idx + 1].id : null;
    }
    nextRankByScout.set(scout.id, next);

    const candidates: Candidate[] = [];
    const codes = rankCodesByScout.get(scout.id) ?? new Set<string>();

    if (next) {
      // Suggestion unit = TOP-LEVEL requirement. Sub-requirements (6c.1,
      // 6c.2, …) are taught together as one block, so an unsatisfied parent
      // becomes a single suggestion/session — never one per sub-leaf.
      const tree = rankTree.get(next) ?? [];
      const abbr = RANK_ABBR[next] ?? next;
      // Unfinished, plannable (NOT_PLANNABLE and the 95% SM-conference gate), split by venue: lib/rank-calculus, shared
      // with the meeting board's matcher.
      const open = openRankTops(tree, next, codes);
      const outing: EngineRankReqRow[] = open.outing;
      for (const top of open.meeting) {
        candidates.push({
          key: `rank:${next}-${top.code}`,
          boardKey: `${next}-${top.code}`,
          sourceId: next,
          code: top.code,
          kind: 'rank',
          codeLabel: `${abbr} ${top.code}`,
          label: top.label,
          eagle: false,
          skillId: top.skill_id,
          sortOrder: top.sort_order
        });
      }
      outingByScout.set(scout.id, outing);
    }

    // Older-scout MB pass: badges in progress, plus Eagle-required badges
    // with a registered counselor. Eagle-required first.
    if (tierForRank(next) === 'older') {
      const inProgress = inProgressByScout.get(scout.id) ?? new Set<string>();
      const awarded = awardedByScout.get(scout.id) ?? new Set<string>();
      const pool = new Set<string>(inProgress);
      for (const mb of input.mbs) {
        if (mb.eagle && counseledMbs.has(mb.id) && !awarded.has(mb.id)) pool.add(mb.id);
      }
      mbPoolSize.set(scout.id, [...pool].filter((id) => !awarded.has(id)).length);

      const mbCodes = mbCodesByScout.get(scout.id) ?? new Set<string>();
      // One requirement, never the whole badge (Meeting Planner II Decision 10): the badge's first unfinished top-level
      // requirement with something left to do at a meeting, keyed as the board keys it ('first-aid-2').
      const mbCandidates: { mbId: string; eagle: boolean; inProgress: boolean; top: EngineMbReqRow }[] = [];
      for (const mbId of pool) {
        if (awarded.has(mbId)) continue;
        const tree = mbTree.get(mbId);
        if (!tree || tree.length === 0) continue;
        const top = tree.find((t) => {
          if (mbNodeSatisfied(t, mbId, mbCodes)) return false;
          const missing: EngineMbReqRow[] = [];
          collectMissingMbLeaves(t, mbId, mbCodes, missing);
          return missing.some((m) => m.venue !== 'outing');
        });
        if (!top) continue;
        mbCandidates.push({
          mbId,
          eagle: mbById.get(mbId)?.eagle ?? false,
          inProgress: inProgress.has(mbId),
          top
        });
      }
      mbCandidates.sort(
        (a, b) =>
          Number(b.eagle) - Number(a.eagle) ||
          Number(b.inProgress) - Number(a.inProgress) ||
          a.mbId.localeCompare(b.mbId)
      );
      for (const mc of mbCandidates.slice(0, MAX_MB_CANDIDATES_PER_SCOUT)) {
        const mb = mbById.get(mc.mbId);
        candidates.push({
          key: `mb:${mc.mbId}-${mc.top.code}`,
          boardKey: `${mc.mbId}-${mc.top.code}`,
          sourceId: mc.mbId,
          code: mc.top.code,
          kind: 'mb',
          codeLabel: `${mb?.name ?? mc.mbId} ${mc.top.code}`,
          label: mc.top.label,
          eagle: mc.eagle,
          skillId: null,
          sortOrder: 0
        });
      }
    }

    if (candidates.length > 0 || (outingByScout.get(scout.id)?.length ?? 0) > 0) {
      candidatesByScout.set(scout.id, candidates);
    }
    if (candidates.length === 0) reasonByScout.set(scout.id, noSuggestionReason(scout.id, next, codes));
  }

  // ── pass 2: shared counts, then top-3 per scout ─────────────────────────

  const sharedCount = new Map<string, number>();
  for (const candidates of candidatesByScout.values()) {
    for (const c of candidates) {
      sharedCount.set(c.key, (sharedCount.get(c.key) ?? 0) + 1);
    }
  }

  const selectedByScout = new Map<string, Candidate[]>();
  for (const [scoutId, candidates] of candidatesByScout) {
    const scored = [...candidates].sort((a, b) => {
      const score = (c: Candidate) =>
        (sharedCount.get(c.key) ?? 1) * 100 +
        (c.kind === 'mb' && c.eagle ? 30 : 0) +
        (c.skillId ? 10 : 0) -
        c.sortOrder / 1000;
      return score(b) - score(a);
    });
    selectedByScout.set(scoutId, scored.slice(0, MAX_SUGGESTIONS_PER_SCOUT));
  }

  // ── pass 3: group sessions (≥2 scouts, split >8 by patrol) ──────────────

  const membersByKey = new Map<string, { candidate: Candidate; scoutIds: string[] }>();
  for (const [scoutId, selected] of selectedByScout) {
    for (const c of selected) {
      const entry = membersByKey.get(c.key) ?? { candidate: c, scoutIds: [] };
      entry.scoutIds.push(scoutId);
      membersByKey.set(c.key, entry);
    }
  }

  interface ProtoSession {
    candidate: Candidate;
    tier: TierId;
    scoutIds: string[];
    groupPart: string | null;
  }
  const protoSessions: ProtoSession[] = [];
  for (const { candidate, scoutIds } of membersByKey.values()) {
    if (scoutIds.length < 2) continue;
    const tier = candidate.kind === 'mb' ? 'older' : tierForRank(candidate.sourceId);
    // Keep patrols together when splitting: sort by patrol, then name.
    const sorted = [...scoutIds].sort((a, b) => {
      const ra = scoutRefs.get(a)!;
      const rb = scoutRefs.get(b)!;
      return (ra.patrol ?? '').localeCompare(rb.patrol ?? '') || ra.name.localeCompare(rb.name);
    });
    const parts = Math.ceil(sorted.length / MAX_GROUP_SIZE);
    const size = Math.ceil(sorted.length / parts);
    for (let p = 0; p < parts; p++) {
      protoSessions.push({
        candidate,
        tier,
        scoutIds: sorted.slice(p * size, (p + 1) * size),
        groupPart: parts > 1 ? String.fromCharCode(65 + p) : null
      });
    }
  }

  const tierOrder: Record<TierId, number> = { new: 0, experienced: 1, older: 2 };
  protoSessions.sort(
    (a, b) =>
      tierOrder[a.tier] - tierOrder[b.tier] ||
      b.scoutIds.length - a.scoutIds.length ||
      a.candidate.key.localeCompare(b.candidate.key) ||
      (a.groupPart ?? '').localeCompare(b.groupPart ?? '')
  );

  // Teacher matching.
  // One skills table: a person is an adult teacher or a scout instructor by who they are, never by which row.
  const adultsBySkill = new Map<string, number[]>();
  const instructorsBySkill = new Map<string, string[]>();
  for (const ts of input.teachingSkills) {
    if (adultByPerson.has(ts.person_id)) {
      const list = adultsBySkill.get(ts.skill_id) ?? [];
      list.push(ts.person_id);
      adultsBySkill.set(ts.skill_id, list);
    }
    const s = scoutByPerson.get(ts.person_id);
    // Read-time guard: a scout teaches only a youth-teachable skill, whatever the table says.
    if (s && skillById.get(ts.skill_id)?.youth_teachable) {
      const list = instructorsBySkill.get(ts.skill_id) ?? [];
      list.push(s.id);
      instructorsBySkill.set(ts.skill_id, list);
    }
  }
  const scoutById = new Map(input.scouts.map((s) => [s.id, s]));
  const mayTeach = (scoutId: string) => {
    const s = scoutById.get(scoutId);
    if (!s) return false;
    return canOfferToTeach({
      rankSortOrder: s.current_rank ? (rankSort.get(s.current_rank) ?? null) : null,
      firstClassSortOrder: firstClassSort,
      graduationYear: s.graduation_year,
      override: s.junior_leader_override,
      onDate: input.meetingDate
    });
  };
  const teacher = (personId: number) => ({ code: String(personId), name: adultByPerson.get(personId)?.name ?? `Person ${personId}` });

  const sessions: PlanSession[] = [];
  const sessionIdByKeyScout = new Map<string, number>();
  protoSessions.forEach((proto, i) => {
    const id = i + 1;
    const c = proto.candidate;
    const skill = c.skillId ? skillById.get(c.skillId) : undefined;
    const memberSet = new Set(proto.scoutIds);

    const adultTeachers = (c.skillId ? (adultsBySkill.get(c.skillId) ?? []) : []).slice(0, MAX_ADULT_TEACHERS).map(teacher);

    const counselors =
      c.kind === 'mb'
        ? (counselorsByMb.get(c.sourceId) ?? [])
            .slice(0, MAX_ADULT_TEACHERS)
        : [];

    const scoutTeachers =
      skill?.youth_teachable
        ? (instructorsBySkill.get(skill.id) ?? [])
            .filter((sid) => mayTeach(sid) && !memberSet.has(sid) && scoutRefs.has(sid))
            .slice(0, MAX_SCOUT_TEACHERS)
            .map((sid) => {
              const ref = scoutRefs.get(sid)!;
              return { id: sid, name: ref.name, rankLabel: ref.rankLabel };
            })
        : [];

    sessions.push({
      id,
      key: c.boardKey,
      tier: proto.tier,
      kind: c.kind,
      codeLabel: sessionCodeLabel(c, rankLabel, mbById),
      title: c.label,
      eagle: c.kind === 'mb' && c.eagle,
      skillId: skill?.id ?? null,
      skillName: skill?.name ?? null,
      youthTeachable: Boolean(skill?.youth_teachable),
      adultOnly: Boolean(skill && !skill.youth_teachable),
      groupPart: proto.groupPart,
      scouts: proto.scoutIds.map((sid) => scoutRefs.get(sid)!),
      adultTeachers,
      counselors,
      scoutTeachers
    });
    for (const sid of proto.scoutIds) {
      sessionIdByKeyScout.set(`${c.key}|${sid}`, id);
    }
  });

  // ── pass 4: by-scout rows ────────────────────────────────────────────────

  const byScout: PlanByScout[] = [];
  for (const scout of input.scouts) {
    const selected = selectedByScout.get(scout.id) ?? [];
    const outing = outingByScout.get(scout.id) ?? [];
    // B9: every active scout is reported; one with no suggestion carries why (reasonByScout), never skipped.
    const why = selected.length === 0 ? (reasonByScout.get(scout.id) ?? { reason: 'finished' as const, rankId: null }) : null;

    const next = nextRankByScout.get(scout.id) ?? null;
    const abbr = next ? (RANK_ABBR[next] ?? next) : '';
    const suggestions: ScoutSuggestion[] = selected.map((c) => ({
      key: c.boardKey,
      kind: c.kind,
      codeLabel: c.codeLabel,
      label: c.label,
      eagle: c.kind === 'mb' && c.eagle,
      sessionId: sessionIdByKeyScout.get(`${c.key}|${scout.id}`) ?? null
    }));

    byScout.push({
      scout: scoutRefs.get(scout.id)!,
      tier: tierForRank(next),
      suggestions,
      needsOuting: outing.slice(0, MAX_OUTING_ITEMS).map((leaf) => ({
        codeLabel: `${abbr} ${leaf.code}`,
        label: leaf.label
      })),
      reason: why?.reason ?? null,
      reasonRankId: why?.rankId ?? null
    });
  }
  byScout.sort(
    (a, b) =>
      tierOrder[a.tier] - tierOrder[b.tier] || a.scout.name.localeCompare(b.scout.name)
  );

  // ── pass 5: teaching roster + stats ─────────────────────────────────────

  const sessionIdsByLeader = new Map<string, number[]>();
  const sessionIdsByInstructor = new Map<string, number[]>();
  for (const s of sessions) {
    for (const t of [...s.adultTeachers, ...s.counselors]) {
      const list = sessionIdsByLeader.get(t.code) ?? [];
      if (!list.includes(s.id)) list.push(s.id);
      sessionIdsByLeader.set(t.code, list);
    }
    for (const t of s.scoutTeachers) {
      const list = sessionIdsByInstructor.get(t.id) ?? [];
      list.push(s.id);
      sessionIdsByInstructor.set(t.id, list);
    }
  }

  // Skills in the skills table's order, so a person's list reads the same everywhere.
  const sortedTeaching = [...input.teachingSkills].sort(
    (x, y) => (skillById.get(x.skill_id)?.sort_order ?? 0) - (skillById.get(y.skill_id)?.sort_order ?? 0)
  );
  const skillNamesByAdult = new Map<number, string[]>();
  const skillNamesByInstructor = new Map<string, string[]>();
  for (const ts of sortedTeaching) {
    const skill = skillById.get(ts.skill_id);
    if (!skill) continue;
    if (adultByPerson.has(ts.person_id)) skillNamesByAdult.set(ts.person_id, [...(skillNamesByAdult.get(ts.person_id) ?? []), skill.name]);
    const sc = scoutByPerson.get(ts.person_id);
    if (sc && skill.youth_teachable && scoutRefs.has(sc.id)) skillNamesByInstructor.set(sc.id, [...(skillNamesByInstructor.get(sc.id) ?? []), skill.name]);
  }
  const rosterAdults = [...skillNamesByAdult.entries()]
    .map(([personId, skills]) => ({
      code: String(personId),
      name: adultByPerson.get(personId)?.name ?? `Person ${personId}`,
      role: adultByPerson.get(personId)?.role ?? null,
      skills,
      sessionIds: sessionIdsByLeader.get(String(personId)) ?? []
    }))
    .sort((a, b) => b.sessionIds.length - a.sessionIds.length || a.name.localeCompare(b.name));

  const personOfScout = new Map([...scoutByPerson].map(([personId, sc]) => [sc.id, personId]));
  const rosterScoutInstructors = [...skillNamesByInstructor.entries()]
    .filter(([id]) => mayTeach(id))
    .map(([id, skills]) => {
      const ref = scoutRefs.get(id)!;
      return {
        id,
        personId: personOfScout.get(id) ?? null,
        name: ref.name,
        rankLabel: ref.rankLabel,
        skills,
        sessionIds: sessionIdsByInstructor.get(id) ?? []
      };
    })
    .sort((a, b) => b.sessionIds.length - a.sessionIds.length || a.name.localeCompare(b.name));

  const outingItems = [...outingByScout.values()].reduce((sum, list) => sum + list.length, 0);

  return {
    version: 1,
    meetingDate: input.meetingDate,
    title: input.title,
    generatedAt: input.generatedAt,
    stats: {
      scoutsWithSuggestions: [...selectedByScout.values()].filter((l) => l.length > 0).length,
      sessions: sessions.length,
      adultsMatched: new Set(sessions.flatMap((s) => [...s.adultTeachers, ...s.counselors].map((t) => t.code))).size,
      scoutInstructors: new Set(sessions.flatMap((s) => s.scoutTeachers.map((t) => t.id))).size,
      outingItems
    },
    sessions,
    byScout,
    rosterAdults,
    rosterScoutInstructors
  };
}

function sessionCodeLabel(
  c: Candidate,
  rankLabel: Map<string, string>,
  mbById: Map<string, { id: string; name: string; eagle: boolean }>
): string {
  if (c.kind === 'mb') return `${mbById.get(c.sourceId)?.name ?? c.sourceId} ${c.code}`;
  return `${rankLabel.get(c.sourceId) ?? c.sourceId} ${c.code}`;
}
