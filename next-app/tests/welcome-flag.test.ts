import { describe, it, expect } from 'vitest';
import { withWelcomeFlag } from '../src/lib/welcome-flag';

/**
 * Signal for the one-time passkey offer (Plans/Verified-Signup.md, Phase A):
 * only /events/ paths get `welcome=1` appended, applied AFTER
 * safeInternalPath has already resolved the redirect target.
 */
describe('withWelcomeFlag — one-time passkey-offer signal', () => {
  it('WithWelcomeFlag_AddsFlagOnlyForEventPaths', () => {
    expect(withWelcomeFlag('/events/12/signup')).toBe('/events/12/signup?welcome=1');
    expect(withWelcomeFlag('/profile')).toBe('/profile');
    expect(withWelcomeFlag('/member')).toBe('/member');
    expect(withWelcomeFlag('/')).toBe('/');
  });

  it('WithWelcomeFlag_AppendsWithAmpersand_WhenAQueryAlreadyExists', () => {
    expect(withWelcomeFlag('/events/12/signup?gate=1')).toBe('/events/12/signup?gate=1&welcome=1');
  });

  it('WithWelcomeFlag_InsertsBeforeAnyHash', () => {
    expect(withWelcomeFlag('/events/12/signup#jobs')).toBe('/events/12/signup?welcome=1#jobs');
    expect(withWelcomeFlag('/events/12/signup?gate=1#jobs')).toBe('/events/12/signup?gate=1&welcome=1#jobs');
  });

  it('WithWelcomeFlag_LeavesNonEventsPathsCompletelyUntouched', () => {
    // Never breaks safeInternalPath's guarantees — a fallback like '/profile'
    // (or anything else outside /events/) passes through byte-for-byte.
    expect(withWelcomeFlag('/events-archive/foo')).toBe('/events-archive/foo');
    expect(withWelcomeFlag('/profile?x=1#y')).toBe('/profile?x=1#y');
  });
});
