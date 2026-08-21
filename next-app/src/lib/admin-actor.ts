/**
 * Who is acting in /admin, regardless of which credential got them there
 * (Plans/Unified-Identity-And-Capabilities.md Phase B).
 *
 * Two session types reach the workspace during the transition:
 *
 *   1. `t79_leader_session` — the legacy shared-password login. The password
 *      itself retired in Phase E (2026-08-16) and nothing mints this cookie
 *      anymore (break-glass issues identity sign-in codes, and login/actions
 *      only deletes it) — the branch below is inert, kept until someone does
 *      the deletion refactor.
 *   2. `t79_identity` — a verified person who holds at least one capability.
 *      This is the one that makes "a leader who is also a parent signs in
 *      once" true.
 *
 * Callers should never branch on which cookie was presented. They ask for a
 * capability and get an answer — that is the whole point of the abstraction,
 * and it is what let Phase E retire the password without touching a single
 * page (and what lets the dead branch be deleted the same way, whenever).
 *
 * Server-only: needs next/headers. The framework-agnostic half lives in
 * lib/capabilities.ts so proxy.ts (Edge) can still import the vocabulary.
 */

import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { LEADER_COOKIE, verifySession, type SessionRole } from '@/lib/leader-session';
import { IDENTITY_COOKIE, verifyIdentitySession, type IdentitySubjectKind } from '@/lib/identity-session';
import { leaderSessionPersonId } from '@/lib/session-person';
import { CAPABILITIES, loadPersonAuthz, type Capability } from '@/lib/capabilities';

export interface AdminActor {
  /** Which credential authorized this request. */
  kind: 'legacy' | 'identity';
  /** Display label for the top bar. */
  label: string;
  /** people.id. Null when a legacy session's typed label cannot be matched
   *  back to a person — lossy by nature, which is why identity sessions carry
   *  the id outright. */
  personId: number | null;
  capabilities: Set<Capability>;
  /** 'leader' when kind === 'legacy'; null for identity actors. The only
   *  remaining reader is the workspace layout's full-admin check — a legacy
   *  password session sees everything. Dead in practice since Phase E
   *  (2026-08-16): no code path mints a legacy session anymore. */
  legacyRole: SessionRole | null;
  /** 'adult' | 'scout' for an identity actor; null for a legacy session
   *  (SCOUT_PASSWORD is retired, so a legacy actor is never a scout).
   *  Needed anywhere a check must exclude a verified scout even though they
   *  hold a real capability — e.g. lib/library-viewer.ts's viewerIsLeader(),
   *  which must not treat a youth leader's narrow `meeting_plan.use` grant
   *  as license to see leaders-only material. Don't infer this from
   *  `capabilities` alone — a scout can legitimately hold a capability
   *  (the youth_leader bundle) without becoming an adult leader. */
  subjectKind: IdentitySubjectKind | null;
}

/**
 * TRANSITION SHIM — a legacy session gets a synthetic capability set.
 *
 * A LEADER_PASSWORD session granted full admin, so it mapped to every
 * capability; otherwise converting a page to requireCapability() would have
 * locked out the people using the site mid-transition. This is what made the
 * switchover safe to do one page at a time rather than in one commit. The
 * password died in Phase E (2026-08-16); this shim is now unreachable and
 * rides along until the legacy branch is deleted.
 *
 * The SCOUT_PASSWORD half of this shim is gone (Phase C, 2026-08-16). It
 * mapped a scout session to `news.write`, which — once news.author and
 * news.publish collapsed into one capability — meant converting any News
 * guard would have handed a shared-password holder publish and delete. The
 * role was retired rather than the guard kept.
 *
 * finance.manage / finance.view are EXCLUDED here (qa-lead, 2026-08-18,
 * pre-production BLOCK finding) — the "grants full admin today" rationale
 * above only holds for capabilities LEADER_PASSWORD already implicitly
 * granted before capabilities existed. Troop Finances did not exist under
 * the old system; nothing was ever "already granted" for it. Auto-including
 * it here would hand every one of the troop's ~10 leaders full financial
 * write/export access through one shared password, directly contradicting
 * the explicit, hand-picked grant list (Patrick, Jason, Mindy —
 * Plans/Troop-Finances.md Decisions §3). A future capability added to this
 * codebase should default to the SAME exclusion unless it genuinely was
 * part of what the legacy password already did.
 */
const LEGACY_EXCLUDED: ReadonlySet<Capability> = new Set(['finance.manage', 'finance.view']);

function legacyCapabilities(): Set<Capability> {
  return new Set(CAPABILITIES.filter((c) => !LEGACY_EXCLUDED.has(c)));
}

/**
 * Resolve the acting person, or null when the request carries no admin-worthy
 * credential.
 *
 * An identity session with ZERO capabilities resolves to an actor with an
 * empty set rather than null — the difference matters to the workspace
 * layout, which shows "you don't have admin access" instead of bouncing to a
 * login the visitor has already completed.
 */
export async function resolveAdminActor(): Promise<AdminActor | null> {
  const jar = await cookies();

  const legacy = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (legacy) {
    return {
      kind: 'legacy',
      label: legacy.leader,
      // Resolved by reverse label match — lossy in principle, which is why
      // identity sessions carry the id outright. See session-person.ts.
      personId: await leaderSessionPersonId(),
      capabilities: legacyCapabilities(),
      legacyRole: legacy.role,
      subjectKind: null
    };
  }

  const identity = await verifyIdentitySession(jar.get(IDENTITY_COOKIE.name)?.value);
  if (!identity) return null;

  // The one DB read: epoch and grants together (see person_authz()).
  const authz = await loadPersonAuthz(createAdminClient(), identity.personId);
  // Revoked (epoch bumped) or deleted → not an actor at all, so the layout
  // sends them to sign in again rather than showing an access message.
  if (!authz || authz.sessionEpoch !== identity.epoch) return null;

  return {
    kind: 'identity',
    label: identity.displayName,
    personId: identity.personId,
    capabilities: authz.capabilities,
    legacyRole: null,
    subjectKind: identity.subjectKind
  };
}

export function actorHas(actor: AdminActor | null, capability: Capability): boolean {
  return actor?.capabilities.has(capability) ?? false;
}

/**
 * The acting person's display name, for audit stamps and bylines.
 *
 * Replaces reading `t79_leader_session` directly, which several screens did
 * for a name. Those reads returned null for an identity actor, so they would
 * have quietly lost the byline the moment LEADER_PASSWORD retired.
 */
export async function adminActorLabel(fallback = 'admin'): Promise<string> {
  const actor = await resolveAdminActor();
  return actor?.label ?? fallback;
}
