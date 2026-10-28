/**
 * Loads what the agenda editor needs for one meeting — its sessions and the
 * meeting's plan (Meeting Planner III's This week). The engine's own suggestions panel retired
 * 2026-10-22 (B7): the tray is the plan. Shared by the editor's own
 * page (/admin/advancement/meetings/[id]) and the calendar entry workbench,
 * which renders the editor inside its Agenda tab (Patrick, 2026-08-24: "Can
 * the agenda editor also be opened immediately when clicking on that tab?").
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { MeetingSession } from '@/lib/supabase/types';
import { loadMeetingById } from '@/lib/meeting-board';
import { loadPlannerLists } from '@/lib/people-lists';
import { buildThisWeek, type ThisWeek } from '@/lib/this-week';
import { loadThisWeekData } from '@/lib/this-week-db';
import type { BoardTray, MatchedCandidate } from './[id]/meeting-editor';

/**
 * The tray's planner half (Meeting Planner III, Decision 10): what This week says will be taught, one card per
 * session (each group of the night, each merit badge, Helping teach, each class from requests and offers), pre-filled
 * as an agenda item (title, teacher, scouts), so the published agenda matches the plan. Promoting goes through the
 * same promotePlanSession; nothing is written until a leader adds it. null = the planner failed to load.
 */
export async function loadBoardTray(entryId: number): Promise<BoardTray | null> {
  try {
    const sb = createAdminClient();
    const meeting = await loadMeetingById(sb, entryId);
    if (!meeting || meeting.closed) return { closed: true, sessions: [], wanted: 0 };
    const data = await loadThisWeekData(sb, meeting, await loadPlannerLists());
    return { closed: false, source: 'plan', sessions: planCandidates(buildThisWeek(data.input)), wanted: 0 };
  } catch {
    return null;
  }
}

/** This week's sessions as tray cards with their promote payload. Pure. */
export function planCandidates(view: ThisWeek): MatchedCandidate[] {
  const card = (key: string, title: string, codeLabel: string, track: string, teacher: string | null, scouts: string[], requirements: { code: string; label: string }[]): MatchedCandidate => ({
    id: `plan:${key}`,
    blockLabel: 'This week',
    title,
    codeLabel,
    group: null,
    teacher: teacher ?? '',
    flags: [],
    scouts: [...scouts].sort(),
    promote: { title, description: codeLabel, track, leaderName: teacher, skillId: null, requirements, scouts: scouts.length ? [...scouts].sort() : null }
  });
  const coming = (p: { intent: string | null }) => p.intent !== 'not_coming';
  return [
    ...view.groups.map((g) =>
      card(
        g.key,
        g.kind === 'badge' ? `${g.name} merit badge` : `${g.name} group`,
        g.columns.map((c) => c.code).join(', '),
        g.kind === 'badge' ? 'Merit Badge' : 'Open Advancement',
        g.teacher?.name ?? null,
        g.members.filter(coming).map((m) => m.name),
        g.columns.map((c) => ({ code: c.code, label: c.label }))
      )
    ),
    ...(view.helpers.length ? [card('help', 'Helping teach', '', 'Open Advancement', null, view.helpers.filter(coming).map((m) => m.name), [])] : []),
    ...view.extras.map((x) =>
      card(x.key, x.title, x.codeLabel, x.key.startsWith('mb:') ? 'Merit Badge' : 'Open Advancement', x.teacher?.name ?? null, x.scouts.filter(coming).map((m) => m.name), [{ code: x.codeLabel || x.key, label: x.title }])
    )
  ];
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
