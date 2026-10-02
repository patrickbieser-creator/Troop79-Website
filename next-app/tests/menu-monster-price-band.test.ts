import { describe, it, expect } from 'vitest';
import { PRICE_BAND, bandCheck, unitPrice } from '../src/lib/menu-monster/price-band';

/**
 * The +/-50% price band (Plans/Menu-Monster-Scout-Workspace.md, "Phase 2
 * design"). The SQL in mm_report_price mirrors this rule; the db tests run the
 * same cases through the function.
 */
const pkg = (price: number, yld: number | null = 10) => ({ price, yield: yld });

describe('price band', () => {
  it('PriceBand_IsHalf', () => {
    expect(PRICE_BAND).toBe(0.5);
  });

  it('UnitPrice_DividesPriceByYield', () => {
    expect(unitPrice(pkg(5, 10))).toBe(0.5);
  });

  it('UnitPrice_IsNull_WhenYieldIsMissing', () => {
    expect(unitPrice(pkg(5, null))).toBeNull();
  });

  it('BandCheck_IsSame_WhenPriceIsUnchanged', () => {
    expect(bandCheck(pkg(4), 4)).toBe('same');
  });

  it('BandCheck_Applies_WhenUnitPriceMovesWithinBand', () => {
    expect(bandCheck(pkg(4), 5.5)).toBe('apply');
  });

  it('BandCheck_Applies_ExactlyAtTheEdge', () => {
    expect(bandCheck(pkg(4), 6)).toBe('apply');
    expect(bandCheck(pkg(4), 2)).toBe('apply');
  });

  it('BandCheck_Holds_WhenUnitPriceRisesPastBand', () => {
    expect(bandCheck(pkg(4), 6.01)).toBe('hold');
  });

  it('BandCheck_Holds_WhenUnitPriceFallsPastBand', () => {
    expect(bandCheck(pkg(4), 1.99)).toBe('hold');
  });

  it('BandCheck_Holds_WhenThePackageHasNoYield', () => {
    expect(bandCheck(pkg(4, null), 4.5)).toBe('hold');
  });

  it('BandCheck_Holds_WhenTheCurrentPriceIsZero', () => {
    expect(bandCheck(pkg(0), 3)).toBe('hold');
  });

  it('BandCheck_IsInvalid_WhenReportedPriceIsNotPositive', () => {
    expect(bandCheck(pkg(4), 0)).toBe('invalid');
    expect(bandCheck(pkg(4), -1)).toBe('invalid');
    expect(bandCheck(pkg(4), Number.NaN)).toBe('invalid');
  });

  it('BandCheck_UsesWholeCents_SoTheEdgeIsExact', () => {
    expect(bandCheck(pkg(0.1), 0.15)).toBe('apply');
  });

  it('BandCheck_Holds_WhenThePriceIsInsideTheBandOfTheCurrentPriceButOutsideTheAnchors', () => {
    expect(bandCheck({ price: 6, anchorPrice: 4, yield: 10 }, 8)).toBe('hold');
  });

  it('BandCheck_Applies_WhenThePriceIsInsideTheAnchorsBand_EvenFarFromTheCurrentPrice', () => {
    expect(bandCheck({ price: 6, anchorPrice: 4, yield: 10 }, 2)).toBe('apply');
  });

  it('BandCheck_IsSame_WhenThePriceEqualsTheCurrentPrice_EvenIfTheAnchorDiffers', () => {
    expect(bandCheck({ price: 6, anchorPrice: 4, yield: 10 }, 6)).toBe('same');
  });

  it('BandCheck_FallsBackToThePrice_WhenThereIsNoAnchor', () => {
    expect(bandCheck({ price: 4, yield: 10 }, 6.01)).toBe('hold');
  });

  it('BandCheck_Holds_WhenTheAnchorIsZero', () => {
    expect(bandCheck({ price: 4, anchorPrice: 0, yield: 10 }, 3)).toBe('hold');
  });
});
