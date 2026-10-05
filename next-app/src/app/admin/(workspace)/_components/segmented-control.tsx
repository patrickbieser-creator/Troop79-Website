'use client';

/**
 * SegmentedControl — choosing ONE of two to four states (Jenna's control-hierarchy rule, 2026-10-05: "a
 * choice between states is a segmented control, not buttons" — three navy buttons with aria-pressed read as
 * three more primaries). A real radio group: arrow keys move, the chosen one is dark, the rest quiet.
 *
 *   <SegmentedControl name="mm-gf-state" label="What gluten-free scouts get" value={state}
 *     options={[{ value: 'substituted', label: 'Substitute' }, …]} onChange={setState} />
 *
 * Specimen: /admin/styleguide/admin → Buttons → Segmented control.
 */
import styles from './segmented-control.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
  disabled = false
}: {
  /** The radio group's name — unique on the page. */
  name: string;
  /** The accessible name of the group: what is being chosen. */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.seg} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className={o.value === value ? `${styles.option} ${styles.optionOn}` : styles.option}>
          <input type="radio" className={styles.input} name={name} value={o.value} checked={o.value === value} disabled={disabled} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
