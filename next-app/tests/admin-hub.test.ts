import { describe, it, expect } from 'vitest';
import { SECTIONS, visibleNavSections, navSections, sectionNav, hubGroups, folderEntries, navActiveMatchPathFor, type HubGroup } from '../src/app/admin/(workspace)/_components/nav-data';
import { BUNDLES, CAPABILITIES, type Capability } from '../src/lib/capabilities';

/**
 * Home's card grid and the section bar + tabs render from the same SECTIONS data
 * (Plans/Admin-Home-And-Nav.md Waves 2 and 3).
 */

// The hrefs the rail offered at v1.214.0 (before Wave 2), for the regression test — minus Roster
// Import, retired on purpose 2026-10-20 (a one-time Google Sheets import).
const FORMER_RAIL_HREFS = [
  '/admin', '/admin/advancement/fast-entry', '/admin/advancement/meeting-plan', '/admin/advancement/has-needs',
  '/admin/advancement/ledger', '/admin/advancement/roster', '/admin/advancement/records', '/admin/advancement/mb-progress',
  '/admin/advancement/audits', '/admin/advancement/report', '/admin/advancement/court-of-honor',
  '/admin/advancement/scoutbook-export', '/admin/advancement/meetings/report', '/admin/news/articles', '/admin/news/pages',
  '/admin/calendar', '/admin/library', '/admin/library/menu-monster', '/admin/news/media-manager',
  '/admin/news/photo-albums', '/admin/finance', '/admin/finance/reimbursements', '/admin/finance/report',
  '/admin/utilities/ledger-audit', '/admin/finance/wreaths', '/admin/advancement/lookups',
  '/admin/access', '/admin/audit', '/admin/utilities'
];

const ALL = new Set<Capability>(CAPABILITIES);
const ALL_CAPS: Capability[] = [...CAPABILITIES];

function visible(caps: Iterable<Capability>, fullAdmin = false) {
  return visibleNavSections(SECTIONS, { fullAdmin, capabilities: new Set(caps) });
}
function hubHrefs(groups: HubGroup[]) {
  // A plain card answers for its own href; the quiet tools card also for each of its links.
  return [...new Set(groups.flatMap((g) => g.cards.flatMap((c) => [c.href, ...(c.links ?? []).map((l) => l.href)])))];
}
function cardTitles(groups: HubGroup[]) {
  return groups.flatMap((g) => g.cards.map((c) => c.title));
}

describe('AdminHome card grid', () => {
  it('AdminHome_ShowsOnlyCardsTheLeaderCanOpen_WhenGrantedOneCapability', () => {
    const groups = hubGroups(visible(['calendar.write']), { wreathOpen: false });
    expect(cardTitles(groups)).toEqual(['Calendar']);
  });

  it('AdminHome_HidesAGroup_WhenNoneOfItsCardsAreVisible', () => {
    const groups = hubGroups(visible(['calendar.write']), { wreathOpen: false });
    expect(groups.map((g) => g.title)).toEqual(['Calendar & Content']);
  });

  it('AdminHome_ShowsNothing_WhenOnlyHomeIsOffered', () => {
    expect(hubGroups(visible(['library.proxy_view']), { wreathOpen: false })).toEqual([]);
  });

  it('AdminHome_ShowsOneCardPerReport_InItsOwnReportsGroup_NoFolderCard', () => {
    const groups = hubGroups(visible(['advancement.write']), { wreathOpen: false });
    const reports = groups.find((g) => g.title === 'Reports')!;
    expect(reports.cards.map((c) => c.title)).toEqual([
      'Audits', 'Advancement Report', 'Court of Honor', 'Scoutbook Export', 'Attendance Report'
    ]);
    for (const c of reports.cards) {
      expect(c.links, c.title).toBeUndefined();
      expect(c.description, c.title).toBeTruthy();
    }
    expect(groups.find((g) => g.title === 'Advancement')!.cards.map((c) => c.title)).not.toContain('Reports');
  });

  it('AdminHome_HasNoCardForTheReportsLanding_ItsTheSectionBarEntry', () => {
    const groups = hubGroups(visible(ALL, true), { wreathOpen: false });
    expect(hubHrefs(groups)).not.toContain('/admin/reports');
  });

  it('AdminHome_PutsDashboardFirstInAdvancement_ForAnAdvancementWriter', () => {
    const adv = hubGroups(visible(['advancement.write']), { wreathOpen: false }).find((g) => g.title === 'Advancement')!;
    expect(adv.cards[0].title).toBe('Dashboard');
    expect(adv.cards[0].href).toBe('/admin/advancement/dashboard');
    expect(adv.cards[1].title).toBe('Fast Entry');
  });

  it('AdminHome_OffersNoDashboard_ToALeaderWithoutAdvancementWrite', () => {
    expect(cardTitles(hubGroups(visible(['calendar.write']), { wreathOpen: false }))).not.toContain('Dashboard');
  });

  it('AdminHome_MovesActivityReportAndLedgerAuditOutOfMoney_IntoReports', () => {
    const groups = hubGroups(visible(ALL, true), { wreathOpen: false });
    const money = groups.find((g) => g.title === 'Money')!.cards.map((c) => c.title);
    expect(money).not.toContain('Bucket Report');
    expect(money).not.toContain('Ledger Audit');
    const reports = groups.find((g) => g.title === 'Reports')!.cards.map((c) => c.title);
    expect(reports).toEqual([
      'Audits', 'Advancement Report', 'Court of Honor', 'Scoutbook Export', 'Attendance Report', 'Bucket Report', 'Ledger Audit'
    ]);
  });

  it('AdminHome_ShowsAFinanceOnlyLeaderExactlyTheTwoFinanceReports', () => {
    const groups = hubGroups(visible(['finance.manage']), { wreathOpen: false });
    expect(groups.find((g) => g.title === 'Reports')!.cards.map((c) => c.title)).toEqual(['Bucket Report', 'Ledger Audit']);
  });

  it('AdminHome_ShowsAnAdvancementOnlyLeaderTheFiveAdvancementReports', () => {
    const groups = hubGroups(visible(['advancement.write']), { wreathOpen: false });
    expect(groups.find((g) => g.title === 'Reports')!.cards).toHaveLength(5);
  });

  it('AdminHome_PlacesReportsAfterMoneyAndBeforePeople', () => {
    const titles = hubGroups(visible(ALL, true), { wreathOpen: false }).map((g) => g.title);
    expect(titles).toEqual(['Advancement', 'Calendar & Content', 'Meeting Plan', 'Money', 'Reports', 'People & Setup', 'Troop admin tools']);
  });

  it('AdminHome_TintsEveryGroupItsOwnEarthTone_AndLeavesTheToolsRowUntinted', () => {
    const groups = hubGroups(visible(ALL, true), { wreathOpen: false });
    const tints = Object.fromEntries(groups.map((g) => [g.title, g.tint]));
    expect(tints).toEqual({
      Advancement: 'moss',
      'Calendar & Content': 'sky',
      'Meeting Plan': 'moss',
      Money: 'wheat',
      Reports: 'clay',
      'People & Setup': 'stone',
      'Troop admin tools': undefined
    });
  });

  it('AdminHome_CarriesADescriptionOnEveryNonToolsCard', () => {
    const groups = hubGroups(visible(ALL, true), { wreathOpen: true }).filter((g) => !g.quiet);
    for (const c of groups.flatMap((g) => g.cards)) expect(c.description, c.title).toBeTruthy();
  });

  it('AdminHome_ListsTroopAdminToolsLast_AsOneQuietCardOfLinks', () => {
    const groups = hubGroups(visible(ALL, true), { wreathOpen: true });
    const last = groups[groups.length - 1];
    expect(last.title).toBe('Troop admin tools');
    expect(last.quiet).toBe(true);
    expect(last.cards).toHaveLength(1);
    expect(last.cards[0].links?.map((l) => l.label)).toEqual(['Lookups & Admin', 'BSA Roster', 'EmailOctopus Sync', 'Audit Trail', 'Utilities', 'Styleguides']);
  });

  it('AdminHome_OffersStyleguidesToFullAdminsOnly', () => {
    expect(hubHrefs(hubGroups(visible(ALL, true), { wreathOpen: true }))).toContain('/admin/styleguide');
    expect(hubHrefs(hubGroups(visible(['advancement.write', 'roster.manage']), { wreathOpen: true }))).not.toContain('/admin/styleguide');
  });

  it('AdminHome_PutsWreathSaleFirstInMoney_WhenTheSaleIsOpen', () => {
    const money = hubGroups(visible(ALL, true), { wreathOpen: true }).find((g) => g.title === 'Money')!;
    expect(money.cards[0].title).toBe('Wreath Sale');
    expect(money.cards[0].season).toBe('open');
  });

  it('AdminHome_PutsWreathSaleLastAndGreyed_WhenTheSaleIsNotOpen', () => {
    const money = hubGroups(visible(ALL, true), { wreathOpen: false }).find((g) => g.title === 'Money')!;
    expect(money.cards[money.cards.length - 1].title).toBe('Wreath Sale');
    expect(money.cards[money.cards.length - 1].season).toBe('off');
    expect(money.cards[0].title).toBe('Financial Ledger');
  });
});

describe('AdminNav hub and section bar agree', () => {
  const presets: [string, Capability[]][] = [
    ...Object.entries(BUNDLES).map(([k, b]) => [k, [...b.capabilities]] as [string, Capability[]]),
    ['finance_view_only', ['finance.view']],
    ['everything_but_finance', CAPABILITIES.filter((c) => !c.startsWith('finance.'))]
  ];

  for (const fullAdmin of [false, true]) {
    for (const [name, caps] of presets) {
      it(`AdminNav_HubAndSectionBarAgree_ForEveryCapabilitySet [${name}${fullAdmin ? ', fullAdmin' : ''}]`, () => {
        const vis = visible(caps, fullAdmin);
        const expected = vis.flatMap((s) => s.items).filter((i) => !i.everyone).map((i) => i.href!);
        const landings = vis.flatMap((s) => s.items).filter((i) => i.folderLanding).map((i) => i.href!);
        const hub = hubHrefs(hubGroups(vis, { wreathOpen: true }));
        // Every destination appears on the hub exactly once (a folder landing is the bar entry, not a card)...
        expect([...hub].sort()).toEqual(expected.filter((h) => !landings.includes(h)).sort());
        // ...the bar + tabs offer the same set, bar the navHidden ones (reports behind the Reports tab, Styleguides)...
        const nav = navSections(vis).flatMap((s) => s.items).filter((i) => !i.everyone).map((i) => i.href!);
        const hidden = vis.flatMap((s) => s.items).filter((i) => i.navHidden).map((i) => i.href!);
        expect([...nav, ...hidden].sort()).toEqual([...expected].sort());
        // ...and the bar names the same sections the hub groups do (plus Home).
        const barTitles = sectionNav(vis, '/admin').bar.map((b) => b.key).filter((k) => k !== 'Overview');
        expect(barTitles).toEqual(hubGroups(vis, { wreathOpen: true }).map((g) => g.title));
      });
    }
  }

  it('AdminNav_EveryFormerRailLinkIsReachable', () => {
    const vis = visible(ALL, true);
    const navHrefs = navSections(vis).flatMap((s) => s.items).map((i) => i.href);
    const reports = folderEntries(vis, 'Reports').map((e) => e.href);
    const hub = hubHrefs(hubGroups(vis, { wreathOpen: true }));
    for (const href of FORMER_RAIL_HREFS) {
      // On the bar/tabs, or collected on the Reports landing (behind the single Reports tab).
      expect([...navHrefs, ...reports], `bar/tabs or Reports landing: ${href}`).toContain(href);
      if (href !== '/admin') expect(hub, `hub: ${href}`).toContain(href);
    }
    // Styleguides is a Home tools-row link only.
    expect(hub).toContain('/admin/styleguide');
  });

  it('AdminNav_EveryFolderMemberIsNavHidden_SoANewReportNeverBecomesATab', () => {
    for (const i of SECTIONS.flatMap((s) => s.items).filter((i) => i.folder)) expect(i.navHidden, i.label).toBe(true);
  });
});

describe('Section bar and tabs', () => {
  const nav = (caps: Capability[], path: string, fullAdmin = false) => sectionNav(visible(caps, fullAdmin), path);
  const labels = (xs: { label: string }[] | null) => (xs ?? []).map((x) => x.label);

  it('AdminNav_SkipsTheTabStrip_WhenASectionHasOneVisibleItem', () => {
    const n = nav(['calendar.write'], '/admin/calendar');
    expect(labels(n.bar)).toEqual(['Home', 'Calendar & Content']);
    expect(n.tabs).toBeNull();
  });

  it('AdminNav_SkipsTheTabStrip_OnHome', () => {
    expect(nav(ALL_CAPS, '/admin', true).tabs).toBeNull();
  });

  it('AdminNav_ShowsTheSectionsItemsAsTabs_WhenThereIsMoreThanOne', () => {
    const n = nav(['calendar.write', 'news.write'], '/admin/news/pages');
    expect(labels(n.tabs)).toEqual(['Calendar', 'News', 'Pages', 'Media Manager', 'Photo Albums']);
    expect(n.activeKey).toBe('/admin/news/pages');
  });

  it('AdminNav_HidesASection_WithNoVisibleItems', () => {
    const n = nav(['calendar.write'], '/admin/calendar');
    for (const gone of ['Advancement', 'Money', 'People', 'Tools']) expect(labels(n.bar)).not.toContain(gone);
  });

  it('AdminNav_OffersHomeToEveryone_EvenWithOnlyOneUnrelatedCapability', () => {
    expect(labels(nav(['finance.manage'], '/admin').bar)).toEqual(['Home', 'Money', 'Reports']);
  });

  it('AdminNav_LabelsTheBar_LikeThePrototype', () => {
    expect(labels(nav(ALL_CAPS, '/admin', true).bar)).toEqual([
      'Home', 'Advancement', 'Calendar & Content', 'Meeting Plan', 'Money', 'Reports', 'People', 'Tools'
    ]);
  });

  it('AdminNav_LinksEachBarEntry_ToItsFirstTab', () => {
    const n = nav(ALL_CAPS, '/admin', true);
    expect(n.bar.find((b) => b.label === 'Advancement')!.href).toBe('/admin/advancement/dashboard');
    expect(n.bar.find((b) => b.label === 'Reports')!.href).toBe('/admin/reports');
    expect(n.bar.find((b) => b.label === 'Home')!.href).toBe('/admin');
  });

  it('AdminNav_AdvancementTabs_StartWithDashboard_AndCarryNoReports', () => {
    const n = nav(['advancement.write', 'meeting_plan.use'], '/admin/advancement/ledger');
    expect(labels(n.tabs)).toEqual(['Dashboard', 'Fast Entry', 'Ledger', 'Submit & Present', 'MB Progress', 'Has/Needs']);
  });

  it.each([
    '/admin/reports',
    '/admin/advancement/audits',
    '/admin/advancement/report',
    '/admin/advancement/court-of-honor',
    '/admin/advancement/scoutbook-export',
    '/admin/advancement/meetings/report'
  ])('AdminNav_ReportsBarEntryIsActive_OnEveryReportPage %s', (path) => {
    const n = nav(['advancement.write'], path);
    expect(n.activeKey).toBe('/admin/reports');
    expect(n.bar.find((b) => b.active)!.label).toBe('Reports');
    expect(n.tabs).toBeNull();
  });

  it.each(['/admin/utilities/ledger-audit', '/admin/finance/report'])('AdminNav_LightsReportsWithNoTabStrip_On %s', (path) => {
    const n = nav(['finance.manage'], path);
    expect(n.bar.find((b) => b.active)!.label).toBe('Reports');
    expect(n.tabs).toBeNull();
    expect(n.activeKey).toBe('/admin/reports');
  });

  it('AdminNav_KeepsMoneyLit_OnTheFinancialLedger_NotReports', () => {
    const n = nav(['finance.manage'], '/admin/finance');
    expect(n.bar.find((b) => b.active)!.label).toBe('Money');
    expect(labels(n.tabs)).toEqual(['Financial Ledger', 'Reimbursements', 'Wreath Sale']);
  });

  it('AdminNav_LightsAdvancementAndItsDashboardTab_OnTheDashboardUrl', () => {
    const n = nav(['advancement.write'], '/admin/advancement/dashboard');
    expect(n.bar.find((b) => b.active)!.label).toBe('Advancement');
    expect(n.activeKey).toBe('/admin/advancement/dashboard');
  });

  it('AdminNav_LightsHome_OnlyOnSlashAdmin', () => {
    expect(nav(['advancement.write'], '/admin').bar.find((b) => b.active)!.label).toBe('Home');
  });

  it('AdminNav_KeepsStyleguidesOutOfTheBarAndTabs', () => {
    const n = nav(ALL_CAPS, '/admin/advancement/lookups', true);
    expect(labels(n.tabs)).not.toContain('Styleguides');
    expect(labels(n.bar)).not.toContain('Styleguides');
  });

  it('AdminNav_LightsNothing_OnAPageThatIsNotInTheNav', () => {
    const n = nav(['calendar.write'], '/admin/somewhere-else');
    expect(n.bar.some((b) => b.active)).toBe(false);
    expect(n.tabs).toBeNull();
  });
});

describe('Reports landing', () => {
  it('ReportsLanding_ListsEveryReportTheLeaderCanOpen_WithADescriptionEach', () => {
    const entries = folderEntries(visible(['advancement.write']), 'Reports');
    expect(entries.map((e) => e.label)).toEqual([
      'Audits', 'Advancement Report', 'Court of Honor', 'Scoutbook Export', 'Attendance Report'
    ]);
    for (const e of entries) expect(e.description, e.label).toBeTruthy();
  });

  it('ReportsLanding_ListsTheTwoFinanceReports_ForAFinanceOnlyLeader', () => {
    expect(folderEntries(visible(['finance.manage']), 'Reports').map((e) => e.label)).toEqual(['Bucket Report', 'Ledger Audit']);
  });

  it('ReportsLanding_ListsNothing_WhenTheLeaderHoldsNoReportCapability', () => {
    expect(folderEntries(visible(['calendar.write']), 'Reports')).toEqual([]);
  });

  it('ReportsLanding_IsATabOnlyWhileAReportIsOpenToTheLeader', () => {
    const tabs = (caps: Capability[]) => navSections(visible(caps)).flatMap((s) => s.items).map((i) => i.href);
    expect(tabs(['advancement.write'])).toContain('/admin/reports');
    expect(tabs(['calendar.write'])).not.toContain('/admin/reports');
  });

  // Patrick, 2026-10-13 (Wave 3 decision): the five reports live ONLY on the landing, never as tabs.
  it('ReportsLanding_IsTheOnlyReportsTab_TheFiveReportsAreNotTabs', () => {
    const tabs = navSections(visible(['advancement.write'])).flatMap((s) => s.items).map((i) => i.label);
    expect(tabs).toContain('Reports');
    for (const l of ['Audits', 'Advancement Report', 'Court of Honor', 'Scoutbook Export', 'Attendance Report']) {
      expect(tabs).not.toContain(l);
    }
  });

  it('ReportsLanding_ShowsANewNavDataReportAutomatically', () => {
    const extended = SECTIONS.map((s) =>
      s.title !== 'Advancement'
        ? s
        : {
            ...s,
            items: [
              ...s.items,
              {
                label: 'Camping Nights Report',
                href: '/admin/advancement/camping-nights',
                matchPath: '/admin/advancement/camping-nights',
                description: 'Nights camped per scout',
                folder: 'Reports',
                navHidden: true,
                capability: 'advancement.write' as Capability
              }
            ]
          }
    );
    const vis = visibleNavSections(extended, { fullAdmin: false, capabilities: new Set<Capability>(['advancement.write']) });
    expect(folderEntries(vis, 'Reports').map((e) => e.label)).toContain('Camping Nights Report');
    expect(hubHrefs(hubGroups(vis, { wreathOpen: false }))).toContain('/admin/advancement/camping-nights');
    expect(navSections(vis).flatMap((s) => s.items).map((i) => i.label)).not.toContain('Camping Nights Report');
    expect(navActiveMatchPathFor(vis, '/admin/advancement/camping-nights')).toBe('/admin/reports');
  });

  it('ReportsLanding_LightsTheReportsTab_OnTheLanding', () => {
    expect(navActiveMatchPathFor(visible(['advancement.write']), '/admin/reports')).toBe('/admin/reports');
  });

  it.each([
    '/admin/advancement/audits',
    '/admin/advancement/report',
    '/admin/advancement/court-of-honor',
    '/admin/advancement/scoutbook-export',
    '/admin/advancement/meetings/report'
  ])('ReportsLanding_LightsTheReportsTab_On %s', (path) => {
    expect(navActiveMatchPathFor(visible(['advancement.write']), path)).toBe('/admin/reports');
  });

  it('ReportsLanding_LeavesOtherTabsAlone_OnTheirOwnPages', () => {
    expect(navActiveMatchPathFor(visible(['advancement.write']), '/admin/advancement/ledger')).toBe('/admin/advancement/ledger');
  });
});
