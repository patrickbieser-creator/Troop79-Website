import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { signToken } from '../src/lib/signed-cookie';
import { verifySession } from '../src/lib/leader-session';

/**
 * SCOUT_PASSWORD is retired (Plans/Unified-Identity-And-Capabilities.md
 * Phase C, 2026-08-16). No scout ever used it.
 *
 * This file replaces tests/news-scout-shim-guard.test.ts, whose premise was
 * the opposite: while the scout role existed, the Phase B1 shim mapped it to
 * `news.write`, so converting any News guard to requireCapability('news.write')
 * would have handed a shared-password holder publish and delete. That guard
 * kept News on requireRole() until the role could be removed. The role is now
 * gone, News is converted, and what needs guarding is the reverse — that the
 * role does not come back.
 */

const ADMIN_SRC = 'src/app/admin';
const LIB_SRC = 'src/lib';

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('scout password retirement', () => {
  it('ScoutRoleCookie_IsRejected_RatherThanUpgradedToLeader', async () => {
    // The failure mode this prevents: narrowing SessionRole to 'leader' while
    // verifySession() still coerces unknown roles to 'leader' would turn a
    // retirement into a privilege escalation for any outstanding scout cookie.
    const token = await signToken({ leader: 'Some Scout', iat: Date.now(), role: 'scout' });
    expect(await verifySession(token)).toBeNull();
  });

  it('LegacyCookieWithoutRole_StillVerifiesAsLeader', async () => {
    // Cookies predate the `role` field; they were leader-only at the time and
    // must keep working, or retiring the scout role signs out every leader.
    const token = await signToken({ leader: 'Patrick B', iat: Date.now() });
    const session = await verifySession(token);
    expect(session).not.toBeNull();
    expect(session!.role).toBe('leader');
  });

  it('NoSourceFile_StillReadsScoutPassword', () => {
    const offenders = [...tsFilesUnder(ADMIN_SRC), ...tsFilesUnder(LIB_SRC)].filter((f) =>
      /process\.env\.SCOUT_PASSWORD/.test(readFileSync(f, 'utf8'))
    );
    expect(offenders, 'SCOUT_PASSWORD is retired — do not reintroduce a shared scout login').toEqual(
      []
    );
  });

  it('Proxy_HasNoScoutAllowlist_SoTheDenyByOmissionBugClassIsGone', () => {
    const proxy = readFileSync('src/proxy.ts', 'utf8');
    // The allowlist's own comment recorded that advancement/* had once leaked
    // through it. It is not narrowed — it is deleted.
    // Match the declaration, not the word — the header comment explains the
    // removal and should keep saying so.
    expect(proxy).not.toMatch(/const\s+SCOUT_ALLOWED_PREFIXES/);
    expect(proxy).not.toMatch(/const\s+SCOUT_LANDING/);
    expect(proxy).not.toMatch(/role === 'scout'/);
  });
});
