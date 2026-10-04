import { describe, it, expect, afterEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { adminClient } from './helpers/admin-client';
import {
  addStoreWith,
  deleteStoreWith,
  listStoresWith,
  moveStoreWith,
  renameStoreWith,
  restoreStoreWith,
  retireStoreWith
} from '../src/lib/menu-monster/stores';
import type { AuditEntry } from '../src/lib/audit';

/**
 * mm_stores (20261003140000_mm_stores.sql) and lib/menu-monster/stores.ts:
 * the seed, the case-insensitive unique name, the rename RPC that cascades
 * to mm_packages in one transaction, and the lib's validation + audit.
 * Every row a test adds (stores, the fixture package) is removed after it and
 * every reordered seeded store is put back.
 */
const admin = adminClient();
const PKG_ID = 'vitest-stores-package';
/** Stores from the seed that are still on the list. The list is leader-maintained now (Lookups & Admin) and
 *  later migrations added stores and removed Kroger, so nothing here asserts the whole list or its order. */
const SEED = ['Costco', 'Target', 'Outpost', 'Other'];

const entries: AuditEntry[] = [];
const record = vi.fn(async (e: AuditEntry) => {
  entries.push(e);
});

async function storeId(name: string): Promise<number> {
  const all = await listStoresWith(admin, { includeRetired: true });
  return all.find((s) => s.name === name)!.id;
}

async function makePackage(store: string | null) {
  const { data: ing } = await admin.from('mm_ingredients').select('id').is('retired_at', null).limit(1).single();
  const { error } = await admin
    .from('mm_packages')
    .insert({ id: PKG_ID, ingredient_id: ing!.id, name: 'vitest stores', price: 4, yield: 10, as_of: '2026-01-01', store });
  if (error) throw new Error(`fixture: ${error.message}`);
}

async function snapshotSeed() {
  const { data } = await admin.from('mm_stores').select('id, name, sort_order, retired_at').in('name', SEED).order('id');
  return data;
}

async function pkgStore() {
  return (await admin.from('mm_packages').select('store').eq('id', PKG_ID).single()).data!.store;
}

afterEach(async () => {
  entries.length = 0;
  record.mockClear();
  await admin.from('mm_packages').delete().eq('id', PKG_ID);
  await admin.from('mm_stores').delete().ilike('name', 'vitest%');
});

describe('mm_stores seed', () => {
  it('Migration_SeedsTheStores_WithoutDuplicates', async () => {
    const all = await listStoresWith(admin, { includeRetired: true });
    expect(all.map((s) => s.name)).toEqual(expect.arrayContaining(SEED));
    const lowered = all.map((s) => s.name.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  it('Migration_KeepsEveryStoreAPackageAlreadyUses', async () => {
    const [{ data: stores }, { data: pkgs }] = await Promise.all([
      admin.from('mm_stores').select('name'),
      admin.from('mm_packages').select('store').not('store', 'is', null)
    ]);
    const known = new Set((stores ?? []).map((s) => (s.name as string).toLowerCase()));
    const missing = (pkgs ?? []).map((p) => p.store as string).filter((s) => !known.has(s.trim().toLowerCase()));
    expect(missing).toEqual([]);
  });

  it('Database_RefusesADuplicateName_IgnoringCase', async () => {
    const { error } = await admin.from('mm_stores').insert({ name: 'COSTCO', sort_order: 999 });
    expect(error?.code).toBe('23505');
  });
});

describe('mm_rename_store', () => {
  it('Rename_CascadesToPackages_InOneCall', async () => {
    await admin.from('mm_stores').insert({ name: 'vitest old', sort_order: 900 });
    const id = await storeId('vitest old');
    await makePackage('vitest old');
    const { data, error } = await admin.rpc('mm_rename_store', { p_id: id, p_name: '  vitest new  ' });
    expect(error).toBeNull();
    expect(data).toBe('ok');
    expect((await admin.from('mm_stores').select('name').eq('id', id).single()).data!.name).toBe('vitest new');
    expect(await pkgStore()).toBe('vitest new');
  });

  it('Rename_ChangesNothing_WhenTheNameCollidesIgnoringCase', async () => {
    await admin.from('mm_stores').insert({ name: 'vitest solo', sort_order: 900 });
    const id = await storeId('vitest solo');
    await makePackage('vitest solo');
    const { data } = await admin.rpc('mm_rename_store', { p_id: id, p_name: 'COSTCO' });
    expect(data).toBe('duplicate');
    expect(await pkgStore()).toBe('vitest solo');
  });

  it('Rename_Refuses_AnEmptyOrOverlongName', async () => {
    await admin.from('mm_stores').insert({ name: 'vitest solo', sort_order: 900 });
    const id = await storeId('vitest solo');
    expect((await admin.rpc('mm_rename_store', { p_id: id, p_name: '   ' })).data).toBe('invalid');
    expect((await admin.rpc('mm_rename_store', { p_id: id, p_name: 'x'.repeat(41) })).data).toBe('invalid');
  });

  it('Rename_ReportsMissing_ForAnUnknownStore', async () => {
    expect((await admin.rpc('mm_rename_store', { p_id: 999999, p_name: 'vitest nope' })).data).toBe('missing');
  });

  it('Rename_CannotBeExecuted_WithTheAnonKey', async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { error } = await anon.rpc('mm_rename_store', { p_id: 1, p_name: 'Costco' });
    expect(error).not.toBeNull();
  });

  it('Rename_IsNotExecutableByAnonAuthenticatedOrPublic_InPostgres', () => {
    const sql =
      "select has_function_privilege('anon','public.mm_rename_store(integer,text)','execute'), " +
      "has_function_privilege('authenticated','public.mm_rename_store(integer,text)','execute'), " +
      "has_function_privilege('public','public.mm_rename_store(integer,text)','execute')";
    const out = execSync(`docker exec supabase_db_next-app psql -U postgres -tAc "${sql}"`).toString().trim();
    expect(out).toBe('f|f|f');
  });
});

describe('stores lib', () => {
  it('Leader_CanAddAStore_WithATrimmedName_AndAuditIsWritten', async () => {
    const res = await addStoreWith(admin, '  vitest Aldi  ', record);
    expect(res.ok).toBe(true);
    const all = await listStoresWith(admin, { includeRetired: false });
    expect(all[all.length - 1]!.name).toBe('vitest Aldi');
    expect(record).toHaveBeenCalledTimes(1);
    expect(entries[0]).toMatchObject({ area: 'library', action: 'create', entityType: 'mm_store' });
    expect(entries[0]!.summary).toContain('"vitest Aldi"');
  });

  it.each([
    ['empty', '   ', /name/i],
    ['too long', 'v'.repeat(41), /40/],
    ['a duplicate ignoring case', 'cOSTCO', /already/i]
  ])('Leader_CannotAddAStore_WhenTheNameIs_%s', async (_label, name, msg) => {
    const res = await addStoreWith(admin, name, record);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(msg);
    expect(record).not.toHaveBeenCalled();
  });

  it('Leader_CanRenameAStore_AndItsPackagesFollow_WithAuditNamingTheStore', async () => {
    await addStoreWith(admin, 'vitest Before', record);
    const id = await storeId('vitest Before');
    await makePackage('vitest Before');
    record.mockClear();
    entries.length = 0;
    const res = await renameStoreWith(admin, id, 'vitest After', record);
    expect(res.ok).toBe(true);
    expect(await pkgStore()).toBe('vitest After');
    expect(entries[0]).toMatchObject({ area: 'library', action: 'update', entityType: 'mm_store' });
    expect(entries[0]!.summary).toContain('"vitest After"');
    expect(entries[0]!.details).toEqual([{ field: 'Name', from: 'vitest Before', to: 'vitest After' }]);
  });

  it('Leader_CannotRenameAStore_ToAnotherStoresName', async () => {
    await addStoreWith(admin, 'vitest Dup', record);
    const res = await renameStoreWith(admin, await storeId('vitest Dup'), 'costco', record);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already/i);
  });

  it('Leader_CanChangeOnlyTheCaseOfAStoreName', async () => {
    await addStoreWith(admin, 'vitest case', record);
    const res = await renameStoreWith(admin, await storeId('vitest case'), 'Vitest Case', record);
    expect(res.ok).toBe(true);
  });

  it('Retire_HidesTheStoreFromTheActiveList_ButKeepsItsPackages', async () => {
    await addStoreWith(admin, 'vitest Gone', record);
    const id = await storeId('vitest Gone');
    await makePackage('vitest Gone');
    expect((await retireStoreWith(admin, id, record)).ok).toBe(true);
    expect((await listStoresWith(admin, { includeRetired: false })).some((s) => s.name === 'vitest Gone')).toBe(false);
    const all = await listStoresWith(admin, { includeRetired: true });
    const gone = all[all.length - 1]!;
    expect(gone).toMatchObject({ name: 'vitest Gone', packageCount: 1 });
    expect(gone.retiredAt).not.toBeNull();
    expect(await pkgStore()).toBe('vitest Gone');
    expect(entries.at(-1)).toMatchObject({ action: 'retire', entityType: 'mm_store' });
  });

  it('Restore_BringsARetiredStoreBackIntoTheActiveList', async () => {
    await addStoreWith(admin, 'vitest Back', record);
    const id = await storeId('vitest Back');
    await retireStoreWith(admin, id, record);
    expect((await restoreStoreWith(admin, id, record)).ok).toBe(true);
    expect((await listStoresWith(admin, { includeRetired: false })).some((s) => s.name === 'vitest Back')).toBe(true);
    expect(entries.at(-1)).toMatchObject({ action: 'restore' });
  });

  it('Delete_IsRefused_WhenAPackageStillUsesTheStore', async () => {
    await addStoreWith(admin, 'vitest Used', record);
    const id = await storeId('vitest Used');
    await makePackage('vitest Used');
    const res = await deleteStoreWith(admin, id, record);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/retire/i);
    expect((await listStoresWith(admin, { includeRetired: true })).some((s) => s.id === id)).toBe(true);
  });

  it('Delete_RemovesAnUnusedStore_AndWritesAudit', async () => {
    await addStoreWith(admin, 'vitest Unused', record);
    const id = await storeId('vitest Unused');
    expect((await deleteStoreWith(admin, id, record)).ok).toBe(true);
    expect((await listStoresWith(admin, { includeRetired: true })).some((s) => s.id === id)).toBe(false);
    expect(entries.at(-1)).toMatchObject({ action: 'delete', entityType: 'mm_store' });
    expect(entries.at(-1)!.summary).toContain('"vitest Unused"');
  });

  it('Move_SwapsAStoreWithItsNeighbour_AndStopsAtTheEnds', async () => {
    const before = await snapshotSeed();
    const list = await listStoresWith(admin, { includeRetired: false });
    const first = list[0]!;
    const second = list[1]!;
    try {
      expect((await moveStoreWith(admin, second.id, 'up', record)).ok).toBe(true);
      const after = await listStoresWith(admin, { includeRetired: false });
      expect(after.slice(0, 2).map((s) => s.name)).toEqual([second.name, first.name]);
      record.mockClear();
      expect((await moveStoreWith(admin, second.id, 'up', record)).ok).toBe(true);
      expect(record).not.toHaveBeenCalled();
    } finally {
      for (const row of before ?? []) {
        await admin.from('mm_stores').update({ sort_order: row.sort_order }).eq('id', row.id);
      }
    }
    expect(await snapshotSeed()).toEqual(before);
  });
});
