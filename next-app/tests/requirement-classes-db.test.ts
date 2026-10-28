import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { NOT_PLANNABLE } from '../src/lib/rank-calculus';

/**
 * Requirement classes (Plans/Requirement-Classification.md, step 1): the lookup, the class_codes tags on both
 * requirement tables, and the backfill from venue + NOT_PLANNABLE. The parity tests hold until step 3 retires venue and
 * NOT_PLANNABLE: on the day of the switch, nothing the planner suggests may change. Test-owned rows: class 'Q' and one
 * badge; cleanup by them.
 */
const admin = adminClient();
const MB = `vitest-rcls-${process.pid}`;
let reqId = 0;

type Row = { key: string; venue: string; class_codes: string[] };

async function allRows(): Promise<Row[]> {
  const out: Row[] = [];
  for (const [table, owner] of [['rank_requirements', 'rank_id'], ['merit_badge_requirements', 'mb_id']] as const) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from(table).select(`${owner}, code, venue, class_codes`).order('id').range(from, from + 999);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as unknown as Record<string, unknown>[];
      out.push(...page.map((r) => ({ key: `${r[owner]}-${r.code}`, venue: r.venue as string, class_codes: r.class_codes as string[] })));
      if (page.length < 1000) break;
    }
  }
  return out;
}

beforeAll(async () => {
  await admin.from('merit_badges').insert({ id: MB, name: `${TEST_PREFIX} Classes` });
  const { data } = await admin.from('merit_badge_requirements').insert({ mb_id: MB, code: '1', label: 'Req 1', sort_order: 0 }).select('id').single();
  reqId = (data as { id: number }).id;
});
afterEach(async () => {
  await admin.from('merit_badge_requirements').update({ class_codes: [] }).eq('id', reqId);
  await admin.from('requirement_classes').delete().eq('code', 'Q');
});
afterAll(async () => {
  await admin.from('merit_badges').delete().eq('id', MB);
});

describe('requirement_classes lookup', () => {
  it('Classes_AreSeededWithTheEight_InOrder', async () => {
    const { data } = await admin.from('requirement_classes').select('code').order('sort_order');
    expect((data ?? []).map((r) => r.code).join('')).toBe('MCOASHEL');
  });

  it('ClassInUse_CannotBeDeleted', async () => {
    await admin.from('requirement_classes').insert({ code: 'Q', name: `${TEST_PREFIX} Q`, sort_order: 99 });
    await admin.from('merit_badge_requirements').update({ class_codes: ['Q'] }).eq('id', reqId);
    const { error } = await admin.from('requirement_classes').delete().eq('code', 'Q');
    expect(error?.message).toMatch(/in use by 1 requirement/);
  });

  it('UnusedClass_CanBeDeleted', async () => {
    await admin.from('requirement_classes').insert({ code: 'Q', name: `${TEST_PREFIX} Q`, sort_order: 99 });
    const { error } = await admin.from('requirement_classes').delete().eq('code', 'Q');
    expect(error).toBeNull();
  });

  it('ClassCode_CannotBeChanged', async () => {
    await admin.from('requirement_classes').insert({ code: 'Q', name: `${TEST_PREFIX} Q`, sort_order: 99 });
    const { error } = await admin.from('requirement_classes').update({ code: 'Z' }).eq('code', 'Q');
    expect(error?.message).toMatch(/can't be changed/);
  });
});

describe('class_codes on requirements', () => {
  it('Requirement_CanCarrySeveralTags', async () => {
    await admin.from('merit_badge_requirements').update({ class_codes: ['M', 'E'] }).eq('id', reqId);
    const { data } = await admin.from('merit_badge_requirements').select('class_codes').eq('id', reqId).single();
    expect((data as { class_codes: string[] }).class_codes).toEqual(['M', 'E']);
  });

  it('Requirement_RefusesAnUnknownTag', async () => {
    const { error } = await admin.from('merit_badge_requirements').update({ class_codes: ['M', 'Z'] }).eq('id', reqId);
    expect(error?.message).toMatch(/Unknown requirement class Z/);
  });

  it('Requirement_StartsUntagged', async () => {
    const { data } = await admin.from('merit_badge_requirements').select('class_codes').eq('id', reqId).single();
    expect((data as { class_codes: string[] }).class_codes).toEqual([]);
  });
});

// Parity with today's planner until step 3 switches it over.
describe('backfill parity', () => {
  let rows: Row[] = [];
  beforeAll(async () => {
    rows = await allRows();
  });

  it('OutingVenueRows_AreAllTagged_AndNoneForTheMeeting', () => {
    const outing = rows.filter((r) => r.venue === 'outing');
    expect(outing.filter((r) => r.class_codes.length === 0 || r.class_codes.includes('M')).map((r) => r.key)).toEqual([]);
  });

  it('NotPlannable_EveryKeyIsTaggedLeadershipOnly', () => {
    const byKey = new Map(rows.map((r) => [r.key, r.class_codes]));
    expect([...NOT_PLANNABLE].filter((k) => JSON.stringify(byKey.get(k)) !== '["L"]')).toEqual([]);
  });
});
