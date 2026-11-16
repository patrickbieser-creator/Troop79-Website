import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const isHealthViewer = vi.fn();
vi.mock('../src/lib/health-store', () => ({ isHealthViewer: (...a: unknown[]) => isHealthViewer(...a), isYouthOnRoster: vi.fn(), loadTripsForAdult: vi.fn() }));
vi.mock('../src/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));

import { adminIsHealthViewer, healthAdminAllowed } from '../src/lib/health-access';

/**
 * Admin Health Forms gates (Plans/Admin-Health-Forms.md, decision 3; qa-lead 2026-11-15): the screen needs admin entry
 * AND the health viewers list; the menu flag fails closed so a database hiccup can't take down every admin page.
 */
const named = { me: { personId: 9, name: 'M' }, family: [], named: true, trips: [] };

describe('healthAdminAllowed (pure)', () => {
  it('HealthAdmin_AllowsAnAdminOnTheList', () => {
    expect(healthAdminAllowed(true, named)).toBe(true);
  });

  it('HealthViewerWithoutAdmin_IsRefused', () => {
    expect(healthAdminAllowed(false, named)).toBe(false);
  });

  it('AdminNotOnTheList_IsRefused_EvenAsFullAdmin', () => {
    expect(healthAdminAllowed(true, { ...named, named: false })).toBe(false);
  });

  it('NoHealthSession_IsRefused', () => {
    expect(healthAdminAllowed(true, null)).toBe(false);
  });
});

describe('adminIsHealthViewer', () => {
  it('AdminIsHealthViewer_PasswordSession_IsNever_AndAsksNothing', async () => {
    isHealthViewer.mockClear();
    expect([await adminIsHealthViewer({ kind: 'legacy', personId: null }), isHealthViewer.mock.calls.length]).toEqual([false, 0]);
  });

  it('AdminIsHealthViewer_FailsClosed_WhenTheLookupThrows', async () => {
    isHealthViewer.mockRejectedValueOnce(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await adminIsHealthViewer({ kind: 'identity', personId: 9 })).toBe(false);
  });
});
