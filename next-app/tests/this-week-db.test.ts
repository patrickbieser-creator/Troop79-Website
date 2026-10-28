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
});
