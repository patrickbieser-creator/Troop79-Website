import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * L0 qa follow-ups (2026-10-22): a failed audit write logs only area, action and entity id, never the entry (ledger
 * summaries carry names and notes); and the scout-name lookup after a ledger write can't throw, so a network error
 * never makes a saved edit look failed.
 */
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));

const { recordAuditAs } = await import('../src/lib/audit');
const { scoutNamesFor } = await import('../src/lib/ledger-audit');

const refusing = { from: () => ({ insert: async () => ({ error: { message: 'refused' } }) }) } as unknown as SupabaseClient;
const throwing = {
  from: () => {
    throw new Error('network down');
  }
} as unknown as SupabaseClient;
const ENTRY = { area: 'advancement' as const, action: 'update', entityType: 'ledger_entry', entityId: 42, summary: 'Changed Anjali S Second Class BoR: notes secret → other' };

afterEach(() => vi.restoreAllMocks());

describe('audit failure log', () => {
  it('AuditFailureLog_OmitsTheSummary', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await recordAuditAs(refusing, null, ENTRY);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('Anjali');
  });

  it('AuditFailureLog_NamesAreaActionAndEntity', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await recordAuditAs(refusing, null, ENTRY);
    expect(JSON.stringify(spy.mock.calls)).toContain('advancement/update/42');
  });
});

describe('scoutNamesFor', () => {
  it('ScoutNamesFor_NetworkError_ReturnsNoNames', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await scoutNamesFor(throwing, ['s1'])).size).toBe(0);
  });
});
