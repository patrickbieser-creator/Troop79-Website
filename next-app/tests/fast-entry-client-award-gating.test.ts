import { describe, it, expect } from 'vitest';
import {
  validateAwards,
  mbCleanSlate
} from '@/app/admin/(workspace)/advancement/fast-entry/satisfaction';
import {
  itemKey,
  mbAwardItem,
  mbReqItem,
  rankAwardItem,
  type CatalogPayload,
  type CompletionMap,
  type ReqTreeNode
} from '@/app/admin/(workspace)/advancement/fast-entry/picker-types';

/**
 * B-005 (Patrick, 2026-09-06): the v1.50.2 clean-slate bypass for merit badge
 * awards was applied to the SERVER validator only (`validateAwardRows` in
 * actions.ts, covered by fast-entry-award-gating.test.ts). Scout-First's
 * client-side pre-save check — `validateAwards` here — never got it, so
 * checking "Full merit badge earned" alone for a scout with zero progress on
 * that badge was still rejected before the request ever reached the server.
 *
 * Same rule as the server, deliberately: clean slate (zero completed AND zero
 * pending leaf rows for that badge) trusts the award check on its own;
 * partial progress still runs the full leaf-satisfaction gate; rank awards
 * are leaf-gated unconditionally.
 */

const MB_ID = 'chemistry';
const RANK_ID = 'tenderfoot';

function leaf(code: string, label = `Req ${code}`): ReqTreeNode {
  return { code, label, complete_rule: 'all', complete_n: null, children: [] };
}

// Chemistry's real shape mixes grouped and bare top-level requirements —
// that's the shape Patrick hit the bug on.
const catalog: CatalogPayload = {
  ranks: [
    {
      id: RANK_ID,
      display_name: 'Tenderfoot',
      requirements: [leaf('1a'), leaf('1b')]
    }
  ],
  mbs: [
    {
      id: MB_ID,
      name: 'Chemistry',
      eagle: false,
      requirements: [
        {
          code: '1',
          label: 'Safety',
          complete_rule: 'all',
          complete_n: null,
          children: [leaf('1a'), leaf('1b')]
        },
        leaf('5'),
        leaf('6')
      ]
    }
  ],
  events: [],
  serviceProjects: [],
  leadershipPositions: []
};

function completed(...keys: string[]): CompletionMap {
  return new Map(
    keys.map((k) => [k, { entryId: 1, date: '2026-09-01', by: 'PB', code: k }])
  );
}

const award = mbAwardItem(MB_ID, 'Chemistry', false);

describe('mbCleanSlate', () => {
  it('is true with no completed and no pending leaves for that badge', () => {
    expect(mbCleanSlate(MB_ID, completed(), new Set())).toBe(true);
  });

  it('is false when any leaf for that badge is already completed', () => {
    expect(
      mbCleanSlate(MB_ID, completed(itemKey.mbReq(MB_ID, '1a')), new Set())
    ).toBe(false);
  });

  it('is false when any leaf for that badge is pending in the batch', () => {
    expect(
      mbCleanSlate(MB_ID, completed(), new Set([itemKey.mbReq(MB_ID, '5')]))
    ).toBe(false);
  });

  it('ignores progress on a different badge', () => {
    expect(
      mbCleanSlate(MB_ID, completed(itemKey.mbReq('cooking', '1a')), new Set())
    ).toBe(true);
  });
});

describe('validateAwards — merit badge clean-slate bypass (client)', () => {
  it('accepts the award alone on a clean slate', () => {
    expect(validateAwards([award], catalog, completed())).toEqual([]);
  });

  it('still blocks the award when partial progress exists', () => {
    const errors = validateAwards(
      [award],
      catalog,
      completed(itemKey.mbReq(MB_ID, '1a'))
    );
    expect(errors.map((e) => e.parentCode)).toEqual(['1', '5', '6']);
  });

  it('passes partial progress once the remainder is ticked in the same batch', () => {
    const selections = [
      award,
      mbReqItem(MB_ID, 'Chemistry', '1b', 'Req 1b'),
      mbReqItem(MB_ID, 'Chemistry', '5', 'Req 5'),
      mbReqItem(MB_ID, 'Chemistry', '6', 'Req 6')
    ];
    expect(
      validateAwards(selections, catalog, completed(itemKey.mbReq(MB_ID, '1a')))
    ).toEqual([]);
  });

  it('keeps rank awards leaf-gated on a clean slate', () => {
    const errors = validateAwards(
      [rankAwardItem(RANK_ID, 'Tenderfoot')],
      catalog,
      completed()
    );
    expect(errors.map((e) => e.parentCode)).toEqual(['1a', '1b']);
  });
});
