'use server';

import { requireCapability } from '@/lib/require-capability';
import { getPersonHistory } from './get-person-history';
import type { PersonHistoryEntry } from './record-types';

/**
 * The record page's "Full log" (Phase 4): every audit_log row about this
 * person, newest first — fetched on demand when the dialog opens, since the
 * page itself only carries the latest four. READ-ONLY: this file writes
 * nothing and therefore records no audit row of its own
 * (tests/audit-coverage.test.ts lists it as read-only).
 */
export async function loadFullHistory(personId: number): Promise<PersonHistoryEntry[]> {
  await requireCapability('roster.manage');
  return getPersonHistory(personId);
}
