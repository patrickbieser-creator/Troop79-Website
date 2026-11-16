import { describe, it, expect } from 'vitest';
import { FEATURES, visibleFeatures } from '../src/app/admin/(workspace)/_components/feature-registry';
import { azEntries, azGroups } from '../src/app/admin/(workspace)/everything/az';
import { CAPABILITIES, type Capability } from '../src/lib/capabilities';

/** Everything A–Z (Plans/Admin-Portal-Nav.md decision 9). */

const ALL = visibleFeatures(FEATURES, { fullAdmin: true, capabilities: new Set<Capability>(CAPABILITIES), healthViewer: true, plannerView: true });

describe('Everything A–Z', () => {
  it('AZ_ListsAllVisible_Alphabetical', () => {
    const labels = azEntries(ALL).map((e) => e.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  });

  it('AZ_ListsEveryVisibleItemButHome', () => {
    expect(azEntries(ALL).length).toBe(ALL.length - 1);
  });

  it('AZ_OmitsRetiredDashboard', () => {
    expect(azEntries(ALL).some((e) => e.key === 'advancement.dashboard')).toBe(false);
  });

  it('AZ_EntriesCarryNoTags', () => {
    // Plain names only: no group or type words added to the label.
    expect(azEntries(ALL).every((e) => FEATURES.find((f) => f.key === e.key)?.label === e.label)).toBe(true);
  });

  it('AZ_OnlyWhatThePersonCanOpen', () => {
    const cal = visibleFeatures(FEATURES, { fullAdmin: false, capabilities: new Set<Capability>(['calendar.write']) });
    expect(azEntries(cal).every((e) => e.key.startsWith('content.'))).toBe(true);
  });

  it('AZ_TypeFilter_KeepsOnlyThatKind', () => {
    const groups = azGroups(azEntries(ALL), { kind: 'report', q: '' });
    expect(groups.flatMap((g) => g.entries).every((e) => e.kind === 'report')).toBe(true);
  });

  it('AZ_TextFilter_MatchesNameOrAlias', () => {
    const hits = azGroups(azEntries(ALL), { kind: null, q: 'recon' }).flatMap((g) => g.entries.map((e) => e.key));
    expect(hits).toEqual(expect.arrayContaining(['money.reconcile', 'money.wreath-reconciliation']));
  });

  it('AZ_GroupsByFirstLetter', () => {
    const groups = azGroups(azEntries(ALL), { kind: null, q: '' });
    expect(groups.every((g) => g.entries.every((e) => e.label.charAt(0).toUpperCase() === g.letter))).toBe(true);
  });
});
