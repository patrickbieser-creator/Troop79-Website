'use client';

import { useEffect, useState } from 'react';
import styles from './site-nav.module.css';

export function UtilityDate() {
  const [date, setDate] = useState('');
  useEffect(() => {
    // The formatted date depends on the browser's locale/timezone, so it
    // can't be computed during render without risking a hydration mismatch
    // against the server-rendered (blank) output.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(
      // eslint-disable-next-line no-restricted-syntax -- the visitor's own clock, by design (client effect)
      new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    );
  }, []);
  return <span className={styles.utilityDate}>{date || ' '}</span>;
}
