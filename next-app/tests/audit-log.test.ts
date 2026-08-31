import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { recordAuditAs, type AuditEntry } from '../src/lib/audit';

/**
 * Content audit trail (Patrick, 2026-08-30): CRUD on news/calendar/roster/
 * library content dumps one row into audit_log with a date and person tag
 * (advancement + finance excluded — they have ledgers). recordAuditAs is
 * the db-testable half; the recordAudit wrapper only adds actor resolution
 * from the request session, which needs cookies this suite can't mock.
 *
 * The invariant that matters most: AUDITING MUST NEVER BREAK A SAVE — a
 * failed audit write logs and returns, it does not throw into the action
 * that called it.
 */

const MARKER = 'vitest-audit-log';
const admin = adminClient();

afterEach(async () => {
  await admin.from('audit_log').delete().eq('entity_type', MARKER);
});

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    area: 'news',
    action: 'create',
    entityType: MARKER,
    entityId: 42,
    summary: 'Created "Test Article"',
    ...overrides
  };
}

describe('recordAuditAs', () => {
  it('WritesOneRow_WithActorAreaActionEntityAndTimestamp', async () => {
    await recordAuditAs(admin, { personId: null, label: 'Test Leader' }, entry());
    const { data } = await admin
      .from('audit_log')
      .select('actor_person_id, actor_label, area, action, entity_type, entity_id, summary, occurred_at, details')
      .eq('entity_type', MARKER);
    expect(data).toHaveLength(1);
    const row = data![0];
    expect(row.actor_label).toBe('Test Leader');
    expect(row.actor_person_id).toBeNull();
    expect(row.area).toBe('news');
    expect(row.action).toBe('create');
    expect(row.entity_id).toBe('42');
    expect(row.summary).toBe('Created "Test Article"');
    expect(row.occurred_at).toBeTruthy();
    expect(row.details).toBeNull();
  });

  it('StringifiesNumericEntityIds_AndAcceptsStringOnes', async () => {
    await recordAuditAs(admin, { personId: null, label: 'L' }, entry({ entityId: 'jsmith' }));
    const { data } = await admin.from('audit_log').select('entity_id').eq('entity_type', MARKER);
    expect(data![0].entity_id).toBe('jsmith');
  });

  it('RecordsSystemAsTheActorLabel_WhenNoActorResolves', async () => {
    await recordAuditAs(admin, null, entry());
    const { data } = await admin.from('audit_log').select('actor_label').eq('entity_type', MARKER);
    expect(data![0].actor_label).toBe('system');
  });

  it('NeverThrows_WhenTheInsertFails_AuditingMustNotBreakASave', async () => {
    // 'advancement' violates the area CHECK constraint — the insert fails at
    // the DB, and recordAuditAs must swallow it.
    await expect(
      recordAuditAs(admin, null, entry({ area: 'advancement' as AuditEntry['area'] }))
    ).resolves.toBeUndefined();
    const { data } = await admin.from('audit_log').select('id').eq('entity_type', MARKER);
    expect(data).toHaveLength(0);
  });
});
