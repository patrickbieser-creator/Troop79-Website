import { describe, it, expect } from 'vitest';
import { alsoFor } from '../src/lib/family-week';
import type { ThisWeek, TwGroup, TwRow } from '../src/lib/this-week';

/** The family page's "Work ahead" (Planner III Family; split groups): the next RANK's group, never the scout's own
 *  rank's Group 2. */
const catalog = { ranks: [], rankRequirements: [], meritBadges: [], meritBadgeRequirements: [] } as never;
const g = (key: string, refId: string, name: string, section = 1): TwGroup => ({ key, kind: 'rank', refId, name, section, columns: [], teachers: [] }) as unknown as TwGroup;
const tw = { groups: [g('fr:scout', 'scout', 'Scout'), g('fr:scout~2', 'scout', 'Scout', 2), g('fr:tenderfoot', 'tenderfoot', 'Tenderfoot')] } as unknown as ThisWeek;
const row = (groupKey: string) => ({ groupKey }) as TwRow;

describe('Work ahead with split groups', () => {
  it('Group1Scout_WorksAheadIntoTheNextRank_NotGroup2', () => {
    expect(alsoFor('rank', row('fr:scout'), tw, 'Ann', null, catalog).map((o) => [o.key, o.label])).toEqual([['fr:tenderfoot', 'Work ahead: Tenderfoot']]);
  });

  it('Group2Scout_WorksAheadIntoTheNextRankToo', () => {
    expect(alsoFor('rank', row('fr:scout~2'), tw, 'Ann', null, catalog).map((o) => o.key)).toEqual(['fr:tenderfoot']);
  });
});
