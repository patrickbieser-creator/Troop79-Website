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
import { loadLiveMatch, loadTeachBoard, type TeachBoard } from '@/lib/meeting-board-supply';
import { HALF_LABEL, sessionWords, type MatchResult } from '@/lib/meeting-board-match';
import { topicWords } from '@/lib/meeting-board-picklist';
import { boardName } from '@/lib/meeting-board-shared';
import { assessTeacher, flagText, teacherName } from '@/lib/meeting-board-teach';
import { loadRotationBoard, type RotationBoard } from '@/lib/meeting-board-stations';
import { stationVisitors } from '@/lib/meeting-board-rotations';
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
    if (!meeting) return { mode: 'closed', sessions: [], wanted: 0 };
    if (meeting.mode === 'closed') return { mode: 'closed', sessions: [], wanted: 0 };
    const catalog = await loadAdvancementCatalog();
    if (meeting.mode === 'merit_badge') {
      // Phase 3b: one card per station, its teacher, place and rotation order.
      const rows = await loadBoardState(sb, meeting, catalog);
      const teach = await loadTeachBoard(sb, meeting, catalog, rows);
      const rot = await loadRotationBoard(sb, meeting, catalog, rows, teach);
      if (!rot) return { mode: 'merit_badge', sessions: [], wanted: 0 };
      const sessions = stationCandidates(rot, { catalog, rows, teach });
      return { mode: 'merit_badge', sessions, wanted: sessions.filter((c) => !c.teacher).length };
    }
    const rows = await loadBoardState(sb, meeting, catalog);
    const teach = await loadTeachBoard(sb, meeting, catalog, rows);
    const match = await loadLiveMatch(sb, meeting, rows, teach);
    return { mode: 'rank', sessions: matchedCandidates(match, { catalog, rows, teach }), wanted: match.wanted.length };
  } catch {
    return null;
  }
}

/** Matched sessions as tray cards with their promote payload. Pure. */
export function matchedCandidates(
  match: MatchResult,
  src: {
    catalog: Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'meritBadges' | 'skills'>;
    rows: readonly Pick<BoardScoutRow, 'personId' | 'name'>[];
    teach: Pick<TeachBoard, 'people' | 'freeformTitles'>;
  }
): MatchedCandidate[] {
  const skillNames = new Map(src.catalog.skills.map((s) => [s.id, s.name]));
  const scoutName = new Map(src.rows.map((r) => [r.personId, boardName(r.name)]));
  const teacher = (id: number) => {
    const p = src.teach.people.get(id);
    return p ? teacherName(p, 'scout') : '';
  };
  return match.sessions.map((s) => {
    const w = sessionWords(s.keys, src.catalog, skillNames, src.teach.freeformTitles);
    const block = `Block ${s.block + 1} · ${HALF_LABEL[s.half]}`;
    const scouts = s.scouts.map((x) => scoutName.get(x.personId) ?? '').filter(Boolean).sort();
    const leaders = [s.teacherId, ...s.coTeacherIds].map(teacher).filter(Boolean);
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
          const t = topicWords(k, src.catalog.ranks, src.catalog.rankRequirements, src.catalog.meritBadges, src.teach.freeformTitles);
          return { code: t?.codeLabel ?? k, label: t?.label ?? k };
        }),
        scouts: scouts.length ? scouts : null
      }
    };
  });
}

/**
 * A merit badge night's stations as tray cards (Phase 3b), one per station: the station's name, its requirements, the
 * teacher (as families see them), the place and the rotation order in the description, and the scouts who work on it
 * (a scout who already finished it is with their group but not in its audience). Pure.
 */
export function stationCandidates(
  rot: Pick<RotationBoard, 'mbId' | 'mbName' | 'stations' | 'result' | 'teachersAt'>,
  src: {
    catalog: Pick<AdvancementCatalog, 'meritBadgeRequirements'>;
    rows: readonly Pick<BoardScoutRow, 'personId' | 'name'>[];
    teach: Pick<TeachBoard, 'people' | 'ctx'>;
  }
): MatchedCandidate[] {
  const scoutName = new Map(src.rows.map((r) => [r.personId, boardName(r.name)]));
  const reqLabel = (code: string) => src.catalog.meritBadgeRequirements.find((r) => r.mb_id === rot.mbId && r.parent_id == null && r.code === code)?.label ?? code;
  return rot.stations.map((st) => {
    const teacherIds = rot.teachersAt.get(st.index) ?? [];
    const people = teacherIds.map((id) => src.teach.people.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    const leaders = people.map((p) => teacherName(p, 'scout'));
    // The sign-off needs a counselor only when nobody teaching it is one.
    const flags = people.length && people.every((p) => assessTeacher(p, `mb:${rot.mbId}`, src.teach.ctx).flags.length) ? flagText(['needs_counselor'], 'admin') : [];
    const order = stationVisitors(rot.result, st.index)
      .map((v) => `${v.rotation}: ${v.groups.length ? v.groups.map((g) => `Group ${g.label}`).join(' + ') : 'nobody'}`)
      .join(', ');
    const working = rot.result.groups.flatMap((g) => g.members.filter((m) => !m.skips.includes(st.index)).map((m) => m.personId));
    const scouts = working.map((id) => scoutName.get(id) ?? '').filter(Boolean).sort();
    const codeLabel = `${rot.mbName} ${st.codes.join(', ')}`;
    return {
      id: `station:${st.topicId}`,
      blockLabel: `Station ${st.index + 1}`,
      title: st.title,
      codeLabel,
      group: null,
      teacher: leaders.join(', '),
      flags,
      scouts,
      promote: {
        title: st.title,
        description: [codeLabel, st.location, order ? `Rotations ${order}` : null].filter(Boolean).join(' · '),
        track: 'Merit Badge',
        leaderName: leaders.length ? leaders.join(', ') : null,
        skillId: null,
        requirements: st.codes.map((c) => ({ code: `${rot.mbName} ${c}`, label: reqLabel(c) })),
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
