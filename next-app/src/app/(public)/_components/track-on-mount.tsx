'use client';

/**
 * Fires one dataLayer event when this component first renders on the client,
 * then never again — for tracking a moment a Server Component page reaches
 * (viewed the signup form, form became visible, proof was accepted) rather
 * than a click. Renders nothing; mount it wherever that moment is already
 * conditionally rendered so it inherits the same gate.
 */
import { useEffect, useRef } from 'react';
import { trackEvent, type AnalyticsEvent } from '@/lib/analytics';

export function TrackOnMount({
  event,
  params
}: {
  event: AnalyticsEvent;
  params?: Record<string, string | number | boolean>;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackEvent(event, params);
    // Deliberately fire-once on mount only — params are read at mount time,
    // not re-tracked if a parent re-renders with new prop values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
