/**
 * Meeting Plan suggestion engine — pure functions, no I/O.
 *
 * Same batch shape as audits/checks/bor-requirements.ts: raw catalog rows →
 * buildReqTree → isGroupSatisfied walk against per-scout ledger code sets.
 *
 * Rules (Plans/Meeting-Plan-Advancement-Suggestions.md):
 *   - Suggest next-rank TOP-LEVEL requirements with venue ≠ 'outing'; max 3
 *     per scout. Sub-requirements roll up to their parent (taught together).
 *   - Prefer requirements shared by several scouts (they make group sessions).
 *   - Older scouts (next rank Star+) also get merit badge suggestions,
 *     Eagle-required first, drawn from badges in progress or with a counselor.
 *   - Group sessions need ≥2 scouts; cohorts over 8 split by patrol.
 *   - Teacher matching: requirement skill → leader_skills for adults; if the
 *     skill is youth-teachable, authorized Star+ scout instructors too.
 *   - Campout-only outstanding items are reported separately (needsOuting).
 */

import { buildReqTree, isGroupSatisfied, type ReqNode } from '@/lib/mb-helpers';
import type { ReqVenue, Skill } from '@/lib/supabase/types';
import {
  type MeetingPlanPayload,
  type PlanByScout,
  type PlanScoutRef,
  type PlanSession,
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
  scouts: { id: string; display_name: string; patrol: string | null; current_rank: string | null }[];
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
  leaders: { code: string; name: string; role: string | null }[];
  leaderSkills: { leader_code: string; skill_id: string }[];
  counselors: { mb_id: string; leader_code: string }[];
  scoutInstructors: { scout_id: string; skill_id: string }[];
}

// ── non-plannable leaves ───────────────────────────────────────────────────
// Tenure, Scout Spirit, POR, MB-count rollups, and the Eagle project can't be
// "worked on" in a planned meeting block. Scoutmaster conferences stay — they
// genuinely happen at meetings. Keyed `${rankId}-${code}`.

const NOT_PLANNABLE = new Set([
  'scout-1b',
  'tenderfoot-9',
  'second-class-10',
  'first-class-11',
  'star-1', 'star-2', 'star-3', 'star-5',
  'life-1', 'life-2', 'life-3', 'life-5', 'life-6',
  'eagle-1', 'eagle-2', 'eagle-3', 'eagle-4', 'eagle-5'
]);

// Scoutmaster conferences cap a rank — suggest them only when the scout has
// completed ≥95% of that rank's requirement leaves (user rule, 2026-07-11).
// Suggesting one earlier wastes a suggestion slot on something that can't
// happen yet.
const SM_CONFERENCE_CODES = new Set(['tenderfoot-10', 'second-class-11', 'first-class-12']);
const SM_CONFERENCE_THRESHOLD = 0.95;

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

type RankNode = ReqNode<EngineRankReqRow>;
type MbNode = ReqNode<EngineMbReqRow>;

function rankNodeSatisfied(node: RankNode, rankId: string, codes: Set<string>): boolean {
  if (node.children.length === 0) return codes.has(`${rankId}-${node.code}`);
  const sat = node.children.filter((c) => rankNodeSatisfied(c, rankId, codes)).length;
  return isGroupSatisfied(node.complete_rule, node.complete_n, sat, node.children.length);
}

/** Fraction of a rank's requirement leaves on the ledger, excluding one
 *  top-level code (the SM conference being gated). */
function rankLeafCompletion(
  tree: RankNode[],
  rankId: string,
  codes: Set<string>,
  excludeTopCode: string
): number {
  let total = 0;
  let done = 0;
  const walk = (n: RankNode) => {
    if (n.children.length === 0) {
      total++;
      if (codes.has(`${rankId}-${n.code}`)) done++;
      return;
    }
    n.children.forEach(walk);
  };
  for (const top of tree) {
    if (top.code === excludeTopCode) continue;
    walk(top);
  }
  return total === 0 ? 0 : done / total;
}

function mbNodeSatisfied(node: MbNode, mbId: string, codes: Set<string>): boolean {
  if (node.children.length === 0) return codes.has(`${mbId}-${node.code}`);
  const sat = node.children.filter((c) => mbNodeSatisfied(c, mbId, codes)).length;
  return isGroupSatisfied(node.complete_rule, node.complete_n, sat, node.children.length);
}

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
  /** Grouping key: `rank:tenderfoot-3a` or `mb:personal-management`. */
  key: string;
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
  const starSort = rankSort.get('star') ?? Number.MAX_SAFE_INTEGER;

  const skillById = new Map(input.skills.map((s) => [s.id, s]));
  const mbById = new Map(input.mbs.map((m) => [m.id, m]));
  const leaderByCode = new Map(input.leaders.map((l) => [l.code, l]));

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
  const counselorsByMb = new Map<string, string[]>();
  for (const c of input.counselors) {
    const list = counselorsByMb.get(c.mb_id) ?? [];
    list.push(c.leader_code);
    counselorsByMb.set(c.mb_id, list);
  }

  // ── pass 1: candidate pool per scout ────────────────────────────────────

  const scoutRefs = new Map<string, PlanScoutRef>();
  const nextRankByScout = new Map<string, string | null>();
  const candidatesByScout = new Map<string, Candidate[]>();
  const outingByScout = new Map<string, EngineRankReqRow[]>();

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
      const outing: EngineRankReqRow[] = [];
      for (const top of tree) {
        if (rankNodeSatisfied(top, next, codes)) continue;
        if (NOT_PLANNABLE.has(`${next}-${top.code}`)) continue;
        if (
          SM_CONFERENCE_CODES.has(`${next}-${top.code}`) &&
          rankLeafCompletion(tree, next, codes, top.code) < SM_CONFERENCE_THRESHOLD
        ) {
          continue;
        }
        if (top.venue === 'outing') {
          outing.push(top);
          continue;
        }
        candidates.push({
          key: `rank:${next}-${top.code}`,
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

      const mbCodes = mbCodesByScout.get(scout.id) ?? new Set<string>();
      const mbCandidates: { mbId: string; eagle: boolean; inProgress: boolean; firstLeaf: EngineMbReqRow }[] = [];
      for (const mbId of pool) {
        if (awarded.has(mbId)) continue;
        const tree = mbTree.get(mbId);
        if (!tree || tree.length === 0) continue;
        const missing: EngineMbReqRow[] = [];
        for (const top of tree) {
          if (!mbNodeSatisfied(top, mbId, mbCodes)) {
            collectMissingMbLeaves(top, mbId, mbCodes, missing);
          }
        }
        const meetingDoable = missing.filter((m) => m.venue !== 'outing');
        if (meetingDoable.length === 0) continue;
        mbCandidates.push({
          mbId,
          eagle: mbById.get(mbId)?.eagle ?? false,
          inProgress: inProgress.has(mbId),
          firstLeaf: meetingDoable[0]
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
          key: `mb:${mc.mbId}`,
          kind: 'mb',
          codeLabel: `${mb?.name ?? mc.mbId} ${mc.firstLeaf.code}`,
          label: mc.firstLeaf.label,
          eagle: mc.eagle,
          skillId: null,
          sortOrder: 0
        });
      }
    }

    if (candidates.length > 0 || (outingByScout.get(scout.id)?.length ?? 0) > 0) {
      candidatesByScout.set(scout.id, candidates);
    }
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
    const tier =
      candidate.kind === 'mb'
        ? 'older'
        : tierForRank(candidate.key.slice('rank:'.length).split('-').slice(0, -1).join('-'));
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
  const adultsBySkill = new Map<string, string[]>();
  for (const ls of input.leaderSkills) {
    const list = adultsBySkill.get(ls.skill_id) ?? [];
    list.push(ls.leader_code);
    adultsBySkill.set(ls.skill_id, list);
  }
  const instructorsBySkill = new Map<string, string[]>();
  for (const si of input.scoutInstructors) {
    const list = instructorsBySkill.get(si.skill_id) ?? [];
    list.push(si.scout_id);
    instructorsBySkill.set(si.skill_id, list);
  }
  const isStarPlus = (scoutId: string) => {
    const ref = scoutRefs.get(scoutId);
    if (!ref?.rankId) return false;
    return (rankSort.get(ref.rankId) ?? -1) >= starSort;
  };

  const sessions: PlanSession[] = [];
  const sessionIdByKeyScout = new Map<string, number>();
  protoSessions.forEach((proto, i) => {
    const id = i + 1;
    const c = proto.candidate;
    const skill = c.skillId ? skillById.get(c.skillId) : undefined;
    const memberSet = new Set(proto.scoutIds);

    const adultTeachers = (c.skillId ? (adultsBySkill.get(c.skillId) ?? []) : [])
      .slice(0, MAX_ADULT_TEACHERS)
      .map((code) => ({ code, name: leaderByCode.get(code)?.name ?? code }));

    const counselors =
      c.kind === 'mb'
        ? (counselorsByMb.get(c.key.slice('mb:'.length)) ?? [])
            .slice(0, MAX_ADULT_TEACHERS)
            .map((code) => ({ code, name: leaderByCode.get(code)?.name ?? code }))
        : [];

    const scoutTeachers =
      skill?.youth_teachable
        ? (instructorsBySkill.get(skill.id) ?? [])
            .filter((sid) => isStarPlus(sid) && !memberSet.has(sid) && scoutRefs.has(sid))
            .slice(0, MAX_SCOUT_TEACHERS)
            .map((sid) => {
              const ref = scoutRefs.get(sid)!;
              return { id: sid, name: ref.name, rankLabel: ref.rankLabel };
            })
        : [];

    sessions.push({
      id,
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
    if (selected.length === 0 && outing.length === 0) continue;

    const next = nextRankByScout.get(scout.id) ?? null;
    const abbr = next ? (RANK_ABBR[next] ?? next) : '';
    const suggestions: ScoutSuggestion[] = selected.map((c) => ({
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
      }))
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

  const skillNamesByLeader = new Map<string, string[]>();
  for (const ls of input.leaderSkills) {
    const name = skillById.get(ls.skill_id)?.name;
    if (!name) continue;
    const list = skillNamesByLeader.get(ls.leader_code) ?? [];
    list.push(name);
    skillNamesByLeader.set(ls.leader_code, list);
  }
  const rosterAdults = [...skillNamesByLeader.entries()]
    .map(([code, skills]) => ({
      code,
      name: leaderByCode.get(code)?.name ?? code,
      role: leaderByCode.get(code)?.role ?? null,
      skills,
      sessionIds: sessionIdsByLeader.get(code) ?? []
    }))
    .sort((a, b) => b.sessionIds.length - a.sessionIds.length || a.name.localeCompare(b.name));

  const skillNamesByInstructor = new Map<string, string[]>();
  for (const si of input.scoutInstructors) {
    if (!scoutRefs.has(si.scout_id)) continue;
    const name = skillById.get(si.skill_id)?.name;
    if (!name) continue;
    const list = skillNamesByInstructor.get(si.scout_id) ?? [];
    list.push(name);
    skillNamesByInstructor.set(si.scout_id, list);
  }
  const rosterScoutInstructors = [...skillNamesByInstructor.entries()]
    .filter(([id]) => isStarPlus(id))
    .map(([id, skills]) => {
      const ref = scoutRefs.get(id)!;
      return {
        id,
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
  if (c.kind === 'mb') {
    const mbId = c.key.slice('mb:'.length);
    return `${mbById.get(mbId)?.name ?? mbId} · Merit Badge`;
  }
  const full = c.key.slice('rank:'.length); // e.g. "second-class-2f"
  const dash = full.lastIndexOf('-');
  const rankId = full.slice(0, dash);
  const code = full.slice(dash + 1);
  return `${rankLabel.get(rankId) ?? rankId} ${code}`;
}
