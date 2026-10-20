/**
 * The People side of the EmailOctopus sync (lib/newsletter-sync.ts).
 *
 * Eligible: every address of an active person (not merged, not a guest) that
 * hasn't unsubscribed or bounced here. An address unsubscribed here is never
 * added, whoever has it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { normEmail, type SyncAddress } from '@/lib/newsletter-sync';

interface EmailRow {
  id: number;
  person_id: number;
  email: string;
  unsubscribed_at: string | null;
  bounced_at: string | null;
}

export async function loadSyncAddresses(sb: SupabaseClient): Promise<{ addresses: SyncAddress[]; unsubscribedHere: string[] }> {
  const [people, emails, scouts] = await Promise.all([
    fetchAllRows<{ id: number; first_name: string | null; last_name: string | null }>((from, to) =>
      sb
        .from('people')
        .select('id, first_name, last_name')
        .eq('active', true)
        .is('merged_into_person_id', null)
        .is('guest_host_household_id', null)
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<EmailRow>((from, to) =>
      sb.from('person_emails').select('id, person_id, email, unsubscribed_at, bounced_at').order('id').range(from, to)
    ),
    fetchAllRows<{ person_id: number | null }>((from, to) => sb.from('scouts').select('person_id').order('id').range(from, to))
  ]);

  const personOf = new Map(people.map((p) => [p.id, p]));
  const scoutIds = new Set(scouts.map((s) => s.person_id).filter((id): id is number => id != null));
  const addresses: SyncAddress[] = [];
  for (const e of emails) {
    const p = personOf.get(e.person_id);
    if (!p || e.unsubscribed_at || e.bounced_at) continue;
    addresses.push({ personId: p.id, email: e.email, firstName: p.first_name ?? '', lastName: p.last_name ?? '', isScout: scoutIds.has(p.id) });
  }
  const unsubscribedHere = emails.filter((e) => e.unsubscribed_at).map((e) => e.email);
  return { addresses, unsubscribedHere };
}

/** Record EmailOctopus unsubscribes on every person_emails row with that address. Returns rows marked. */
export async function markAddressesUnsubscribed(sb: SupabaseClient, emails: string[], at: string): Promise<number> {
  if (!emails.length) return 0;
  const wanted = new Set(emails.map(normEmail));
  const rows = await fetchAllRows<{ id: number; email: string }>((from, to) =>
    sb.from('person_emails').select('id, email').is('unsubscribed_at', null).order('id').range(from, to)
  );
  const ids = rows.filter((r) => wanted.has(normEmail(r.email))).map((r) => r.id);
  if (!ids.length) return 0;
  const { error } = await sb.from('person_emails').update({ unsubscribed_at: at }).in('id', ids);
  if (error) throw new Error(error.message);
  return ids.length;
}
