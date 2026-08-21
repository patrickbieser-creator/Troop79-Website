/**
 * Shared public Badge — semantic uppercase pill. Mirrors the admin Badge's
 * API shape, implemented on the public tokens. Tones: neutral | success |
 * warning | danger | info | accent (khaki/bark — the "your scout completed
 * this" personalization signal). Canonical rendering: /admin/styleguide/public.
 */
import type { ReactNode } from 'react';
import s from './badge.module.css';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export function Badge({
  tone = 'neutral',
  caps = true,
  className,
  children
}: {
  tone?: BadgeTone;
  /** false — keep mixed case (dates, names); default badges are uppercase. */
  caps?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={[s.badge, s[tone], caps ? null : s.noCaps, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}
