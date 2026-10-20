import { describe, it, expect, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { loadSyncAddresses, markAddressesUnsubscribed } from '../src/lib/newsletter-sync-db';

/**
 * Who the EmailOctopus sync may put on the list, and where it records an
 * unsubscribe. Test-owned people (TEST_PREFIX) and test-owned addresses
 * (@zzvitest.example) only.
 */
const admin = adminClient();
const P = `${TEST_PREFIX} EO`;
const DOMAIN = '@zzvitest.example';

async function personWithEmail(label: string, extra: Record<string, unknown> = {}, emailExtra: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from('people')
    .insert({ display_name: `${P} ${label}`, first_name: P, last_name: label, ...extra })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message);
  const email = `${label.toLowerCase()}${DOMAIN}`;
  const { error: e2 } = await admin.from('person_emails').insert({ person_id: data.id, email, is_primary: true, ...emailExtra });
  if (e2) throw new Error(e2.message);
  return { id: data.id as number, email };
}

afterAll(async () => {
  const { data } = await admin.from('people').select('id').like('display_name', `${P}%`);
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) {
    await admin.from('person_emails').delete().in('person_id', ids);
    await admin.from('people').delete().in('id', ids);
  }
});

describe('loadSyncAddresses', () => {
  it('Sync_IncludesAnActivePersonsAddress', async () => {
    const p = await personWithEmail('Active');
    const { addresses } = await loadSyncAddresses(admin);
    expect(addresses.map((a) => a.email)).toContain(p.email);
  });

  it('Sync_LeavesOutAnInactivePerson', async () => {
    const p = await personWithEmail('Inactive', { active: false });
    const { addresses } = await loadSyncAddresses(admin);
    expect(addresses.map((a) => a.email)).not.toContain(p.email);
  });

  it('Sync_LeavesOutAnAddressUnsubscribedHere_AndListsItAsSuppressed', async () => {
    const p = await personWithEmail('Unsub', {}, { unsubscribed_at: new Date().toISOString() });
    const { addresses, unsubscribedHere } = await loadSyncAddresses(admin);
    expect([addresses.map((a) => a.email).includes(p.email), unsubscribedHere.includes(p.email)]).toEqual([false, true]);
  });
});

describe('markAddressesUnsubscribed', () => {
  it('Sync_RecordsAnUnsubscribe_IgnoringCase', async () => {
    const p = await personWithEmail('Marked');
    await markAddressesUnsubscribed(admin, [p.email.toUpperCase()], '2026-10-20T12:00:00Z');
    const { data } = await admin.from('person_emails').select('unsubscribed_at').eq('email', p.email).single();
    expect(data?.unsubscribed_at).not.toBeNull();
  });
});
