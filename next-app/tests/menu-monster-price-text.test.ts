import { describe, it, expect } from 'vitest';
import { priceText } from '../src/lib/menu-monster/units';

/** Grocery prices always show cents ("$2.00"), unlike event fees ("$20"). */
describe('priceText', () => {
  it('PriceText_ShowsCents_OnWholeDollars', () => {
    expect(priceText(2)).toBe('$2.00');
  });

  it('PriceText_RoundsToCents', () => {
    expect(priceText(11.094)).toBe('$11.09');
  });

  it('PriceText_MarksNegatives_WithAMinusSign', () => {
    expect(priceText(-1.5)).toBe('−$1.50');
  });
});
