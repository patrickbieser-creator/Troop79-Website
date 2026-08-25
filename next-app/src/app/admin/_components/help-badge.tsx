'use client';

/**
 * HelpBadge — the ? in a circle that opens a small popover of reference
 * material beside the thing it explains (Patrick, 2026-08-25: page ledes
 * were carrying pill legends and field consequences; those move here, one
 * badge per thing, copy in `admin/help.tsx`).
 *
 * A POPOVER, deliberately not a tooltip. WCAG 2.2 SC 1.4.13 (content on
 * hover or focus) wants it dismissible without moving the pointer (Esc),
 * hoverable (the pointer can travel onto the text), and persistent (it stays
 * until dismissed) — and touch has no hover at all. So: a real button that
 * opens on click / tap / Enter / Space — not on hover (Patrick, 2026-08-25,
 * after tuning: 320px, 20px circle, click only) — closes on Esc (focus returns to the badge), on the × or on a click
 * outside, and never on a timer. The panel is `role="dialog"` (non-modal)
 * so its title is announced and links inside are reachable.
 *
 * Placement flips above the badge when there is no room below, and the panel
 * slides sideways to stay inside the viewport — the only inline style, and
 * it is measured, not designed. Tune it on /admin/styleguide/help-sample.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HELP, type HelpId } from '../help';
import styles from './help-badge.module.css';

export type HelpPlacement = 'auto' | 'top' | 'bottom';
export type HelpBadgeSize = 16 | 20 | 24;

export interface HelpBadgeProps {
  /** Key into the help map. Either this or title + children. */
  id?: HelpId | (string & {});
  /** Inline alternative to the map — for one-off content in a sample. */
  title?: string;
  children?: ReactNode;
  placement?: HelpPlacement;
  /** Panel width cap in px. */
  maxWidth?: number;
  /** Visible circle size; the hit area is always ≥ 44px. */
  size?: HelpBadgeSize;
  /** Open on hover too (after `hoverDelay` ms). Off by default (Patrick,
   *  2026-08-25); click always works. */
  hoverOpens?: boolean;
  hoverDelay?: number;
  className?: string;
}

const VIEWPORT_PAD = 8;
const GAP = 6;

export function HelpBadge({
  id,
  title,
  children,
  placement = 'auto',
  maxWidth = 320,
  size = 20,
  hoverOpens = false,
  hoverDelay = 150,
  className
}: HelpBadgeProps) {
  const entry = id !== undefined ? (HELP as Record<string, { title: string; body: ReactNode }>)[id] : undefined;
  if (id !== undefined && !entry) {
    throw new Error(`HelpBadge: "${id}" is not in the help map (src/app/admin/help.tsx)`);
  }
  const heading = entry?.title ?? title ?? 'Help';
  const body = entry?.body ?? children;

  const popId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  // Opened by click / keyboard — a pointer leaving must not close it.
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ above: boolean; shift: number }>({ above: placement === 'top', shift: 0 });

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setPinned(false);
    if (returnFocus) btnRef.current?.focus();
  }, []);

  // Measure once open: flip above when the panel would run off the bottom
  // and there is more room above; slide sideways to stay in the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    const b = btn.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let above = placement === 'top';
    if (placement === 'auto') {
      const roomBelow = vh - b.bottom - GAP;
      const roomAbove = b.top - GAP;
      above = roomBelow < p.height && roomAbove > roomBelow;
    }
    // The panel is centred on the badge by CSS; shift keeps it on screen.
    const centre = b.left + b.width / 2;
    const left = centre - p.width / 2;
    const right = centre + p.width / 2;
    let shift = 0;
    if (left < VIEWPORT_PAD) shift = VIEWPORT_PAD - left;
    else if (right > vw - VIEWPORT_PAD) shift = vw - VIEWPORT_PAD - right;
    setPos({ above, shift });
  }, [open, placement, maxWidth]);

  // Esc anywhere closes and returns focus; a click outside just closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    }
    function onDown(e: MouseEvent | TouchEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open, close]);

  useEffect(
    () => () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    },
    []
  );

  function toggle() {
    if (open && pinned) close(false);
    else {
      setOpen(true);
      setPinned(true);
    }
  }
  function onEnter() {
    if (!hoverOpens || open) return;
    hoverTimer.current = window.setTimeout(() => setOpen(true), hoverDelay);
  }
  function onLeave() {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (open && !pinned) setOpen(false);
  }

  const panelStyle: CSSProperties = {
    /* dynamic — measured against the viewport on open */
    maxWidth: `${maxWidth}px`,
    transform: `translateX(calc(-50% + ${pos.shift}px))`
  };

  return (
    <span ref={wrapRef} className={`${styles.wrap} ${className ?? ''}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        ref={btnRef}
        type="button"
        className={styles.trigger}
        data-size={size}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={`Help: ${heading}`}
        onClick={toggle}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <div
          ref={popRef}
          id={popId}
          role="dialog"
          aria-label={heading}
          className={`${styles.panel} ${pos.above ? styles.above : styles.below}`}
          style={panelStyle}
        >
          <div className={styles.head}>
            <span className={styles.title}>{heading}</span>
            <button type="button" className={styles.close} aria-label="Close help" onClick={() => close(true)}>
              ×
            </button>
          </div>
          <div className={styles.body}>{body}</div>
        </div>
      )}
    </span>
  );
}
