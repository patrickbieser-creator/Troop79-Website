import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * A recipe line's `scale` rides on every read of mm_recipe_lines, or a fixed ("whole meal") line silently
 * turns back into per person on its way through. Every `.select(…)` that names qty_per_person on a RECIPE
 * line (not a variation line, which has no scale) must name `scale` beside it.
 */
const SRC = path.resolve(__dirname, '../src');
const files: string[] = [];
(function walk(dir: string) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f)) files.push(p);
  }
})(SRC);

describe('mm_recipe_lines selects', () => {
  it('EveryQtyPerPersonSelect_NamesScaleBesideIt', () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\.select\(\s*(['"`])(.*?)\1/g)) {
        const sel = m[2];
        if (!sel.includes('qty_per_person') || sel.includes('base_ingredient_id')) continue; // variation lines carry no scale
        seen++;
        if (!/\bscale\b/.test(sel)) bad.push(`${path.relative(SRC, f)}: ${sel}`);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(4);
    expect(bad).toEqual([]);
  });
});
