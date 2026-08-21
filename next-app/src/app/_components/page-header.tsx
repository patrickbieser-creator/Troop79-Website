/**
 * Shared public page header — kicker, display title, optional lede, hairline
 * rule. Replaces the per-screen .pageHeader/.pageTitle blocks (11 files + 2
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
  lede,
  rule = true
}: {
  kicker?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  rule?: boolean;
}) {
  return (
    <header className={s.pageHeader}>
      {kicker != null && <div className={s.kicker}>{kicker}</div>}
      <h1 className={s.pageTitle}>{title}</h1>
      {lede != null && <p className={s.pageLede}>{lede}</p>}
      {rule && <div className={s.headRule} />}
    </header>
  );
}
