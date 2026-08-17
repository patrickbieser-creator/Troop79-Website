'use server';

/**
 * LEADER_PASSWORD is retired (Plans/Unified-Identity-And-Capabilities.md
 * Phase E, 2026-08-16). There is no password login any more: leaders sign in
 * as themselves at /signin and their capabilities come from their person
 * record.
 *
 * logoutAction survives because outstanding `t79_leader_session` cookies do —
 * they were issued for 30 days and simply expire out. Until then the legacy
 * branch in lib/admin-actor.ts still honours them, and this clears one on
 * demand. Both can go once no valid cookie can remain.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LEADER_COOKIE } from '@/lib/leader-session';

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(LEADER_COOKIE.name);
  redirect('/');
}
