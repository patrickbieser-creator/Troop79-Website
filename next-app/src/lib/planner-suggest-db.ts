/**
 * Planner III Suggestions' reads (prototypes/meeting-plan-III/README.md, "Screen: Suggestions"). Server-only, service
 * role; the page gates access.
 *
 *   loadSuggestionsData  ONE engine run (lib/meeting-suggest: the whole-ledger fan-out) shaped for every view at once;
 *                        view switches, filters and ticks never come back here. The page caches it (unstable_cache;
 *                        JSON-only values).
 *   loadPlanStates       what is on each of the toolbar's meetings: its topics, the requirements inside its focus sets
 *                        (a focus item is listed by its top-level requirement, as the engine keys it), the focus names,
 *                        and who teaches each topic (Teaching's "✓ teaching"). One query.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEngineInput } from '@/lib/meeting-suggest/load-input';
import { buildMeetingPlan } from '@/lib/meeting-suggest/engine';
import { suggestionsData, type PlanState, type SuggestionsData } from '@/lib/planner-suggest';

export async function loadSuggestionsData(meetingDate: string, title: string): Promise<SuggestionsData> {
  const res = await loadEngineInput(meetingDate, title);
  if (!res.ok) throw new Error(res.error);
  const mbOfKey: Record<string, string> = {};
  for (const r of res.input.mbReqs) if (r.parent_id == null) mbOfKey[`${r.mb_id}-${r.code}`] = r.mb_id;
  return suggestionsData(buildMeetingPlan(res.input), res.input.ranks, mbOfKey);
}

export interface MeetingPlanState extends PlanState {
  /** The focus sets' names, in the order they were added ('First aid + Knots'). */
  focusNames: string[];
  /** Who teaches each topic: topic key → person ids. */
  teachers: Record<string, number[]>;
}

type TopicRow = {
  calendar_entry_id: number;
  topic_key: string;
  kind: string;
  title: string;
  seeded_at: string | null;
  meeting_topic_members: { item_key: string }[] | null;
  meeting_topic_teachers: { person_id: number }[] | null;
};

export async function loadPlanStates(sb: SupabaseClient, entryIds: readonly number[]): Promise<Record<number, MeetingPlanState>> {
  const out: Record<number, MeetingPlanState> = Object.fromEntries(entryIds.map((id) => [id, { onPlan: [], focus: [], focusNames: [], teachers: {} }]));
  if (!entryIds.length) return out;
  const { data, error } = await sb
    .from('meeting_topics')
    .select('calendar_entry_id, topic_key, kind, title, seeded_at, meeting_topic_members(item_key), meeting_topic_teachers(person_id)')
    .in('calendar_entry_id', [...entryIds])
    .order('seeded_at', { nullsFirst: false });
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as TopicRow[]) {
    const plan = out[r.calendar_entry_id];
    if (!plan) continue;
    const teachers = (r.meeting_topic_teachers ?? []).map((t) => t.person_id);
    if (teachers.length) plan.teachers[r.topic_key] = teachers;
    if (r.kind === 'focus_group') {
      if (r.seeded_at == null) continue;
      plan.focusNames.push(r.title);
      for (const m of r.meeting_topic_members ?? []) {
        const top = m.item_key.split('.')[0];
        if (!plan.focus.includes(top)) plan.focus.push(top);
      }
      continue;
    }
    if (!plan.onPlan.includes(r.topic_key)) plan.onPlan.push(r.topic_key);
  }
  return out;
}
