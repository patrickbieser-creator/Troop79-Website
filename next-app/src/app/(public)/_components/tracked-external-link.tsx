'use client';

/**
 * A plain outbound <a target="_blank"> that also fires a dataLayer event on
 * click — for external links rendered from Server Components (library
 * resource cards, merit badge BSA/workbook links), which can't carry an
 * onClick themselves. The Server Component renders this Client Component as
 * a child; nothing else about it needs to move to the client.
 */
import type { CSSProperties, ReactNode } from 'react';
import { trackEvent, type AnalyticsEvent } from '@/lib/analytics';

export function TrackedExternalLink({
  href,
  className,
  style,
  event,
  params,
  children
}: {
  href: string;
  className?: string;
  style?: CSSProperties;
  event: AnalyticsEvent;
  params?: Record<string, string | number | boolean>;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      style={style}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackEvent(event, params)}
    >
      {children}
    </a>
  );
}
