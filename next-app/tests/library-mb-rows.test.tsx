import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MbRequirementsTree } from '../src/app/(public)/library/mb/[mbId]/mb-requirements-tree';
import { buildReqTree } from '../src/lib/mb-helpers';
import type { PlacedResource } from '../src/lib/library-data';
import type { LibraryViewer } from '../src/lib/library-viewer';
import type { MeritBadgeRequirement } from '../src/lib/supabase/types';
import { fmtDate } from '../src/lib/format-date';
import { centralToday } from '../src/lib/dates';

/**
 * The ONE consolidated Requirements section on /library/mb/[mbId]
 * (Plans/Library-MB-Consolidation.md, prototype rev 4 approved 2026-09-07).
 * A row at rest is code · label · a dated Done/Pending pill for the selected
 * scout · up to three icon-only actions at the right edge, in this order:
 * View resources (only where the requirement has any) · I did this (only
 * while the selected scout still needs it, never for a visitor) · Suggest a
 * resource (always). Resources and the counselor note are hidden until the
 * row is opened by its text or its View-resources icon — a button + `hidden`
 * accordion, never <details> (D-070 shipped blank content twice).
 */

const MB = 'chem';

const ROWS: MeritBadgeRequirement[] = [
  { id: 1, mb_id: MB, parent_id: null, code: '4', label: 'Chemistry and camping', complete_rule: 'all', complete_n: null, sort_order: 1 },
  { id: 2, mb_id: MB, parent_id: 1, code: '4a', label: 'Compare two waterproofing methods', complete_rule: 'all', complete_n: null, sort_order: 1 },
  { id: 3, mb_id: MB, parent_id: 1, code: '4b', label: 'Describe the four classes of fires', complete_rule: 'all', complete_n: null, sort_order: 2 },
  { id: 4, mb_id: MB, parent_id: 1, code: '4c', label: 'Conduct flame tests of five elements', complete_rule: 'all', complete_n: null, sort_order: 3 },
  { id: 5, mb_id: MB, parent_id: null, code: '6', label: 'Identify five fields of chemistry', complete_rule: 'all', complete_n: null, sort_order: 2 }
];

let nextId = 100;
function res(title: string, opts: { pinned?: boolean; url?: string; key?: string } = {}): PlacedResource {
  const id = nextId++;
  return {
    id,
    title,
    blurb: null,
    kind: 'link',
    url: opts.url ?? `https://example.org/${id}`,
    body_md: null,
    thumbnail_url: null,
    host: 'example.org',
    visibility: 'public',
    status: 'published',
    submitted_by_label: null,
    submitted_person_id: null,
    submitter_note: null,
    attribution_label: null,
    reviewed_by: null,
    reviewed_at: null,
    decline_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    placement: {
      id,
      pinned: opts.pinned ?? false,
      sort_order: 0,
      target_kind: 'mb_req',
      target_key: opts.key ?? `${MB}-4a`
    }
  };
}

const FAMILY: LibraryViewer = {
  kind: 'scout',
  scoutId: 's-ari',
  scoutName: 'Ari D.',
  switchOptions: [],
  isProxy: false
};

function renderTree(opts: {
  viewer?: LibraryViewer;
  canClaim?: boolean;
  doneDates?: Map<string, string>;
  pendingByLeaf?: Map<string, Set<string>>;
  byLeafCode?: Map<string, PlacedResource[]>;
  wholeBadge?: PlacedResource[];
} = {}) {
  const byLeafCode = opts.byLeafCode ?? new Map([['4a', [res('Waterproofing guide')]]]);
  return render(
    <MbRequirementsTree
      mbId={MB}
      nodes={buildReqTree(ROWS)}
      viewer={opts.viewer}
      canClaim={opts.canClaim ?? false}
      resources={{ wholeBadge: opts.wholeBadge ?? [], byLeafCode }}
      notes={new Map()}
      doneDates={opts.doneDates}
      pendingByLeaf={opts.pendingByLeaf}
    />
  );
}

describe('Library MB consolidated requirement rows', () => {
  it('Visitor_SeesViewResourcesIcon_OnlyWhereResourcesExist', () => {
    renderTree();
    expect(screen.getByRole('button', { name: 'View resources — 4a (1)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /View resources — 4b/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /View resources — 6/ })).toBeNull();
  });

  it('Visitor_NeverSeesIDidThis', () => {
    renderTree({ viewer: undefined, canClaim: false });
    expect(screen.queryByRole('link', { name: /I did this/ })).toBeNull();
  });

  it('Family_SeesIDidThis_OnlyWhereSelectedScoutNotDone', () => {
    renderTree({
      viewer: FAMILY,
      canClaim: true,
      doneDates: new Map([['4a', '2026-04-19']]),
      pendingByLeaf: new Map([['4b', new Set(['s-ari'])]])
    });
    // 4a is done and 4b is pending for Ari → no claim on either; 4c and 6 still need it.
    expect(screen.queryByRole('link', { name: 'I did this — 4a' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'I did this — 4b' })).toBeNull();
    const claim = screen.getByRole('link', { name: 'I did this — 4c' });
    expect(claim.getAttribute('href')).toBe(
      `/library/submit-proof?target=${encodeURIComponent('mb_req:chem-4c')}&scout=s-ari`
    );
    expect(screen.getByRole('link', { name: 'I did this — 6' })).toBeTruthy();
    // A parent row has no ledger row of its own — never a claim.
    expect(screen.queryByRole('link', { name: 'I did this — 4' })).toBeNull();
  });

  it('Family_SeesDonePillWithDate_ForSelectedScout', () => {
    const thisYear = centralToday().slice(0, 4);
    const recent = `${thisYear}-04-19`;
    const old = '2024-11-02';
    renderTree({
      viewer: FAMILY,
      canClaim: true,
      doneDates: new Map([
        ['4a', recent],
        ['4b', old]
      ]),
      pendingByLeaf: new Map([['4c', new Set(['s-ari'])]])
    });
    // This year: no year on the pill. An earlier year: the year is shown.
    expect(screen.getByText(`Done · ${fmtDate(recent, { year: false })}`)).toBeTruthy();
    expect(screen.getByText(`Done · ${fmtDate(old)}`)).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    // 6 is neither done nor pending → no pill at all on that row.
    const row6 = screen.getByText('Identify five fields of chemistry').closest('[data-req]')!;
    expect(within(row6 as HTMLElement).queryByText(/Done|Pending/)).toBeNull();
  });

  it('Anyone_ClicksRequirementText_RevealsResources_AndAriaExpanded', async () => {
    const user = userEvent.setup();
    renderTree();
    const label = screen.getByRole('button', { name: 'Compare two waterproofing methods' });
    expect(label.getAttribute('aria-expanded')).toBe('false');
    // Hidden at rest — the link is not in the accessibility tree.
    expect(screen.queryByRole('link', { name: /Waterproofing guide/ })).toBeNull();
    await user.click(label);
    expect(label.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(label.getAttribute('aria-controls')!)!;
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(screen.getByRole('link', { name: /Waterproofing guide/ })).toBeTruthy();
    // Click again → closed.
    await user.click(label);
    expect(label.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hasAttribute('hidden')).toBe(true);
  });

  it('Anyone_ExpandAllCollapseAll_TogglesEveryRow', async () => {
    const user = userEvent.setup();
    renderTree({
      byLeafCode: new Map([
        ['4a', [res('Waterproofing guide')]],
        ['6', [res('Fields of chemistry', { key: `${MB}-6` })]]
      ])
    });
    expect(screen.queryByRole('link', { name: /Waterproofing guide/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Fields of chemistry/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByRole('link', { name: /Waterproofing guide/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Fields of chemistry/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByRole('link', { name: /Waterproofing guide/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Fields of chemistry/ })).toBeNull();
    // Collapse all also folds the group's children away.
    expect(screen.queryByRole('button', { name: 'Compare two waterproofing methods' })).toBeNull();
  });

  it('Anyone_SeesSuggestIcon_OnEveryRow_WithCodeInAccessibleName', () => {
    renderTree();
    for (const code of ['4', '4a', '4b', '4c', '6']) {
      const link = screen.getByRole('link', { name: `Suggest a resource — ${code}` });
      expect(link.getAttribute('href')).toBe(
        `/library/submit?target=${encodeURIComponent(`mb_req:chem-${code}`)}`
      );
    }
    const whole = screen.getByRole('link', { name: 'Suggest a resource — whole badge' });
    expect(whole.getAttribute('href')).toBe(`/library/submit?target=${encodeURIComponent('mb:chem')}`);
  });

  it('Anyone_SeesWholeBadgeGroup_AtTopOfList', () => {
    renderTree({
      wholeBadge: [res('Troop-annotated workbook', { key: MB, pinned: true }), res('Counselor tips', { key: MB })]
    });
    const rows = document.querySelectorAll('[data-req]');
    expect(rows[0].getAttribute('data-req')).toBe('mb');
    expect(within(rows[0] as HTMLElement).getByText('For the whole badge')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View resources — whole badge (2)' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /I did this — whole badge/ })).toBeNull();
  });

  it('Legend_DropsIDidThis_ForVisitor', () => {
    const { unmount } = renderTree({ viewer: undefined, canClaim: false });
    expect(screen.getByText(/View resources/, { selector: 'p *' })).toBeTruthy();
    expect(screen.queryByText(/I did this/)).toBeNull();
    unmount();
    renderTree({ viewer: FAMILY, canClaim: true });
    expect(screen.getByText(/I did this · /)).toBeTruthy();
  });
});
