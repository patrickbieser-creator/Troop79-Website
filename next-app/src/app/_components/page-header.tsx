/**
 * Shared public page header — kicker, display title, optional lede (calm
 * restyle R1, 2026-10-03: no header rule). Replaces the per-screen .pageHeader/.pageTitle blocks (11 files + 2
 * inline copies at audit). Canonical rendering: /admin/styleguide/public.
 * Phase A of Plans/Public-Design-System.md.
 */
import type { ReactNode } from 'react';
import s from './page-header.module.css';

export function KickerSep() {
  return <span className={s.kickerSep}>·</span>;
}

export function PageHeader({
  kicker,
  title,
  lede
}: {
  kicker?: ReactNode;
  /** Omit when the page renders its own h1 (an editable title, a record name). */
  title?: ReactNode;
  lede?: ReactNode;
}) {
  return (
    <header className={s.pageHeader}>
      {kicker != null && <div className={s.kicker}>{kicker}</div>}
      {title != null && <h1 className={s.pageTitle}>{title}</h1>}
      {lede != null && <p className={s.pageLede}>{lede}</p>}
    </header>
  );
}
