'use client';

/**
 * The planner's summary rail (Plans/Menu-Monster-Planner-Flow.md, part b, guideline 3): one sticky line under
 * the site header — "8 people · $3.10/person/meal · 3 to fix ›" — on every step, so the cost is never a
 * surprise at the end. Tapping the text opens a bottom sheet with the headcount, the diets above zero, the
 * total, the budget and the to-fix list, each row a link to the control that answers it. The right end is the
 * ONE primary of the screen (guideline 7): the Plan tab's Save while dirty and "Next: …" when clean, a plain
 * "Next: …" link on the other steps — handed in as `children`.
 *
 * It only displays a PlanProgress (menu-view.ts planProgress): a server page hands in the SAVED menu's, the Plan
 * tab its unsaved draft's and says so with `unsaved`. Headcount is only ever what was typed (decision 4).
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { FixTarget, PlanProgress } from '@/lib/menu-monster/menu-view';
import { priceText as money } from '@/lib/menu-monster/units';
import s from './summary-rail.module.css';

export interface RailHrefs {
  /** The plan route. */
  plan: string;
  /** Null where there is no such page to link to (a menu not saved yet): the row is plain text. */
  gear: string | null;
  shopping: string | null;
}

/** Where a "to fix" row goes: the step's route, plus #meal-<id> or ?item=<ingredientId> inside it. */
export function fixHref(t: FixTarget, h: RailHrefs): string | null {
  switch (t.step) {
    case 'eating':
      return h.plan;
    case 'meals':
      return t.mealId ? `${h.plan}#meal-${t.mealId}` : `${h.plan}#meals`;
    case 'gear':
      return h.gear;
    case 'shopping':
      return h.shopping == null ? null : t.ingredientId ? `${h.shopping}?item=${encodeURIComponent(t.ingredientId)}` : h.shopping;
  }
}

export function SummaryRail({ progress, hrefs, unsaved = false, children }: { progress: PlanProgress; hrefs: RailHrefs; unsaved?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const people = `${progress.headcount} ${progress.headcount === 1 ? 'person' : 'people'}`;
  const text = [people, progress.hasCost ? `${money(progress.perPersonMeal)}/person/meal` : null, progress.toFix > 0 ? `${progress.toFix} to fix` : 'nothing to fix'].filter(Boolean).join(' · ');

  return (
    <div className={s.rail} role="region" aria-label="Menu summary">
      <button type="button" ref={triggerRef} className={s.summary} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={s.text}>{text}</span>
        <span className={s.chev} aria-hidden="true">
          ›
        </span>
      </button>
      {unsaved && <span className={s.unsaved}>unsaved</span>}
      {children != null && <div className={s.right}>{children}</div>}

      {open && (
        <>
          <button type="button" className={s.backdrop} tabIndex={-1} aria-label="Close summary" onClick={() => setOpen(false)} />
          <div
            className={s.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${uid}-h`}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          >
            <div className={s.sheetHead}>
              <h2 id={`${uid}-h`} className={s.sheetTitle}>
                This menu{unsaved ? ' (unsaved changes)' : ''}
              </h2>
              <button type="button" ref={closeRef} className={s.close} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <dl className={s.facts}>
              <div className={s.fact}>
                <dt>People</dt>
                <dd>{progress.headcount}</dd>
              </div>
              {progress.diets.map((d) => (
                <div key={d.key} className={s.fact}>
                  <dt>{d.label}</dt>
                  <dd>{d.count}</dd>
                </div>
              ))}
              {progress.hasCost && (
                <div className={s.fact}>
                  <dt>Total</dt>
                  <dd>{money(progress.total)}</dd>
                </div>
              )}
              <div className={s.fact}>
                <dt>Budget</dt>
                <dd>{money(progress.budget)} a person, per meal</dd>
              </div>
            </dl>
            <h3 className={s.fixHead}>To fix</h3>
            {progress.fixes.length === 0 ? (
              <p className={s.none}>Nothing to fix.</p>
            ) : (
              <ul className={s.fixes}>
                {progress.fixes.map((f) => {
                  const href = fixHref(f.target, hrefs);
                  return (
                    <li key={`${f.target.step}-${f.text}`}>
                      {href != null ? (
                        <Link className={s.fixLink} href={href} onClick={() => setOpen(false)}>
                          {f.text}
                          <span aria-hidden="true"> ›</span>
                        </Link>
                      ) : (
                        <span className={s.fixPlain}>{f.text}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
