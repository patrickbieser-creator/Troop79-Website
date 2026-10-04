import { describe, it, expect, afterEach, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  decidePriceWith,
  listHeldWith,
  listRecentChangesWith,
  leaderSetPriceWith,
  reportPriceWith
} from '../src/lib/menu-monster/price-history';
import type { AuditEntry } from '../src/lib/audit';

/**
 * lib/menu-monster/price-history.ts against the local database. The audit
 * recorder is a spy, so no audit_log rows are written. Charlie Walters
 * (person 39) is the test reporter; Patrick's own person row is not needed —
 * the same person stands in as the leader.
 */
const SCOUT = 39;
const PKG_ID = 'vitest-store-package';
const PKG_NAME = 'vitest store package';
const admin = adminClient();

async function makePackage(overrides: Record<string, unknown> = {}) {
  const { data: ing } = await admin.from('mm_ingredients').select('id').is('retired_at', null).limit(1).single();
  const { error } = await admin
    .from('mm_packages')
    .insert({ id: PKG_ID, ingredient_id: ing!.id, name: PKG_NAME, price: 4, yield: 10, as_of: '2026-01-01', ...overrides });
  if (error) throw new Error(`fixture: ${error.message}`);
}

afterEach(async () => {
  await admin.from('mm_price_history').delete().eq('package_id', PKG_ID);
  await admin.from('mm_packages').delete().eq('id', PKG_ID);
});

const spy = () => vi.fn<(e: AuditEntry) => Promise<void>>(async () => {});

describe('reportPriceWith', () => {
  it('Scout_AuditsAnAppliedReport_NamingPeopleAndPackageButNoPrice', async () => {
    await makePackage();
    const record = spy();
    expect(await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 5, reportedBy: SCOUT }, record)).toBe('applied');
    const entry = record.mock.calls[0][0];
    expect(entry).toMatchObject({ area: 'library', action: 'price_report', entityType: 'mm_package', entityId: PKG_ID, subjects: [SCOUT] });
    expect(entry.summary).toContain(PKG_NAME);
    expect(entry.summary).toMatch(/Charlie W\./);
    expect(entry.summary).not.toMatch(/\$/);
    expect(entry.details).toEqual([{ field: 'Price', from: '$4.00', to: '$5.00' }]);
  });

  it('Scout_AuditsAHeldReport_AsHeld', async () => {
    await makePackage();
    const record = spy();
    expect(await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 9, reportedBy: SCOUT }, record)).toBe('held');
    expect(record.mock.calls[0][0]).toMatchObject({ action: 'price_hold' });
  });

  it('Scout_WritesNoAudit_WhenThePriceIsUnchanged', async () => {
    await makePackage();
    const record = spy();
    expect(await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 4, reportedBy: SCOUT }, record)).toBe('same');
    expect(record).not.toHaveBeenCalled();
  });
});

describe('listHeldWith', () => {
  it('Leader_SeesAHeldPrice_WithReporterCurrentProposedAndUnitChange', async () => {
    await makePackage();
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 9, reportedBy: SCOUT }, spy());
    const held = (await listHeldWith(admin)).find((h) => h.packageId === PKG_ID);
    expect(held).toMatchObject({ packageName: PKG_NAME, reporter: 'Charlie W.', currentPrice: 4, proposedPrice: 9, menuName: null });
    expect(held!.unitChangePct).toBeCloseTo(1.25, 5);
  });

  it('Leader_SeesNoUnitChange_WhenThePackageHasNoYield', async () => {
    await makePackage({ yield: null });
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 4.5, reportedBy: SCOUT }, spy());
    const held = (await listHeldWith(admin)).find((h) => h.packageId === PKG_ID);
    expect(held!.unitChangePct).toBeNull();
  });

  it('Leader_NoLongerSeesARow_OnceItIsDecided', async () => {
    await makePackage();
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 9, reportedBy: SCOUT }, spy());
    const held = (await listHeldWith(admin)).find((h) => h.packageId === PKG_ID)!;
    await decidePriceWith(admin, { historyId: held.id, decision: 'dismiss', decidedBy: SCOUT }, spy());
    expect((await listHeldWith(admin)).some((h) => h.packageId === PKG_ID)).toBe(false);
  });
});

describe('decidePriceWith', () => {
  it('Leader_AuditsAnApply_WithPriceChangeInDetails', async () => {
    await makePackage();
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 9, reportedBy: SCOUT }, spy());
    const held = (await listHeldWith(admin)).find((h) => h.packageId === PKG_ID)!;
    const record = spy();
    expect(await decidePriceWith(admin, { historyId: held.id, decision: 'apply', decidedBy: SCOUT }, record)).toBe('applied');
    const entry = record.mock.calls[0][0];
    expect(entry).toMatchObject({ area: 'library', action: 'price_apply', entityId: PKG_ID });
    expect(entry.summary).not.toMatch(/\$/);
    expect(entry.details).toEqual([{ field: 'Price', from: '$4.00', to: '$9.00' }]);
  });

  it('Leader_AuditsADismiss', async () => {
    await makePackage();
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 9, reportedBy: SCOUT }, spy());
    const held = (await listHeldWith(admin)).find((h) => h.packageId === PKG_ID)!;
    const record = spy();
    expect(await decidePriceWith(admin, { historyId: held.id, decision: 'dismiss', decidedBy: SCOUT }, record)).toBe('dismissed');
    expect(record.mock.calls[0][0]).toMatchObject({ action: 'price_dismiss' });
  });

  it('Leader_WritesNoAudit_WhenARevertIsSuperseded', async () => {
    await makePackage();
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 4.5, reportedBy: SCOUT }, spy());
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 5, reportedBy: SCOUT }, spy());
    const changes = (await listRecentChangesWith(admin)).filter((c) => c.packageId === PKG_ID);
    const older = changes.find((c) => c.newPrice === 4.5)!;
    const record = spy();
    expect(await decidePriceWith(admin, { historyId: older.id, decision: 'revert', decidedBy: SCOUT }, record)).toBe('superseded');
    expect(record).not.toHaveBeenCalled();
  });
});

describe('listRecentChangesWith', () => {
  it('Leader_SeesChangesNewestFirst_OnlyTheLatestRevertable', async () => {
    await makePackage();
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 4.5, reportedBy: SCOUT }, spy());
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 5, reportedBy: SCOUT }, spy());
    const changes = (await listRecentChangesWith(admin)).filter((c) => c.packageId === PKG_ID);
    expect(changes.map((c) => c.newPrice)).toEqual([5, 4.5]);
    expect(changes.map((c) => c.canRevert)).toEqual([true, false]);
    expect(changes[0]).toMatchObject({ reporter: 'Charlie W.', packageName: PKG_NAME, oldPrice: 4.5 });
  });

  it('Leader_DoesNotSeeHeldRows_InRecentChanges', async () => {
    await makePackage();
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 9, reportedBy: SCOUT }, spy());
    expect((await listRecentChangesWith(admin)).some((c) => c.packageId === PKG_ID)).toBe(false);
  });

  it('Leader_GetsAtMostTheLimit', async () => {
    await makePackage();
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 4.5, reportedBy: SCOUT }, spy());
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 5, reportedBy: SCOUT }, spy());
    expect(await listRecentChangesWith(admin, 1)).toHaveLength(1);
  });
});

describe('leaderSetPriceWith', () => {
  it('Leader_EditRecordsAnAppliedRow_WithLeaderAsReporterAndDecider', async () => {
    await makePackage();
    expect(await leaderSetPriceWith(admin, { packageId: PKG_ID, newPrice: 4.75, asOf: '2026-02-02', leaderId: SCOUT })).toBe('applied');
    const { data } = await admin.from('mm_price_history').select('*').eq('package_id', PKG_ID);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ status: 'applied', old_price: 4, new_price: 4.75, old_as_of: '2026-01-01', reported_by_person_id: SCOUT, decided_by_person_id: SCOUT });
    expect(data![0].decided_at).not.toBeNull();
  });

  it('Leader_EditRecordsNothing_WhenThePriceIsUnchanged', async () => {
    await makePackage();
    expect(await leaderSetPriceWith(admin, { packageId: PKG_ID, newPrice: 4, asOf: null, leaderId: SCOUT })).toBe('same');
    const { data } = await admin.from('mm_price_history').select('id').eq('package_id', PKG_ID);
    expect(data).toHaveLength(0);
  });
});
