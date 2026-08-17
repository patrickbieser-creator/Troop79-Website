import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards against a bug that has shipped TWICE, independently, in two
 * different files: a hand-rolled `process.env.NEXT_PUBLIC_SITE_URL ||
 * 'http://localhost:3000'` fallback.
 *
 * NEXT_PUBLIC_SITE_URL has never actually been set in Vercel — both
 * incidents trace back to that, not to the fallback logic itself being wrong
 * in isolation. A file that reinvents its own fallback instead of importing
 * siteUrl() from lib/site-url.ts ships a localhost link to production with
 * NO server-side trace: a link to localhost never reaches this app's own
 * logs, so nothing here can page anyone — it is only visible when a real
 * person watches it fail by hand. That is exactly what made both incidents
 * invisible until someone did.
 *
 * First occurrence: the .ics Subscribe links, caught 2026-07-12 (the day
 * troop-79.com went live) — lib/site-url.ts was built as the fix. Second
 * occurrence: the sign-in email link in lib/identity-challenge.ts, caught
 * 2026-08-16 — an independently-written, un-migrated copy of the exact same
 * fallback, because nothing had ever asserted "use the shared helper."
 * lib/site-url.ts existing was not enough; this test is what makes skipping
 * it a build failure instead of a silent third incident.
 */
describe('site URL — nothing reinvents the localhost fallback', () => {
  it('OnlySiteUrlTs_OwnsTheLocalhostFallback', () => {
    const srcDir = join(__dirname, '..', 'src');
    // Files allowed to mention the literal 'http://localhost:3000' string.
    // - lib/site-url.ts: the one legitimate owner.
    // - lib/passkeys.ts: PASSKEY_ORIGIN's own local-dev default, gated on
    //   PASSKEY_RP_ID === 'localhost' — a different setting entirely, not
    //   this bug class (see Registration_RequiresUserVerification's
    //   neighbours in passkeys.test.ts for that file's own coverage).
    const allowed = new Set([join('lib', 'site-url.ts'), join('lib', 'passkeys.ts')]);
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const relative = full.slice(srcDir.length + 1);
        if ([...allowed].some((a) => relative.endsWith(a))) continue;
        const contents = readFileSync(full, 'utf8');
        if (contents.includes("'http://localhost:3000'") || contents.includes('"http://localhost:3000"')) {
          offenders.push(relative);
        }
      }
    }
    walk(srcDir);
    expect(offenders).toEqual([]);
  });

  it('IdentityChallenge_BuildsTheSignInLinkFromTheSharedHelper', () => {
    // Names the specific incident: the link that mints login_tokens must go
    // through siteUrl(), not build its own siteUrl variable.
    const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'identity-challenge.ts'), 'utf8');
    expect(src).toContain("import { siteUrl } from '@/lib/site-url'");
    expect(src).toContain('siteUrl()');
  });
});
