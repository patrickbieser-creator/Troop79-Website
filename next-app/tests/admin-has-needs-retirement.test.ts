import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Admin's Has/Needs retires (Build a Plan B7, Plans/Build-A-Plan.md; Patrick approved /planner/has-needs 2026-10-23).
 * Old links land on the planner tab for a planner viewer, and on Admin's Home (no error) for anyone else.
 */
const SRC = path.join(__dirname, '..', 'src');
const HN = path.join(SRC, 'app', 'admin', '(workspace)', 'advancement', 'has-needs');
const PAGE = '../src/app/admin/(workspace)/advancement/has-needs/page';

const landingFor = async (capabilities: string[]) => {
  vi.resetModules();
  const redirect = vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  });
  const permanentRedirect = vi.fn((to: string) => {
    throw new Error(`PERMANENT ${to}`);
  });
  vi.doMock('next/navigation', () => ({ redirect, permanentRedirect }));
  vi.doMock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => ({ capabilities: new Set(capabilities), subjectKind: 'leader' }) }));
  const { default: Page } = await import(PAGE);
  try {
    return await (Page as () => Promise<unknown>)().then(() => 'no redirect', (e: Error) => e.message);
  } finally {
    vi.doUnmock('next/navigation');
    vi.doUnmock('@/lib/admin-actor');
  }
};

describe('Admin Has/Needs retirement', () => {
  it('AdminHasNeeds_RedirectsToThePlannerTab', async () => {
    expect(await landingFor(['advancement.write', 'meeting_planner.view'])).toBe('REDIRECT /planner/has-needs');
  });

  it('AdminHasNeeds_WithoutPlannerRights_LandsOnAdminHome', async () => {
    expect(await landingFor(['advancement.write'])).toBe('REDIRECT /admin');
  });

  // qa-lead: the landing depends on the viewer's rights, so it must not be a cacheable 308.
  it('AdminHasNeeds_RedirectIsTemporary', async () => {
    expect(await landingFor(['advancement.write'])).not.toMatch(/^PERMANENT/);
  });

  it('AdminHasNeeds_ToolAndStylesAreGone', () => {
    expect(['has-needs-tool.tsx', 'has-needs.module.css'].filter((f) => existsSync(path.join(HN, f)))).toEqual([]);
  });

  it('AdminNav_HasNoEntryForHasNeeds', () => {
    const nav = readFileSync(path.join(SRC, 'app', 'admin', '(workspace)', '_components', 'nav-data.ts'), 'utf8');
    expect(nav).not.toMatch(/\/admin\/advancement\/has-needs/);
  });
});
