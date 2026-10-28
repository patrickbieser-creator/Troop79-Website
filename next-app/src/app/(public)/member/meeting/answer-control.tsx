'use client';

/**
 * The member meeting page's answer control (Coming / Not sure yet / Can't make it) and its "Saved" mark, used by
 * "Teach at a meeting" (teach-board.tsx). Moved out of the retired scout pick board (Meeting Planner III, P7).
 */
import { INTENT_LABEL, type Intent } from '@/lib/meeting-board-shared';
import styles from './meeting.module.css';

export function Saved({ on }: { on: boolean }) {
  return (
    <span className={on ? `${styles.saved} ${styles.savedOn}` : styles.saved} aria-hidden="true">
      {on ? 'Saved' : ''}
    </span>
  );
}

/** Coming / Not sure yet / Can't make it: a real radio group (arrow keys move), saved the moment it changes. */
export function IntentControl({
  groupName,
  label,
  value,
  implied = false,
  options,
  helper,
  saved,
  disabled,
  onChange
}: {
  groupName: string;
  label: string;
  value: Intent | null;
  implied?: boolean;
  options: Intent[];
  helper: string | null;
  saved: boolean;
  disabled: boolean;
  onChange: (v: Intent) => void;
}) {
  const labelId = `${groupName}-label`;
  return (
    <div className={styles.block}>
      <div className={styles.fieldLabel} id={labelId}>
        {label}
      </div>
      <div className={styles.intentRow}>
        <div className={styles.seg} role="radiogroup" aria-labelledby={labelId}>
          {options.map((o) => (
            <label key={o} className={o === value || (implied && o === 'coming') ? `${styles.segOption} ${styles.segOn}` : styles.segOption}>
              <input
                type="radio"
                className={styles.segInput}
                name={groupName}
                value={o}
                checked={o === value}
                disabled={disabled}
                onChange={() => onChange(o)}
              />
              {INTENT_LABEL[o]}
            </label>
          ))}
        </div>
        <Saved on={saved} />
      </div>
      {helper && <p className={styles.helper}>{helper}</p>}
    </div>
  );
}
