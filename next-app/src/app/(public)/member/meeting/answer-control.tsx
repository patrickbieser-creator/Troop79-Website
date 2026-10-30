'use client';

/**
 * The member meeting page's "Saved" mark, used by "Teach at a meeting" (teach-board.tsx). Moved out of the retired
 * scout pick board (Meeting Planner III, P7).
 */
import styles from './meeting.module.css';

export function Saved({ on }: { on: boolean }) {
  return (
    <span className={on ? `${styles.saved} ${styles.savedOn}` : styles.saved} aria-hidden="true">
      {on ? 'Saved' : ''}
    </span>
  );
}
