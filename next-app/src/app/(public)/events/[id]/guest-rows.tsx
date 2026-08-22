'use client';

/**
 * "Bringing anyone else?" — named guest rows on the public sign-up forms
 * (Plans/Participant-Classification.md, Patrick 2026-08-21): each guest is a
 * name + class (Webelos / Cub Scout / Youth Guest / Adult Guest), stored as
 * its own sign-up entry under the household's entry so planning gets exact,
 * named youth/adult counts. Replaces the old "+N guests, we don't need their
 * names" count for new sign-ups.
 *
 * Controlled: the parent owns the list; this renders it and carries it as ONE
 * hidden JSON field (`guests`) that the submit action normalizes server-side
 * (lib/event-signup normalizeGuestRows — never trusts this payload).
 */

import { GUEST_CLASSES, PARTICIPANT_CLASS_LABEL, type GuestClass } from '@/lib/participant-class';
import styles from './event-detail.module.css';

export interface GuestRowValue {
  name: string;
  cls: GuestClass;
}

export function GuestRowsEditor({
  guests,
  onChange,
  prompt
}: {
  guests: GuestRowValue[];
  onChange: (next: GuestRowValue[]) => void;
  /** The builder's guest_prompt, if the leader wrote one. */
  prompt?: string | null;
}) {
  const update = (i: number, patch: Partial<GuestRowValue>) =>
    onChange(guests.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  const remove = (i: number) => onChange(guests.filter((_, idx) => idx !== i));
  const add = () => onChange([...guests, { name: '', cls: 'youth_guest' }]);

  return (
    <div className={styles.guestBlock}>
      <p className={styles.dayHead}>Bringing anyone else?</p>
      <p className={styles.gateLede}>
        {prompt ??
          'Friends, siblings, Webelos or Cub Scouts joining in — add each one by name so we can plan tents, food and leadership.'}
      </p>
      <input type="hidden" name="guests" value={JSON.stringify(guests)} />
      {guests.length > 0 && (
        <ul className={styles.guestRows}>
          {guests.map((g, i) => (
            <li key={i} className={styles.guestRow}>
              <input
                type="text"
                className={styles.gateInput}
                value={g.name}
                placeholder="Name"
                aria-label={`Guest name ${i + 1}`}
                maxLength={80}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <select
                className={styles.gateInput}
                value={g.cls}
                aria-label={`Guest class ${i + 1}`}
                onChange={(e) => update(i, { cls: e.target.value as GuestClass })}
              >
                {GUEST_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {PARTICIPANT_CLASS_LABEL[c]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.guestRemove}
                aria-label={`Remove guest ${i + 1}`}
                onClick={() => remove(i)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={styles.guestAdd} onClick={add}>
        + Add a guest
      </button>
    </div>
  );
}
