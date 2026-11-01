/**
 * Teachers' answers (Plans/Meeting-Planner-III-Confirmations.md, C2): read and write meeting_teacher_answers, and fill a
 * yes's snapshot (the card as This week has it now, lib/plan-states teacherSnapOf). Server-only, service role. The
 * family page's teacher card (signed in or from the email link) writes through recordTeacherAnswers.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import type { PeopleLists } from '@/lib/people-lists';
import { loadThisWeekData } from '@/lib/this-week-db';
import { buildThisWeek, type ThisWeek, type ThisWeekInput } from '@/lib/this-week';
import { teacherSnapOf, type TeacherSnap } from '@/lib/plan-states';
import { canonicalGroupKey } from '@/lib/focus-plan';

export { loadTeacherAnswers, type TeacherAnswerRow } from '@/lib/this-week-db';

/** The card a key names on This week now: a group (merged keys read as one) or a class from requests and offers. */
export function snapOfKey(view: Pick<ThisWeek, 'groups' | 'extras'>, key: string, merged?: ReadonlySet<string>): TeacherSnap | null {
  const g = view.groups.find((x) => x.key === canonicalGroupKey(key, merged));
  if (g) return teacherSnapOf(g, merged);
  const x = view.extras.find((e) => e.key === key);
  return x ? { group: x.key, itemKeys: [x.key], title: x.title } : null;
}

export type BuiltWeek = { view: ThisWeek; input: ThisWeekInput };

export async function viewOf(sb: SupabaseClient, meeting: { entryId: number; date: string }, lists: Pick<PeopleLists, 'pool'>, catalog?: AdvancementCatalog): Promise<BuiltWeek> {
  const data = await loadThisWeekData(sb, meeting, lists, catalog);
  return { view: buildThisWeek(data.input), input: data.input };
}

/**
 * Records answers for one person: a yes carries the card now; a no, an optional note. Their own answer (the family
 * teacher card) has no `enteredBy`; a planner entering it for them (their drawer) names themself, and the person's own
 * later answer replaces it. `week`: This week already built by the caller.
 */
export async function recordTeacherAnswers(
  sb: SupabaseClient,
  meeting: { entryId: number; date: string },
  personId: number,
  answers: readonly { key: string; answer: 'yes' | 'no'; note?: string | null }[],
  lists: Pick<PeopleLists, 'pool'>,
  catalog?: AdvancementCatalog,
  opts: { enteredBy?: number | null; week?: BuiltWeek } = {}
): Promise<void> {
  if (!answers.length) return;
  const needView = answers.some((a) => a.answer === 'yes');
  const v = needView ? (opts.week ?? (await viewOf(sb, meeting, lists, catalog))) : null;
  const now = new Date().toISOString();
  // A yes is recorded only with the card it said yes to (qa-lead): no card found = nothing to confirm.
  const kept = answers.filter((a) => a.answer === 'no' || (v && snapOfKey(v.view, a.key, v.input.mergedBases)));
  if (!kept.length) return;
  const rows = kept.map((a) => ({
    calendar_entry_id: meeting.entryId,
    person_id: personId,
    group_key: a.key,
    answer: a.answer,
    note: a.answer === 'no' ? (a.note ?? null) : null,
    answered_at: now,
    answered_plan: a.answer === 'yes' && v ? snapOfKey(v.view, a.key, v.input.mergedBases) : null,
    entered_by_person_id: opts.enteredBy ?? null
  }));
  const { error } = await sb.from('meeting_teacher_answers').upsert(rows, { onConflict: 'calendar_entry_id,person_id,group_key' });
  if (error) throw new Error(error.message);
}

/** Their answers on this meeting go (the family card's "Clear this answer"). */
export async function clearTeacherAnswers(sb: SupabaseClient, entryId: number, personId: number): Promise<void> {
  const { error } = await sb.from('meeting_teacher_answers').delete().eq('calendar_entry_id', entryId).eq('person_id', personId);
  if (error) throw new Error(error.message);
}
