/**
 * The wreath goal thermometer: "12 of 25 wreaths toward Oliver’s goal" over a calm horizontal bar. One definition of
 * the numbers (lib/wreaths/scout-entry goalProgress), used on a scout's public page and on Members › Wreath sale.
 * A native <progress> carries the bar (no inline width): it is capped at 100% while the text keeps counting ("27 of 25").
 * Renders nothing when no goal is set.
 */
import type { GoalProgress } from '@/lib/wreaths/scout-entry';
import styles from './goal-bar.module.css';

export function GoalBar({ progress }: { progress: GoalProgress | null }) {
  if (!progress) return null;
  const shown = Math.min(progress.sold, progress.goal);
  return (
    <div className={styles.goal}>
      <p className={styles.text}>
        <strong>
          {progress.sold} of {progress.goal} wreaths
        </strong>{' '}
        toward {progress.firstName}&rsquo;s goal
      </p>
      <progress
        className={styles.bar}
        role="progressbar"
        aria-label={progress.label}
        aria-valuemin={0}
        aria-valuemax={progress.goal}
        aria-valuenow={shown}
        aria-valuetext={progress.label}
        value={shown}
        max={progress.goal}
      />
    </div>
  );
}
