import { describe, it, expect } from 'vitest';
import { FEATURES, visibleFeatures } from '../src/app/admin/(workspace)/_components/feature-registry';
import { searchEntries, searchFeatures, PER_GROUP } from '../src/app/admin/(workspace)/_components/search-model';
import { likePattern, searchRecords, NO_RECORDS } from '../src/lib/admin-record-search';
import { adminClient } from './helpers/admin-client';
import { CAPABILITIES, type Capability } from '../src/lib/capabilities';

/** Search (Plans/Admin-Portal-Nav.md decision 8, phase 5). */

const ALL = searchEntries(
  visibleFeatures(FEATURES, { fullAdmin: true, capabilities: new Set<Capability>(CAPABILITIES), healthViewer: true, plannerView: true })
);
const keys = (q: string, entries = ALL) => searchFeatures(entries, q).flatMap((g) => g.entries.map((e) => e.key));

describe('feature search', () => {
  it('Search_FindsByLabel', () => {
    expect(keys('fast entry')[0]).toBe('advancement.fast-entry');
  });

  it('Search_FindsByAlias', () => {
    expect(keys('bank statement')).toContain('money.reconcile');
  });

  it('Search_EveryWordMustMatch', () => {
    expect(keys('wreath zebra')).toEqual([]);
  });

  it('Search_GroupsDoScreensReportsSetup_InThatOrder', () => {
    const titles = searchFeatures(ALL, 'wreath').map((g) => g.title);
    expect(titles).toEqual(['Screens', 'Reports', 'Setup']);
  });

  it('Search_AtMostSixPerGroup', () => {
    expect(searchFeatures(ALL, 'a').every((g) => g.entries.length <= PER_GROUP)).toBe(true);
  });

  it('Search_LabelStartBeatsAMatchInTheDescription', () => {
    const screens = searchFeatures(ALL, 'roster').find((g) => g.title === 'Screens')!;
    expect(screens.entries[0].key).toBe('people.roster');
  });

  it('Search_EmptyQuery_FindsNothing', () => {
    expect(searchFeatures(ALL, '   ')).toEqual([]);
  });

  it('Search_HidesFeaturesWithoutCapability', () => {
    const cal = searchEntries(visibleFeatures(FEATURES, { fullAdmin: false, capabilities: new Set<Capability>(['calendar.write']) }));
    expect([keys('reconciliation', cal), keys('health', cal)]).toEqual([[], []]);
  });

  it('Search_LeavesHomeOut', () => {
    expect(ALL.some((e) => e.key === 'home')).toBe(false);
  });
});

describe('record search', () => {
  it('LikePattern_TreatsWildcardsLiterally', () => {
    expect(likePattern('50%_off\\, (x)')).toBe('%50\\%\\_off\\\\   x%');
  });

  it('RecordSearch_ShortQuery_SearchesNothing', async () => {
    expect(await searchRecords(adminClient(), 'a', new Set<Capability>(CAPABILITIES))).toEqual(NO_RECORDS);
  });

  it('RecordSearch_HidesHealthAndFinanceRecordsWithoutAccess', async () => {
    // A finance- or health-only person gets no people, calendar or article hits at all: nothing is searched for them.
    const r = await searchRecords(adminClient(), 'troop', new Set<Capability>(['finance.manage', 'finance.view']));
    expect(r).toEqual(NO_RECORDS);
  });

  it('RecordSearch_FindsPeople_OnlyWithRosterManage', async () => {
    const sb = adminClient();
    const [withRoster, without] = await Promise.all([
      searchRecords(sb, 'Patrick', new Set<Capability>(['roster.manage'])),
      searchRecords(sb, 'Patrick', new Set<Capability>(['calendar.write']))
    ]);
    expect([withRoster.people.length > 0, without.people.length]).toEqual([true, 0]);
  });

  it('RecordSearch_PeopleOpenTheirRecord', async () => {
    const r = await searchRecords(adminClient(), 'Patrick', new Set<Capability>(['roster.manage']));
    expect(r.people.every((p) => /^\/admin\/advancement\/roster\/\d+$/.test(p.href))).toBe(true);
  });

  it('RecordSearch_NoCalendarOrArticles_WithoutTheirCapability', async () => {
    const r = await searchRecords(adminClient(), 'meeting', new Set<Capability>(['roster.manage']));
    expect([r.calendar, r.articles]).toEqual([[], []]);
  });

  it('LikePattern_DropsFilterGrammar_AndEscapesATrailingBackslash', () => {
    expect([likePattern('a,b'), likePattern('x\\')]).toEqual(['%a b%', '%x\\\\%']);
  });

  it('RecordSearch_FindsCalendarEntries_WithCalendarWrite', async () => {
    const r = await searchRecords(adminClient(), 'meeting', new Set<Capability>(['calendar.write']));
    expect([r.calendar.length > 0, r.calendar.length <= 5, r.people.length]).toEqual([true, true, 0]);
  });
});
