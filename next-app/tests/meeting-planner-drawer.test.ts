import { describe, it, expect } from 'vitest';
import { drawerOptions } from '../src/lib/meeting-planner-drawer';

/** The person drawer's list (Plans/Meeting-Planner-II.md P2a): the board first, then the rest of the list. */

const words = (key: string) => ({ title: key.toUpperCase(), codeLabel: `Code ${key}` });
const teachers = (key: string) => (key === 'a' ? ['Jenna M'] : []);

describe('drawerOptions', () => {
  it('BoardTopics_ComeBeforeTheRestOfTheList', () => {
    const o = drawerOptions({ boardKeys: ['b'], listKeys: ['a', 'b', 'c'], onKeys: new Set(), words, teachers });
    expect(o.map((x) => `${x.section}:${x.key}`)).toEqual(['board:b', 'more:a', 'more:c']);
  });

  it('EachRow_SaysWhoIsTeachingIt', () => {
    const o = drawerOptions({ boardKeys: ['a', 'b'], listKeys: [], onKeys: new Set(), words, teachers });
    expect(o.map((x) => x.meta)).toEqual(['Code a · teacher: Jenna M', 'Code b · no teacher yet']);
  });

  it('Scout_OnlySeesBoardTopicsOnTheirPickList', () => {
    const o = drawerOptions({ boardKeys: ['a', 'x'], listKeys: [], onKeys: new Set(), allowed: new Set(['a']), words, teachers });
    expect(o.map((x) => x.key)).toEqual(['a']);
  });

  it('APickAlreadyMade_StaysListed_EvenOffTheList', () => {
    const o = drawerOptions({ boardKeys: [], listKeys: [], onKeys: new Set(['z']), allowed: new Set(), words, teachers });
    expect(o.map((x) => [x.key, x.on])).toEqual([['z', true]]);
  });

  it('Adult_SeesTopicsTheyCanTeachFirst', () => {
    const o = drawerOptions({ boardKeys: ['a', 'b', 'c'], listKeys: [], onKeys: new Set(), preferred: new Set(['c']), words, teachers });
    expect(o.map((x) => x.key)).toEqual(['c', 'a', 'b']);
  });
});
