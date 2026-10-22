import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Meeting Live hosts its visitors in a system household
 * (`households.system_key = 'meeting-visitors'`). It is nobody's family, so
 * every read that LISTS households must filter `system_key is null`.
 *
 * A TRIPWIRE, not a proof: a regex scan of src/ for `from('households')`
 * reads whose chained calls must either filter on system_key or fetch by id
 * (`.eq('id', …)` / `.in('id', …)` — a lookup of households already known,
 * not a list). It only sees chains written inline with no nested parentheses
 * in an argument; a query built across variables or with an embedded select
 * like `select('id, household_members(person_id)')` slips past it. The sanity
 * test below fails if the scan stops finding reads at all, so a broken regex
 * can't pass silently.
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

const reads: { file: string; chain: string }[] = walk(SRC).flatMap((f) =>
  householdReads(fs.readFileSync(f, 'utf8')).map((chain) => ({ file: path.relative(SRC, f), chain }))
);

describe('household lists skip system households (tripwire)', () => {
  it('the scanner finds households reads to check', () => {
    expect(reads.length).toBeGreaterThan(0);
  });

  it('every households read it finds filters system_key or fetches by id', () => {
    const offenders = reads.filter((r) => !isScoped(r.chain)).map((r) => `${r.file}: ${r.chain.trim()}`);
    expect(offenders).toEqual([]);
  });
});
