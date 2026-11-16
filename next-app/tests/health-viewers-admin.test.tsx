import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { HealthViewersAdmin } from '../src/app/admin/(workspace)/health-forms/viewers/health-viewers-admin';

/**
 * Admin › Health Forms › Who can open health records (Plans/Admin-Health-Forms.md). The list can't be left empty: the
 * last name's Remove is greyed and says why, in visible text.
 */
afterEach(cleanup);

const noop = vi.fn(async () => ({ ok: true as const }));

describe('HealthViewersAdmin', () => {
  it('ViewersPage_LastViewerCannotBeRemoved', () => {
    render(<HealthViewersAdmin viewers={[{ personId: 1, name: 'Mindy S', grantedAt: '2026-11-12T12:00:00Z' }]} adults={[]} grant={noop} revoke={noop} />);
    const remove = screen.getByRole('button', { name: 'Remove Mindy S…' }) as HTMLButtonElement;
    expect([remove.disabled, !!screen.getByText(/can’t be left empty/)]).toEqual([true, true]);
  });

  it('ViewersPage_RemoveIsOffered_WhenMoreThanOne', () => {
    render(
      <HealthViewersAdmin
        viewers={[
          { personId: 1, name: 'Mindy S', grantedAt: '2026-11-12T12:00:00Z' },
          { personId: 2, name: 'Jason M', grantedAt: '2026-11-12T12:00:00Z' }
        ]}
        adults={[]}
        grant={noop}
        revoke={noop}
      />
    );
    expect((screen.getByRole('button', { name: 'Remove Jason M…' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
