'use client';

/**
 * Shared Actions ▾ menu (Phase A, Plans/Admin-Design-System.md) — the
 * D-156/D-158 page-level actions pattern: one quiet select instead of a
 * wall of buttons. Replaces the 7 verbatim per-screen copies (and, on
 * conversion, roster's and calendar's divergent ones). Canonical rendering:
 * /admin/styleguide.
 *
 * Contract carried over from every legacy copy: the select always rests on
 * the placeholder; picking an option dispatches `onAction(value)` and snaps
 * back, so the control reads as a menu, not a persistent value. Parents keep
 * their own dispatch logic (open a modal, navigate, submit) — this component
 * owns only the menu behavior and its styling.
 */
import styles from './actions-menu.module.css';

export interface ActionsMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function ActionsMenu({
  options,
  onAction,
  ariaLabel,
  placeholder = 'Actions…',
  disabled
}: {
  options: ActionsMenuOption[];
  onAction: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Disables the whole menu (e.g. while a transition is pending). */
  disabled?: boolean;
}) {
  return (
    <select
      className={styles.select}
      value=""
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        // Imperative snap-back (same as every legacy copy): without it a
        // controlled value="" only resets the DOM if something re-renders,
        // which onAction isn't guaranteed to cause.
        e.target.value = '';
        if (!v) return;
        onAction(v);
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
