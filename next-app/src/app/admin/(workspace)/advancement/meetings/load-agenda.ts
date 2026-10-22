/**
 * Loads what the agenda editor needs for one meeting — its sessions, the
 * meeting board's live match (Phase 3a) and the Meeting Plan engine's
 * suggestions for that date. Shared by the editor's own
 * page (/admin/advancement/meetings/[id]) and the calendar entry workbench,
 * which renders the editor inside its Agenda tab (Patrick, 2026-08-24: "Can
 * the agenda editor also be opened immediately when clicking on that tab?").
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { MeetingSession } from '@/lib/supabase/types';
import { buildMeetingPlan } from '../meeting-plan/engine';
import { loadEngineInput } from '../meeting-plan/load-input';
import { publicName } from '@/lib/meeting-plan-types';
import { loadAdvancementCatalog, type AdvancementCatalog } from '@/lib/advancement-catalog';
import { loadBoardState, loadMeetingById, type BoardScoutRow } from '@/lib/meeting-board';
import { loadTeachBoard, type TeachBoard } from '@/lib/meeting-board-supply';
import { loadMatchOrPlacement } from '@/lib/meeting-live';
import { HALF_LABEL, sessionWords, type MatchResult } from '@/lib/meeting-board-match';
import { topicWords } from '@/lib/meeting-board-picklist';
import { boardName } from '@/lib/meeting-board-shared';
import { flagText, teacherName } from '@/lib/meeting-board-teach';
import type { BoardTray, Candidate, MatchedCandidate } from './[id]/meeting-editor';

/** null = engine unavailable (load error) — the tray shows a quiet note. */
export async function loadCandidates(meetingDate: string, title: string): Promise<Candidate[] | null> {
  try {
    const loaded = await loadEngineInput(meetingDate, title);
    if (!loaded.ok) return null;
    const payload = buildMeetingPlan(loaded.input);
    return payload.sessions.map((s) => {
      const teachers = [...s.adultTeachers, ...s.counselors].map((t) => t.name);
      const scoutTeachers = s.scoutTeachers.map((t) => `${t.name} (${t.rankLabel})`);
      return {
        key: s.id,
        codeLabel: s.codeLabel,
        reqLabel: s.title,
        eagle: s.eagle,
        track: s.kind === 'mb' ? 'Merit Badge' : 'Open Advancement',
        skillId: s.skillId,
        skillName: s.skillName,
        leaderName: teachers.length > 0 ? teachers.join(', ') : scoutTeachers.join(', ') || null,
        scouts: s.scouts.map((sc) => publicName(sc.name)),
        groupPart: s.groupPart
      };
    });
  } catch {
    return null;
  }
}

/**
 * The tray's board half (Phase 3a of Plans/Meeting-Requests-And-Teaching-Offers.md): this meeting's live match, each
 * session pre-filled as an agenda item (title, teacher, audience). Promoting goes through the same promotePlanSession
 * as an engine suggestion; nothing is written until a leader adds it. Names are as the agenda shows them to families:
 * adults formally ("Mr. Vest"), scouts and Junior Leaders first name + last initial ("Finn P").
 * null = the board failed to load (the tray says so and the engine half still works).
 */
export async function loadBoardTray(entryId: number): Promise<BoardTray | null> {
  try {
    const sb = createAdminClient();
    const meeting = await loadMeetingById(sb, entryId);
    if (!meeting || meeting.closed) return { mode: 'closed', sessions: [], wanted: 0 };
    const catalog = await loadAdvancementCatalog();
    const rows = await loadBoardState(sb, meeting, catalog);
    const teach = await loadTeachBoard(sb, meeting, catalog, rows);
    const match = await loadMatchOrPlacement(sb, meeting, rows, teach);
    return { mode: 'rank', sessions: matchedCandidates(match, { catalog, rows, teach }), wanted: match.wanted.length };
  } catch {
    return null;
  }
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

export async function loadAgendaEditorData(meetingId: number, entryDate: string, title: string, entryId?: number) {
  const supabase = createAdminClient();
  const [{ data: sessions }, candidates, board] = await Promise.all([
    supabase
      .from('meeting_sessions')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    loadCandidates(entryDate, title),
    entryId != null ? loadBoardTray(entryId) : Promise.resolve(undefined)
  ]);
  return { sessions: (sessions ?? []) as MeetingSession[], candidates, board };
}
