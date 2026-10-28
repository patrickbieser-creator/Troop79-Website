import { describe, it, expect } from 'vitest';
import { canonical, changedScouts, type SnapshotPayload } from '../src/lib/plan-snapshot';

/** Publish snapshot (Plans/Meeting-Planner-III.md, Decision 5): which families a republish emails, and the hash's input. */
const base: SnapshotPayload = {
  focus: ['Citizenship'],
  options: [{ key: 'fr:tenderfoot', title: 'Tenderfoot group', sub: '7a', teacher: null, items: ['7a · Flag'] }],
  suggested: { '1': ['fr:tenderfoot'], '2': ['fr:tenderfoot'] }
};

describe('changedScouts', () => {
  it('FirstPublish_EmailsEveryone', () => {
    expect(changedScouts(null, base, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('OptionsChanged_EmailsEveryone', () => {
    const next = { ...base, options: [...base.options, { key: 'mb:first-aid', title: 'First Aid', sub: '', teacher: null }] };
    expect(changedScouts(base, next, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('ATeacherNamed_EmailsEveryone', () => {
    const next = { ...base, options: [{ ...base.options[0], teacher: 'Dan B' }] };
    expect(changedScouts(base, next, [1, 2])).toEqual([1, 2]);
  });

  it('OnlySuggestionsChanged_EmailsOnlyThoseScouts', () => {
    const next = { ...base, suggested: { ...base.suggested, '2': [] } };
    expect(changedScouts(base, next, [1, 2, 3])).toEqual([2]);
  });

  it('NothingChanged_EmailsNobody', () => {
    expect(changedScouts(base, base, [1, 2])).toEqual([]);
  });
});

describe('canonical', () => {
  it('Canonical_IgnoresTheOrderOfSuggestionKeys', () => {
    const shuffled = { ...base, suggested: { '2': ['fr:tenderfoot'], '1': ['fr:tenderfoot'] } };
    expect(canonical(shuffled)).toBe(canonical(base));
  });
});
