import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { boardName } from '../src/lib/meeting-board-shared';

/**
 * Every edit of a ledger row is audited (Patrick, 2026-10-22): the ledger page's edit, bulk edit, archive, delete and
 * restore, Fast Entry's undo, and the Audits fixes each write one audit_log row per ledger row, as the acting leader,
 * with before → after for the fields that changed. Real local database; test-owned rows only (audit rows by our
 * ledger ids).
 */
const sb = adminClient();
const ACTOR = { personId: null as number | null, label: `${TEST_PREFIX} LGA Leader` };
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => ({ label: 'LGA', personId: null }) }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => ACTOR, adminActorLabel: async () => 'LGA' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const ledger = () => import('../src/app/admin/(workspace)/advancement/ledger/actions');
const fast = () => import('../src/app/admin/(workspace)/advancement/fast-entry/actions');
const audits = () => import('../src/app/admin/(workspace)/advancement/audits/actions');

let personId = 0;
let scoutId = '';
let scoutName = '';
const ledgerIds: number[] = [];

async function row(over: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await sb
    .from('ledger_entries')
    .insert({ scout_id: scoutId, date: '2026-08-18', kind: 'rank_requirement', code: 'second-class-BoR', label: 'Board of Review - Second Class', by: 'PB', qty: 1, unit: 'complete', entered_by: 'vitest', ...over })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  ledgerIds.push(data!.id);
  return data!.id as number;
}
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const editForm = (id: number, o: Record<string, string> = {}) =>
  form({ id: String(id), date: '2026-08-18', scout_id: scoutId, kind: 'rank_requirement', code: 'second-class-BoR', label: 'Board of Review - Second Class', by: 'PB', qty: '1', unit: 'complete', notes: '', ...o });
type Logged = { actor_label: string; actor_person_id: number | null; area: string; action: string; summary: string; details: unknown };
const logged = async (id: number): Promise<Logged[]> =>
  ((await sb.from('audit_log').select('actor_label, actor_person_id, area, action, summary, details').eq('entity_type', 'ledger_entry').eq('entity_id', String(id)).order('id')).data ?? []) as Logged[];

beforeAll(async () => {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} LGA Anjali`, first_name: `${TEST_PREFIX} LGA`, last_name: 'Anjali' }).select('id, display_name').single();
  if (error) throw new Error(error.message);
  personId = data!.id as number;
  scoutName = boardName(data!.display_name as string);
  scoutId = `vitest-lga-${personId}`;
  const s = await sb.from('scouts').insert({ id: scoutId, first_name: `${TEST_PREFIX} LGA`, last_name: 'Anjali', display_name: `${TEST_PREFIX} LGA Anjali`, person_id: personId, active: true });
  if (s.error) throw new Error(s.error.message);
});

afterEach(async () => {
  if (ledgerIds.length) await sb.from('audit_log').delete().eq('entity_type', 'ledger_entry').in('entity_id', ledgerIds.map(String));
});

afterAll(async () => {
  if (ledgerIds.length) await sb.from('ledger_entries').delete().in('id', ledgerIds);
  await sb.from('scouts').delete().eq('id', scoutId);
  await sb.from('people').delete().eq('id', personId);
});

describe('ledger edits are audited', () => {
  it('LedgerEdit_Summary_NamesScoutThingAndChange', async () => {
    const id = await row();
    await (await ledger()).updateLedgerEntry(editForm(id, { date: '2025-10-05' }));
    expect((await logged(id)).map((r) => r.summary)).toEqual([`Changed ${scoutName} Second Class BoR: date Aug 18, 2026 → Oct 5, 2025`]);
  });

  it('LedgerEdit_Details_HoldBeforeAndAfter', async () => {
    const id = await row();
    await (await ledger()).updateLedgerEntry(editForm(id, { date: '2025-10-05', by: 'MB' }));
    expect((await logged(id))[0]?.details).toEqual({
      changes: [
        { field: 'date', from: 'Aug 18, 2026', to: 'Oct 5, 2025' },
        { field: 'by', from: 'PB', to: 'MB' }
      ],
      people: [personId]
    });
  });

  it('LedgerEdit_RecordsTheActingLeader', async () => {
    const id = await row();
    await (await ledger()).updateLedgerEntry(editForm(id, { qty: '2' }));
    const [r] = await logged(id);
    expect([r?.actor_label, r?.area, r?.action]).toEqual([ACTOR.label, 'advancement', 'update']);
  });

  it('LedgerEdit_NothingChanged_WritesNoAuditRow', async () => {
    const id = await row();
    await (await ledger()).updateLedgerEntry(editForm(id));
    expect(await logged(id)).toEqual([]);
  });

  it('LedgerBulkEdit_AuditsEachRow', async () => {
    const a = await row();
    const b = await row({ date: '2026-08-19' });
    await (await ledger()).bulkUpdateLedgerEntries(form({ ids: JSON.stringify([a, b]), patch: JSON.stringify({ by: 'MB' }) }));
    expect([(await logged(a)).length, (await logged(b)).length]).toEqual([1, 1]);
  });
});

describe('archive, delete and restore are audited', () => {
  it('LedgerArchive_IsAudited', async () => {
    const id = await row();
    await (await ledger()).archiveLedgerEntry(form({ id: String(id), reason: 'Old' }));
    expect((await logged(id)).map((r) => r.summary)).toEqual([`Archived ${scoutName} Second Class BoR (Old)`]);
  });

  it('LedgerDelete_IsAudited', async () => {
    const id = await row();
    await (await ledger()).softDeleteLedgerEntry(form({ id: String(id), reason: 'Duplicate' }));
    expect((await logged(id)).map((r) => r.action)).toEqual(['delete']);
  });

  it('LedgerRestore_IsAudited', async () => {
    const id = await row({ deleted_at: new Date().toISOString(), deleted_by: 'PB', deleted_reason: 'x' });
    await (await ledger()).restoreLedgerEntry(form({ id: String(id) }));
    expect((await logged(id)).map((r) => r.summary)).toEqual([`Restored ${scoutName} Second Class BoR`]);
  });

  it('LedgerBulkDelete_AuditsEachRow', async () => {
    const a = await row();
    const b = await row({ date: '2026-08-19' });
    await (await ledger()).bulkDeleteLedgerEntries(form({ ids: JSON.stringify([a, b]), reason: 'Wrong scout' }));
    expect([(await logged(a)).length, (await logged(b)).length]).toEqual([1, 1]);
  });

  it('FastEntryUndo_IsAudited', async () => {
    const id = await row();
    await (await fast()).undoCompletion(form({ id: String(id), reason: 'Clicked by mistake' }));
    expect((await logged(id)).map((r) => r.action)).toEqual(['delete']);
  });

  it('AuditsDuplicateFix_IsAudited', async () => {
    const keep = await row();
    const dup = await row();
    await (await audits()).resolveDuplicateLedgerEntries(form({ keep_id: String(keep), scout_id: scoutId, delete_ids: JSON.stringify([dup]) }));
    expect((await logged(dup)).map((r) => r.action)).toEqual(['delete']);
  });
});
