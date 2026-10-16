import { describe, expect, it } from 'vitest';
import { stripeErrorText } from '@/lib/wreaths/card-payments';

// A Stripe connection error hides the real cause in `detail` (production refund, 2026-10-16: the log said only
// "An error occurred with our connection to Stripe"). The log line must carry it.
describe('stripeErrorText', () => {
  it('ConnectionError_IncludesTheUnderlyingCause', () => {
    const e = Object.assign(new Error('An error occurred with our connection to Stripe. Request was retried 2 times.'), {
      type: 'StripeConnectionError',
      detail: Object.assign(new Error('Invalid character in header content ["Authorization"]'), { code: 'ERR_INVALID_CHAR' })
    });
    expect(stripeErrorText(e)).toContain('ERR_INVALID_CHAR');
  });

  it('ApiError_IncludesTypeCodeAndRequestId', () => {
    const e = Object.assign(new Error('The provided key does not have the required permissions'), {
      type: 'StripePermissionError',
      code: 'secret_key_required',
      requestId: 'req_123'
    });
    expect(stripeErrorText(e)).toBe('StripePermissionError | secret_key_required | req_123 | The provided key does not have the required permissions');
  });

  it('NonError_IsStringified', () => {
    expect(stripeErrorText('boom')).toBe('boom');
  });
});
