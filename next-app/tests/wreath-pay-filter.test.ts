import { describe, it, expect } from 'vitest';
import { parsePayFilter } from '../src/app/admin/(workspace)/finance/wreaths/pay-filter';

describe('wreath orders ?pay filter', () => {
  it.each(['paid', 'unpaid', 'cancelled'])('PayFilter_Keeps_%s', (v) => {
    expect(parsePayFilter(v)).toBe(v);
  });

  it.each([undefined, '', 'refunded', 'UNPAID', '<script>', 'unpaid,paid'])('PayFilter_IgnoresJunk_%s', (v) => {
    expect(parsePayFilter(v as string | undefined)).toBe('');
  });
});
