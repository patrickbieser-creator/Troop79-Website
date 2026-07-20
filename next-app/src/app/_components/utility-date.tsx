'use client';

import { useEffect, useState } from 'react';

export function UtilityDate() {
  const [date, setDate] = useState('');
  useEffect(() => {
    // The formatted date depends on the browser's locale/timezone, so it
    // can't be computed during render without risking a hydration mismatch
    // against the server-rendered (blank) output.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(
      new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    );
  }, []);
  return (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 11,
        color: 'var(--text-meta)',
        letterSpacing: '.03em',
        fontWeight: 600
      }}
    >
      {date || ' '}
    </span>
  );
}
