import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Build a Plan B4 (Plans/Build-A-Plan.md, Decision 3): Admin's generator (Generate Plan / Group Sessions) and Publish to
 * Site retired; /admin/advancement/meeting-plan redirects to /planner/build (build-plan-b4-retirement.test.ts). By
 * Scout and Teaching Roster only ever lived inside the generator, so they stay on their own page, read-only. Server
 * actions are the mock boundary.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/admin/advancement/meeting-plan/by-scout' }));
vi.mock('../src/app/admin/(workspace)/advancement/meeting-plan/actions', () => ({ generatePlan: vi.fn() }));

const { PlanView } = await import('../src/app/admin/(workspace)/advancement/meeting-plan/by-scout/scout-view');

describe('By Scout and Teaching Roster', () => {
  it('ByScout_ShowsItsTwoViews_AndNoPublish', () => {
    render(<PlanView defaultDate="2096-02-02" />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect([tabs, screen.getByRole('button', { name: 'Show' }) != null, screen.queryByText(/Publish/), screen.queryByText(/Group Sessions/)]).toEqual([
      ['By Scout', 'Teaching Roster'],
      true,
      null,
      null
    ]);
  });
});
