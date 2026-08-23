import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  FALLBACK_CATEGORY_COLOR,
  FALLBACK_CATEGORY_TEMPLATE,
  behaviorOf,
  categoryColorMap,
  colorFor,
  labelsForBehavior,
  sortedCategoryLabels,
  templateOf,
  usesAgenda,
  type CalendarCategoryRow
} from '@/lib/calendar-categories';

/**
 * D-082 — calendar categories as a managed lookup table.
 *
 * The DB half of these tests is the whole point of the feature: a rename has
 * to reach every referencing row (that is Patrick's rename tool), an in-use or
 * behavior-carrying category must be undeletable, and the two tables that
 * share the taxonomy must actually share it — the 2026-07-21 photo-album drift
 * bug is what this migration exists to make structurally impossible.
 */

const admin = adminClient();
const FIXTURE = `ZZVITEST Category ${process.pid}`;

/** Tracks the fixture category's CURRENT label — the rename tests move it. */
let fixtureLabel = FIXTURE;
let entryId: number | null = null;
let albumId: number | null = null;

beforeAll(async () => {
  const { error: catErr } = await admin
    .from('calendar_categories')
    .insert({ label: FIXTURE, color: '#123456', sort_order: 9999 });
  if (catErr) throw new Error(`fixture: calendar_categories insert failed: ${catErr.message}`);

  const { data: entry, error: entryErr } = await admin
    .from('calendar_entries')
    .insert({ entry_date: '2027-02-02', category: FIXTURE, title: `${FIXTURE} entry` })
    .select('id')
    .single();
  if (entryErr || !entry) throw new Error(`fixture: calendar_entries insert failed: ${entryErr?.message}`);
  entryId = entry.id;

  const { data: album, error: albumErr } = await admin
    .from('photo_albums')
    .insert({
      title: `${FIXTURE} album`,
      event_date: '2027-02-02',
      category: FIXTURE,
      google_url: 'https://photos.example.com/vitest'
    })
    .select('id')
    .single();
  if (albumErr || !album) throw new Error(`fixture: photo_albums insert failed: ${albumErr?.message}`);
  albumId = album.id;
});

afterAll(async () => {
  // Children first — the FK is RESTRICT, which is exactly what test 4 asserts.
  if (albumId) await admin.from('photo_albums').delete().eq('id', albumId);
  if (entryId) await admin.from('calendar_entries').delete().eq('id', entryId);
  await admin.from('calendar_categories').delete().eq('label', fixtureLabel);
});

describe('calendar_categories lookup', () => {
  it('Seed_CarriesTheFourteenLegacyCategories_WithBehaviorsAssigned', async () => {
    const { data } = await admin
      .from('calendar_categories')
      .select('label, color, sort_order, behavior')
      // Excludes EVERY test fixture, not just this file's: vitest runs files in
      // parallel, so calendar-unification's fixture category is live in the
      // table while this assertion runs. Matching one label made the count
      // assertion depend on which file happened to be mid-flight.
      .not('label', 'like', 'ZZVITEST%');
    const rows = (data ?? []) as CalendarCategoryRow[];

    // The vocabulary is EXTENSIBLE now (2026-08-21: news tags merged into this
    // list — see 20260822130000_one_taxonomy), so assert the seeded fourteen
    // are all present rather than that nothing else is.
    const SEEDED = [
      'Troop Meeting', 'Campout / Overnight', 'Day Activity / Outing', 'High Adventure', 'Summer Camp',
      'Service Project', 'Fundraiser', 'Advancement Event', 'Training', 'Ceremony / Recognition',
      'Leadership / Planning', 'Recruiting / Outreach', 'Social Event'
    ];
    const labels = new Set(rows.map((r) => r.label));
    for (const l of SEEDED) expect(labels.has(l), `seeded category missing: ${l}`).toBe(true);
    expect(rows.find((r) => r.behavior === 'meeting')?.label).toBe('Troop Meeting');
    // "No Meeting" was retired 2026-08-23 — a week with no meeting is a Troop
    // Meeting titled "No Troop Meeting".
    expect(rows.find((r) => r.label === 'No Meeting')).toBeUndefined();
    // The Bugle's printed legend colors must survive the move to the DB.
    expect(rows.find((r) => r.label === 'Campout / Overnight')?.color).toBe('#3d5a3e');
  });

  it('Rename_CascadesToCalendarEntries_WhenCategoryLabelChanges', async () => {
    const renamed = `${FIXTURE} (renamed)`;
    const { error } = await admin
      .from('calendar_categories')
      .update({ label: renamed })
      .eq('label', fixtureLabel);
    expect(error).toBeNull();
    fixtureLabel = renamed;

    const { data } = await admin
      .from('calendar_entries')
      .select('category')
      .eq('id', entryId!)
      .single();
    expect((data as { category: string }).category).toBe(renamed);
  });

  it('Rename_CascadesToPhotoAlbums_WhenCategoryLabelChanges', async () => {
    // Depends on the rename above having already run — albums share the FK,
    // so one cascade reaches both tables. This is the drift bug's antidote.
    const { data } = await admin.from('photo_albums').select('category').eq('id', albumId!).single();
    expect((data as { category: string }).category).toBe(fixtureLabel);
  });

  it('Delete_IsRejected_WhenACalendarEntryStillUsesTheCategory', async () => {
    const { error } = await admin.from('calendar_categories').delete().eq('label', fixtureLabel);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates foreign key constraint/i);
  });

  it('Delete_IsRejected_WhenTheCategoryCarriesABehavior', async () => {
    const { error } = await admin.from('calendar_categories').delete().eq('label', 'Troop Meeting');
    expect(error).not.toBeNull();
    // Troop Meeting is also in use by entries, so either guard may answer first.
    expect(error?.message).toMatch(/behavior|foreign key/i);
  });

  it('Insert_IsRejected_WhenTheBehaviorIsAlreadyClaimed', async () => {
    const { error } = await admin
      .from('calendar_categories')
      .insert({ label: `${FIXTURE} dupe`, color: '#000000', sort_order: 9998, behavior: 'meeting' });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/duplicate key|unique/i);
  });

  it('CalendarEntry_IsRejected_WhenCategoryIsNotInTheLookup', async () => {
    const { error } = await admin
      .from('calendar_entries')
      .insert({ entry_date: '2027-02-03', category: 'Not A Real Category', title: `${FIXTURE} bad` });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates foreign key constraint/i);
  });

  it('PhotoAlbum_IsRejected_WhenCategoryIsNotInTheLookup', async () => {
    const { error } = await admin.from('photo_albums').insert({
      title: `${FIXTURE} bad album`,
      event_date: '2027-02-03',
      category: 'Not A Real Category',
      google_url: 'https://photos.example.com/vitest-bad'
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates foreign key constraint/i);
  });
});

describe('category presentation helpers', () => {
  const rows: CalendarCategoryRow[] = [
    { label: 'Troop Meeting', color: '#1e3a4a', sort_order: 10, behavior: 'meeting', template: 'meeting', credit_kind: 'meeting_attendance', credit_unit: null, counts_as_activity: false },
    { label: 'Fundraiser', color: '#8b6914', sort_order: 70, behavior: null, template: 'activity', credit_kind: 'fundraiser', credit_unit: 'each', counts_as_activity: true },
    // Deliberately left unassigned: a category with no template must still
    // resolve, the same way an unknown color falls back to neutral.
    { label: 'Community', color: '#a0978a', sort_order: 140, behavior: null, template: null, credit_kind: null, credit_unit: null, counts_as_activity: true }
  ];

  it('TemplateOf_ReturnsTheAssignedTemplate_WhenTheCategoryCarriesOne', () => {
    expect(templateOf(rows, 'Troop Meeting')).toBe('meeting');
    expect(templateOf(rows, 'Fundraiser')).toBe('activity');
  });

  it('TemplateOf_FallsBackToActivity_WhenNoTemplateIsAssigned', () => {
    expect(templateOf(rows, 'Community')).toBe(FALLBACK_CATEGORY_TEMPLATE);
  });

  it('TemplateOf_FallsBackToActivity_WhenTheCategoryIsUnknownToThisRender', () => {
    expect(templateOf(rows, 'Invented Yesterday')).toBe(FALLBACK_CATEGORY_TEMPLATE);
  });

  it('UsesAgenda_IsTrueOnlyForTheMeetingTemplate', () => {
    expect(usesAgenda(rows, 'Troop Meeting')).toBe(true);
    expect(usesAgenda(rows, 'Fundraiser')).toBe(false);
  });

  it('ColorFor_ReturnsTheLookupColor_WhenCategoryIsKnown', () => {
    expect(colorFor(categoryColorMap(rows), 'Fundraiser')).toBe('#8b6914');
  });

  it('ColorFor_FallsBackToNeutral_WhenCategoryIsUnknownToThisRender', () => {
    // A category added by another leader between this page's category load and
    // its entry load must render a neutral swatch, never crash the page.
    expect(colorFor(categoryColorMap(rows), 'Invented Yesterday')).toBe(FALLBACK_CATEGORY_COLOR);
  });

  it('BehaviorOf_ResolvesByLabel_WhenTheCategoryCarriesOne', () => {
    expect(behaviorOf(rows, 'Troop Meeting')).toBe('meeting');
    expect(behaviorOf(rows, 'Fundraiser')).toBeNull();
    expect(behaviorOf(rows, 'Renamed Away')).toBeNull();
  });

  it('LabelsForBehavior_ReturnsCurrentLabels_ForTheMeetingsQuery', () => {
    // lib/meetings.ts used to hardcode ['Troop Meeting', 'No Meeting'].
    expect(labelsForBehavior(rows, 'meeting')).toEqual(['Troop Meeting']);
  });

  it('SortedCategoryLabels_OrdersBySortOrder_NotAlphabetically', () => {
    expect(sortedCategoryLabels(rows)).toEqual(['Troop Meeting', 'Fundraiser', 'Community']);
  });
});
