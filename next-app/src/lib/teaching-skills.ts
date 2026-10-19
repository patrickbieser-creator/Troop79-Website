/**
 * Teaching skills, Phase 0b of Plans/Meeting-Requests-And-Teaching-Offers.md: the "What I can teach" member page and
 * Admin › Lookups write the SAME teaching_skills rows through one diffing RPC (set_teaching_skills), which logs every
 * add and remove to teaching_skill_changes in the same transaction. Member changes start unreviewed and raise the
 * admin-home alert; Undo and Mark reviewed clear it. Nothing waits for approval: a saved skill counts for the Meeting
 * Plan right away.
 *
 * Who gets the card: an adult (any person who is not an active scout, leaders and parents alike) sees every skill; a
 * scout who can offer to teach (canOfferToTeach: First Class+, or a Junior Leader) sees only youth-teachable skills;
 * anyone else gets no card. Server-only: every function takes the service-role client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { canOfferToTeach } from '@/lib/can-offer-to-teach';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { JuniorLeaderOverride } from '@/lib/participant-class';

export type TeachingProfileKind = 'adult' | 'junior' | 'none';

export interface TeachingSkillOption {
  id: string;
  name: string;
  youthTeachable: boolean;
  /** Why an adults-only skill is adults-only; null for a skill scouts may teach. */
  adultOnlyNote: string | null;
  held: boolean;
  /** Junior Leaders only: of the rank requirements that use this skill, how many the scout has finished. */
  finished: { done: number; total: number } | null;
}

export interface TeachingProfile {
  kind: TeachingProfileKind;
  skills: TeachingSkillOption[];
  /** Badge names this person is a registered counselor for (read-only: it comes from council registration). */
  counselorFor: string[];
}

/** First aid is adults-only by troop rule; the Guide to Safe Scouting covers the others (specialist review). */
export function adultOnlyNote(skillId: string): string {
  return skillId === 'first-aid' ? 'Adults only (troop rule)' : 'Adults only (Guide to Safe Scouting)';
}

type SkillRow = { id: string; name: string; youth_teachable: boolean; sort_order: number };
type ScoutRow = { id: string; current_rank: string | null; graduation_year: number | null; junior_leader_override: JuniorLeaderOverride };

export async function loadTeachingProfile(sb: SupabaseClient, personId: number, onDate: string): Promise<TeachingProfile> {
  const [skillsRes, heldRes, scoutRes, ranksRes, counselorRes] = await Promise.all([
    sb.from('skills').select('id, name, youth_teachable, sort_order').order('sort_order'),
    sb.from('teaching_skills').select('skill_id').eq('person_id', personId),
    sb.from('scouts').select('id, current_rank, graduation_year, junior_leader_override').eq('person_id', personId).eq('active', true).limit(1),
    sb.from('ranks').select('id, sort_order'),
    sb.from('merit_badge_counselors').select('sort_order, merit_badges(name)').eq('person_id', personId)
  ]);
  const firstError = skillsRes.error ?? heldRes.error ?? scoutRes.error ?? ranksRes.error ?? counselorRes.error;
  if (firstError) throw new Error(firstError.message);

  const held = new Set(((heldRes.data ?? []) as { skill_id: string }[]).map((r) => r.skill_id));
  const skills = (skillsRes.data ?? []) as SkillRow[];
  const counselorFor = ((counselorRes.data ?? []) as unknown as { merit_badges: { name: string } | { name: string }[] | null }[])
    .map((c) => (Array.isArray(c.merit_badges) ? c.merit_badges[0] : c.merit_badges)?.name)
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b));
  const scout = ((scoutRes.data ?? []) as ScoutRow[])[0];

  if (!scout) {
    return {
      kind: 'adult',
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        youthTeachable: s.youth_teachable,
        adultOnlyNote: s.youth_teachable ? null : adultOnlyNote(s.id),
        held: held.has(s.id),
        finished: null
      })),
      counselorFor
    };
  }

  const rankSort = new Map(((ranksRes.data ?? []) as { id: string; sort_order: number }[]).map((r) => [r.id, r.sort_order]));
  const mySort = scout.current_rank ? (rankSort.get(scout.current_rank) ?? null) : null;
  const may = canOfferToTeach({
    rankSortOrder: mySort,
    firstClassSortOrder: rankSort.get('first-class') ?? Number.MAX_SAFE_INTEGER,
    graduationYear: scout.graduation_year,
    override: scout.junior_leader_override,
    onDate
  });
  if (!may) return { kind: 'none', skills: [], counselorFor };

  // "Finished it themselves" (specialist review): the scout's current rank is at or above the requirement's rank, or
  // the requirement is on their ledger. Rank first, because historical ranks often lack requirement rows.
  const [{ data: reqRows, error: reqErr }, ledger] = await Promise.all([
    sb.from('rank_requirements').select('rank_id, code, skill_id').not('skill_id', 'is', null),
    fetchAllRows<{ code: string }>((from, to) =>
      sb.from('ledger_active').select('code').eq('kind', 'rank_requirement').eq('scout_id', scout.id).order('id').range(from, to)
    )
  ]);
  if (reqErr) throw new Error(reqErr.message);
  const codes = new Set(ledger.map((l) => l.code));
  const counts = new Map<string, { done: number; total: number }>();
  for (const r of (reqRows ?? []) as { rank_id: string; code: string; skill_id: string }[]) {
    const c = counts.get(r.skill_id) ?? { done: 0, total: 0 };
    const reqSort = rankSort.get(r.rank_id);
    const done = (mySort != null && reqSort != null && mySort >= reqSort) || codes.has(`${r.rank_id}-${r.code}`);
    counts.set(r.skill_id, { done: c.done + (done ? 1 : 0), total: c.total + 1 });
  }
  return {
    kind: 'junior',
    skills: skills
      .filter((s) => s.youth_teachable)
      .map((s) => ({ id: s.id, name: s.name, youthTeachable: true, adultOnlyNote: null, held: held.has(s.id), finished: counts.get(s.id) ?? { done: 0, total: 0 } })),
    counselorFor
  };
}

export type TeachingSource = 'member' | 'admin';
export interface ChangedBy {
  personId: number | null;
  label: string | null;
}

export type SaveTeachingResult = { ok: true; added: string[]; removed: string[] } | { ok: false; error: string };

export async function saveTeachingSkills(
  sb: SupabaseClient,
  personId: number,
  skillIds: string[],
  source: TeachingSource,
  by: ChangedBy
): Promise<SaveTeachingResult> {
  const { data, error } = await sb.rpc('set_teaching_skills', {
    p_person_id: personId,
    p_skill_ids: skillIds,
    p_source: source,
    p_changed_by_person_id: by.personId,
    p_changed_by_label: by.label
  });
  if (error) return { ok: false, error: error.message };
  const d = data as { added: string[]; removed: string[] };
  return { ok: true, added: d.added ?? [], removed: d.removed ?? [] };
}

export type UndoOutcome = 'ok' | 'missing' | 'already' | 'superseded';

export async function undoTeachingSkillChange(
  sb: SupabaseClient,
  changeId: number,
  by: ChangedBy
): Promise<{ ok: true; outcome: UndoOutcome } | { ok: false; error: string }> {
  const { data, error } = await sb.rpc('undo_teaching_skill_change', {
    p_change_id: changeId,
    p_changed_by_person_id: by.personId,
    p_changed_by_label: by.label
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, outcome: data as UndoOutcome };
}

export async function markTeachingSkillChangeReviewed(sb: SupabaseClient, changeId: number): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb.from('teaching_skill_changes').update({ reviewed_at: new Date().toISOString() }).eq('id', changeId).is('reviewed_at', null);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface TeachingSkillChangeRow {
  id: number;
  personId: number;
  personName: string;
  /** 'Junior Leader' for a scout, the leader's role, or null for a parent. */
  personSub: string | null;
  skillName: string;
  action: 'added' | 'removed';
  source: 'member' | 'admin' | 'undo';
  byLabel: string | null;
  /** True when someone other than the person made the change. */
  byOther: boolean;
  changedAt: string;
  reverted: boolean;
  reviewed: boolean;
}

/** 'review' = still counted on admin home (unreviewed, not undone); 'all' = the recent log. */
export async function loadTeachingSkillChanges(
  sb: SupabaseClient,
  { filter, limit = 50 }: { filter: 'review' | 'all'; limit?: number }
): Promise<TeachingSkillChangeRow[]> {
  let q = sb
    .from('teaching_skill_changes')
    .select('id, person_id, skill_id, action, source, changed_by_person_id, changed_by_label, changed_at, reverted_at, reviewed_at, people!teaching_skill_changes_person_id_fkey(display_name), skills(name)')
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (filter === 'review') q = q.is('reviewed_at', null).is('reverted_at', null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type Row = {
    id: number;
    person_id: number;
    skill_id: string;
    action: 'added' | 'removed';
    source: 'member' | 'admin' | 'undo';
    changed_by_person_id: number | null;
    changed_by_label: string | null;
    changed_at: string;
    reverted_at: string | null;
    reviewed_at: string | null;
    people: { display_name: string } | { display_name: string }[] | null;
    skills: { name: string } | { name: string }[] | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const personIds = [...new Set(rows.map((r) => r.person_id))];
  const [{ data: scouts }, { data: leaders }] = personIds.length
    ? await Promise.all([
        sb.from('scouts').select('person_id').eq('active', true).in('person_id', personIds),
        sb.from('leaders').select('person_id, role').eq('is_person', true).in('person_id', personIds)
      ])
    : [{ data: [] }, { data: [] }];
  const scoutIds = new Set(((scouts ?? []) as { person_id: number }[]).map((s) => s.person_id));
  const roleOf = new Map(((leaders ?? []) as { person_id: number; role: string | null }[]).map((l) => [l.person_id, l.role]));
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    personName: one(r.people)?.display_name ?? `Person ${r.person_id}`,
    personSub: scoutIds.has(r.person_id) ? 'Junior Leader' : (roleOf.get(r.person_id) ?? null),
    skillName: one(r.skills)?.name ?? r.skill_id,
    action: r.action,
    source: r.source,
    byLabel: r.changed_by_label,
    byOther: r.changed_by_person_id !== r.person_id,
    changedAt: r.changed_at,
    reverted: r.reverted_at != null,
    reviewed: r.reviewed_at != null
  }));
}

export async function countUnreviewedTeachingSkillChanges(sb: SupabaseClient): Promise<number> {
  const { count, error } = await sb
    .from('teaching_skill_changes')
    .select('id', { count: 'exact', head: true })
    .is('reviewed_at', null)
    .is('reverted_at', null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Just the card's audience (the /member grid shows the card only to adults and Junior Leaders): two small reads. */
export async function loadTeachingKind(sb: SupabaseClient, personId: number, onDate: string): Promise<TeachingProfileKind> {
  const [{ data: scouts, error: scoutErr }, { data: ranks, error: rankErr }] = await Promise.all([
    sb.from('scouts').select('id, current_rank, graduation_year, junior_leader_override').eq('person_id', personId).eq('active', true).limit(1),
    sb.from('ranks').select('id, sort_order')
  ]);
  if (scoutErr ?? rankErr) throw new Error((scoutErr ?? rankErr)!.message);
  const scout = ((scouts ?? []) as ScoutRow[])[0];
  if (!scout) return 'adult';
  const rankSort = new Map(((ranks ?? []) as { id: string; sort_order: number }[]).map((r) => [r.id, r.sort_order]));
  return canOfferToTeach({
    rankSortOrder: scout.current_rank ? (rankSort.get(scout.current_rank) ?? null) : null,
    firstClassSortOrder: rankSort.get('first-class') ?? Number.MAX_SAFE_INTEGER,
    graduationYear: scout.graduation_year,
    override: scout.junior_leader_override,
    onDate
  })
    ? 'junior'
    : 'none';
}
