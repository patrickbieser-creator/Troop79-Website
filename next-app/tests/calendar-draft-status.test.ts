import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { loadCalendarEntries, loadAllCalendarEntries } from '../src/lib/calendar';
import { loadPromotedEntries } from '../src/lib/home-feed';
import { loadEventDetail } from '../src/lib/event-signup';

/**
 * calendar_entries.status — draft vs published (20260816170000).
 *
 * THE RISK THIS FILE EXISTS FOR is not the migration; it is a missed read
 * path. The calendar is read from the month grid, the list view, the homepage
 * hero and card row, the event permalink, the signup page and the .ics
 * subscription feed. A status column that is not filtered in ALL of them
 * leaks a draft somewhere, and the .ics case would land it in someone's phone
 * calendar where nobody would ever notice.
 *
 * So these tests are parameterised over the reader inventory rather than
 * written one per surface: adding a public reader without adding it here
 * fails, which is the only way this stays true six months from now.
 */

describe('calendar draft status', () => {
  let entryIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (entryIds.length > 0) await admin.from('calendar_entries').delete().in('id', entryIds);
    entryIds = [];
  });

  async function makeEntry(status: 'draft' | 'published', over: Record<string, unknown> = {}) {
    const admin = adminClient();
    // Far future so it can never collide with a real upcoming entry.
    const { data, error } = await admin
      .from('calendar_entries')
      .insert({
        entry_date: '2099-07-04',
        title: '[TEST] Draft Status Probe',
        category: 'Troop Meeting',
        status,
        on_calendar: true,
        show_on_homepage: true,
        ...over
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: calendar_entries insert failed: ${error?.message}`);
    entryIds.push(data.id as number);
    return data.id as number;
  }

  it('DraftEntry_IsAbsentFromEveryPublicReadPath_WhenNotYetPublished', async () => {
    const id = await makeEntry('draft');

    const { upcoming, past } = await loadCalendarEntries();
    const ics = await loadAllCalendarEntries();
    const promoted = await loadPromotedEntries(new Date('2099-07-01'));

    const readers: [string, number[]][] = [
      ['month grid / list view (upcoming)', upcoming.map((e) => e.id)],
      ['list view (past)', past.map((e) => e.id)],
      ['.ics subscription feed', ics.map((e) => e.id)],
      ['homepage hero / card row', promoted.map((e) => e.id)]
    ];
    for (const [surface, ids] of readers) {
      expect(ids, `draft entry leaked into: ${surface}`).not.toContain(id);
    }
  });

  it('EventPermalink_ReturnsNull_WhenEntryIsDraft', async () => {
    // Every entry has had a guessable /events/[id] URL since D-108, so the
    // permalink has to 404 rather than render.
    const id = await makeEntry('draft');
    expect(await loadEventDetail(id)).toBeNull();
  });

  it('PublishedEntry_IsPresent_OnTheSameReadPaths', async () => {
    // The negative tests above would also pass if the loaders were simply
    // broken, so prove the filter admits the normal case.
    const id = await makeEntry('published');
    const { upcoming } = await loadCalendarEntries();
    const ics = await loadAllCalendarEntries();
    expect(upcoming.map((e) => e.id)).toContain(id);
    expect(ics.map((e) => e.id)).toContain(id);
    expect(await loadEventDetail(id)).not.toBeNull();
  });

  it('PublishedEntry_StaysOffTheGrid_WhenOnCalendarIsFalse', async () => {
    // The two-axes guard. A published, off-calendar entry is the D-011
    // news-shaped case and must keep working: absent from the calendar list,
    // present at its own permalink.
    const id = await makeEntry('published', { on_calendar: false });
    const { upcoming } = await loadCalendarEntries();
    expect(upcoming.map((e) => e.id)).not.toContain(id);
    expect(await loadEventDetail(id)).not.toBeNull();
  });

  it('ExistingEntries_DefaultToPublished_AfterTheMigration', async () => {
    const admin = adminClient();
    const { count } = await admin
      .from('calendar_entries')
      .select('id', { count: 'exact', head: true })
      .is('status', null);
    expect(count ?? 0).toBe(0);
  });

  it('EveryPublicCalendarReader_FiltersStatus_InSource', () => {
    // The parameterised test above can only cover readers it knows about.
    // This one catches a NEW public reader that forgot the filter, by holding
    // the source of the three libs the public surfaces go through.
    const libs = ['src/lib/calendar.ts', 'src/lib/home-feed.ts', 'src/lib/event-signup.ts'];
    for (const lib of libs) {
      const src = readFileSync(lib, 'utf8');
      const reads = (src.match(/\.from\('calendar_entries'\)/g) ?? []).length;
      const filters = (src.match(/\.eq\('status', 'published'\)/g) ?? []).length;
      expect(filters, `${lib}: ${reads} calendar_entries read(s), ${filters} status filter(s)`).toBe(
        reads
      );
    }
  });
});
