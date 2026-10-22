import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Functions run next to the database (perf, 2026-10-22): Supabase is AWS us-east-2, Vercel's cle1 (Cleveland). From
 * iad1 every query paid ~12 ms; from cle1 about 1-2 ms. The Vercel project's root directory is next-app/.
 */
describe('vercel.json', () => {
  it('Functions_RunInCle1_BesideTheDatabase', () => {
    expect(JSON.parse(readFileSync(join(__dirname, '..', 'vercel.json'), 'utf8')).regions).toEqual(['cle1']);
  });
});
