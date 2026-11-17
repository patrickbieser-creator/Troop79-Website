import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  FEATURES,
  UNLISTED,
  AREAS,
  hrefPath,
  visibleFeatures,
  featuresIn,
  type VisibilityOpts
} from '../src/app/admin/(workspace)/_components/feature-registry';
import { CAPABILITIES, type Capability } from '../src/lib/capabilities';

/**
 * The feature registry (Plans/Completed/Admin-Portal-Nav.md phase 1): one list every admin surface reads. These pin the rules
 * that keep it the ONLY list: every admin page is registered or deliberately unlisted, and today's nav is derived from
 * it without a visible change.
 */

const APP = join(__dirname, '..', 'src', 'app');
const WORKSPACE = join(APP, 'admin', '(workspace)');

function pageRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...pageRoutes(p));
    else if (e.name === 'page.tsx') {
      const rel = relative(WORKSPACE, dir).split(sep).filter(Boolean).join('/');
      out.push(rel ? `/admin/${rel}` : '/admin');
    }
  }
  return out;
}

const ROUTES = pageRoutes(WORKSPACE);
const REGISTERED = new Set(FEATURES.map((f) => hrefPath(f.href)));

/** An app route (admin or public) that has a page.tsx or a route.ts, ignoring route groups. */
function routeExists(path: string): boolean {
  const segs = path.split('/').filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    if (!existsSync(dir)) return false;
    if (rest.length === 0 && (existsSync(join(dir, 'page.tsx')) || existsSync(join(dir, 'route.ts')))) return true;
    const [head, ...tail] = rest;
    if (head && existsSync(join(dir, head)) && walk(join(dir, head), tail)) return true;
    return readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory() && /^\(.+\)$/.test(e.name) && walk(join(dir, e.name), rest));
  };
  return walk(APP, segs);
}

const CAPS = (...c: Capability[]) => new Set<Capability>(c);

const PROFILES: Record<string, VisibilityOpts> = {
  'full admin, no finance': { fullAdmin: true, capabilities: CAPS(...CAPABILITIES.filter((c) => !c.startsWith('finance'))) },
  'full admin with finance': { fullAdmin: true, capabilities: CAPS(...CAPABILITIES), healthViewer: true },
  'advancement only': { fullAdmin: false, capabilities: CAPS('advancement.write') },
  'roster only': { fullAdmin: false, capabilities: CAPS('roster.manage') },
  'finance only': { fullAdmin: false, capabilities: CAPS('finance.manage') },
  'librarian + news': { fullAdmin: false, capabilities: CAPS('library.moderate', 'news.write') },
  'health viewer, nothing else': { fullAdmin: false, capabilities: CAPS(), healthViewer: true },
  'calendar only': { fullAdmin: false, capabilities: CAPS('calendar.write') }
};

describe('feature registry', () => {
  it('EveryAdminRoute_IsRegisteredOrUnlisted', () => {
    const orphans = ROUTES.filter((r) => !REGISTERED.has(r) && !(r in UNLISTED));
    expect(orphans).toEqual([]);
  });

  it('Unlisted_NamesOnlyRealUnregisteredRoutes', () => {
    const stale = Object.keys(UNLISTED).filter((r) => !ROUTES.includes(r) || REGISTERED.has(r));
    expect(stale).toEqual([]);
  });

  it('Unlisted_EveryEntryGivesAReason', () => {
    expect(Object.entries(UNLISTED).filter(([, why]) => why.trim().length < 8)).toEqual([]);
  });

  it('Registry_EveryHref_IsARealRoute', () => {
    const dead = FEATURES.map((f) => hrefPath(f.href)).filter((p) => !routeExists(p));
    expect(dead).toEqual([]);
  });

  it('Registry_KeysAreUnique', () => {
    const keys = FEATURES.map((f) => f.key);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it('Registry_KeysStartWithTheirArea', () => {
    const wrong = FEATURES.filter((f) => f.key !== 'home' && !f.key.startsWith(`${f.area}.`)).map((f) => f.key);
    expect(wrong).toEqual([]);
  });

  it('Registry_LabelsAreUnique', () => {
    const labels = FEATURES.map((f) => f.label.toLowerCase());
    expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([]);
  });

  it('Registry_EveryReport_IsAlsoInReports', () => {
    const missing = FEATURES.filter((f) => f.kind === 'report' && f.area !== 'reports' && !f.alsoIn?.includes('reports'));
    expect(missing.map((f) => f.key)).toEqual([]);
  });

  it('Registry_AlsoInNeverRepeatsTheHomeArea', () => {
    expect(FEATURES.filter((f) => f.alsoIn?.includes(f.area)).map((f) => f.key)).toEqual([]);
  });

  it('Registry_EveryFeatureHasAWayToBeShown', () => {
    // No capability and no other gate = full admins only. That is deliberate for Styleguides and nothing else.
    const ungated = FEATURES.filter((f) => !f.capability && !f.everyone && !f.planner && !f.healthViewersOnly && !f.landing);
    expect(ungated.map((f) => f.key)).toEqual(['setup.styleguides']);
  });

  it('Registry_PlannerLinks_PointAtThePublicPlannerOnly', () => {
    expect(FEATURES.filter((f) => f.planner && !f.href.startsWith('/planner')).map((f) => f.key)).toEqual([]);
    expect(FEATURES.filter((f) => !f.planner && f.href.startsWith('/planner')).map((f) => f.key)).toEqual([]);
  });

  it('Registry_EveryRailArea_HasItems', () => {
    expect(AREAS.filter((a) => featuresIn(FEATURES, a).length === 0)).toEqual([]);
  });

  it('VisibleFeatures_FinanceNeverImpliedByFullAdmin', () => {
    const shown = visibleFeatures(FEATURES, PROFILES['full admin, no finance']);
    expect(shown.filter((f) => f.capability?.startsWith('finance')).map((f) => f.key)).toEqual([]);
  });

  it('VisibleFeatures_HealthItemsAnswerOnlyToTheViewersList', () => {
    const health = (o: VisibilityOpts) => visibleFeatures(FEATURES, o).filter((f) => f.healthViewersOnly).length;
    expect([health(PROFILES['full admin, no finance']), health(PROFILES['health viewer, nothing else']) > 0]).toEqual([0, true]);
  });

  it('VisibleFeatures_PlannerLinksNeedPlannerView', () => {
    const planner = (o: VisibilityOpts) => visibleFeatures(FEATURES, o).filter((f) => f.planner).length;
    const full = PROFILES['full admin with finance'];
    expect([planner(full), planner({ ...full, plannerView: true }) > 0]).toEqual([0, true]);
  });

  it('VisibleFeatures_ReportsLandingNeedsAVisibleReport', () => {
    const landing = (o: VisibilityOpts) => visibleFeatures(FEATURES, o).some((f) => f.key === 'reports.index');
    expect([landing(PROFILES['calendar only']), landing(PROFILES['finance only'])]).toEqual([false, true]);
  });
});
