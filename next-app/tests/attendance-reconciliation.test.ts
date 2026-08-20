import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { run, type ReconciliationFinding } from '../src/app/admin/(workspace)/advancement/audits/checks/attendance-reconciliation';

/**
 * The reconciliation audit itself is read-only, but its findings now carry
 * the ids a resolve action needs (personId, ledgerEntryId, both quantities) —
 * added 2026-08-20 so the Audits page can offer real fixes instead of just
 * pointing at Roll Call. Wrong ids here mean a resolve button writes to the
 * wrong row, so this pins each kind's payload, not just that it fires.
 */

const admin = adminClient();
const FIXTURE = `ZZVITEST Recon ${process.pid}`;
const SCOUT_ID = `zzvit-recon-${process.pid}`;

let categoryLabel = '';
let scoutPersonId = 0;

beforeAll(async () => {
  categoryLabel = FIXTURE;
  await admin.from('calendar_categories').insert({
    label: categoryLabel,
    color: '#443322',
    sort_order: 9992,
    template: 'activity',
    credit_kind: 'camping_nights',
    credit_unit: 'nights',
    counts_as_activity: true
  });

  const { data: sp } = await admin
    .from('people')
    .insert({ display_name: `${FIXTURE} Scout` })
    .select('id')
    .single();
  scoutPersonId = sp!.id as number;
  await admin.from('scouts').insert({
    id: SCOUT_ID,
    first_name: 'ZZVitest',
    last_name: 'Recon',
    display_name: `${FIXTURE} Scout`,
    active: true,
    person_id: scoutPersonId
  });
});

afterAll(async () => {
  await admin.from('ledger_entries').delete().eq('scout_id', SCOUT_ID);
  await admin.from('scouts').delete().eq('id', SCOUT_ID);
  await admin.from('people').delete().eq('id', scoutPersonId);
  await admin.from('calendar_categories').delete().eq('label', categoryLabel);
});

let entryId = 0;

afterEach(async () => {
  if (!entryId) return;
  await admin.from('event_attendance').delete().eq('calendar_entry_id', entryId);
  await admin.from('ledger_entries').delete().eq('calendar_entry_id', entryId);
  await admin.from('calendar_entries').delete().eq('id', entryId);
  entryId = 0;
});

async function makeEntry(date: string, title: string) {
  const { data } = await admin
    .from('calendar_entries')
    .insert({ entry_date: date, category: categoryLabel, title })
    .select('id')
    .single();
  return data!.id as number;
}

function find(findings: ReconciliationFinding[], kind: ReconciliationFinding['kind']) {
  return findings.find((f) => f.entryId === entryId && f.kind === kind);
}

describe('attendance-reconciliation run()', () => {
  it('CreditMissing_CarriesPersonIdAndRollCallQty_ForWritingTheCredit', async () => {
    entryId = await makeEntry('2027-12-13', `${FIXTURE} missing`);
    await admin.from('event_attendance').insert({ calendar_entry_id: entryId, person_id: scoutPersonId, qty: 2 });

    const findings = await run(admin);
    const f = find(findings, 'credit_missing');
    expect(f).toBeDefined();
    expect(f!.personId).toBe(scoutPersonId);
    expect(f!.rollCallQty).toBe(2);
    expect(f!.ledgerEntryId).toBeUndefined();
    expect(f!.creditKind).toBe('camping_nights');
  });

  it('CreditOrphaned_CarriesTheLedgerRowId_ForRetiringOrMatchingIt', async () => {
    entryId = await makeEntry('2027-12-14', `${FIXTURE} orphaned`);
    const { data: led } = await admin
      .from('ledger_entries')
      .insert({
        scout_id: SCOUT_ID,
        date: '2027-12-14',
        kind: 'camping_nights',
        code: `EVT:${entryId}`,
        qty: 3,
        unit: 'nights',
        calendar_entry_id: entryId
      })
      .select('id')
      .single();

    const findings = await run(admin);
    const f = find(findings, 'credit_orphaned');
    expect(f).toBeDefined();
    expect(f!.personId).toBe(scoutPersonId);
    expect(f!.ledgerEntryId).toBe(led!.id);
    expect(f!.ledgerQty).toBe(3);
  });

  it('QtyMismatch_CarriesBothQuantitiesAndTheLedgerRowId', async () => {
    entryId = await makeEntry('2027-12-15', `${FIXTURE} qty`);
    await admin.from('event_attendance').insert({ calendar_entry_id: entryId, person_id: scoutPersonId, qty: 2 });
    const { data: led } = await admin
      .from('ledger_entries')
      .insert({
        scout_id: SCOUT_ID,
        date: '2027-12-15',
        kind: 'camping_nights',
        code: `EVT:${entryId}`,
        qty: 3,
        unit: 'nights',
        calendar_entry_id: entryId
      })
      .select('id')
      .single();

    const findings = await run(admin);
    const f = find(findings, 'qty_mismatch');
    expect(f).toBeDefined();
    expect(f!.ledgerEntryId).toBe(led!.id);
    expect(f!.rollCallQty).toBe(2);
    expect(f!.ledgerQty).toBe(3);
  });

  it('DateDrift_CarriesTheLedgerRowId_ForAligningItToTheEntrysDate', async () => {
    entryId = await makeEntry('2027-12-16', `${FIXTURE} drift`);
    await admin.from('event_attendance').insert({ calendar_entry_id: entryId, person_id: scoutPersonId, qty: 1 });
    const { data: led } = await admin
      .from('ledger_entries')
      .insert({
        scout_id: SCOUT_ID,
        date: '2027-12-10', // entry moved; credit did not follow
        kind: 'camping_nights',
        code: `EVT:${entryId}`,
        qty: 1,
        unit: 'nights',
        calendar_entry_id: entryId
      })
      .select('id')
      .single();

    const findings = await run(admin);
    const f = find(findings, 'date_drift');
    expect(f).toBeDefined();
    expect(f!.ledgerEntryId).toBe(led!.id);
  });
});
