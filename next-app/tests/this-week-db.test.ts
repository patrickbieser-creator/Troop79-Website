import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { fetchPeopleLists, fetchMeetingLabels } from '../src/lib/people-lists';
import { loadUpcomingMeetings } from '../src/lib/meeting-board';
import { loadThisWeekData } from '../src/lib/this-week-db';
import { buildThisWeek } from '../src/lib/this-week';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

/** This week's loader against the local mirror: it reads, shapes, and every active scout lands exactly once. */
describe('loadThisWeekData', () => {
  it('ThisWeek_PlacesEveryActiveScoutExactlyOnce', async () => {
    const [catalog, lists, labels] = await Promise.all([fetchAdvancementCatalog(sb as never), fetchPeopleLists(sb), fetchMeetingLabels(sb)]);
    const [meeting] = await loadUpcomingMeetings(sb, 1, '2026-01-01', labels);
    const data = await loadThisWeekData(sb, meeting, lists, catalog);
    const tw = buildThisWeek(data.input);
    const ids = tw.sections.flatMap((s) => s.rows.map((r) => r.personId));
    expect([ids.length, new Set(ids).size]).toEqual([lists.pool.scouts.length, lists.pool.scouts.length]);
  });

  it('ThisWeek_ChecklistColumns_ExpandRankSubRequirements_AndEveryMarkHasACell', async () => {
    const [catalog, lists, labels] = await Promise.all([fetchAdvancementCatalog(sb as never), fetchPeopleLists(sb), fetchMeetingLabels(sb)]);
    const [meeting] = await loadUpcomingMeetings(sb, 1, '2026-01-01', labels);
    const tw = buildThisWeek((await loadThisWeekData(sb, meeting, lists, catalog)).input);
    const expected = tw.groups.map((g) => g.columns.flatMap((c) => (c.subs.length ? c.subs.map((x) => x.key) : [c.key])));
    const stray = tw.sections.flatMap((sec) =>
      sec.rows.flatMap((r) => Object.keys(sec.key === r.groupKey ? r.marks : sec.key === r.homeKey ? r.homeMarks : {}).filter((k) => !sec.columns.some((c) => c.key === k)))
    );
    expect([tw.sections.slice(0, tw.groups.length).map((sec) => sec.columns.map((c) => c.key)), stray]).toEqual([expected, []]);
  });
});
