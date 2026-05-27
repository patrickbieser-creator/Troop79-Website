'use client';

import { useEffect, useState } from 'react';

export function UtilityDate() {
  const [date, setDate] = useState('');
  useEffect(() => {
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
