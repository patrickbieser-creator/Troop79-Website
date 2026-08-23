/**
 * The participant-class pill — S / A / JL / Cub / W / G on the indexed
 * categorical scale, youth light / adults dark (events-admin .classPill;
 * Patrick, 2026-08-22). One component for every admin surface that shows a
 * person's class (roster grid, Other responses, the assignments board) so the
 * colors can never drift between them; the full label rides in `title`.
 */
import { PARTICIPANT_CLASS_LABEL, PARTICIPANT_CLASS_SHORT, type ParticipantClass } from '@/lib/participant-class';
import styles from './events-admin.module.css';

const CLASS_PILL_CLASS: Record<ParticipantClass, string> = {
  scout: styles.classS,
  adult: styles.classA,
  junior_leader: styles.classJL,
  cub_scout: styles.classCub,
  webelos: styles.classW,
  youth_guest: styles.classG,
  adult_guest: styles.classAG
};

export function ClassPill({ cls }: { cls: ParticipantClass }) {
  return (
    <span className={`${styles.classPill} ${CLASS_PILL_CLASS[cls]}`} title={PARTICIPANT_CLASS_LABEL[cls]}>
      {PARTICIPANT_CLASS_SHORT[cls]}
    </span>
  );
}
