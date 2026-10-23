import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { boardName } from '../src/lib/meeting-board-shared';

/**
 * The ledger audit trail, path by path (qa-lead, L0 review 2026-10-22): audit-coverage.test.ts only proves a file
 * mentions auditLedger*, so each path that changes a ledger row is driven here against the real local database and
 * its audit_log row is read back: the Ledger page's bulk archive and a bulk edit that changes the scout, the Audits
 * fixes (qty mismatch, orphaned credit, date drift), Roll Call's retire and revive, Calendar Merge's supersede and
 * move, and a requirement code rename (one summarised row). A refused audit insert never fails the save.
 * Test-owned rows only: audit rows by our ledger ids / requirement key, fixtures by id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({ refuseAudit: false }));
const ACTOR = { personId: null as number | null, label: `${TEST_PREFIX} LGP Leader` };

/** The admin client, with audit_log inserts refused while state.refuseAudit is on. */
function maybeRefusing(real: SupabaseClient): SupabaseClient {
  return new Proxy(real, {
    get(t, prop, receiver) {
      const v = Reflect.get(t, prop, receiver);
      if (prop === 'from' && typeof v === 'function') {
        return (table: string) =>
          state.refuseAudit && table === 'audit_log' ? { insert: async () => ({ error: { message: 'refused by test' } }) } : (v as (x: string) => unknown).call(t, table);
      }
      return v;
    }
  });
}
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => maybeRefusing(make()) };
});
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => ({ label: 'LGP', personId: null }) }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => ACTOR, adminActorLabel: async () => 'LGP' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const ledger = () => import('../src/app/admin/(workspace)/advancement/ledger/actions');
const audits = () => import('../src/app/admin/(workspace)/advancement/audits/actions');
const lookups = () => import('../src/app/admin/(workspace)/advancement/lookups/actions');
const rollCall = () => import('../src/lib/attendance-admin');
const calendar = () => import('../src/lib/calendar-admin');

const FIXTURE = `${TEST_PREFIX} LGP ${process.pid}`;
const MB = `zzvit-lgp-mb-${process.pid}`;
let personA = 0;
let personB = 0;
let scoutA = '';
let scoutB = '';
let nameA = '';
const ledgerIds: number[] = [];
const entryIds: number[] = [];

async function person(label: string): Promise<{ id: number; scoutId: string; name: string }> {
  const { data, error } = await sb.from('people').insert({ display_name: `${FIXTURE} ${label}`, first_name: FIXTURE, last_name: label }).select('id, display_name').single();
  if (error) throw new Error(error.message);
  const id = data!.id as number;
  const scoutId = `zzvit-lgp-${id}`;
  const s = await sb.from('scouts').insert({ id: scoutId, first_name: FIXTURE, last_name: label, display_name: `${FIXTURE} ${label}`, person_id: id, active: true });
  if (s.error) throw new Error(s.error.message);
  return { id, scoutId, name: boardName(data!.display_name as string) };
}

async function row(over: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await sb
    .from('ledger_entries')
    .insert({ scout_id: scoutA, date: '2026-08-18', kind: 'rank_requirement', code: 'second-class-BoR', label: 'Board of Review - Second Class', by: 'PB', qty: 1, unit: 'complete', entered_by: 'vitest', ...over })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  ledgerIds.push(data!.id);
  return data!.id as number;
}

async function entry(date: string, title = `${FIXTURE} campout`): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: FIXTURE, title }).select('id').single();
  if (error) throw new Error(error.message);
  entryIds.push(data!.id);
  return data!.id as number;
}

/** A camping credit for scout A on an entry, as Roll Call writes it. */
async function credit(entryId: number, date: string, over: Record<string, unknown> = {}): Promise<number> {
  return row({ kind: 'camping_nights', code: `CAMP:${entryId}`, label: `${FIXTURE} campout`, date, qty: 2, unit: 'nights', calendar_entry_id: entryId, by: null, ...over });
}

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
type Logged = { action: string; summary: string; details: unknown };
const logged = async (id: number): Promise<Logged[]> =>
  ((await sb.from('audit_log').select('action, summary, details').eq('entity_type', 'ledger_entry').eq('entity_id', String(id)).order('id')).data ?? []) as Logged[];
const fresh = async (id: number) => (await sb.from('ledger_entries').select('qty, date, deleted_at, archived_at').eq('id', id).single()).data as { qty: number; date: string; deleted_at: string | null; archived_at: string | null };

beforeAll(async () => {
  const c = await sb.from('calendar_categories').insert({ label: FIXTURE, color: '#556677', sort_order: 9996, template: 'activity', credit_kind: 'camping_nights', credit_unit: 'nights', counts_as_activity: true });
  if (c.error) throw new Error(c.error.message);
  const a = await person('Anjali');
  const b = await person('Finn');
  [personA, scoutA, nameA] = [a.id, a.scoutId, a.name];
  [personB, scoutB] = [b.id, b.scoutId];
  const mb = await sb.from('merit_badges').insert({ id: MB, name: `${FIXTURE} Badge`, eagle: false });
  if (mb.error) throw new Error(mb.error.message);
  const r = await sb.from('merit_badge_requirements').insert({ mb_id: MB, code: '1', label: 'Req 1', sort_order: 0 });
  if (r.error) throw new Error(r.error.message);
});

afterEach(async () => {
  state.refuseAudit = false;
  if (ledgerIds.length) await sb.from('audit_log').delete().eq('entity_type', 'ledger_entry').in('entity_id', ledgerIds.map(String));
  await sb.from('audit_log').delete().eq('entity_type', 'requirement').like('entity_id', `${MB}%`);
});

afterAll(async () => {
  await sb.from('ledger_entries').delete().in('scout_id', [scoutA, scoutB]);
  await sb.from('event_attendance').delete().in('calendar_entry_id', entryIds);
  await sb.from('calendar_entries').delete().in('id', entryIds);
  await sb.from('calendar_categories').delete().eq('label', FIXTURE);
  await sb.from('merit_badge_requirements').delete().eq('mb_id', MB);
  await sb.from('merit_badges').delete().eq('id', MB);
  await sb.from('scouts').delete().in('id', [scoutA, scoutB]);
  await sb.from('people').delete().in('id', [personA, personB]);
});

describe('the Ledger page', () => {
  it('LedgerBulkArchive_AuditsEachRow', async () => {
    const a = await row();
    const b = await row({ date: '2026-08-19' });
    await (await ledger()).bulkArchiveLedgerEntries(form({ ids: JSON.stringify([a, b]), reason: 'Old' }));
    expect([...(await logged(a)), ...(await logged(b))].map((r) => r.action)).toEqual(['archive', 'archive']);
  });

  it('LedgerBulkEdit_ScoutChange_NamesBothScouts', async () => {
    const id = await row();
    await (await ledger()).bulkUpdateLedgerEntries(form({ ids: JSON.stringify([id]), patch: JSON.stringify({ scout_id: scoutB }) }));
    expect((await logged(id))[0]?.summary).toBe(`Changed ${nameA} Second Class BoR: scout ${FIXTURE} Anjali → ${FIXTURE} Finn`);
  });

  it('LedgerEdit_AuditRefused_SaveStillSucceeds', async () => {
    const id = await row();
    state.refuseAudit = true;
    const res = await (await ledger()).bulkUpdateLedgerEntries(form({ ids: JSON.stringify([id]), patch: JSON.stringify({ qty: 3 }) }));
    expect([res.ok, (await fresh(id)).qty]).toEqual([true, 3]);
  });
});

describe('the Audits fixes', () => {
  it('AuditsQtyMismatch_UseRollCall_IsAudited', async () => {
    const e = await entry('2094-05-02');
    const id = await credit(e, '2094-05-02');
    await (await audits()).resolveQtyMismatch(form({ use: 'roll_call', ledger_entry_id: String(id), calendar_entry_id: String(e), person_id: String(personA), roll_call_qty: '3', ledger_qty: '2' }));
    expect((await logged(id))[0]?.details).toEqual({ changes: [{ field: 'qty', from: '2', to: '3' }], people: [personA] });
  });

  it('AuditsOrphanedCredit_Retire_IsAudited', async () => {
    const id = await row({ kind: 'camping_nights', code: 'CAMP:orphan', label: `${FIXTURE} lost campout`, qty: 1, unit: 'nights', by: null });
    await (await audits()).retireOrphanedCredit(form({ ledger_entry_id: String(id), scout_id: scoutA }));
    expect((await logged(id)).map((r) => r.action)).toEqual(['delete']);
  });

  it('AuditsDateDrift_IsAudited', async () => {
    const e = await entry('2094-05-09');
    const id = await credit(e, '2094-05-08');
    await (await audits()).resolveDateDrift(form({ ledger_entry_id: String(id), calendar_entry_id: String(e) }));
    expect(((await logged(id))[0]?.details as { changes: { field: string }[] }).changes.map((c) => c.field)).toContain('date');
  });
});

describe('Roll Call', () => {
  const ctx = (id: number, date: string) => ({ id, entryDate: date, title: `${FIXTURE} campout`, creditKind: 'camping_nights' as const, defaultQty: 2 });

  it('RollCallRetire_IsAudited', async () => {
    const e = await entry('2094-05-16');
    const id = await credit(e, '2094-05-16');
    await (await rollCall()).retireCredit(sb, ctx(e, '2094-05-16'), personA, 'LGP');
    expect((await logged(id)).map((r) => r.action)).toEqual(['delete']);
  });

  it('RollCallRetire_SnapshotReadThrows_StillRetires', async () => {
    const e = await entry('2094-05-17');
    const id = await credit(e, '2094-05-17');
    // The audit snapshot's reads throw (a dropped connection); the retire's own update must still run.
    const throwing = new Proxy(sb, {
      get(t, prop, receiver) {
        const v = Reflect.get(t, prop, receiver);
        if (prop !== 'from' || typeof v !== 'function') return v;
        return (table: string) => {
          const q = (v as (x: string) => ReturnType<SupabaseClient['from']>).call(t, table);
          if (table !== 'ledger_entries') return q;
          return new Proxy(q, {
            get(qt, qp, qr) {
              if (qp === 'select') return () => { throw new Error('fetch failed'); };
              const qv = Reflect.get(qt, qp, qr);
              return typeof qv === 'function' ? qv.bind(qt) : qv;
            }
          });
        };
      }
    });
    await (await rollCall()).retireCredit(throwing, ctx(e, '2094-05-17'), personA, 'LGP');
    expect((await fresh(id)).deleted_at).not.toBeNull();
  });

  it('RollCallRevive_IsAudited', async () => {
    const e = await entry('2094-05-23');
    const id = await credit(e, '2094-05-23', { deleted_at: new Date().toISOString(), deleted_by: 'LGP', deleted_reason: 'Removed from Roll Call' });
    await (await rollCall()).syncCredit(sb, ctx(e, '2094-05-23'), personA, 2, 'LGP', scoutA);
    expect((await logged(id)).map((r) => r.action)).toEqual(['restore']);
  });
});

describe('Calendar Merge', () => {
  it('CalendarMerge_SupersededCredit_IsAudited', async () => {
    const keep = await entry('2094-06-06', `${FIXTURE} keep`);
    const lose = await entry('2094-06-06', `${FIXTURE} lose`);
    await credit(keep, '2094-06-06');
    const dup = await credit(lose, '2094-06-06', { code: `CAMP:${lose}` });
    await (await calendar()).executeCalendarEntryMerge(sb, keep, lose, 'LGP');
    expect((await logged(dup)).map((r) => r.action)).toEqual(['delete']);
  });

  it('CalendarMerge_MovedCredit_IsAudited', async () => {
    const keep = await entry('2094-06-13', `${FIXTURE} keep`);
    const lose = await entry('2094-06-12', `${FIXTURE} lose`);
    const moved = await credit(lose, '2094-06-12');
    await (await calendar()).executeCalendarEntryMerge(sb, keep, lose, 'LGP');
    expect((await logged(moved)).map((r) => r.action)).toEqual(['update']);
  });
});

describe('a requirement code rename', () => {
  it('ReqCodeRename_WritesOneSummaryRow', async () => {
    await row({ kind: 'merit_badge_requirement', code: `${MB}-1`, label: 'Req 1' });
    await row({ kind: 'merit_badge_requirement', code: `${MB}-1`, label: 'Req 1', scout_id: scoutB });
    const { data: req } = await sb.from('merit_badge_requirements').select('id').eq('mb_id', MB).eq('code', '1').single();
    await (await lookups()).updateReqCode(form({ id: String(req!.id), source: 'mb', parent_id: MB, original_code: '1', code: '1x', label: 'Req 1' }));
    const { data } = await sb.from('audit_log').select('summary').eq('entity_type', 'requirement').eq('entity_id', `${MB}-1x`);
    expect((data ?? []).map((r) => r.summary)).toEqual([`Renamed requirement code ${MB}-1 → ${MB}-1x on 2 ledger rows`]);
  });
});
