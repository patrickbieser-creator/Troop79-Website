import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { loadCatalogWith } from '../src/lib/menu-monster/catalog';
import { MEALS } from '../src/lib/menu-monster/units';

/**
 * Menu Monster catalog (Plans/Menu-Monster.md) against the local stack:
 *
 *  1. the migration seed is all there (37 ingredients / 59 packages / 13
 *     conversions / 20 recipes from menu-monster-seed.json, plus the extra
 *     lunch/dinner/snack/dessert items);
 *  2. loadCatalogWith() returns published recipes only, with every line's
 *     ingredient present and every package's ingredient present;
 *  3. RLS is enabled with ZERO policies on every mm_* table (D-051 / D-239)
 *     — checked in pg_catalog through the local container, and behaviourally
 *     with the anon key, mirroring tests/resource-library.test.ts.
 *
 * Read-only: the seed is migration-owned data, nothing is inserted here.
 */

const MM_TABLES = ['mm_ingredients', 'mm_conversions', 'mm_packages', 'mm_recipes', 'mm_recipe_lines'];

/** psql inside the local Supabase container — the db project already needs Docker up. */
function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], {
    encoding: 'utf8'
  }).trim();
}

async function countOf(table: string): Promise<number> {
  const { count, error } = await adminClient().from(table).select('id', { count: 'exact', head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

describe('menu monster catalog', () => {
  it('Catalog_LoadsPublishedRecipesOnly_WithPackagesAndConversions', async () => {
    // Seed counts: everything in menu-monster-seed.json is present.
    expect(await countOf('mm_ingredients')).toBeGreaterThanOrEqual(37);
    expect(await countOf('mm_packages')).toBeGreaterThanOrEqual(59);
    expect(await countOf('mm_conversions')).toBeGreaterThanOrEqual(13);
    expect(await countOf('mm_recipes')).toBeGreaterThanOrEqual(20);

    const catalog = await loadCatalogWith(adminClient());
    const ids = new Set(catalog.ingredients.map((i) => i.id));

    // Published only: the seed's draft (C001 Cinnamon rolls) never reaches the planner.
    expect(catalog.recipes.every((r) => r.status === 'published')).toBe(true);
    expect(catalog.recipes.map((r) => r.id)).not.toContain('C001');
    expect(catalog.recipes.map((r) => r.id)).toContain('B001');
    expect(catalog.recipes.length).toBeGreaterThanOrEqual(19);

    // Every line and every package points at an ingredient the catalog carries.
    for (const r of catalog.recipes) {
      expect(r.lines.length, `${r.id} has lines`).toBeGreaterThan(0);
      for (const l of r.lines) expect(ids.has(l.ingredientId), `${r.id} → ${l.ingredientId}`).toBe(true);
    }
    for (const p of catalog.packages) expect(ids.has(p.ingredientId), `${p.id} → ${p.ingredientId}`).toBe(true);
    for (const c of catalog.conversions) expect(ids.has(c.ingredientId), `conversion → ${c.ingredientId}`).toBe(true);

    // Rows → domain objects: the unit is rebuilt, numerics are numbers, the
    // unusable package keeps its yield null with the reason attached.
    const bananas = catalog.ingredients.find((i) => i.id === 'bananas');
    expect(bananas?.unit).toEqual({ key: 'count', one: 'banana', many: 'bananas', kind: 'count' });
    const mix = catalog.packages.find((p) => p.id === 'p-mix-10lb');
    expect(mix?.yield).toBe(36);
    expect(typeof mix?.price).toBe('number');
    const cider = catalog.packages.find((p) => p.id === 'p-cid-fresh');
    expect(cider?.yield).toBeNull();
    expect(cider?.yieldUnitLabel).toBe('gallon');
    const pancakes = catalog.recipes.find((r) => r.id === 'B001');
    expect(pancakes?.lines[0]).toEqual({
      ingredientId: 'pancake-mix',
      qtyPerPerson: 0.5,
      unitKey: null,
      servesRule: 'except',
      servesRestriction: 'gf'
    });
    const cinnamon = catalog.conversions.find((c) => c.ingredientId === 'cinnamon');
    expect(cinnamon?.factor).toBeCloseTo(2.6, 9);

    // Every meal slot has at least three choices.
    for (const m of MEALS) {
      const n = catalog.recipes.filter((r) => r.mealFit.includes(m.key)).length;
      expect(n, `${m.label} choices`).toBeGreaterThanOrEqual(3);
    }
  });

  it('Shelf_HasMenuMonsterTopicRow_FromTheMigration', async () => {
    const { data, error } = await adminClient()
      .from('library_topics')
      .select('title, icon, sort_order, retired_at')
      .eq('slug', 'menu-monster')
      .single();
    expect(error).toBeNull();
    expect(data?.title).toBe('Menu Monster');
    expect(data?.icon).toBe('🍳');
    expect(data?.sort_order).toBe(60);
    expect(data?.retired_at).toBeNull();
  });

  it('MmTables_HaveRlsEnabled_WithZeroPolicies', () => {
    const rls = localSql(
      `select tablename || '=' || rowsecurity from pg_tables where schemaname = 'public' and tablename like 'mm\\_%' order by 1`
    )
      .split('\n')
      .filter(Boolean);
    // bool || text casts to 'true' (not psql's bare-column 't').
    expect(rls).toEqual(MM_TABLES.slice().sort().map((t) => `${t}=true`));

    const policies = localSql(`select count(*) from pg_policies where schemaname = 'public' and tablename like 'mm\\_%'`);
    expect(Number(policies)).toBe(0);
  });

  it('AnonKey_CannotRead_AnyMenuMonsterTable', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

    for (const table of MM_TABLES) {
      // The seed guarantees rows exist, so an empty result proves RLS, not an empty table.
      expect(await countOf(table), `${table} seeded`).toBeGreaterThan(0);
      const { data, error } = await anon.from(table).select('*').limit(1);
      // RLS with zero policies: either an error or an empty result — never rows.
      if (error === null) expect(data ?? [], `${table} via anon`).toHaveLength(0);
    }
  });
});
