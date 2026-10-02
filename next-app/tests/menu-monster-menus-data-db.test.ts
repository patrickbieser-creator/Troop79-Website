import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadOutingsWith } from '../src/lib/menu-monster/menus-data';

/**
 * Scout Workspace slice 4: the outing pulldown's loader against local
 * Postgres. Only a published, on-calendar, upcoming overnight-type entry is
 * offered — a draft must never leak to a scout — plus the entry a menu is
 * already linked to, even once it is past.
 */

const MARKER = 'vitest-mm-outing';
const admin = adminClient();
const TODAY = '2026-10-02';

afterEach(async () => {
  await admin.from('calendar_entries').delete().like('title', `${MARKER}%`);
});

async function entry(title: string, over: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await admin
    .from('calendar_entries')
    .insert({
      entry_date: '2026-10-10',
      end_date: '2026-10-12',
      category: 'Campout / Overnight',
      title: `${MARKER} ${title}`,
      status: 'published',
      on_calendar: true,
      ...over
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as number;
}

const titles = async (linked: number[] = []) =>
  (await loadOutingsWith(admin, TODAY, linked)).filter((o) => o.title.startsWith(MARKER)).map((o) => o.title);

describe('loadOutingsWith', () => {
  it('Scout_SeesPublishedUpcomingCampout', async () => {
    await entry('future');
    expect(await titles()).toEqual([`${MARKER} future`]);
  });

  it('Scout_DoesNotSeeDraftEntry', async () => {
    await entry('draft', { status: 'draft' });
    expect(await titles()).toEqual([]);
  });

  it('Scout_DoesNotSeePastEntry', async () => {
    await entry('past', { entry_date: '2026-09-01', end_date: '2026-09-03' });
    expect(await titles()).toEqual([]);
  });

  it('Scout_DoesNotSeeOffCalendarEntry', async () => {
    await entry('off', { on_calendar: false });
    expect(await titles()).toEqual([]);
  });

  it('Scout_DoesNotSeeNonOvernightCategory', async () => {
    await entry('meeting', { category: 'Troop Meeting' });
    expect(await titles()).toEqual([]);
  });

  it('Scout_SeesEntryStillInProgress_WhenItEndsToday', async () => {
    await entry('ending', { entry_date: '2026-09-30', end_date: TODAY });
    expect(await titles()).toEqual([`${MARKER} ending`]);
  });

  it('Scout_SeesSingleDayEntry_ByItsDate', async () => {
    await entry('oneday', { entry_date: TODAY, end_date: null });
    expect(await titles()).toEqual([`${MARKER} oneday`]);
  });

  it('Menu_KeepsItsLinkedOuting_EvenWhenPast', async () => {
    const id = await entry('linked-past', { entry_date: '2026-09-01', end_date: '2026-09-03' });
    expect(await titles([id])).toEqual([`${MARKER} linked-past`]);
  });

  it('Outing_ReportsEndDateAsStart_WhenSingleDay', async () => {
    await entry('oneday', { entry_date: TODAY, end_date: null });
    const o = (await loadOutingsWith(admin, TODAY, [])).find((x) => x.title === `${MARKER} oneday`);
    expect(o?.endDate).toBe(TODAY);
  });

  it('Outings_AreOrderedByDate', async () => {
    await entry('b', { entry_date: '2026-11-01', end_date: '2026-11-02' });
    await entry('a', { entry_date: '2026-10-05', end_date: '2026-10-06' });
    expect(await titles()).toEqual([`${MARKER} a`, `${MARKER} b`]);
  });
});
