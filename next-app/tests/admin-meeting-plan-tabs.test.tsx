import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Meeting Planner II, P5c (Plans/Meeting-Planner-II.md Decision 1): Admin's Meeting Plan is the generator only. This
 * Sunday, its board settings, stations and invites moved to /planner; the page keeps Generate Plan, Group Sessions
 * (the ledger suggestions), By Scout, Teaching Roster and Publish to Site. Server actions are the mock boundary.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/admin/advancement/meeting-plan' }));
vi.mock('../src/app/admin/(workspace)/advancement/meeting-plan/actions', () => ({ generatePlan: vi.fn(), publishPlan: vi.fn(), unpublishPlan: vi.fn() }));

const { PlanView } = await import('../src/app/admin/(workspace)/advancement/meeting-plan/plan-view');

describe('Admin Meeting Plan', () => {
  it('AdminMeetingPlan_ShowsGeneratorTabsOnly', () => {
    render(<PlanView published={[]} defaultDate="2096-02-02" />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect([tabs, screen.getByRole('button', { name: 'Generate Plan' }) != null, screen.queryByText(/This Sunday/)]).toEqual([
      ['Group Sessions', 'By Scout', 'Teaching Roster'],
      true,
      null
    ]);
  });
});
