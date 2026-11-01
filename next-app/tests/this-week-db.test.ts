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

  // Responses this week (Patrick, 2026-11-01): every directory adult's answer, teacher or not.
  it('ThisWeek_Responses_ListEveryDirectoryAdultsAnswer', async () => {
    const [catalog, lists, labels] = await Promise.all([fetchAdvancementCatalog(sb as never), fetchPeopleLists(sb), fetchMeetingLabels(sb)]);
    const [meeting] = await loadUpcomingMeetings(sb, 1, '2026-01-01', labels);
    const input = (await loadThisWeekData(sb, meeting, lists, catalog)).input;
    const adults = new Set(lists.pool.adults);
    const expected = [...input.intents].filter(([id]) => adults.has(id) && !input.scouts.some((s) => s.personId === id)).map(([id, i]) => `${id}:${i}`).sort();
    const r = buildThisWeek({ ...input, intents: new Map([...input.intents, ...[...adults].slice(0, 1).map((id) => [id, 'undecided'] as const)]) }).responses;
    const shown = (['coming', 'undecided', 'not_coming'] as const).flatMap((k) => r[k].adults.map((a) => `${a.personId}:${k}`));
    const withExtra = [...new Set([...expected.filter((e) => !e.startsWith(`${[...adults][0]}:`)), `${[...adults][0]}:undecided`])].sort();
    expect(shown.sort()).toEqual(withExtra);
  });

  // Patrick, 2026-11-01: the summary's adult counts are the card's adults.
  it('ThisWeek_AdultAnswerCounts_MatchTheResponsesCard', async () => {
    const [catalog, lists, labels] = await Promise.all([fetchAdvancementCatalog(sb as never), fetchPeopleLists(sb), fetchMeetingLabels(sb)]);
    const [meeting] = await loadUpcomingMeetings(sb, 1, '2026-01-01', labels);
    const input = (await loadThisWeekData(sb, meeting, lists, catalog)).input;
    // An answer from a directory adult who isn't on the teacher list (no YPT, say) must count too.
    const outsider = lists.pool.adults[0];
    const tw = buildThisWeek({ ...input, teachers: input.teachers.filter((t) => t.personId !== outsider), intents: new Map([...input.intents, [outsider, 'coming']]) });
    const a = tw.answers.adults;
    expect([a.coming, a.undecided, a.notComing]).toEqual([tw.responses.coming.adults.length, tw.responses.undecided.adults.length, tw.responses.not_coming.adults.length]);
  });

  it('ThisWeek_OfferedClass_ShowsTheTeachersNote', async () => {
    const [catalog, lists, labels] = await Promise.all([fetchAdvancementCatalog(sb as never), fetchPeopleLists(sb), fetchMeetingLabels(sb)]);
    const [meeting] = await loadUpcomingMeetings(sb, 1, '2026-01-01', labels);
    const input = (await loadThisWeekData(sb, meeting, lists, catalog)).input;
    const adult = input.teachers.find((t) => t.kind === 'adult' && input.intents.get(t.personId) !== 'not_coming')!;
    const tw = buildThisWeek({
      ...input,
      topicTeachers: [...input.topicTeachers, { key: 'ff:vitest-note', personId: adult.personId, note: 'I can teach bottle caps' }],
      titles: new Map([...input.titles, ['ff:vitest-note', 'Bottle caps']])
    });
    expect(tw.extras.find((x) => x.key === 'ff:vitest-note')?.offerNotes.map((n) => n.note)).toEqual(['I can teach bottle caps']);
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
