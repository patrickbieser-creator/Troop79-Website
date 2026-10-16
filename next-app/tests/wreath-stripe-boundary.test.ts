import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Stripe secret key is read in exactly one module, lib/wreaths/stripe-client.ts (Plans/Wreath-Stripe-Checkout.md;
 * qa-lead: "server-only"). This codebase doesn't use the `server-only` package, so the boundary is enforced here: no
 * 'use client' module may import it (or the server half that drives Stripe) except as a type, and nothing reads the
 * secrets from env anywhere else or under a NEXT_PUBLIC_ name.
 */
const SRC = join(__dirname, '..', 'src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const all = files(SRC).map((p) => ({ p, text: readFileSync(p, 'utf8') }));

describe('Stripe secrets boundary', () => {
  it('StripeModule_IsNeverImportedByAClientModule', () => {
    const leaks = all.filter(
      ({ text }) => /^['"]use client['"]/m.test(text) && /^import\s+(?!type\b)[^;]*from\s+['"][^'"]*wreaths\/(stripe-client|card-payments)['"]/m.test(text)
    );
    expect(leaks.map((l) => l.p)).toEqual([]);
  });

  it('StripeSecrets_AreReadOnlyInTheStripeModuleAndTheWebhookRoute', () => {
    const readers = all.filter(({ text }) => /process\.env\.STRIPE_/.test(text)).map(({ p }) => p.split('\\').join('/').replace(/^.*\/src\//, ''));
    expect(readers.sort()).toEqual(['app/api/stripe/webhook/route.ts', 'lib/wreaths/stripe-client.ts']);
  });

  it('StripeSecrets_HaveNoPublicName', () => {
    expect(all.filter(({ text }) => /NEXT_PUBLIC_STRIPE_SECRET|NEXT_PUBLIC_STRIPE_WEBHOOK/.test(text)).length).toBe(0);
  });
});
