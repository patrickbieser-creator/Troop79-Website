import { describe, it, expect, vi } from 'vitest';

/**
 * Guests as People (Plans/Guests-As-People.md) — qa-lead's required
 * `GuestsTab_RequiresLeaderCapability`: every guest write/read action is
 * gated by requireCapability BEFORE it touches the database. The cookie-
 * reading half (resolveAdminActor) has no request scope in Vitest, so it is
 * mocked to "nobody signed in" and each action must refuse with
 * 'Not authenticated' — and must not have called Supabase at all.
 */
const createAdminClient = vi.fn(() => {
  throw new Error('Supabase must not be reached before the capability check');
});
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => createAdminClient() }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => null }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

describe('Guests tab + leader guest actions — capability gate', () => {
  it('GuestsTab_RequiresLeaderCapability_ForgetAndPromote', async () => {
    const { forgetGuest, promoteGuest } = await import('@/app/admin/(workspace)/advancement/roster/guest-actions');
    await expect(forgetGuest(1)).rejects.toThrow('Not authenticated');
    await expect(promoteGuest(1, 2)).rejects.toThrow('Not authenticated');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('LeaderAddAGuest_RequiresCalendarWrite_ForAddAndForTheKnownGuestLookup', async () => {
    const { addGuestEntry, loadGuestsForHost } = await import('@/app/admin/(workspace)/events/actions');
    await expect(addGuestEntry(1, 2, 3, { name: 'X', cls: 'youth_guest' })).rejects.toThrow('Not authenticated');
    await expect(loadGuestsForHost(3, 1)).rejects.toThrow('Not authenticated');
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
