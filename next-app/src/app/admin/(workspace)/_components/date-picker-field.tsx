'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DayPicker, getDefaultClassNames } from 'react-day-picker';
import 'react-day-picker/style.css';
import styles from './date-picker-field.module.css';

/**
 * Shared admin date field: a text input showing the formatted date, backed
 * by a react-day-picker calendar popover. Replaces bare `<input type="date">`
 * (poor, browser-inconsistent UX) — first landed on the Events lookup editor,
 * intended for reuse across the other admin date fields over time.
 *
 * Design per ux-lead review 2026-08-05: anchored popover on desktop
 * (position:fixed, portal to #admin-popover-root — sidesteps clipping from
 * scrollable table ancestors like `.scrollWrap` without needing a
 * Popper/Floating-UI dependency; portals into .adminRoot's DOM subtree,
 * not document.body, so it still inherits the --admin-* CSS custom
 * properties admin.module.css scopes to .adminRoot), centered dialog on
 * mobile, close-on-scroll instead of live repositioning, manual Tab trap +
 * Escape + outside-click.
 *
 * Native <dialog> hosts (added 2026-08-05, rollout to modal call sites):
 * a native `<dialog>` shown via `showModal()` promotes to the browser's
 * top layer, rendering above ALL normal-stacking-context content — z-index
 * cannot beat that. A popover portaled to #admin-popover-root (a sibling
 * further up the tree, not inside the dialog) would render BEHIND an open
 * dialog. Fix: at open time, portal into the nearest ancestor <dialog>
 * instead, if one is open — dialogs still live inside .adminRoot in the
 * DOM tree, so CSS variable inheritance is unaffected; only the portal
 * target changes. Falls back to #admin-popover-root / document.body when
 * there's no dialog ancestor. Per fable architecture review 2026-08-05:
 * fixing at the portal-target level, not by rebuilding the popover on the
 * native Popover API — smaller, one-component change, no new browser-API
 * surface for a 30-scout admin tool.
 */

/** Parse a 'YYYY-MM-DD' ledger-style date string as a LOCAL calendar date —
 *  never via `new Date(iso)`, which the JS spec parses as UTC midnight and
 *  renders a day early in any timezone west of UTC. */
function parseISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toISO(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function formatDisplay(iso: string): string {
  const date = parseISO(iso);
  if (!date) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Tolerant free-typed parser: ISO ('2026-07-25'), US slash ('7/25/2026'),
 *  or anything else `Date.parse` understands ('Jul 25, 2026'). */
function parseTyped(text: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const iso = parseISO(trimmed);
  if (iso) return iso;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slash) {
    const [, mo, d, y] = slash;
    const date = new Date(Number(y), Number(mo) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const MOBILE_BREAKPOINT = 560;

const CALENDAR_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M1.5 6h13" stroke="currentColor" strokeWidth="1.3" />
    <path d="M4.5 1.5v2M11.5 1.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export interface DatePickerFieldProps {
  /** 'YYYY-MM-DD', or '' for no date set. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Hide the calendar-icon button for very narrow table cells — the text
   *  field alone still opens the popover on click (or ArrowDown). */
  compact?: boolean;
  className?: string;
  /** Put an id on the visible input so an external <label htmlFor> binds to it. */
  id?: string;
  /** Id of an element describing this field — /profile uses it to announce
   *  "awaiting review, record still says X" after the field's name. */
  'aria-describedby'?: string;
  /**
   * Submit the ISO value under this name via a hidden input. The visible field
   * holds a FORMATTED date ('Aug 14, 2026'), so it can never be the submitted
   * one — this is what lets the plain `method="get"` report forms (Scoutbook
   * Export, the meeting attendance report) use this control at all.
   */
  name?: string;
}

export function DatePickerField({
  value,
  onChange,
  disabled,
  placeholder = 'Select date',
  compact = false,
  className,
  id,
  name,
  'aria-describedby': describedBy
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => formatDisplay(value));
  const [invalid, setInvalid] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();

  // Keep the displayed text in sync with the committed value while closed —
  // adjusted during render (React's documented pattern for "reset state when
  // a prop changes"), not in an effect, so an external `value` update (e.g.
  // the parent's `rows` prop refreshing) is reflected without an extra paint.
  const [lastValue, setLastValue] = useState(value);
  if (!open && value !== lastValue) {
    setLastValue(value);
    setText(formatDisplay(value));
    setInvalid(false);
  }

  function openPopover() {
    // The `open` guard matters beyond dedup: this fires from the input's
    // click and ArrowDown handlers and from the icon button, and resetting
    // `pos` to null while already open — with no `open`/`mobile` change to
    // re-trigger the positioning effect below — would strand the popover
    // invisible.
    if (disabled || open) return;
    setMobile(typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT);
    setPos(null);
    // Portal into the nearest open ancestor <dialog> so the popover shares
    // its top-layer promotion (see file-header comment); otherwise the
    // usual #admin-popover-root / document.body fallback chain.
    const dialog = wrapRef.current?.closest('dialog');
    setPortalTarget(
      dialog && dialog.open ? dialog : (document.getElementById('admin-popover-root') ?? document.body)
    );
    setOpen(true);
  }

  const closePopover = useCallback(
    (returnFocus = false) => {
      setOpen(false);
      // Revert any uncommitted/invalid typed text back to the authoritative
      // value (covers Escape / outside-click / icon-toggle with garbage
      // input still in the field — commitText() only runs on blur/Enter).
      setText(formatDisplay(value));
      setInvalid(false);
      setLastValue(value);
      if (returnFocus) {
        wrapRef.current?.querySelector('input')?.focus();
      }
    },
    [value]
  );

  /** Returns true if the typed text committed cleanly (empty or parseable) —
   *  false on unparseable text, so callers (Enter) can leave the popover
   *  open with the inline error instead of closing on a rejected edit. */
  function commitText(): boolean {
    if (!text.trim()) {
      setInvalid(false);
      if (value !== '') onChange('');
      return true;
    }
    const parsed = parseTyped(text);
    if (!parsed) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    onChange(toISO(parsed));
    return true;
  }

  /* Latest-ref so the document-level pointerdown listener can commit typed
     text without re-subscribing on every keystroke (and without capturing a
     stale `text`). Assigned in an effect, not during render — refs must not
     be written while rendering. */
  const commitRef = useRef(commitText);
  useEffect(() => {
    commitRef.current = commitText;
  });

  function selectDay(date: Date | undefined) {
    if (!date) return;
    onChange(toISO(date));
    closePopover(true);
  }

  function clear() {
    onChange('');
    closePopover(true);
  }

  // Position the popover against the trigger once both are laid out
  // (desktop only — mobile centers via CSS, see .popoverMobile).
  useLayoutEffect(() => {
    if (!open || mobile) return;
    const trigger = wrapRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const rect = trigger.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom;
    const placeAbove = spaceBelow < popRect.height + 8 && rect.top > popRect.height + 8;
    let left = rect.left;
    if (left + popRect.width > vw - 8) left = vw - popRect.width - 8;
    if (left < 8) left = 8;
    const top = placeAbove ? rect.top - popRect.height - 6 : rect.bottom + 6;
    setPos({ top, left });
  }, [open, mobile]);

  // Outside click, Escape, Tab-trap, and close-on-scroll (the per-row
  // instance lives inside `.scrollWrap`, which is `overflow-y: auto` —
  // repositioning live on scroll is more complexity than this needs, so we
  // just close, same as any native browser popover would on scroll-away).
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      // COMMIT the typed text rather than discarding it.
      //
      // This listener runs before the input's blur. It used to call
      // closePopover(), which resets `text` back to the old committed value —
      // so the blur that followed handed commitText() the OLD text and
      // committed that. The effect was that typing a date and then clicking
      // any button (rather than pressing Enter or tabbing) silently reverted
      // the field to its previous value, and the click itself was spent
      // closing the popover. On a field defaulting to the next Sunday, every
      // typed date came out as that Sunday — reported 2026-08-08 as new
      // meetings "assigning it into the next available Sunday no matter which
      // date I am entering".
      //
      // Unparseable text still reverts: there is nothing to commit, and
      // leaving garbage in a closed field would be worse.
      if (commitRef.current()) setOpen(false);
      else closePopover();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePopover(true);
        return;
      }
      if (e.key !== 'Tab') return;
      const popover = popoverRef.current;
      if (!popover) return;
      const focusable = popover.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex="0"]'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    function onScroll() {
      closePopover();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, closePopover]);

  const selected = parseISO(value) ?? undefined;
  const defaultClassNames = getDefaultClassNames();

  const popover =
    open && portalTarget
      ? createPortal(
          <>
            {mobile && <div className={styles.backdrop} onClick={() => closePopover(true)} />}
            <div
              ref={popoverRef}
              role="dialog"
              aria-modal="true"
              aria-label="Choose date"
              id={dialogId}
              className={mobile ? styles.popoverMobile : styles.popover}
              style={
                mobile
                  ? undefined
                  : { top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }
              }
            >
              <DayPicker
                mode="single"
                selected={selected}
                defaultMonth={selected ?? new Date()}
                onSelect={selectDay}
                autoFocus
                classNames={{ root: `${defaultClassNames.root} ${styles.calendarRoot}` }}
                footer={
                  <div className={styles.footer}>
                    <button type="button" className={styles.footerBtn} onClick={clear}>
                      Clear
                    </button>
                    <button
                      type="button"
                      className={`${styles.footerBtn} ${styles.footerToday}`}
                      onClick={() => selectDay(new Date())}
                    >
                      Today
                    </button>
                  </div>
                }
              />
            </div>
          </>,
          portalTarget
        )
      : null;

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrapper} ${disabled ? styles.wrapperDisabled : ''} ${className ?? ''}`}
    >
      {name && <input type="hidden" name={name} value={value} />}
      <input
        id={id}
        aria-describedby={describedBy}
        type="text"
        className={styles.input}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        /*
         * Opens on CLICK, not on focus (changed 2026-08-12, Patrick).
         *
         * A `<dialog>` shown with showModal() focuses its first focusable
         * descendant, and in two editors that is a date field — the Events
         * entry form and the ledger's row-edit modal. Opening on focus meant
         * the calendar sprang open over the form the instant the editor
         * launched, covering the fields the user came to edit. It also fired
         * on every Tab through a form with several date fields.
         *
         * Keyboard access is unaffected: ArrowDown (the standard combobox
         * affordance for this input's role) opens it, as does the calendar
         * icon button — and typing a date straight into the field, which is
         * the fastest path, never needed the popover at all.
         */
        onClick={openPopover}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            openPopover();
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            // Only close on a clean commit — an unparseable date leaves the
            // popover open with the inline error so the user can fix it.
            if (commitText()) closePopover(true);
          }
        }}
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
      />
      {!compact && (
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => (open ? closePopover(true) : openPopover())}
          disabled={disabled}
          aria-label="Open calendar"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {CALENDAR_ICON}
        </button>
      )}
      {invalid && <span className={styles.error}>Unrecognized date — try YYYY-MM-DD</span>}
      {popover}
    </div>
  );
}
