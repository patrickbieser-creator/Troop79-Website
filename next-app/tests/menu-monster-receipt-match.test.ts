import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expandReceiptName, proposeMatch, type MatchCandidate } from '../src/lib/menu-monster/receipt-match';

/**
 * Receipt line matcher (Plans/Menu-Monster-Receipt-Reconciliation.md): the real Aldi receipt of 2026-10-08 is
 * the contract. Every line's proposal must equal the `proposed` name in the JSON, and the ten lines with
 * `proposed: null` must come back unidentified.
 */
interface Line { code: string; name: string; proposed: string | null }
const receipt = JSON.parse(readFileSync(resolve(__dirname, '../scripts/receipts/2026-10-08-aldi-high-cliff.json'), 'utf-8')) as { lines: Line[] };

const UNBOUGHT = [
  'Bacon - Veg', 'Meatballs - Meatless/GF', 'Sausage - Vegetarian', 'Butter', 'Lettuce - Sandwich', 'Hot Chocolate', 'Pasta sauce',
  'Pancake mix', 'Pickles - Sandwich (slices)', 'GF Cake Mix - Chocolate', 'Zip bags', 'Charcoal', 'Cooking oil', 'Dutch oven liners', 'Paper towels', 'Salt'
];
const names = [...new Set([...receipt.lines.map((l) => l.proposed).filter((p): p is string => p != null), ...UNBOUGHT])];
const candidates: MatchCandidate[] = names.map((n) => ({ id: n, name: n, planned: true }));

describe('the matcher against the High Cliff receipt', () => {
  it.each(receipt.lines.map((l) => [l.name, l.proposed] as const))('Matcher_ReadsTheLine_%s', (name, proposed) => {
    expect(proposeMatch(name, candidates)?.id ?? null).toBe(proposed);
  });

  it('Matcher_LeavesTenLinesUnidentified', () => {
    expect(receipt.lines.filter((l) => l.proposed == null)).toHaveLength(10);
  });
});

describe('expandReceiptName', () => {
  it('SplitsCamelCase_AndExpandsAbbreviations', () => {
    expect(expandReceiptName('DryRstdPeanutsSSlt')).toEqual(expect.arrayContaining(['peanut', 'seasalt']));
  });

  it('DropsQuantitiesAndThePrefix', () => {
    expect(expandReceiptName('FC OJ No Pulp')).toEqual(['orange', 'juice']);
    expect(expandReceiptName('Raisins 20 oz')).toEqual(['raisin']);
  });
});

describe('proposeMatch', () => {
  it('PrefersAPlannedIngredient_OverACatalogOneOfTheSameScore', () => {
    const c: MatchCandidate[] = [{ id: 'a', name: 'Whole Milk', planned: false }, { id: 'b', name: 'Milk', planned: true }];
    expect(proposeMatch('2% Milk', c)?.id).toBe('b');
  });

  it('ReturnsNull_WhenTwoCandidatesTie', () => {
    const c: MatchCandidate[] = [{ id: 'a', name: 'Apple', planned: true }, { id: 'b', name: 'Apple', planned: true }];
    expect(proposeMatch('Apples', c)).toBeNull();
  });

  it('ReturnsNull_WhenNoWordMatches', () => {
    expect(proposeMatch('Mrshmllw/Puff', candidates)).toBeNull();
  });
});
