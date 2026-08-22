'use client';

/**
 * Shared public DateField — a rich date control for the public site
 * (Patrick, 2026-08-21: the native <input type="date"> the profile editors
 * reverted to in Phase C (D-174 option b) is "browser default"; he wants
 * entry that is "far more flexible and accommodating and state-of-the-art",
 * on a par with the admin workstation's picker).
 *
 * Shape: a text input that accepts almost any typed form (7/25/26, Jul 25
 * 2026, 20260725, today — see lib/date-entry's grammar) and shows the
 * committed date as "Jul 25, 2026", plus a react-day-picker calendar
 * popover (anchored on desktop, centered sheet on phones) with Clear/Today.
 * The ISO value travels in a hidden input under `name`, so a plain form
 * post keeps working.
 *
 * FIREWALL: this is an independent implementation on the PUBLIC tokens
 * (date-field.module.css) and neutral lib/ code. It deliberately shares no
 * code with admin's _components/date-picker-field — parity of behavior,
 * not of import (AGENTS.md). The interaction model mirrors what ux-lead
 * approved for the admin picker (open on click/ArrowDown/icon, commit on
 * blur/Enter/outside-click, Escape + Tab-trap + close-on-scroll).
 *
 * Slots into <Field> like TextInput: picks up the label's id and the
 * hint/error ids from FieldContext; an explicit `id`/`aria-describedby`
 * prop wins (the /profile EditField passes its own).
 */

import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DayPicker, getDefaultClassNames } from 'react-day-picker';
import 'react-day-picker/style.css';
import { formatDateDisplay, parseTypedDate, toISODate } from '@/lib/date-entry';
import { FieldContext } from './form';
import s from './date-field.module.css';

const MOBILE_BREAKPOINT = 640; // the public stack breakpoint (globals.css canon)
const INVALID_MSG = 'Unrecognized date — try 7/25/2026 or Jul 25, 2026';

const CALENDAR_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M1.5 6h13" stroke="currentColor" strokeWidth="1.3" />
    <path d="M4.5 1.5v2M11.5 1.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

/** 'YYYY-MM-DD' → local Date (never `new Date(iso)`, which is UTC midnight
 *  and a day early west of UTC). */
function isoToLocalDate(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export interface DateFieldProps {
  /** Controlled 'YYYY-MM-DD' ('' = no date). Omit for uncontrolled use. */
  value?: string;
  /** Initial 'YYYY-MM-DD' for uncontrolled use. */
  defaultValue?: string;
  /** Fires with the committed ISO value ('' when cleared). */
  onChange?: (iso: string) => void;
  /** Submit the ISO value under this name (hidden input). */
  name?: string;
  id?: string;
  'aria-describedby'?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
}

export function DateField({
  value,
  defaultValue,
  onChange,
  name,
  id: idProp,
  'aria-describedby': describedByProp,
  disabled = false,
  readOnly = false,
  required,
  placeholder = 'e.g. 7/25/2026',
  className
}: DateFieldProps) {
  const ctx = useContext(FieldContext);
  const id = idProp ?? ctx.id;

  // Controlled vs uncontrolled — `committed` is the one source of truth.
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? '');
  const committed = controlled ? value : inner;
  const commit = useCallback(
    (iso: string) => {
      if (!controlled) setInner(iso);
      onChange?.(iso);
    },
    [controlled, onChange]
  );

  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => formatDateDisplay(committed));
  const [invalid, setInvalid] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const errorId = useId();
  const inert = disabled || readOnly;

  // Mirror an external value change into the text while closed — adjusted
  // during render (React's "reset state when a prop changes" pattern), not
  // in an effect.
  const [lastCommitted, setLastCommitted] = useState(committed);
  if (!open && committed !== lastCommitted) {
    setLastCommitted(committed);
    setText(formatDateDisplay(committed));
    setInvalid(false);
  }

  // Who opened it decides where focus goes: from the icon button (or on a
  // phone, where the sheet covers the field) focus moves INTO the calendar
  // so keyboard/AT users land in the dialog they asked for; from a click or
  // ArrowDown in the input, the caret STAYS in the input so typing keeps
  // working with the calendar open beside it — stealing focus there is the
  // admin picker's one rough edge, deliberately not reproduced here.
  const [focusCalendar, setFocusCalendar] = useState(false);
  function openPopover(via: 'input' | 'button' = 'input') {
    if (inert || open) return;
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT;
    setMobile(isMobile);
    setFocusCalendar(via === 'button' || isMobile);
    setPos(null);
    // A native <dialog> shown via showModal() sits in the top layer; a
    // popover portaled outside it would render behind. Portal into the
    // nearest OPEN dialog ancestor when there is one, else document.body.
    const dialog = wrapRef.current?.closest('dialog');
    setPortalTarget(dialog && dialog.open ? dialog : document.body);
    setOpen(true);
  }

  const closePopover = useCallback(
    (returnFocus = false) => {
      setOpen(false);
      setText(formatDateDisplay(committed));
      setInvalid(false);
      setLastCommitted(committed);
      if (returnFocus) (wrapRef.current?.querySelector('input[type="text"]') as HTMLInputElement | null)?.focus();
    },
    [committed]
  );

  /** True when the typed text committed cleanly (empty or parseable). */
  function commitText(): boolean {
    if (!text.trim()) {
      setInvalid(false);
      if (committed !== '') commit('');
      return true;
    }
    const iso = parseTypedDate(text);
    if (!iso) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    if (iso !== committed) commit(iso);
    else setText(formatDateDisplay(iso));
    return true;
  }
  const commitRef = useRef(commitText);
  useEffect(() => {
    commitRef.current = commitText;
  });

  function selectDay(date: Date | undefined) {
    if (!date) return;
    commit(toISODate(date));
    closePopover(true);
  }
  function clear() {
    commit('');
    closePopover(true);
  }

  // Desktop: anchor under (or above) the trigger once laid out.
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
    // Written straight to the element, not via a JSX style prop — the
    // public census test (design-system-census) counts inline style sites,
    // and a positioned popover is exactly the dynamic case it asks to keep
    // out of JSX. `pos` just flips the visibility class once placed.
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    setPos({ top, left });
  }, [open, mobile]);

  // Outside-click (commits typed text), Escape, Tab trap, close-on-scroll.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
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

  const selected = isoToLocalDate(committed);
  const rdp = getDefaultClassNames();
  const describedBy =
    [describedByProp ?? ctx.describedBy, invalid ? errorId : undefined].filter(Boolean).join(' ') || undefined;

  const popover =
    open && portalTarget
      ? createPortal(
          <>
            {mobile && <div className={s.backdrop} onClick={() => closePopover(true)} />}
            <div
              ref={popoverRef}
              role="dialog"
              aria-modal="true"
              aria-label="Choose date"
              id={dialogId}
              className={mobile ? s.popoverMobile : `${s.popover} ${pos ? s.popoverPlaced : ''}`}
            >
              {invalid && (
                <p id={errorId} className={s.popoverError} role="alert">
                  {INVALID_MSG}
                </p>
              )}
              <DayPicker
                mode="single"
                selected={selected}
                defaultMonth={selected ?? new Date()}
                onSelect={selectDay}
                autoFocus={focusCalendar}
                captionLayout="dropdown"
                startMonth={new Date(1920, 0)}
                endMonth={new Date(new Date().getFullYear() + 5, 11)}
                classNames={{ root: `${rdp.root} ${s.calendarRoot}` }}
                footer={
                  <div className={s.footer}>
                    <button type="button" className={s.footerBtn} onClick={clear}>
                      Clear
                    </button>
                    <button
                      type="button"
                      className={`${s.footerBtn} ${s.footerToday}`}
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
    <div ref={wrapRef} className={[s.field, className].filter(Boolean).join(' ')}>
      <div
        className={[s.wrapper, disabled ? s.wrapperDisabled : '', invalid ? s.wrapperInvalid : '']
          .filter(Boolean)
          .join(' ')}
      >
        {name && <input type="hidden" name={name} value={committed} />}
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          className={s.input}
          value={text}
          placeholder={inert ? '' : placeholder}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onClick={() => openPopover('input')}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (!inert) commitText();
          }}
          onKeyDown={(e) => {
            if (inert) return;
            if (e.key === 'ArrowDown' && !open) {
              e.preventDefault();
              openPopover();
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (commitText()) closePopover(true);
            }
          }}
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
        />
        {!inert && (
          <button
            type="button"
            className={s.iconBtn}
            onClick={() => (open ? closePopover(true) : openPopover('button'))}
            aria-label="Open calendar"
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            {CALENDAR_ICON}
          </button>
        )}
      </div>
      {/* Error sits under the field when closed, but INSIDE the popover while
          it's open — the popover would otherwise cover it exactly when the
          user is looking for it (found in browser verification 2026-08-21). */}
      {invalid && !open && (
        <span id={errorId} className={s.error} role="alert">
          {INVALID_MSG}
        </span>
      )}
      {popover}
    </div>
  );
}
