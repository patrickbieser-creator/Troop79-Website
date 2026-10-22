import { describe, it, expect, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Build a Plan B4 (Plans/Build-A-Plan.md "Consolidation", Decisions 3 and 4): consolidation and retirement.
 *   - Admin's generator (Generate / Group Sessions) redirects to Build a Plan; By Scout and Teaching Roster, which only
 *     ever lived inside it, move to their own page.
 *   - Publish to Site retires: the public /meeting-plan page, its sitemap and site-tree entries, publishPlan and
 *     unpublishPlan. The meeting_plans TABLE stays (one published snapshot, 2026-10-18) until Patrick confirms the
 *     drop, so it is named only in migrations; src/ never reads or writes it.
 *   - The seed drawer and the board's Meeting focus strip retire; "This Sunday" is "Who's coming" everywhere.
 *   - One add path: nothing in src/ seeds a topic except through Build's shared add (seedMany under
 *     plannerAddOfferingAction) and its focus-set and mix siblings.
 */
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
/** Generated from the live schema (supabase gen types): it mirrors the database, where the table still is. */
const GENERATED_TYPES = path.join(SRC, 'lib', 'supabase', 'types.ts');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css|mts)$/.test(name) ? [p] : [];
  });
}
const sources = files(SRC).map((p) => ({ p: path.relative(ROOT, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8'), generated: p === GENERATED_TYPES }));
const hits = (re: RegExp, opts: { skipGenerated?: boolean } = {}) => sources.filter((f) => !(opts.skipGenerated && f.generated) && re.test(f.text)).map((f) => f.p);

describe('retired from src/', () => {
  it('Src_NeverNamesTheMeetingPlansTable', () => {
    expect(hits(/meeting_plans\b/, { skipGenerated: true })).toEqual([]);
  });

  it('Src_HasNoSeedDrawer', () => {
    expect([existsSync(path.join(SRC, 'app', '(public)', 'planner', 'seed-drawer.tsx')), hits(/seed-drawer|SeedDrawer|SeedButton|openSeed/)]).toEqual([false, []]);
  });

  it('Src_NeverSaysThisSunday', () => {
    expect(hits(/This Sunday/)).toEqual([]);
  });

  it('Src_HasNoPublishToSite', () => {
    expect(hits(/publishPlan|unpublishPlan|meeting-plan-publish/)).toEqual([]);
  });
});

describe('one add path', () => {
  it('AddOffer_UsesTheSharedSeedPath', () => {
    // seedMany (lib/meeting-focus-db) is the one seed of a single requirement, called only by Build's add; the
    // single-topic seed and the board's seed actions are gone.
    expect([hits(/\bseedTopic\b|meeting_seed_topic|plannerSeedTopicAction|plannerSeedSetAction|plannerUnseedAction/), hits(/(?<!function )\bseedMany\(/)]).toEqual([
      [],
      ['src/app/(public)/planner/build-actions.ts']
    ]);
  });

  it('AddOffer_NoTeacher_CallsBuildsAdd', () => {
    const drawer = readFileSync(path.join(SRC, 'app', '(public)', 'planner', 'offer-drawer.tsx'), 'utf8');
    expect(drawer).toMatch(/plannerAddOfferingAction\(\{ entryId: p\.entryId, keys: \[what\.key\] \}\)/);
  });
});

describe('the public plan page', () => {
  it('PublicMeetingPlan_IsGone', () => {
    // No route, no link, no sitemap or reserved-slug entry, no revalidation of it anywhere.
    const tree = readFileSync(path.join(SRC, 'lib', 'site-pages-tree.ts'), 'utf8');
    expect([existsSync(path.join(SRC, 'app', '(public)', 'meeting-plan')), /'meeting-plan'/.test(tree), hits(/["'`]\/meeting-plan["'`?#/]/)]).toEqual([false, false, []]);
  });
});

describe("Admin's generator", () => {
  const landingFor = async (capabilities: string[]) => {
    vi.resetModules();
    const redirect = vi.fn((to: string) => {
      throw new Error(`REDIRECT ${to}`);
    });
    vi.doMock('next/navigation', () => ({ redirect, permanentRedirect: redirect }));
    vi.doMock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => ({ capabilities: new Set(capabilities), subjectKind: 'leader' }) }));
    const { default: Page } = await import('../src/app/admin/(workspace)/advancement/meeting-plan/page');
    try {
      return await Page().then(() => 'no redirect', (e: Error) => e.message);
    } finally {
      vi.doUnmock('next/navigation');
      vi.doUnmock('@/lib/admin-actor');
    }
  };

  it('AdminMeetingPlan_RedirectsToBuild', async () => {
    expect(await landingFor(['meeting_plan.use', 'meeting_planner.view'])).toBe('REDIRECT /planner/build');
  });

  it('AdminMeetingPlan_RedirectsToByScout_WithoutPlannerRights', async () => {
    expect(await landingFor(['meeting_plan.use'])).toBe('REDIRECT /admin/advancement/meeting-plan/by-scout');
  });

  it('OldPublicMeetingPlan_RedirectsToThePlanner', () => {
    const config = readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
    expect(config).toMatch(/source: '\/meeting-plan', destination: '\/planner'/);
  });

  it('AdminNav_PointsNoEntryAtTheGenerator', () => {
    const nav = readFileSync(path.join(SRC, 'app', 'admin', '(workspace)', '_components', 'nav-data.ts'), 'utf8');
    expect(nav).not.toMatch(/href: '\/admin\/advancement\/meeting-plan'/);
  });
});
