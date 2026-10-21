import type { TopicPart } from '@/lib/meeting-board-picklist';
import styles from './meeting.module.css';

/**
 * A topic's sub-requirements, listed the way the Clipboard lists them (Plans/Matcher-Tune-Up.md T-4): First Aid for
 * Tenderfoot is picked as one thing, but scouts and teachers see 4a.1 Simple cuts, 4a.2 Blisters… On a scout's own
 * pick list the ones already signed off say so. Nothing renders for a topic without parts.
 */
export function TopicParts({ parts, title }: { parts?: readonly TopicPart[]; title: string }) {
  if (!parts?.length) return null;
  return (
    <ul className={styles.parts} aria-label={`${title}, its parts`}>
      {parts.map((p) => (
        <li key={p.code} className={p.done ? styles.partDone : undefined}>
          <span className={styles.code}>{p.code}</span> {p.label}
          {p.done ? ' · done' : ''}
        </li>
      ))}
    </ul>
  );
}
