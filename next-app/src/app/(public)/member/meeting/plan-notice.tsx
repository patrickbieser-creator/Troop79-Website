/**
 * /member/meeting's "the plan is set" line (Phase 3a). Once the meeting's agenda is published the agenda is the one
 * answer: the page links to it and shows nothing personal from the live match. After the 5:30 pm soft close with no
 * agenda yet, the Phase 1 line. Both still take answers: never "too late".
 */
import Link from 'next/link';
import styles from './meeting.module.css';

export function PlanNotice({ planSet, pastClose, entryId }: { planSet: boolean; pastClose: boolean; entryId: number }) {
  if (planSet) {
    return (
      <div className={styles.notice}>
        <p>
          This week&rsquo;s plan is set: <Link href={`/events/${entryId}`}>see the agenda</Link>. You can still tell us you&rsquo;re coming.
        </p>
      </div>
    );
  }
  if (!pastClose) return null;
  return (
    <div className={styles.notice}>
      <p>This week&rsquo;s plan is set. You can still tell us you&rsquo;re coming.</p>
    </div>
  );
}
