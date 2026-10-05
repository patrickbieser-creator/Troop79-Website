import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Gear tab's extras: who may add or remove them. The owner always could; since 2026-10-05 a leader fixing
 * the menu can too (menu-access.ts canEditPlan). The crew only ticks things as packed. The menu stays the
 * owner's: the write is made against the owner's id, and a new gear name is credited to whoever typed it.
 */
const mocks = vi.hoisted(() => ({ recorder: null as unknown, setGearExtrasWith: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/gear-store', () => ({ setGearExtrasWith: mocks.setGearExtrasWith, setGearPackedWith: vi.fn() }));
vi.mock('../src/app/(public)/library/menu-monster/menus/_components/scout-menus', () => ({ menuRecorder: async () => mocks.recorder }));

import { setGearExtrasAction } from '../src/app/(public)/library/_tools/menu-monster/gear-actions';

const ID = '0b9f8c1e-3a52-4f6e-9d3c-1a2b3c4d5e6f';
const recorder = (access: string, personId: number | null) => ({ access, personId, name: 'x', stored: { ownerPersonId: 39 } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setGearExtrasWith.mockResolvedValue(['Tarp']);
});

describe('setGearExtrasAction', () => {
  it('Owner_ChangesTheirMenusExtraGear', async () => {
    mocks.recorder = recorder('owner', 39);
    expect(await setGearExtrasAction(ID, ['Tarp'])).toEqual({ ok: true, extras: ['Tarp'] });
    expect(mocks.setGearExtrasWith.mock.calls[0].slice(1)).toEqual([ID, 39, ['Tarp'], 39]);
  });

  it('Leader_ChangesAScoutsExtraGear_AgainstTheScoutsMenu', async () => {
    mocks.recorder = recorder('admin', 82);
    expect((await setGearExtrasAction(ID, ['Tarp'])).ok).toBe(true);
    // The menu's owner (39), and the leader (82) as whoever typed a new gear name.
    expect(mocks.setGearExtrasWith.mock.calls[0].slice(1)).toEqual([ID, 39, ['Tarp'], 82]);
  });

  it('Crew_CannotChangeExtraGear', async () => {
    mocks.recorder = recorder('crew', 7);
    expect((await setGearExtrasAction(ID, ['Tarp'])).ok).toBe(false);
    expect(mocks.setGearExtrasWith).not.toHaveBeenCalled();
  });

  it('Leader_WithNoPerson_CannotChangeExtraGear', async () => {
    mocks.recorder = recorder('admin', null);
    expect((await setGearExtrasAction(ID, ['Tarp'])).ok).toBe(false);
    expect(mocks.setGearExtrasWith).not.toHaveBeenCalled();
  });
});
