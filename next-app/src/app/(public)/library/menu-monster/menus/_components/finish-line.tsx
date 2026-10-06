/**
 * The Shopping step's finishing line (Plans/Menu-Monster-Planner-Flow.md, part c): the step's done-state under
 * the totals card. Derived, never stored: nothing left to fix reads "Ready to shop" with the end-of-flow actions
 * beside it (Print, and Share for the owner of a saved menu); something left reads "N to fix before shopping" as
 * a button or link to the first fix, never a dead end. Canonical rendering: /admin/styleguide/public.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/app/_components/button';
import s from './workspace.module.css';

export function FinishLine({ toFix, fix, onPrint, shareHref }: { toFix: number; fix: { onClick: () => void } | { href: string }; onPrint: () => void; shareHref?: string | null }) {
  const label: ReactNode = `${toFix} to fix before shopping`;
  return (
    <div className={s.finishLine} role="group" aria-label="Shopping status">
      {toFix === 0 ? (
        <span className={s.finishReady}>Ready to shop</span>
      ) : 'href' in fix ? (
        <Link className={s.finishFix} href={fix.href}>
          {label}
        </Link>
      ) : (
        <button type="button" className={s.finishFix} onClick={fix.onClick}>
          {label}
        </button>
      )}
      <Button variant="secondary" onClick={onPrint}>
        Print
      </Button>
      {toFix === 0 && shareHref && (
        <Link className={s.finishShare} href={shareHref}>
          Share
        </Link>
      )}
    </div>
  );
}
