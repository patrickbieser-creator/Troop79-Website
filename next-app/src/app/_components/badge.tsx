/**
 * Shared public Badge — a small tinted pill. Mirrors the admin Badge's API
 * shape, implemented on the public tokens. Tones: neutral | success |
 * warning | danger | info | accent (khaki/bark — the "your scout completed
 * this" personalization signal). Sentence case since the calm restyle R1
 * (2026-10-03), so the old `caps` switch is gone. Canonical rendering:
 * /admin/styleguide/public.
 */
import type { ReactNode } from 'react';
import s from './badge.module.css';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export function Badge({
  tone = 'neutral',
  className,
  children
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={[s.badge, s[tone], className].filter(Boolean).join(' ')}>{children}</span>;
}
