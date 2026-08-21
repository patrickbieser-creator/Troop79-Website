/**
 * Shared public Button. Variants: primary (forest — create/commit),
 * secondary (outlined navy), ghost (text link-button), danger (outlined on
 * the status tokens; public follows admin's rule — outlined in context,
 * solid only inside a danger confirm). Renders a Next <Link> when `href` is
 * given. Canonical rendering: /admin/styleguide/public.
 */
import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import s from './button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonOwnProps = {
  variant?: Variant;
  href?: string;
  className?: string;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  href,
  className,
  children,
  ...rest
}: ButtonOwnProps & Omit<ComponentProps<'button'>, 'className'>) {
  const cls = [s.btn, s[variant], className].filter(Boolean).join(' ');
  if (href != null) {
    return (
      <Link href={href} className={cls}>
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
