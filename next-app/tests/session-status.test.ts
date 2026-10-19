import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AdminActor } from '../src/lib/admin-actor';
import type { IdentitySession } from '../src/lib/identity-session';

/**
 * What "signed in" means to the public nav's account control.
 *
 * Reported 2026-08-16: the bar read "Signed in · Family" for someone who had
 * only typed the troop password and had not signed in as anybody. Phase D
 * demoted FAMILY_PASSWORD from a credential to the gate on the name picker,
 * so only a per-person identity session counts.
 *
 * 2026-10-19: the legacy shared-password leader cookie is no longer read
 * (nothing mints it since Phase E), and `canAdmin` reports the admin
 * workspace's own admission rule so the menu offers Admin to exactly the
 * people /admin lets in.
 */

const ROUTE = 'src/app/api/session-status/route.ts';

const mocks = vi.hoisted(() => ({
  identity: null as IdentitySession | null,
  actor: null as AdminActor | null
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'cookie' }) }) }));
vi.mock('@/lib/identity-session', async (orig) => ({
  ...(await orig<typeof import('../src/lib/identity-session')>()),
  verifyIdentitySession: async () => mocks.identity
}));
vi.mock('@/lib/admin-actor', async (orig) => ({
  ...(await orig<typeof import('../src/lib/admin-actor')>()),
  resolveAdminActor: async () => mocks.actor
}));

import { GET } from '../src/app/api/session-status/route';
import { actorCanEnterAdmin } from '../src/lib/admin-actor';

function identity(over: Partial<IdentitySession> = {}): IdentitySession {
  return {
    role: 'identity',
    subjectKind: 'adult',
    personId: 82,
    householdKey: '1',
    displayName: 'Patrick Bieser',
    epoch: 0,
    iat: Date.now(),
    ...over
  } as IdentitySession;
}

function actor(capabilities: string[]): AdminActor {
  return {
    kind: 'identity',
    label: 'Patrick Bieser',
    personId: 82,
    capabilities: new Set(capabilities) as AdminActor['capabilities'],
    legacyRole: null,
    subjectKind: 'adult'
  };
}

async function status() {
  const res = await GET();
  return res.json();
}

beforeEach(() => {
  mocks.identity = null;
  mocks.actor = null;
});

describe('session status', () => {
  it('NoIdentitySession_IsSignedOut_AndCannotAdmin', async () => {
    const s = await status();
    expect(s).toMatchObject({ loggedIn: false, label: null, canAdmin: false });
  });

  it('IdentitySession_IsSignedIn_WithItsDisplayName', async () => {
    mocks.identity = identity();
    const s = await status();
    expect(s).toMatchObject({ loggedIn: true, level: 'Family', label: 'Patrick Bieser', isVerifiedMember: true });
  });

  it('CanAdmin_IsTrue_WhenTheActorHoldsAnyCapability', async () => {
    mocks.identity = identity();
    mocks.actor = actor(['advancement.write']);
    expect((await status()).canAdmin).toBe(true);
  });

  it('CanAdmin_IsFalse_WhenTheActorHoldsNoCapabilities', async () => {
    mocks.identity = identity();
    mocks.actor = actor([]);
    expect((await status()).canAdmin).toBe(false);
  });

  it('CanAdmin_IsFalse_WhenTheSessionIsRevoked', async () => {
    // resolveAdminActor returns null for an epoch-bumped session.
    mocks.identity = identity();
    mocks.actor = null;
    expect((await status()).canAdmin).toBe(false);
  });

  it('Response_IsNeverCached', async () => {
    const res = await GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('FamilyPasswordCookie_IsNotConsulted', () => {
    const src = readFileSync(ROUTE, 'utf8');
    expect(src).not.toContain('verifyFamilySession');
  });

  it('LegacyLeaderCookie_IsNotConsulted', () => {
    const src = readFileSync(ROUTE, 'utf8');
    expect(src).not.toMatch(/LEADER_COOKIE|verifySession\b|leader-session/);
    const trueBranches = src.match(/loggedIn:\s*true/g) ?? [];
    expect(trueBranches).toHaveLength(1);
  });

  it('ActorCanEnterAdmin_IsFalse_ForNoActor', () => {
    expect(actorCanEnterAdmin(null)).toBe(false);
  });

  it('ActorCanEnterAdmin_IsFalse_ForAnEmptyCapabilitySet', () => {
    expect(actorCanEnterAdmin(actor([]))).toBe(false);
  });

  it('ActorCanEnterAdmin_IsTrue_ForAnyCapability', () => {
    expect(actorCanEnterAdmin(actor(['news.write']))).toBe(true);
  });

  it('CanAdmin_ReusesTheWorkspaceAdmissionRule', () => {
    // One rule, two readers: the admin layout and this route.
    expect(readFileSync(ROUTE, 'utf8')).toMatch(/actorCanEnterAdmin\(/);
    expect(readFileSync('src/app/admin/(workspace)/layout.tsx', 'utf8')).toMatch(/actorCanEnterAdmin\(actor\)/);
  });
});
