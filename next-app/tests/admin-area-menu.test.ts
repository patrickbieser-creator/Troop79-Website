import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURES, visibleFeatures, type VisibilityOpts } from '../src/app/admin/(workspace)/_components/feature-registry';
import {
  areaMenu,
  railModel,
  activeAreaFor,
  areaCounts,
  ATTENTION_AREA,
  AREA_LABELS
} from '../src/app/admin/(workspace)/_components/area-menu';
import { CAPABILITIES, type Capability } from '../src/lib/capabilities';

/** The rail and its area menus as data (Plans/Admin-Portal-Nav.md phase 3). */

const ALL: VisibilityOpts = { fullAdmin: true, capabilities: new Set<Capability>(CAPABILITIES), healthViewer: true, plannerView: true };
const visibleTo = (o: VisibilityOpts) => visibleFeatures(FEATURES, o);
const labels = (m: ReturnType<typeof areaMenu>) => m.columns.map((c) => [c.title, c.items.map((i) => i.label)]);

describe('area menus', () => {
  it('AreaMenu_ShowsFourColumns_InOrder', () => {
    expect(areaMenu(visibleTo(ALL), 'money', { wreathOpen: true }).columns.map((c) => c.title)).toEqual(['Do', 'Screens', 'Reports', 'Setup']);
  });

  it('AreaMenu_ShowsOnlyVisibleItems', () => {
    const adv = visibleTo({ fullAdmin: false, capabilities: new Set<Capability>(['advancement.write']) });
    const items = areaMenu(adv, 'advancement', { wreathOpen: false }).columns.flatMap((c) => c.items.map((i) => i.key));
    // Review proof needs library.moderate and Requirement classes needs roster.manage: neither is offered.
    expect(items.includes('advancement.review-proof') || items.includes('advancement.requirement-classes')).toBe(false);
  });

  it('AreaMenu_EmptyColumn_KeptWithNoItems', () => {
    const content = areaMenu(visibleTo(ALL), 'content', { wreathOpen: false });
    expect(content.columns.find((c) => c.title === 'Reports')?.items).toEqual([]);
  });

  it('AreaMenu_PrimaryItemsLeadTheirColumn', () => {
    const screens = areaMenu(visibleTo(ALL), 'money', { wreathOpen: false }).columns.find((c) => c.title === 'Screens')!;
    expect(screens.items[0].key).toBe('money.ledger');
  });

  it('AreaMenu_WreathSaleLeadsInSeason_LastAndOffOutOfSeason', () => {
    const screens = (open: boolean) => areaMenu(visibleTo(ALL), 'money', { wreathOpen: open }).columns.find((c) => c.title === 'Screens')!.items;
    const off = screens(false);
    expect([screens(true)[0].key, off[off.length - 1].key, off[off.length - 1].season]).toEqual(['money.wreaths', 'money.wreaths', 'off']);
  });

  it('AreaMenu_TitleLinksToTheFirstPrimaryScreen', () => {
    expect(areaMenu(visibleTo(ALL), 'people', { wreathOpen: false }).homeHref).toBe('/admin/advancement/roster');
  });

  it('ReportsMenu_GroupsBySubject', () => {
    const m = areaMenu(visibleTo(ALL), 'reports', { wreathOpen: false });
    expect(m.columns.map((c) => c.title)).toEqual(['Advancement', 'Meetings and people', 'Money', 'Site']);
  });

  it('ReportsMenu_ListsEveryReportOnce', () => {
    const m = areaMenu(visibleTo(ALL), 'reports', { wreathOpen: false });
    const keys = m.columns.flatMap((c) => c.items.map((i) => i.key)).sort();
    expect(keys).toEqual(FEATURES.filter((f) => f.kind === 'report').map((f) => f.key).sort());
  });

  it('ReportsMenu_SiteHoldsSignInsAnalyticsAndAuditTrail', () => {
    const site = areaMenu(visibleTo(ALL), 'reports', { wreathOpen: false }).columns.find((c) => c.title === 'Site')!;
    expect(site.items.map((i) => i.label)).toEqual(['Recent Sign-ins', 'Site Analytics', 'Audit Trail']);
  });

  it('SetupMenu_HasDoListsReportsWorkspace', () => {
    expect(labels(areaMenu(visibleTo(ALL), 'setup', { wreathOpen: false })).map(([t]) => t)).toEqual(['Do', 'Lists', 'Reports', 'Workspace']);
  });

  it('SetupMenu_WorkspaceIsAccessAndStyleguides', () => {
    const ws = areaMenu(visibleTo(ALL), 'setup', { wreathOpen: false }).columns.find((c) => c.title === 'Workspace')!;
    expect(ws.items.map((i) => i.key)).toEqual(['people.access', 'setup.styleguides', 'setup.utilities']);
  });

  it('EveryReport_IsInItsOwnGroupAndInReports', () => {
    const v = visibleTo(ALL);
    const missing = FEATURES.filter((f) => f.kind === 'report' && f.area !== 'reports').filter((f) => {
      const own = areaMenu(v, f.area, { wreathOpen: false }).columns.flatMap((c) => c.items.map((i) => i.key));
      const rep = areaMenu(v, 'reports', { wreathOpen: false }).columns.flatMap((c) => c.items.map((i) => i.key));
      return !own.includes(f.key) || !rep.includes(f.key);
    });
    expect(missing.map((f) => f.key)).toEqual([]);
  });

  it('AreaLabels_RenameCalendarAndNewsToWebsiteContent', () => {
    expect(AREA_LABELS.content).toBe('Website Content');
  });
});

describe('rail model', () => {
  it('Rail_GroupsInDecisionOrder', () => {
    expect(railModel(visibleTo(ALL), [], { wreathOpen: false }).groups.map((g) => g.title)).toEqual([
      'Meetings',
      'Advancement',
      'Website Content',
      'Money',
      'People',
      'Reports'
    ]);
  });

  it('Rail_ReportsOnlyLeader_SeesReportsAndNothingEmpty', () => {
    // finance.view alone reaches no screen; a person holding only advancement reports still sees groups with items only.
    const m = railModel(visibleTo({ fullAdmin: false, capabilities: new Set<Capability>(['advancement.write']) }), [], { wreathOpen: false });
    expect(m.groups.every((g) => g.columns.some((c) => c.items.length > 0))).toBe(true);
  });

  it('Rail_HidesGroupsThePersonCanOpenNothingIn', () => {
    const m = railModel(visibleTo({ fullAdmin: false, capabilities: new Set<Capability>(['calendar.write']) }), [], { wreathOpen: false });
    expect([m.groups.map((g) => g.area), m.setup]).toEqual([['content'], null]);
  });

  it('PlannerLinks_HiddenWithoutPlannerView', () => {
    const noPlanner = { ...ALL, plannerView: false };
    const meetings = railModel(visibleTo(noPlanner), [], { wreathOpen: false }).groups.find((g) => g.area === 'meetings')!;
    expect(meetings.columns.flatMap((c) => c.items).some((i) => i.href.startsWith('/planner'))).toBe(false);
  });

  it('Pins_KeepSavedOrder_AndSkipWhatThePersonCannotOpen', () => {
    const adv = visibleTo({ fullAdmin: false, capabilities: new Set<Capability>(['advancement.write']) });
    const m = railModel(adv, ['advancement.ledger', 'money.ledger', 'no.such', 'advancement.fast-entry'], { wreathOpen: false });
    expect(m.pins.map((p) => p.key)).toEqual(['advancement.ledger', 'advancement.fast-entry']);
  });
});

describe('active group', () => {
  it('ActiveGroup_ByMembership_NotUrlPrefix', () => {
    // Ledger Audit's route is under /admin/utilities, but it belongs to Money.
    expect(activeAreaFor('/admin/utilities/ledger-audit')).toBe('money');
  });

  it('ActiveGroup_HomeOnlyOnAdminItself', () => {
    expect([activeAreaFor('/admin'), activeAreaFor('/admin/finance')]).toEqual(['home', 'money']);
  });

  it('ActiveGroup_DetailPageLightsItsList', () => {
    expect([activeAreaFor('/admin/calendar/412'), activeAreaFor('/admin/advancement/roster/88')]).toEqual(['content', 'people']);
  });

  it('ActiveGroup_RouteSegmentsMatchWhole', () => {
    // /admin/finance-reports is not under /admin/finance.
    expect(activeAreaFor('/admin/financex')).toBeNull();
  });

  it('ActiveGroup_SignInsReportLightsReports', () => {
    expect(activeAreaFor('/admin/reports/sign-ins')).toBe('reports');
  });

  it('ActiveGroup_AZAndPinsLightNothing', () => {
    expect([activeAreaFor('/admin/everything'), activeAreaFor('/admin/pins')]).toEqual([null, null]);
  });
});

describe('group counts', () => {
  it('Counts_SumAnAreasAttentionRows', () => {
    const rows = [
      { key: 'reimbursements', count: 2 },
      { key: 'wreath-orders', count: 7 },
      { key: 'proof-submissions', count: 4 },
      { key: 'next-signup', count: 1, informational: true }
    ];
    expect(areaCounts(rows)).toEqual({ money: 9, advancement: 4 });
  });

  it('Counts_EveryAttentionRowHasAGroup', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'app', 'admin', '(workspace)', 'advancement', 'dashboard', 'attention-items.ts'), 'utf8');
    const keys = new Set([...src.matchAll(/queue\(\s*'([a-z-]+)'/g), ...src.matchAll(/key: '([a-z-]+)'/g)].map((m) => m[1]));
    keys.delete('next-signup'); // informational: counts nowhere
    expect([...keys].filter((k) => !(k in ATTENTION_AREA))).toEqual([]);
  });
});
