import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { loadCatalogWith, loadAuthoringCatalogWith } from '../src/lib/menu-monster/catalog';

/**
 * Menu Monster scout workspace, Phase 2 schema (Plans/Menu-Monster-Scout-Workspace.md,
 * "Phase 2 design"): mm_price_history, mm_packages.added_by_person_id / held_at,
 * mm_menus.actuals, and merge_people re-pointing the new person
 * references. RLS-on / zero-policy is asserted with the other tables in
 * menu-monster-db.test.ts.
 *
 * Rows are made for the test scout (Charlie Walters, person 39) and removed after each test.
 */

const TEST_SCOUT = 39;
const MARKER = 'vitest-mm-price-history';
const PKG_ID = 'vitest-held-package';
const admin = adminClient();

function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], {
    encoding: 'utf8'
  }).trim();
}

async function anIngredientId(): Promise<string> {
  const { data, error } = await admin.from('mm_ingredients').select('id').is('retired_at', null).limit(1).single();
  if (error || !data) throw new Error(`fixture: no ingredient: ${error?.message}`);
  return data.id as string;
}

async function makePackage(overrides: Record<string, unknown> = {}) {
  const { error } = await admin
    .from('mm_packages')
    .insert({ id: PKG_ID, ingredient_id: await anIngredientId(), name: MARKER, price: 2, ...overrides });
  if (error) throw new Error(`fixture: package insert failed: ${error.message}`);
}

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    package_id: PKG_ID,
    old_price: 2,
    old_as_of: null,
    new_price: 3,
    reported_by_person_id: TEST_SCOUT,
    status: 'applied',
    ...overrides
  };
}

afterEach(async () => {
  await admin.from('mm_price_history').delete().eq('package_id', PKG_ID);
  await admin.from('mm_packages').delete().eq('id', PKG_ID);
  await admin.from('mm_menus').delete().eq('name', MARKER);
});

describe('mm_price_history schema', () => {
  it('PriceHistory_StoresAnAppliedChange_WithDefaults', async () => {
    await makePackage();
    const { data, error } = await admin.from('mm_price_history').insert(historyRow()).select('*').single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ package_id: PKG_ID, status: 'applied', menu_id: null, decided_by_person_id: null, decided_at: null });
    expect(typeof data?.id).toBe('string');
  });

  it('PriceHistory_RejectsANonPositiveNewPrice', async () => {
    await makePackage();
    const { error } = await admin.from('mm_price_history').insert(historyRow({ new_price: 0 }));
    expect(error?.code).toBe('23514');
  });

  it('PriceHistory_RejectsAnUnknownStatus', async () => {
    await makePackage();
    const { error } = await admin.from('mm_price_history').insert(historyRow({ status: 'maybe' }));
    expect(error?.code).toBe('23514');
  });

  it('PriceHistory_RejectsAHeldRowThatIsAlreadyDecided', async () => {
    await makePackage();
    const { error } = await admin
      .from('mm_price_history')
      .insert(historyRow({ status: 'held', decided_by_person_id: TEST_SCOUT, decided_at: new Date().toISOString() }));
    expect(error?.code).toBe('23514');
  });

  it('PriceHistory_RejectsAnUnknownPackage_WithAForeignKeyError', async () => {
    const { error } = await admin.from('mm_price_history').insert(historyRow({ package_id: 'no-such-package' }));
    expect(error?.code).toBe('23503');
  });

  it('PriceHistory_BlocksDeletingAPackageThatHasHistory', () => {
    // confdeltype: r = RESTRICT.
    const rule = localSql(
      `select confdeltype from pg_constraint where conrelid = 'public.mm_price_history'::regclass and confrelid = 'public.mm_packages'::regclass`
    );
    expect(rule).toBe('r');
  });

  it('PriceHistory_BlocksDeletingAReporterAndDecider_WhoHaveHistory', () => {
    const rules = localSql(
      `select confdeltype from pg_constraint where conrelid = 'public.mm_price_history'::regclass and confrelid = 'public.people'::regclass`
    );
    expect(rules.split('\n')).toEqual(['r', 'r']);
  });

  it('PriceHistory_KeepsTheRow_WhenItsMenuIsDeleted', () => {
    // confdeltype: n = SET NULL.
    const rule = localSql(
      `select confdeltype from pg_constraint where conrelid = 'public.mm_price_history'::regclass and confrelid = 'public.mm_menus'::regclass`
    );
    expect(rule).toBe('n');
  });
});

describe('mm_packages held / added_by', () => {
  it('Package_BlocksDeletingAPerson_WhoAddedAPackage', () => {
    // confdeltype: r = RESTRICT (a scout-added package is never orphaned).
    const rule = localSql(
      `select confdeltype from pg_constraint where conrelid = 'public.mm_packages'::regclass and confrelid = 'public.people'::regclass`
    );
    expect(rule).toBe('r');
  });

  it('PublicCatalog_HidesAHeldPackage_WhileAuthoringStillSeesIt', async () => {
    await makePackage({ added_by_person_id: TEST_SCOUT, held_at: new Date().toISOString() });
    const pub = await loadCatalogWith(admin);
    const authoring = await loadAuthoringCatalogWith(admin);
    const inPublic = pub.packages.some((p) => p.id === PKG_ID);
    const inAuthoring = authoring.packages.some((p) => p.id === PKG_ID);
    expect({ inPublic, inAuthoring }).toEqual({ inPublic: false, inAuthoring: true });
  });
});

describe('mm_menus actuals', () => {
  function menuRow(overrides: Record<string, unknown> = {}) {
    return { owner_person_id: TEST_SCOUT, name: MARKER, context: 'camp', headcount: 8, ...overrides };
  }

  it('MmMenus_DefaultsActualsToAnObject', async () => {
    const { data, error } = await admin.from('mm_menus').insert(menuRow()).select('actuals').single();
    expect(error).toBeNull();
    expect(data).toEqual({ actuals: {} });
  });

  it('MmMenus_RejectsActualsThatAreNotAnObject', async () => {
    const { error } = await admin.from('mm_menus').insert(menuRow({ actuals: [] }));
    expect(error?.code).toBe('23514');
  });

  it('MmMenus_HasNoFreeItemsColumn_SinceReleaseC', async () => {
    // Typed-ins on menus are real 4B ingredients; the never-written envelope was dropped (20261005110000).
    const { error } = await admin.from('mm_menus').select('free_items').limit(1);
    expect(error?.message).toContain('free_items');
  });
});
