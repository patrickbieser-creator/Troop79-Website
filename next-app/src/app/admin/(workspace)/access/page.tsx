/**
 * /admin/access — Access & Permissions
 * (Plans/Unified-Identity-And-Capabilities.md Phase A).
 *
 * The one place capabilities are handed out. Without it, person_capabilities
 * is only editable in the Supabase console — which is exactly how
 * leaders.can_login drifted into being true for Summer Camp and Turner Hall.
 *
 * Phase A: reachable by any leader session, and reads nothing at runtime —
 * no other screen consults person_capabilities yet. Phase B switches /admin
 * over to capability checks and this page's guard becomes
 * requireCapability('roster.manage').
 */

import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAccessScreen } from '@/lib/capabilities-admin';
import { AccessTable } from './access-table';
import {
  grantCapabilityAction,
  revokeCapabilityAction,
  applyBundleAction,
  revokeAllCapabilitiesAction,
  revokeSessionsAction
} from './actions';
import styles from './access.module.css';

export const metadata = {
  title: 'Access & Permissions — Troop 79'
};

export default async function AccessPage() {
  await requireRole(['leader']);
  const { rows, addable } = await loadAccessScreen(createAdminClient());

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Access &amp; Permissions</h1>
        <p>
          Who can do what, per person. A capability is granted to a human, not to a password — and
          removing one takes effect on their next action, with no sign-out needed.
        </p>
      </div>

      <div className={styles.note}>
        <strong>Not live yet.</strong> Nothing on the site reads these grants — the admin still runs
        on the shared leader password. This screen exists so the grants are right{' '}
        <em>before</em> anything depends on them. Two things worth setting now:{' '}
        {/* Explicit {' '} — the space after </strong> is dropped when the text
            that follows wraps to the next source line (next-app/AGENTS.md).
            Caught in browser verification 2026-08-16: "roster(every". */}
        <strong>Manage the roster</strong>{' '}
        (every family&rsquo;s address, birthdates, and medical notes) is deliberately held by only a
        few people, and{' '}
        <strong>Moderate the Library</strong> is unassigned until you say who owns it.
      </div>

      <AccessTable
        rows={rows}
        addable={addable}
        grantAction={grantCapabilityAction}
        revokeAction={revokeCapabilityAction}
        applyBundleAction={applyBundleAction}
        revokeAllAction={revokeAllCapabilitiesAction}
        revokeSessionsAction={revokeSessionsAction}
      />
    </>
  );
}
