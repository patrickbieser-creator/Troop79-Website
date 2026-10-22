/**
 * Loads what the agenda editor needs for one meeting — its sessions, the
 * meeting's plan (Build a Plan's offerings, or Meeting Live's saved placement
 * once Live has started; B6). The engine's own suggestions panel retired
 * 2026-10-22 (B7): the tray is the plan. Shared by the editor's own
 * page (/admin/advancement/meetings/[id]) and the calendar entry workbench,
 * which renders the editor inside its Agenda tab (Patrick, 2026-08-24: "Can
 * the agenda editor also be opened immediately when clicking on that tab?").
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { MeetingSession } from '@/lib/supabase/types';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { loadMeetingById, type BoardScoutRow } from '@/lib/meeting-board';
import type { TeachBoard } from '@/lib/meeting-board-supply';
import { liveStartedAt, loadMatchOrPlacement } from '@/lib/meeting-live';
import { loadPlannerPage } from '@/lib/meeting-planner-load';
import type { PlannerBoard, PlannerPerson } from '@/lib/meeting-planner-board';
import { planRows, STATE_LABEL } from '@/lib/build-plan';
import { HALF_LABEL, sessionWords, type MatchResult } from '@/lib/meeting-board-match';
import { topicWords } from '@/lib/meeting-board-picklist';
import { boardName } from '@/lib/meeting-board-shared';
import { flagText, teacherName } from '@/lib/meeting-board-teach';
import type { BoardTray, MatchedCandidate } from './[id]/meeting-editor';

/**
 * The tray's planner half: what the Meeting Planner says will be taught, each class pre-filled as an agenda item
 * (title, teacher, audience), so the published agenda matches the plan (Build a Plan B6, "Planner out of Admin";
 * before B6 this was the matcher's raw output, which left out every offering without both a teacher and a scout).
 *   - Before Meeting Live starts: the meeting's plan, Build a Plan's offerings with their teachers and the scouts
 *     signed up so far (the same rows Build shows, planRows over the planner board), labelled with their state.
 *   - Once Live has started: its saved placement (loadMatchOrPlacement, the one seam every reader of the match uses).
 * Promoting goes through the same promotePlanSession as an engine suggestion; nothing is written until a leader adds
 * it. Names are as the agenda shows them to families: adults formally ("Mr. Vest"), scouts and Junior Leaders first
 * name + last initial ("Finn P"). null = the planner failed to load (the tray says so).
 */
export async function loadBoardTray(entryId: number): Promise<BoardTray | null> {
  try {
    const sb = createAdminClient();
    const meeting = await loadMeetingById(sb, entryId);
    if (!meeting || meeting.closed) return { closed: true, sessions: [], wanted: 0 };
    const [page, started] = await Promise.all([loadPlannerPage(sb, meeting), liveStartedAt(sb, entryId)]);
    if (!page) return null;
    const { catalog, rows, teach } = page.src;
    if (started) {
      const match = await loadMatchOrPlacement(sb, meeting, rows, teach);
      return { closed: false, source: 'live', sessions: matchedCandidates(match, { catalog, rows, teach }), wanted: match.wanted.length };
    }
    return { closed: false, source: 'plan', sessions: planCandidates(page.board, { catalog, teach }), wanted: 0 };
  } catch {
    return null;
  }
}

/** The meeting's plan (Build a Plan's rows) as tray cards with their promote payload. Pure. */
export function planCandidates(
  board: Pick<PlannerBoard, 'ready' | 'noTeacher' | 'offered'>,
  src: {
    catalog: Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'meritBadges' | 'skills'> & Partial<Pick<AdvancementCatalog, 'meritBadgeRequirements'>>;
    teach: Pick<TeachBoard, 'people' | 'freeformTitles'> & Partial<Pick<TeachBoard, 'members'>>;
  }
): MatchedCandidate[] {
  const skillNames = new Map(src.catalog.skills.map((s) => [s.id, s.name]));
  const more = { mbReqs: src.catalog.meritBadgeRequirements, members: src.teach.members };
  const people = new Map<string, { teachers: readonly PlannerPerson[]; scouts: readonly PlannerPerson[] }>([
    ...board.ready.map((r) => [r.key, { teachers: r.teachers, scouts: r.scouts }] as const),
    ...board.noTeacher.map((r) => [r.key, { teachers: [], scouts: r.waiting }] as const),
    ...board.offered.map((r) => [r.key, { teachers: r.teachers, scouts: [] }] as const)
  ]);
  const teacher = (t: PlannerPerson) => {
    const p = src.teach.people.get(t.personId);
    return p ? teacherName(p, 'scout') : t.name;
  };
  return planRows(board).map((row) => {
    const w = sessionWords([row.key], src.catalog, skillNames, src.teach.freeformTitles, more);
    const who = people.get(row.key) ?? { teachers: [], scouts: [] };
    const leaders = who.teachers.map(teacher).filter(Boolean);
    const scouts = who.scouts.map((x) => x.name).filter(Boolean).sort();
    const codeLabel = row.codeLabel || w.codeLabel;
    return {
      id: `plan:${row.key}`,
      blockLabel: STATE_LABEL[row.state],
      title: row.title,
      codeLabel,
      group: null,
      teacher: leaders.join(', '),
      flags: [],
      scouts,
      promote: {
        title: row.title,
        description: codeLabel,
        track: w.kind === 'mb' ? 'Merit Badge' : 'Open Advancement',
        leaderName: leaders.length ? leaders.join(', ') : null,
        skillId: w.skillId,
        requirements: [{ code: codeLabel || row.key, label: row.title }],
        scouts: scouts.length ? scouts : null
      }
    };
  });
}

/** Matched sessions as tray cards with their promote payload. Pure. */
export function matchedCandidates(
  match: MatchResult,
  src: {
    catalog: Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'meritBadges' | 'skills'> & Partial<Pick<AdvancementCatalog, 'meritBadgeRequirements'>>;
    rows: readonly Pick<BoardScoutRow, 'personId' | 'name'>[];
    teach: Pick<TeachBoard, 'people' | 'freeformTitles'> & Partial<Pick<TeachBoard, 'members'>>;
  }
): MatchedCandidate[] {
  const skillNames = new Map(src.catalog.skills.map((s) => [s.id, s.name]));
  const scoutName = new Map(src.rows.map((r) => [r.personId, boardName(r.name)]));
  const teacher = (id: number) => {
    const p = src.teach.people.get(id);
    return p ? teacherName(p, 'scout') : '';
  };
  return match.sessions.map((s) => {
    const sw = sessionWords(s.keys, src.catalog, skillNames, src.teach.freeformTitles, { mbReqs: src.catalog.meritBadgeRequirements, members: src.teach.members });
    const w = { ...sw, title: s.title ?? sw.title };
    const block = `Block ${s.block + 1} · ${HALF_LABEL[s.half]}`;
    const scouts = s.scouts.map((x) => scoutName.get(x.personId) ?? '').filter(Boolean).sort();
    const leaders = [s.teacherId, ...s.coTeacherIds].filter((id): id is number => id != null).map(teacher).filter(Boolean);
    return {
      id: s.id,
      blockLabel: block,
      title: w.title,
      codeLabel: w.codeLabel,
      group: s.group,
      teacher: leaders.join(', '),
      flags: flagText(s.flags, 'admin'),
      scouts,
      promote: {
        title: w.title,
        description: [w.codeLabel, block, s.group ? `Group ${s.group}` : null].filter(Boolean).join(' · '),
        track: w.kind === 'mb' ? 'Merit Badge' : 'Open Advancement',
        leaderName: leaders.length ? leaders.join(', ') : null,
        skillId: w.skillId,
        requirements: s.keys.map((k) => {
          const t = topicWords(k, src.catalog.ranks, src.catalog.rankRequirements, src.catalog.meritBadges, src.teach.freeformTitles, { mbReqs: src.catalog.meritBadgeRequirements, members: src.teach.members });
          return { code: t?.codeLabel ?? k, label: t?.label ?? k };
        }),
        scouts: scouts.length ? scouts : null
      }
    };
  });
}

export async function loadAgendaEditorData(meetingId: number, entryId: number) {
  const supabase = createAdminClient();
  const [{ data: sessions }, board] = await Promise.all([
    supabase
      .from('meeting_sessions')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    loadBoardTray(entryId)
  ]);
  return { sessions: (sessions ?? []) as MeetingSession[], board };
}
