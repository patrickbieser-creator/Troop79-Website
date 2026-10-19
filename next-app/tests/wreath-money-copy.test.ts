import { describe, it, expect } from 'vitest';
import { moneyBlockLines } from '../src/lib/wreaths/copy';

/** "Where the money goes" reads the sale's scout share, not a number written into the copy (2026-10-19). */
describe('moneyBlockLines', () => {
  it('ScoutPage_SaysTheSalesScoutShare', () => {
    expect(moneyBlockLines('Lily', { scoutShare: 0.35, donationShare: 0.15 })[1]).toContain('35% of its profit');
  });

  it('ScoutPage_NeverSaysAHardCodedThirtyPercent_WhenTheShareDiffers', () => {
    expect(moneyBlockLines('Lily', { scoutShare: 0.25 }).join(' ')).not.toContain('30%');
  });
});
