import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '../src/lib/safe-redirect';

/**
 * Open-redirect guard (lib/safe-redirect.ts) — the one guard a phishing
 * redirect targeting /signin's next_path (stored in login_tokens, read back
 * out of the database on redemption — the app's highest-value form) would
 * actually try to exploit. Flagged as missing test coverage in qa-lead
 * review 2026-08-06, despite the plan's Test Plan listing
 * NextPath_IsRejected_WhenItEscapesTheOrigin() — this closes that gap.
 */
describe('safeInternalPath — open-redirect guard', () => {
  it('NextPath_IsRejected_WhenItEscapesTheOrigin', () => {
    expect(safeInternalPath('http://evil.com', '/profile')).toBe('/profile');
    expect(safeInternalPath('https://evil.com/phish', '/profile')).toBe('/profile');
    expect(safeInternalPath('//evil.com', '/profile')).toBe('/profile');
    // The backslash trick — WHATWG URL parsers (and browsers resolving a
    // Location header) treat \ as / for special schemes, so a bare
    // startsWith('/') check would wrongly accept this.
    expect(safeInternalPath('/\\evil.com', '/profile')).toBe('/profile');
    expect(safeInternalPath('javascript:alert(1)', '/profile')).toBe('/profile');
  });

  it('InternalPath_IsAccepted_WhenItStaysOnOrigin', () => {
    expect(safeInternalPath('/library/submit-proof?target=rank_req:scout-1a', '/profile')).toBe(
      '/library/submit-proof?target=rank_req:scout-1a'
    );
    expect(safeInternalPath('/profile#section', '/profile')).toBe('/profile#section');
  });

  it('FallbackIsUsed_WhenNextIsEmptyOrMissing', () => {
    expect(safeInternalPath(undefined, '/profile')).toBe('/profile');
    expect(safeInternalPath(null, '/profile')).toBe('/profile');
    expect(safeInternalPath('', '/profile')).toBe('/profile');
  });
});
