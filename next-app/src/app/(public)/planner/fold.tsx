'use client';

/**
 * A disclosure that starts open on a wide screen and folded on a phone (Brad's phone mock: a request's teacher list
 * folds behind "N people can teach this ▾"; the Everyone wall folds every list but Coming). `phoneOpen` keeps it open on
 * a phone too. It renders open on the server, then folds after hydration when the screen is 640px or narrower.
 */
import { useEffect, useRef, type ReactNode } from 'react';

const PHONE = '(max-width: 640px)';

export function Fold({ summary, children, className, summaryClassName, phoneOpen = false }: { summary: ReactNode; children: ReactNode; className?: string; summaryClassName?: string; phoneOpen?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!phoneOpen && ref.current && window.matchMedia?.(PHONE).matches) ref.current.open = false;
  }, [phoneOpen]);
  return (
    <details ref={ref} className={className} open>
      <summary className={summaryClassName}>{summary}</summary>
      {children}
    </details>
  );
}
