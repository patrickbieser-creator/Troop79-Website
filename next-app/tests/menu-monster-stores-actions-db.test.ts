import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * The store actions in Lookups & Admin: gated on library.moderate, they
 * write through the lib and record to the audit trail. Session and audit are
 * stubbed; the database is the real local one. Rows added here are removed.
 */
const admin = adminClient();

const mocks = vi.hoisted(() => ({ allowed: true, audit: vi.fn(async () => {}) }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/require-capability', () => ({
  requireCapability: async () => {
    if (!mocks.allowed) throw new Error('nope');
    return { personId: 39 };
  }
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

import { createStore, deleteStore } from '../src/app/admin/(workspace)/advancement/lookups/store-actions';

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  mocks.allowed = true;
  mocks.audit.mockClear();
});

afterEach(async () => {
  await admin.from('mm_stores').delete().ilike('name', 'vitest%');
});

describe('Store actions', () => {
  it('Leader_CanAddAStore_WhenTheyMayModerateTheLibrary', async () => {
    const res = await createStore(fd({ name: 'vitest Action Mart' }));
    expect(res.ok).toBe(true);
    const { data } = await admin.from('mm_stores').select('name').eq('name', 'vitest Action Mart');
    expect(data).toHaveLength(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it('Visitor_CannotAddAStore_WithoutTheLibraryCapability', async () => {
    mocks.allowed = false;
    const res = await createStore(fd({ name: 'vitest Nope Mart' }));
    expect(res.ok).toBe(false);
    const { data } = await admin.from('mm_stores').select('name').eq('name', 'vitest Nope Mart');
    expect(data).toHaveLength(0);
  });

  it('Visitor_CannotDeleteAStore_WithoutTheLibraryCapability', async () => {
    await createStore(fd({ name: 'vitest Keep Mart' }));
    const { data } = await admin.from('mm_stores').select('id').eq('name', 'vitest Keep Mart').single();
    mocks.allowed = false;
    const res = await deleteStore(fd({ id: String(data!.id) }));
    expect(res.ok).toBe(false);
    expect((await admin.from('mm_stores').select('id').eq('id', data!.id)).data).toHaveLength(1);
  });

  it('Leader_CannotDeleteAStore_WithoutAnId', async () => {
    const res = await deleteStore(fd({}));
    expect(res.ok).toBe(false);
  });
});
