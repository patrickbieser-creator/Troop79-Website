import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Meeting Live hosts its visitors in a system household
 * (`households.system_key = 'meeting-visitors'`). It is nobody's family, so
 * every read that LISTS households must filter `system_key is null`.
 *
 * Grep-shaped guard: for every `from('households')` read in src/, the chained
 * calls must either filter on system_key or fetch by id (`.eq('id', …)` /
 * `.in('id', …)` — a lookup of households already known, not a list).
 */

const SRC = path.join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Each households read in a file: the chain of calls after from(), when it selects (writes returning ids excluded). */
function householdReads(src: string): string[] {
  const re = /from\(\s*['"]households['"]\s*\)((?:\s*\.\w+\([^()]*\))*)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) if (m[1].includes('.select(') && !/\.(insert|update|upsert|delete)\(/.test(m[1])) out.push(m[1]);
  return out;
}

function isScoped(chain: string): boolean {
  return /system_key/.test(chain) || /\.(eq|in)\(\s*['"]id['"]/.test(chain);
}

describe('household lists skip system households', () => {
  it('every households read filters system_key or fetches by id', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const src = fs.readFileSync(f, 'utf8');
      for (const chain of householdReads(src)) {
        if (!isScoped(chain)) offenders.push(`${path.relative(SRC, f)}: ${chain.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
