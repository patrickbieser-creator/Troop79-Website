/**
 * Shared public Button. Variants: primary (forest — create/commit),
 * secondary (outlined navy), ghost (text link-button), danger (outlined on
 * the status tokens; public follows admin's rule — outlined in context,
 * solid only inside a danger confirm). Renders a Next <Link> when `href` is
 * given (it carries `aria-current` and `onClick` across). Canonical rendering: /admin/styleguide/public.
 */
import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import s from './button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost';

type ButtonOwnProps = {
  variant?: Variant;
  /** 'sm' — compact chrome/section-header sizing; ghost variants ignore it. */
  size?: 'md' | 'sm';
  href?: string;
  className?: string;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  href,
  className,
  children,
  ...rest
}: ButtonOwnProps & Omit<ComponentProps<'button'>, 'className'>) {
  const cls = [s.btn, s[variant], size === 'sm' ? s.sm : null, className].filter(Boolean).join(' ');
  if (href != null) {
    // A link-button keeps its current-page mark and may take over a plain click (Build a Plan's view bar, 2026-10-22).
    const onClick = rest.onClick as unknown as ComponentProps<typeof Link>['onClick'];
    return (
      <Link href={href} className={cls} aria-current={rest['aria-current']} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
