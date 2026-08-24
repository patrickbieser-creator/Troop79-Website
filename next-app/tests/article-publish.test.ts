import { describe, it, expect } from 'vitest';
import { publishedAtFromDate, dateOfIso, resolveAuthorRole } from '../src/lib/article-publish';

/**
 * News editor gaps (BACKLOG 2026-08-22, built 2026-08-24): a post can be
 * backdated, and the byline's role (leader/scout) is editable instead of
 * hard-coded 'leader'.
 */
describe('publishedAtFromDate — the editor’s "Published on" picker', () => {
  it('BlankPicker_LeavesTheStoredValueAlone', () => {
    expect(publishedAtFromDate('', '2026-08-03T18:00:00.000Z')).toBeNull();
    expect(publishedAtFromDate('', null)).toBeNull();
  });

  it('SameCalendarDayAsStored_KeepsTheExactStoredInstant', () => {
    // 2026-08-03 18:00Z is 1 pm Central on Aug 3 — re-saving that day must not shift the time.
    expect(publishedAtFromDate('2026-08-03', '2026-08-03T18:00:00.000Z')).toBe('2026-08-03T18:00:00.000Z');
  });

  it('DifferentDay_BecomesMiddayCentralOnThatDay', () => {
    const iso = publishedAtFromDate('2026-07-14', '2026-08-03T18:00:00.000Z')!;
    expect(dateOfIso(iso)).toBe('2026-07-14');
    // Midday, not midnight: midnight UTC would read as the evening before in Milwaukee.
    expect(new Date(iso).getUTCHours()).toBe(18);
  });

  it('NothingStoredYet_StillAcceptsAnExplicitDate', () => {
    expect(dateOfIso(publishedAtFromDate('2026-01-02', null)!)).toBe('2026-01-02');
  });
});

describe('dateOfIso — what the picker shows for a stored instant', () => {
  it('RendersTheCentralCalendarDay_NotTheUtcOne', () => {
    // 03:30Z on Aug 4 is still Aug 3 in Chicago.
    expect(dateOfIso('2026-08-04T03:30:00.000Z')).toBe('2026-08-03');
    expect(dateOfIso(null)).toBe('');
  });
});

describe('resolveAuthorRole — the byline’s Leader/Scout choice', () => {
  it('AcceptsOnlyTheTwoRoles_AndFallsBackOtherwise', () => {
    expect(resolveAuthorRole('scout', 'leader')).toBe('scout');
    expect(resolveAuthorRole('leader', 'scout')).toBe('leader');
    expect(resolveAuthorRole('', 'scout')).toBe('scout');
    expect(resolveAuthorRole('admin', 'leader')).toBe('leader');
  });
});
