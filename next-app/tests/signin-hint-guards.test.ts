import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source-level guards for the hinted sign-in (Plans/Bugle-Register-Now-Links.md).
 * Same grep-shaped style as the D-120/D-122 guards: each of these protects a
 * rule that every behavioural test would keep passing without.
 */

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('signin-hint — guards', () => {
  it('HintIntakeRoute_NeverMintsASession_OnGet', () => {
    // A GET must never set an identity or family cookie — mail scanners and
    // the newsletter's click tracker prefetch links. The intake only ever
    // sets the short-lived hint cookie.
    const src = read('src/app/(public)/signin/hint/route.ts');
    expect(src).toMatch(/export async function GET/);
    // Reading the identity/leader cookies to wave a signed-in adult through
    // is fine (B5); minting one is not. The only cookie write is the hint.
    expect(src).not.toMatch(/signIdentitySession|signFamilySession|signSession\b/);
    expect(src).not.toMatch(/\.set\(\s*(IDENTITY_COOKIE|FAMILY_COOKIE|LEADER_COOKIE)/);
    const writes = src.match(/cookies\.set\(/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(src).toMatch(/cookies\.set\(HINT_COOKIE\.name/);
  });

  it('HintedSend_IsAServerAction', () => {
    // A Server Action inherits Next's Origin-header CSRF check; a hand-rolled
    // route handler would not (qa-lead, 2026-09-05).
    const src = read('src/app/(public)/signin/actions.ts');
    expect(src.trimStart().startsWith("'use server'")).toBe(true);
    expect(src).toMatch(/export async function requestHintedCodeAction/);
  });

  it('HintedSend_IsAuthorisedByTheHintCookie_NotTheFamilyGate', () => {
    const src = read('src/app/(public)/signin/actions.ts');
    const body = src.slice(src.indexOf('export async function requestHintedCodeAction'));
    const fn = body.slice(0, body.indexOf('\n}\n') + 3);
    expect(fn).toMatch(/hintAllowsPerson/);
  });

  it('ReferrerPolicy_IsSetExplicitly', () => {
    const src = read('next.config.ts');
    expect(src).toMatch(/Referrer-Policy/);
    expect(src).toMatch(/strict-origin-when-cross-origin/);
  });

  it('LoginEventsMethod_IncludesHint_InMigrationAndType', () => {
    const migrations = fs
      .readdirSync(path.join(ROOT, 'supabase', 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => read(path.join('supabase', 'migrations', f)))
      .join('\n');
    expect(migrations).toMatch(/login_events_method_check[\s\S]*'hint'/);
    expect(read('src/lib/login-events.ts')).toMatch(/LoginMethod = 'link' \| 'code' \| 'passkey' \| 'hint'/);
  });
});
