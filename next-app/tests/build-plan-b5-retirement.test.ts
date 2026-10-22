import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Build a Plan B5 (Plans/Build-A-Plan.md): Suggestions mode restores the retired generator's lenses, so Admin's By
 * Scout / Teaching Roster page retires with its nav entry and Home card. Old links land in Suggestions for a planner
 * viewer, and on Admin's Home (no error) for anyone else. The engine's admin-only action (generatePlan) goes with it.
 */
const SRC = path.join(__dirname, '..', 'src');
const MP = path.join(SRC, 'app', 'admin', '(workspace)', 'advancement', 'meeting-plan');

const landingFor = async (page: string, capabilities: string[]) => {
  vi.resetModules();
  const redirect = vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  });
  vi.doMock('next/navigation', () => ({ redirect, permanentRedirect: redirect }));
  vi.doMock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => ({ capabilities: new Set(capabilities), subjectKind: 'leader' }) }));
  const { default: Page } = await import(page);
  try {
    return await (Page as () => Promise<unknown>)().then(() => 'no redirect', (e: Error) => e.message);
  } finally {
    vi.doUnmock('next/navigation');
    vi.doUnmock('@/lib/admin-actor');
  }
};

describe('Admin By Scout retirement', () => {
  it('AdminByScout_RedirectsToSuggestions', async () => {
    expect(await landingFor('../src/app/admin/(workspace)/advancement/meeting-plan/by-scout/page', ['meeting_plan.use', 'meeting_planner.view'])).toBe(
      'REDIRECT /planner/build?view=suggestions'
    );
  });

  it('AdminByScout_WithoutPlannerRights_LandsOnAdminHome', async () => {
    expect(await landingFor('../src/app/admin/(workspace)/advancement/meeting-plan/by-scout/page', ['meeting_plan.use'])).toBe('REDIRECT /admin');
  });

  it('AdminMeetingPlan_RedirectsToSuggestions', async () => {
    expect(await landingFor('../src/app/admin/(workspace)/advancement/meeting-plan/page', ['meeting_planner.view'])).toBe('REDIRECT /planner/build?view=suggestions');
  });

  it('AdminByScout_ViewsAndGeneratorActionAreGone', () => {
    expect(['by-scout/scout-view.tsx', 'actions.ts', 'meeting-plan.module.css'].filter((f) => existsSync(path.join(MP, f)))).toEqual([]);
  });

  it('AdminNav_HasNoEntryForTheMeetingPlanPages', () => {
    const nav = readFileSync(path.join(SRC, 'app', 'admin', '(workspace)', '_components', 'nav-data.ts'), 'utf8');
    expect(nav).not.toMatch(/\/admin\/advancement\/meeting-plan/);
  });
});
