import { describe, it, expect } from 'vitest';
import {
  PHOTO_VIEWS,
  isPhotoView,
  DEFAULT_PHOTO_VIEW,
  yearsPresent,
  gapYearsAfter,
  groupByYear,
  SEASONS,
  almanacRows,
  sortLedger,
  filterAlbums,
  albumCategoryColor,
  LEGACY_CATEGORY_ALIASES,
  type PhotoViewAlbum
} from '../src/lib/photo-views';
import { FALLBACK_CATEGORY_COLOR } from '../src/lib/calendar-categories';

/**
 * The four photo-library views (Patrick, 2026-08-22: the tabbed shell from
 * Brad's Concept 6, with "print shelf, timeline spine, the ledger, and the
 * almanac views as the four tabs").
 *
 * Everything the four views disagree about — how albums group, how they sort,
 * where a gap year shows — is decided here so it can be asserted without a
 * browser. The components render what these return.
 *
 * CHRONOLOGY IS A HARD REQUIREMENT (one of Patrick's four, with date, title
 * and category), so it gets real tests rather than being assumed: newest
 * first everywhere by default, gap years visible rather than skipped, and the
 * Ledger's year separators appearing only while the table is actually in date
 * order.
 */

function album(over: Partial<PhotoViewAlbum> & { id: number; event_date: string }): PhotoViewAlbum {
  return {
    title: `Album ${over.id}`,
    category: 'Campout / Overnight',
    photo_count: 10,
    google_url: 'https://photos.google.com/x',
    description: null,
    cover_url: null,
    cover_alt: null,
    ...over
  };
}

const ALBUMS: PhotoViewAlbum[] = [
  album({ id: 1, event_date: '2026-07-26', title: 'Summer Camp — Tesomas', category: 'Summer Camp', photo_count: 200 }),
  album({ id: 2, event_date: '2026-02-14', title: 'Winter Camp', category: 'Campout / Overnight', photo_count: 143 }),
  album({ id: 3, event_date: '2025-09-07', title: 'Court of Honor 2025', category: 'Ceremony / Recognition', photo_count: 59 }),
  album({ id: 4, event_date: '2025-12-20', title: '2025 in Review', category: 'Recruiting / Outreach', photo_count: 1024 }),
  album({ id: 5, event_date: '2022-04-02', title: 'First Troop Meeting', category: 'Troop Meeting', photo_count: 12 })
];

describe('photo views — the tab set (pure)', () => {
  it('PhotoViews_AreTheFourPatrickAskedFor_InHisOrder', () => {
    // The order is specified, not ours to re-sort.
    expect(PHOTO_VIEWS).toEqual(['prints', 'spine', 'ledger', 'almanac']);
  });

  it('DefaultPhotoView_IsThePrintShelf', () => {
    expect(DEFAULT_PHOTO_VIEW).toBe('prints');
  });

  it('IsPhotoView_AcceptsOnlyAKnownView_SoAUrlCannotInventOne', () => {
    expect(isPhotoView('ledger')).toBe(true);
    expect(isPhotoView('shelf')).toBe(false);
    expect(isPhotoView('')).toBe(false);
    expect(isPhotoView(null)).toBe(false);
  });
});

describe('photo views — chronology (pure)', () => {
  it('YearsPresent_ListsEveryYearThatHasAlbums_NewestFirst', () => {
    expect(yearsPresent(ALBUMS)).toEqual(['2026', '2025', '2022']);
  });

  it('GapYearsAfter_NamesTheYearsWithNoAlbums_BeforeTheNextOneThatHasSome', () => {
    // The live library really does skip 2023 and 2024. The Spine draws that
    // gap instead of letting year-grouping hide it.
    expect(gapYearsAfter(ALBUMS, '2025')).toEqual(['2024', '2023']);
  });

  it('GapYearsAfter_ReturnsEmpty_ForConsecutiveYears', () => {
    expect(gapYearsAfter(ALBUMS, '2026')).toEqual([]);
  });

  it('GapYearsAfter_ReturnsEmpty_ForTheOldestYear', () => {
    expect(gapYearsAfter(ALBUMS, '2022')).toEqual([]);
  });

  it('GroupByYear_KeepsYearsNewestFirst_AndAlbumsNewestFirstWithin', () => {
    const groups = groupByYear(ALBUMS);
    expect(groups.map((g) => g.year)).toEqual(['2026', '2025', '2022']);
    expect(groups[1].albums.map((a) => a.id)).toEqual([4, 3]);
  });
});

describe('photo views — the ledger (pure)', () => {
  it('SortLedger_DefaultsToNewestFirst', () => {
    expect(sortLedger(ALBUMS, 'date', 'desc').map((a) => a.id)).toEqual([1, 2, 4, 3, 5]);
  });

  it('SortLedger_ReversesOnAscending', () => {
    expect(sortLedger(ALBUMS, 'date', 'asc').map((a) => a.id)).toEqual([5, 3, 4, 2, 1]);
  });

  it('SortLedger_SortsByPhotoCount', () => {
    expect(sortLedger(ALBUMS, 'photos', 'desc')[0].id).toBe(4);
  });

  it('SortLedger_SortsByTitle', () => {
    expect(sortLedger(ALBUMS, 'title', 'asc')[0].title).toBe('2025 in Review');
  });

  it('SortLedger_BreaksACategoryTieByDate_NewestFirst', () => {
    const two = [
      album({ id: 10, event_date: '2024-01-01', category: 'Summer Camp' }),
      album({ id: 11, event_date: '2024-06-01', category: 'Summer Camp' })
    ];
    expect(sortLedger(two, 'category', 'asc').map((a) => a.id)).toEqual([11, 10]);
  });

  it('SortLedger_DoesNotMutateTheInput', () => {
    const before = ALBUMS.map((a) => a.id);
    sortLedger(ALBUMS, 'photos', 'asc');
    expect(ALBUMS.map((a) => a.id)).toEqual(before);
  });
});

describe('photo views — the almanac (pure)', () => {
  it('Seasons_AreCalendarQuarters_SoLeftToRightRunsForwardInTime', () => {
    // Patrick's four hard requirements include chronology; true seasons read
    // better but would file a September Court of Honor under "Summer" and
    // break the left-to-right reading. Quarters until he says otherwise.
    expect(SEASONS.map((s) => s.months)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [9, 10, 11]
    ]);
  });

  it('AlmanacRows_RunNewestYearFirst_AndIncludeYearsWithNoAlbums', () => {
    // A skipped year is a fact about the troop, not a rendering detail.
    const rows = almanacRows(ALBUMS);
    expect(rows.map((r) => r.year)).toEqual(['2026', '2025', '2024', '2023', '2022']);
    expect(rows.find((r) => r.year === '2024')?.count).toBe(0);
  });

  it('AlmanacRows_PlaceEachAlbumInItsCalendarQuarter', () => {
    const rows = almanacRows(ALBUMS);
    const y2025 = rows.find((r) => r.year === '2025')!;
    // Sept 7 -> Jul–Sep; Dec 20 -> Oct–Dec.
    expect(y2025.cells[2].albums.map((a) => a.id)).toEqual([3]);
    expect(y2025.cells[3].albums.map((a) => a.id)).toEqual([4]);
    expect(y2025.cells[0].albums).toEqual([]);
  });

  it('AlmanacRows_GiveEveryRowFourCells_EvenWhenEmpty', () => {
    for (const row of almanacRows(ALBUMS)) expect(row.cells).toHaveLength(4);
  });

  it('AlmanacRows_SortWithinACell_NewestFirst', () => {
    const two = [
      album({ id: 20, event_date: '2026-07-01' }),
      album({ id: 21, event_date: '2026-09-01' })
    ];
    expect(almanacRows(two)[0].cells[2].albums.map((a) => a.id)).toEqual([21, 20]);
  });
});

describe('photo views — filtering (pure)', () => {
  it('FilterAlbums_ReturnsEverything_WhenNothingIsFiltered', () => {
    expect(filterAlbums(ALBUMS, { category: 'all', year: 'all', query: '' })).toHaveLength(5);
  });

  it('FilterAlbums_NarrowsByCategoryAndYear', () => {
    expect(filterAlbums(ALBUMS, { category: 'Summer Camp', year: 'all', query: '' }).map((a) => a.id)).toEqual([1]);
    expect(filterAlbums(ALBUMS, { category: 'all', year: '2025', query: '' })).toHaveLength(2);
  });

  it('FilterAlbums_SearchesTitleDescriptionAndCategory_CaseInsensitively', () => {
    expect(filterAlbums(ALBUMS, { category: 'all', year: 'all', query: 'tesomas' }).map((a) => a.id)).toEqual([1]);
    expect(filterAlbums(ALBUMS, { category: 'all', year: 'all', query: 'CEREMONY' }).map((a) => a.id)).toEqual([3]);
  });

  it('FilterAlbums_ReturnsNewestFirst_WhateverOrderItWasGiven', () => {
    const shuffled = [ALBUMS[4], ALBUMS[0], ALBUMS[2]];
    expect(filterAlbums(shuffled, { category: 'all', year: 'all', query: '' }).map((a) => a.id)).toEqual([1, 3, 5]);
  });
});

describe('photo views — category colour (pure)', () => {
  const map = { 'Ceremony / Recognition': '#7a4b78', 'Recruiting / Outreach': '#a04a3d' };

  it('AlbumCategoryColor_ReadsTheDatabaseColour_NotAHardcodedMap', () => {
    // The bug this replaces: albums-browser.tsx carried its own label->class
    // map while calendar_categories has an authoritative `color` column, so
    // five live labels fell through to the default navy chip.
    expect(albumCategoryColor(map, 'Recruiting / Outreach')).toBe('#a04a3d');
  });

  it('AlbumCategoryColor_ResolvesALegacyAlbumLabel_ToItsCurrentCategory', () => {
    // photo_albums.category is free text; rows created before the 2026-07-18
    // calendar rename still hold the old spellings.
    expect(albumCategoryColor(map, 'Court of Honor')).toBe('#7a4b78');
  });

  it('AlbumCategoryColor_FallsBackForAnUnknownLabel', () => {
    expect(albumCategoryColor(map, 'Something Nobody Configured')).toBe(FALLBACK_CATEGORY_COLOR);
  });

  it('LegacyCategoryAliases_PointAtLabelsNotAtColours', () => {
    // Aliases must resolve to a CURRENT category label so they keep working
    // when that category's colour is edited in Lookups.
    for (const target of Object.values(LEGACY_CATEGORY_ALIASES)) {
      expect(target).not.toMatch(/^#/);
    }
  });
});
