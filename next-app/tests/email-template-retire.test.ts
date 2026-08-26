import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Retire keeps the row (Patrick, 2026-08-26). The first cut deleted a
 * template outright when no signup referenced it and only soft-retired a
 * referenced one — so a leader could lose a template they wrote by
 * "retiring" it. Retire now always sets retired_at; Restore brings it back.
 *
 * The action needs a cookie (requireCapability), which this suite cannot
 * mock (D-049), so the property is asserted against the source the same way
 * news-submission.test.ts guards the literal status write.
 */
describe('retireEmailTemplate', () => {
  const src = readFileSync(
    new URL('../src/app/admin/(workspace)/advancement/lookups/email-template-actions.ts', import.meta.url),
    'utf8'
  );
  const fn = src.slice(src.indexOf('export async function retireEmailTemplate'), src.indexOf('export async function restoreEmailTemplate'));

  it('Retire_NeverDeletes_OnlySetsRetiredAt', () => {
    expect(fn).not.toMatch(/\.delete\(/);
    expect(fn).toMatch(/retired_at: new Date\(\)\.toISOString\(\)/);
  });
});
