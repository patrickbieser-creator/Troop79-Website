/**
 * Build a Plan B5: Suggestions mode's one read. ONE engine run (lib/meeting-suggest: the whole-ledger fan-out) shaped
 * for every lens at once; lens switches, filters and ticks never come back here. The page caches the result for two
 * minutes per meeting (unstable_cache; JSON-only values). Server-only; callers gate access.
 */
import { loadEngineInput } from '@/lib/meeting-suggest/load-input';
import { buildMeetingPlan } from '@/lib/meeting-suggest/engine';
import { suggestionsData, type SuggestionsData } from '@/lib/build-plan-suggest';

export async function loadSuggestionsData(meetingDate: string, title: string): Promise<SuggestionsData> {
  const res = await loadEngineInput(meetingDate, title);
  if (!res.ok) throw new Error(res.error);
  return suggestionsData(buildMeetingPlan(res.input), res.input.ranks);
}
