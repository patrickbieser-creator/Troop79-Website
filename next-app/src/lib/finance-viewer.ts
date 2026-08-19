/**
 * "Whose scout account should /member/scout-account show?" — the finance
 * counterpart to lib/library-viewer.ts's resolveLibraryViewer(), extended to
 * a new domain (Plans/Troop-Finances.md, "extend the superuser proxy
 * logic... to scout accounts on the public site").
 *
 * Deliberately gated on `finance.manage`, NOT `library.proxy_view` — reusing
 * an unrelated capability across domains is exactly what this project's flat,
 * non-nesting capability model rejects (a Librarian would gain financial
 * proxy-view for free). finance.manage already means "sees all financial
 * data" (the treasurer's own admin ledger); this just extends where that
 * grant reaches, rather than inventing a speculative finance.proxy_view
 * nobody asked for yet.
 *
 * DEFAULT-TO-OWN-FAMILY, NOT DEFAULT-TO-PROXY (Patrick, 2026-08-18): unlike
 * the Library resolver — where a leader has no "own scout" to fall back to
 * — a finance.manage holder who is ALSO a verified parent (Patrick himself:
 * real relationships rows, real scouts) sees their OWN family's view by
 * default, exactly like everyone else, with the scout-switcher offered
 * alongside it rather than replacing it. Picking a scout from that switcher
 * is what turns proxy mode on; it turns back off simply by not carrying
 * `?viewScout=` — landing on this page fresh from /member always resets to
 * the family default, no server-side toggle state needed.
 *
 * DECISION LOGIC IS SPLIT OUT (decideFinanceViewer, below) from the
 * cookie/DB resolution (resolveFinanceViewer) for the same D-049 reason
 * lib/library-viewer.ts splits out actorCanProxyLibrary()/
 * actorIsLibraryLeader(): resolveFinanceViewer() imports next/headers
 * (transitively, via resolveAdminActor/getIdentitySessionIfValid) and can't
 * be unit-tested in this project's db-project suite. decideFinanceViewer()
 * takes plain already-resolved values and is pure — this is where the ACTUAL
 * branching that determines whose money a request sees lives, and where the
 * test coverage belongs (qa-lead, 2026-08-18, pre-production BLOCK finding:
 * this file had zero test coverage of anything beyond the one-line
 * actorCanProxyFinance guard).
 *
 * Four outcomes:
 *   - 'none'             — not signed in, a scout admin login, a revoked
 *                          identity session, or a leader with neither
 *                          finance.manage nor a family identity to fall back to.
 *   - 'proxy-available'  — finance.manage held, no family scope to default
 *                          to (a pure leader/treasurer with no scouts of
 *                          their own), and no `?viewScout=` chosen yet.
 *   - 'scope', isProxy=false — the viewer's own family (self ∪ children).
 *                          switchOptions is populated here too when the
 *                          viewer ALSO holds finance.manage — the switcher
 *                          renders as an offer ("view another scout"),
 *                          not a "currently viewing as" banner.
 *   - 'scope', isProxy=true — an explicitly chosen scout via `?viewScout=`,
 *                          only reachable by a finance.manage holder.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAdminActor, actorHas, type AdminActor } from '@/lib/admin-actor';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { resolveFamilyScope } from '@/lib/household-scope';

/** Same subjectKind guard as actorCanProxyLibrary() and for the same reason:
 *  a scout holding finance.manage by grant-table mistake must never proxy as
 *  another scout — checked here regardless of what the grants table says. */
export function actorCanProxyFinance(actor: AdminActor | null): boolean {
  return !!actor && actor.subjectKind !== 'scout' && actorHas(actor, 'finance.manage');
}

export interface FinanceSwitchOption {
  personId: number;
  name: string;
}

export type FinanceViewer =
  | { kind: 'none' }
  | { kind: 'proxy-available'; options: FinanceSwitchOption[] }
  | {
      kind: 'scope';
      personIds: number[];
      label: string;
      /** Every active scout the viewer could switch to. Populated whenever
       *  the viewer holds finance.manage, whether or not they're currently
       *  proxying — empty only for an ordinary family with no proxy grant,
       *  since there's nothing for them to switch between. */
      switchOptions: FinanceSwitchOption[];
      isProxy: boolean;
    };

/**
 * Pure decision — every input already resolved (no cookies, no DB). This is
 * the piece that actually decides whose money a request sees; test THIS,
 * not the cookie-reading orchestration around it.
 *
 * `chosen` must already be validated against `activeScouts` by the caller
 * (a `?viewScout=` value that doesn't match a real active scout is `null`
 * here, same as if it were never supplied) — this function trusts it.
 */
export function decideFinanceViewer(input: {
  canProxy: boolean;
  /** null = no valid (unrevoked, unexpired) identity session at all.
   *  resolveFamilyScope() never returns an empty array for a real session
   *  (an adult with no children still gets [themselves]), so `[]` here
   *  would only happen if a caller passed one in wrong — treated the same
   *  as null defensively. */
  familyScope: number[] | null;
  familyLabel: string;
  activeScouts: FinanceSwitchOption[];
  chosen: FinanceSwitchOption | null;
}): FinanceViewer {
  const hasFamily = !!input.familyScope && input.familyScope.length > 0;

  if (input.canProxy) {
    if (input.chosen) {
      return {
        kind: 'scope',
        personIds: [input.chosen.personId],
        label: input.chosen.name,
        switchOptions: input.activeScouts,
        isProxy: true
      };
    }
    if (hasFamily) {
      return {
        kind: 'scope',
        personIds: input.familyScope!,
        label: input.familyLabel,
        switchOptions: input.activeScouts,
        isProxy: false
      };
    }
    if (input.activeScouts.length === 0) return { kind: 'none' };
    return { kind: 'proxy-available', options: input.activeScouts };
  }

  // Not proxy-capable — ordinary family-only path. A leader without
  // finance.manage still lands here rather than 'none': under the unified
  // session model a leader and a verified parent are often the SAME
  // t79_identity cookie, same reasoning as resolveLibraryViewer().
  if (!hasFamily) return { kind: 'none' };
  return { kind: 'scope', personIds: input.familyScope!, label: input.familyLabel, switchOptions: [], isProxy: false };
}

export async function resolveFinanceViewer(
  supabase: SupabaseClient,
  viewScoutParam: string | undefined
): Promise<FinanceViewer> {
  const actor = await resolveAdminActor();
  const canProxy = actorCanProxyFinance(actor);

  // Resolved unconditionally, not just when canProxy is false — a
  // finance.manage holder who is ALSO a verified parent needs their own
  // scope available as the default, per Patrick's 2026-08-18 exception.
  const identity = await getIdentitySessionIfValid();
  let familyScope: number[] | null = null;
  let familyLabel = '';
  if (identity && (await isEpochCurrent(supabase, identity))) {
    familyScope = await resolveFamilyScope(supabase, identity.personId, identity.subjectKind);
    familyLabel = identity.displayName;
  }

  let activeScouts: FinanceSwitchOption[] = [];
  if (canProxy) {
    const { data } = await supabase
      .from('scouts')
      .select('person_id, display_name')
      .eq('active', true)
      .not('person_id', 'is', null)
      .order('display_name');
    activeScouts = ((data ?? []) as { person_id: number; display_name: string }[]).map((s) => ({
      personId: s.person_id,
      name: s.display_name
    }));
  }

  const chosenId = viewScoutParam ? Number(viewScoutParam) : undefined;
  const chosen =
    chosenId != null && Number.isFinite(chosenId) ? (activeScouts.find((s) => s.personId === chosenId) ?? null) : null;

  return decideFinanceViewer({ canProxy, familyScope, familyLabel, activeScouts, chosen });
}
