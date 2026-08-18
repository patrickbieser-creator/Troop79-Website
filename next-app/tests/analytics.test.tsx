import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { trackEvent } from '../src/lib/analytics';

/**
 * lib/analytics.ts's whole job is to be a safe no-op whenever GTM hasn't
 * loaded `dataLayer` yet (or isn't configured at all) — the same
 * unconfigured-is-a-no-op rule as email.ts/bunny-storage.ts, just enforced by
 * reading `window.dataLayer` instead of an env var. `.test.tsx` (not
 * `.test.ts`) so this runs in the jsdom project and gets a real `window`.
 */
describe('trackEvent', () => {
  afterEach(() => {
    delete (window as { dataLayer?: unknown[] }).dataLayer;
  });

  it('does nothing when window.dataLayer does not exist', () => {
    expect(window.dataLayer).toBeUndefined();
    expect(() => trackEvent('ics_subscribe_click', { provider: 'google' })).not.toThrow();
    expect(window.dataLayer).toBeUndefined();
  });

  it('does nothing when window.dataLayer is not an array', () => {
    (window as { dataLayer?: unknown }).dataLayer = 'not-an-array';
    expect(() => trackEvent('ics_subscribe_click', { provider: 'google' })).not.toThrow();
  });

  describe('once dataLayer exists', () => {
    beforeEach(() => {
      window.dataLayer = [];
    });

    it('pushes the event name and params as one object', () => {
      trackEvent('library_resource_click', { resource_id: 42, resource_kind: 'link' });
      expect(window.dataLayer).toEqual([
        { event: 'library_resource_click', resource_id: 42, resource_kind: 'link' }
      ]);
    });

    it('pushes an event with no params as just the event name', () => {
      trackEvent('event_signup_view');
      expect(window.dataLayer).toEqual([{ event: 'event_signup_view' }]);
    });

    it('appends rather than replacing prior entries', () => {
      window.dataLayer!.push({ 'gtm.start': 1 });
      trackEvent('proof_submitted', { target_kind: 'mb_req' });
      expect(window.dataLayer).toEqual([
        { 'gtm.start': 1 },
        { event: 'proof_submitted', target_kind: 'mb_req' }
      ]);
    });
  });
});
