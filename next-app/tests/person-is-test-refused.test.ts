import { describe, it, expect, vi } from 'vitest';
import type { Capability } from '../src/lib/capabilities';

/**
 * setPersonIsTest (the record page's Test record section) is roster.manage only. A signed-in leader without it is
 * refused before the database is touched. The real requireCapability runs; only the actor and the client are mocked.
 */
const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => {
    throw new Error('the database must not be touched');
  })
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient }));
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => ({
    kind: 'identity',
    label: 'ZZ Vitest Leader',
    personId: null,
    capabilities: new Set(['advancement.write']) as Set<Capability>,
    legacyRole: null,
    subjectKind: 'adult'
  })
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));

import { setPersonIsTest } from '../src/app/admin/(workspace)/advancement/roster/person-actions';

describe('setPersonIsTest needs roster.manage', () => {
  it('SetPersonIsTest_IsRefused_WhenTheCallerLacksRosterManage', async () => {
    await expect(setPersonIsTest(1, true)).rejects.toThrow(/This action requires/);
  });

  it('SetPersonIsTest_NeverReachesTheDatabase_WhenRefused', async () => {
    await setPersonIsTest(1, true).catch(() => undefined);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
