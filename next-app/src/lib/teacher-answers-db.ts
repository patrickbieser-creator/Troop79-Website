/**
 * Teachers' answers (Plans/Meeting-Planner-III-Confirmations.md, C2): read and write meeting_teacher_answers, and fill a
 * yes's snapshot (the card as This week has it now, lib/plan-states teacherSnapOf). Server-only, service role. The teach
 * page records its answers in its own transaction (meeting_answer_teach_page) and calls fillYesPlans after; the family
 * page's teacher card writes through recordTeacherAnswers.
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

async function viewOf(sb: SupabaseClient, meeting: { entryId: number; date: string }, lists: Pick<PeopleLists, 'pool'>, catalog?: AdvancementCatalog): Promise<{ view: ThisWeek; input: ThisWeekInput }> {
  const data = await loadThisWeekData(sb, meeting, lists, catalog);
  return { view: buildThisWeek(data.input), input: data.input };
}

/** Each of these keys' yes, if it has no snapshot yet, gets the card as it is now. */
export async function fillYesPlans(
  sb: SupabaseClient,
  meeting: { entryId: number; date: string },
  personId: number,
  keys: readonly string[],
  lists: Pick<PeopleLists, 'pool'>,
  catalog?: AdvancementCatalog
): Promise<void> {
  if (!keys.length) return;
  const { view, input } = await viewOf(sb, meeting, lists, catalog);
  for (const key of new Set(keys)) {
    const plan = snapOfKey(view, key, input.mergedBases);
    if (!plan) continue;
    const { error } = await sb
      .from('meeting_teacher_answers')
      .update({ answered_plan: plan })
      .eq('calendar_entry_id', meeting.entryId)
      .eq('person_id', personId)
      .eq('group_key', key)
      .eq('answer', 'yes')
      .is('answered_plan', null);
    if (error) throw new Error(error.message);
  }
}

/** Records answers for one person (the family teacher card): a yes carries the card now; a no, an optional note. */
export async function recordTeacherAnswers(
  sb: SupabaseClient,
  meeting: { entryId: number; date: string },
  personId: number,
  answers: readonly { key: string; answer: 'yes' | 'no'; note?: string | null }[],
  lists: Pick<PeopleLists, 'pool'>,
  catalog?: AdvancementCatalog
): Promise<void> {
  if (!answers.length) return;
  const needView = answers.some((a) => a.answer === 'yes');
  const v = needView ? await viewOf(sb, meeting, lists, catalog) : null;
  const now = new Date().toISOString();
  const rows = answers.map((a) => ({
    calendar_entry_id: meeting.entryId,
    person_id: personId,
    group_key: a.key,
    answer: a.answer,
    note: a.answer === 'no' ? (a.note ?? null) : null,
    answered_at: now,
    answered_plan: a.answer === 'yes' && v ? snapOfKey(v.view, a.key, v.input.mergedBases) : null
  }));
  const { error } = await sb.from('meeting_teacher_answers').upsert(rows, { onConflict: 'calendar_entry_id,person_id,group_key' });
  if (error) throw new Error(error.message);
}

/** Their answers on this meeting go (the family card's "Clear this answer"). */
export async function clearTeacherAnswers(sb: SupabaseClient, entryId: number, personId: number): Promise<void> {
  const { error } = await sb.from('meeting_teacher_answers').delete().eq('calendar_entry_id', entryId).eq('person_id', personId);
  if (error) throw new Error(error.message);
}

/** A No's note from the teach page, on the answer (the card's "Needs a teacher" shows it). */
export async function setTeacherNoNote(sb: SupabaseClient, entryId: number, personId: number, key: string, note: string | null): Promise<void> {
  const { error } = await sb.from('meeting_teacher_answers').update({ note }).eq('calendar_entry_id', entryId).eq('person_id', personId).eq('group_key', key).eq('answer', 'no');
  if (error) throw new Error(error.message);
}
