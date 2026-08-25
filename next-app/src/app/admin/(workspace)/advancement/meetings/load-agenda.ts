/**
 * Loads what the agenda editor needs for one meeting — its sessions and the
 * Meeting Plan engine's suggestions for that date. Shared by the editor's own
 * page (/admin/advancement/meetings/[id]) and the calendar entry workbench,
 * which renders the editor inside its Agenda tab (Patrick, 2026-08-24: "Can
 * the agenda editor also be opened immediately when clicking on that tab?").
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { MeetingSession } from '@/lib/supabase/types';
import { buildMeetingPlan } from '../meeting-plan/engine';
import { loadEngineInput } from '../meeting-plan/load-input';
import { publicName } from '@/lib/meeting-plan-types';
import type { Candidate } from './[id]/meeting-editor';

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

export async function loadAgendaEditorData(meetingId: number, entryDate: string, title: string) {
  const supabase = createAdminClient();
  const [{ data: sessions }, candidates] = await Promise.all([
    supabase
      .from('meeting_sessions')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    loadCandidates(entryDate, title)
  ]);
  return { sessions: (sessions ?? []) as MeetingSession[], candidates };
}
