/**
 * The planner's step strip (Plans/Menu-Monster-Planner-Flow.md, part b): Who's eating → Meals → Gear →
 * Shopping, with What we bought joining once the outing is over. Each step is a link to its own route, a
 * done one is ticked, the current one is highlighted — and none is ever locked (a patrol plans out of order;
 * a locked step is a stalled patrol). Who's eating and Meals are two screens, two routes (2026-10-06).
 * Share is a quiet action at the end, not a step.
 *
 * Pure markup on public tokens: it renders for a server page (saved progress) and for the Plan tab (the
 * draft's progress) alike. Canonical rendering: /admin/styleguide/public.
 */

import Link from 'next/link';
import type { StepKey } from '@/lib/menu-monster/menu-view';
import s from './step-strip.module.css';

export type StepCurrent = StepKey | 'bought' | 'review' | 'share';

export interface StepStripConfig {
  /** The Who's eating route. */
  people: string;
  /** The plan route: the Meals step. */
  plan: string;
  gear: string;
  shopping: string;
  /** Present once What we bought should show. */
  bought?: string;
  /** A leader's fifth step (Patrick, 2026-10-06: Review was "almost invisible on the right"); absent for everyone else. */
  review?: string;
  /** A quiet action at the end: the owner's "Share". */
  share?: { label: string; href: string };
}

const LABELS: Record<StepKey, string> = { eating: 'Who’s eating', meals: 'Meals', gear: 'Gear', shopping: 'Shopping' };

export function StepStrip({ config, done = {}, current }: { config: StepStripConfig; done?: Partial<Record<StepKey, boolean>>; current: StepCurrent | StepCurrent[] }) {
  const now = new Set(Array.isArray(current) ? current : [current]);
  const steps: { key: StepCurrent; label: string; href: string }[] = [
    { key: 'eating', label: LABELS.eating, href: config.people },
    { key: 'meals', label: LABELS.meals, href: config.plan },
    { key: 'gear', label: LABELS.gear, href: config.gear },
    { key: 'shopping', label: LABELS.shopping, href: config.shopping },
    ...(config.bought ? [{ key: 'bought' as const, label: 'What we bought', href: config.bought }] : []),
    ...(config.review ? [{ key: 'review' as const, label: 'Review', href: config.review }] : [])
  ];
  return (
    <nav aria-label="Menu steps" className={s.nav}>
      <ol className={s.strip}>
        {steps.map((st) => {
          const isDone = st.key !== 'bought' && st.key !== 'review' && st.key !== 'share' && done[st.key] === true;
          const isNow = now.has(st.key);
          return (
            <li key={st.key} className={s.item}>
              <Link href={st.href} className={isNow ? `${s.step} ${s.current}` : s.step} aria-current={isNow ? 'step' : undefined}>
                {isDone && (
                  <span className={s.tick} aria-hidden="true">
                    ✓
                  </span>
                )}
                {st.label}
                {isDone && <span className={s.srOnly}> (done)</span>}
              </Link>
            </li>
          );
        })}
      </ol>
      {config.share && (
        <Link href={config.share.href} className={now.has('share') ? `${s.action} ${s.current}` : s.action} aria-current={now.has('share') ? 'page' : undefined}>
          {config.share.label}
        </Link>
      )}
    </nav>
  );
}
