/**
 * Shared admin Button (2026-08-24, Plans/Admin-Design-System.md follow-through
 * — "113 button class declarations across 32 stylesheets").
 *
 * One component, five variants, two sizes; renders a Next <Link> when `href`
 * is given. Mirrors the public Button's API so the two sides read alike, but
 * paints ONLY from --admin-* tokens (admin.css) — never the public palette.
 *
 * Lives one level ABOVE `(workspace)` on purpose: /admin/roster-print and
 * /admin/snapshot sit outside that route group, import admin.css themselves,
 * and used to carry their own navy `.printBtn` because nothing shared was
 * reachable from there.
 *
 * Variants (the Phase A decisions, 2026-08-21):
 *   primary     — solid navy. Save / Publish / Apply / form submits. Green is
 *                 reserved for Add (see AddButton), so colour carries meaning.
 *   secondary   — white, grey border, navy on hover. Edit / Clone / Cancel /
 *                 pager / most row actions.
 *   danger      — OUTLINED red: in-context destructive actions (rows, panels),
 *                 quiet until hovered.
 *   dangerSolid — solid red: ONLY the confirm button inside a danger Dialog.
 *   quiet       — link-styled text button for in-page switches and "× clear".
 * Sizes: 'md' (default) for forms and panel heads; 'sm' for table rows and
 * dense toolbars (the old .editBtn shape).
 *
 * Canonical rendering + scoreboard: /admin/styleguide/admin → Buttons.
 */
import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import s from './button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerSolid' | 'quiet';
export type ButtonSize = 'md' | 'sm';

type ButtonOwnProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a Link. Link mode has no `disabled` — use `aria-disabled` (the
   *  pager idiom) or hide/swap instead. */
  href?: string;
  /** Link mode only: open in a new tab (print pages). `rel` follows. */
  target?: string;
  rel?: string;
  className?: string;
  children: ReactNode;
};

export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string
): string {
  return [s.btn, s[variant], size === 'sm' ? s.sm : null, className].filter(Boolean).join(' ');
}

export function Button({
  variant = 'secondary',
  size = 'md',
  href,
  target,
  rel,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonOwnProps & Omit<ComponentProps<'button'>, 'className' | 'children'>) {
  const cls = buttonClass(variant, size, className);
  if (href != null) {
    const disabledLink = rest['aria-disabled'] === true || rest['aria-disabled'] === 'true';
    return (
      <Link
        href={href}
        className={cls}
        title={rest.title}
        aria-label={rest['aria-label']}
        aria-disabled={rest['aria-disabled']}
        tabIndex={disabledLink ? -1 : undefined}
        target={target}
        rel={rel ?? (target === '_blank' ? 'noopener' : undefined)}
      >
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
