/**
 * Client-side custom event tracking via GTM's dataLayer (Plans/GTM-Custom-Events,
 * follow-up to the GA4/GTM setup in app/layout.tsx). Unconfigured is a no-op,
 * not a crash — same rule lib/email.ts and lib/bunny-storage.ts apply to their
 * own optional integrations: `dataLayer` is absent whenever GTM isn't wired up
 * (local dev, GTM env var unset) or before the async gtm.js has run yet, and
 * every call site should behave identically either way.
 *
 * PII RULE: params are string | number | boolean ONLY — no objects, so a
 * scout/household record can never be spread in by accident. Name params
 * generically (resource_id, mb_id, rank_code) — never personally
 * (scout_name, email). Enforced at the type level rather than with a runtime
 * scrubber; a deny-list scrubber is exactly the kind of second mechanism this
 * codebase avoids (see feedback-simplify-dont-layer in project memory).
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** Keep in lockstep with the GTM triggers built for each event. */
export type AnalyticsEvent =
  | 'event_signup_view'
  | 'event_signup_start'
  | 'event_signup_complete'
  | 'library_resource_click'
  | 'proof_submitted'
  | 'outbound_bsa_click'
  | 'ics_subscribe_click';

export function trackEvent(
  event: AnalyticsEvent,
  params: Record<string, string | number | boolean> = {}
): void {
  if (typeof window === 'undefined' || !Array.isArray(window.dataLayer)) return;
  window.dataLayer.push({ event, ...params });
}
