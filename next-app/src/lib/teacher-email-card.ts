/**
 * What a teacher email says about the group it asks them to teach (Patrick, 2026-10-31): the group by its title (its
 * rank, and Group n when split), the requirements, the minutes, and the scouts placed in it by full name (a private
 * email). One shape for the Emails screen's preview and the email itself. Pure.
 */
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { canonicalGroupKey } from '@/lib/focus-plan';
import { groupMinutes } from '@/lib/family-week';
import { minutesText } from '@/lib/meeting-board-picklist';
import type { ThisWeek, ThisWeekInput, TwGroup } from '@/lib/this-week';

export interface TeacherCard {
  /** 'Tenderfoot group', 'Scout Group 2', 'First Aid merit badge'. */
  title: string;
  /** '4a, 4b, 5, 6, 7'. */
  codes: string;
  /** 'about 60 minutes', or ''. */
  minutes: string;
  /** Full names, in the group's order; Can't-make-it scouts left out. */
  scouts: string[];
  /** Who is planned on the card (Confirmations C-D1: their email asks them to confirm it). */
  teacherIds: number[];
}

export function teacherCardOf(
  view: Pick<ThisWeek, 'groups'>,
  input: Pick<ThisWeekInput, 'scouts' | 'mergedBases'>,
  key: string,
  catalog: Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'meritBadges' | 'meritBadgeRequirements'>
): TeacherCard | null {
  const g = view.groups.find((x) => x.key === canonicalGroupKey(key, input.mergedBases));
  if (!g) return null;
  const full = new Map(input.scouts.map((s) => [s.personId, s.name]));
  return {
    title: g.title,
    codes: g.columns.map((c) => c.code).join(', '),
    minutes: minutesText(groupMinutes(g as TwGroup, catalog as AdvancementCatalog)),
    scouts: g.members.filter((m) => m.intent !== 'not_coming').map((m) => full.get(m.personId) ?? m.name),
    teacherIds: (g.teachers ?? []).map((t) => t.personId)
  };
}
