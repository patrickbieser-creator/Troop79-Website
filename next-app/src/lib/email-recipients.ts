import { createAdminClient } from '@/lib/supabase/server';

/**
 * Who should receive troop mail for a given set of scouts.
 *
 * Reads scout_parent_emails (the per-address table added for exactly this
 * job) and drops anything that bounced or unsubscribed — a sender that keeps
 * mailing dead addresses gets its domain reputation downgraded, which
 * eventually stops mail reaching everyone else.
 *
 * Falls back to the legacy scout_parents.email for any parent that has no
 * address row yet, so nobody is silently unreachable during the transition.
 */

export interface Recipient {
  email: string;
  parentName: string;
  scoutIds: string[];
}

export async function recipientsForScouts(scoutIds: string[]): Promise<Recipient[]> {
  if (scoutIds.length === 0) return [];
  const supabase = createAdminClient();

  const { data: parents } = await supabase
    .from('scout_parents')
    .select('id, scout_id, name, email')
    .in('scout_id', scoutIds);

  const parentRows = (parents ?? []) as { id: number; scout_id: string; name: string; email: string | null }[];
  if (parentRows.length === 0) return [];

  const { data: addresses } = await supabase
    .from('scout_parent_emails')
    .select('scout_parent_id, email, is_primary, bounced_at, unsubscribed_at')
    .in(
      'scout_parent_id',
      parentRows.map((p) => p.id)
    );

  const rows = (addresses ?? []) as {
    scout_parent_id: number;
    email: string;
    is_primary: boolean;
    bounced_at: string | null;
    unsubscribed_at: string | null;
  }[];

  const byParent = new Map<number, typeof rows>();
  for (const r of rows) byParent.set(r.scout_parent_id, [...(byParent.get(r.scout_parent_id) ?? []), r]);

  const out = new Map<string, Recipient>();
  for (const p of parentRows) {
    const addrs = (byParent.get(p.id) ?? []).filter((a) => !a.bounced_at && !a.unsubscribed_at);
    // Prefer the primary; fall back to any live address, then the legacy column.
    const chosen =
      addrs.find((a) => a.is_primary)?.email ??
      addrs[0]?.email ??
      (p.email ? p.email.trim().toLowerCase() : null);
    if (!chosen) continue;

    const existing = out.get(chosen);
    if (existing) {
      if (!existing.scoutIds.includes(p.scout_id)) existing.scoutIds.push(p.scout_id);
    } else {
      out.set(chosen, { email: chosen, parentName: p.name, scoutIds: [p.scout_id] });
    }
  }
  return [...out.values()];
}
