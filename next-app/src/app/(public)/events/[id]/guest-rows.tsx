'use client';

/**
 * Guests on the public sign-up forms (Plans/Guests-As-People.md, Patrick
 * 2026-08-22/23: "we need to know who they are, their ride, etc." and "BOTH
 * modes are real").
 *
 * Two components, one per guest mode:
 *
 *   GuestRowsEditor  — NAMED mode. "Bringing anyone else?" — each guest is a
 *     name + class (Webelos / Cub Scout / Youth Guest / Adult Guest) and
 *     becomes a `people` row with its own sign-up entry under the household's
 *     entry. The household's guests on record are offered as one-click picks
 *     ("Add Grandma Pat again") so a recurring guest is the SAME person across
 *     events; a typed name that matches one of them gets a confirm, never a
 *     silent merge (People-Identity-Model's rule). An adult guest may carry a
 *     phone (optional, carpools); a youth guest never does.
 *
 *   GuestCountField  — COUNT mode. "How many guests?" — a number + an optional
 *     note on the host's entry (Court of Honor, service project). Nobody is
 *     named.
 *
 * Both are controlled: the parent owns the values. The named list travels as
 * ONE hidden JSON field (`guests`) the submit action normalizes server-side
 * (lib/event-signup normalizeGuestRows — never trusts this payload); the count
 * rides on the host entry in the `entries` field.
 */

import { GUEST_CLASSES, PARTICIPANT_CLASS_LABEL, type GuestClass } from '@/lib/participant-class';
import type { HouseholdGuest } from '@/lib/guest-payload';
import styles from './event-detail.module.css';

export interface GuestRowValue {
  /** people.id of one of the household's guests on record (a re-pick); null
   *  for a newly typed name. */
  personId: number | null;
  name: string;
  cls: GuestClass;
  /** Adult guests only — the input is hidden for youth classes and the
   *  server drops whatever a youth row carries. */
  phone: string;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function GuestRowsEditor({
  guests,
  onChange,
  prompt,
  previousGuests = []
}: {
  guests: GuestRowValue[];
  onChange: (next: GuestRowValue[]) => void;
  /** The builder's guest_prompt, if the leader wrote one. */
  prompt?: string | null;
  /** The household's guests on record — offered as one-click picks. */
  previousGuests?: HouseholdGuest[];
}) {
  const update = (i: number, patch: Partial<GuestRowValue>) =>
    onChange(guests.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  const remove = (i: number) => onChange(guests.filter((_, idx) => idx !== i));
  const add = () => onChange([...guests, { personId: null, name: '', cls: 'youth_guest', phone: '' }]);
  const addAgain = (p: HouseholdGuest) =>
    onChange([...guests, { personId: p.personId, name: p.name, cls: p.cls, phone: p.phone ?? '' }]);

  const pickedIds = new Set(guests.map((g) => g.personId).filter((v): v is number => v != null));
  const unpicked = previousGuests.filter((p) => !pickedIds.has(p.personId));

  /** A typed name that matches a guest on record (not already picked) — offer
   *  "Use X again?" instead of quietly creating a twin. */
  const matchFor = (g: GuestRowValue): HouseholdGuest | null => {
    if (g.personId != null || !g.name.trim()) return null;
    return unpicked.find((p) => sameName(p.name, g.name)) ?? null;
  };

  return (
    <div className={styles.guestBlock}>
      <p className={styles.dayHead}>Bringing anyone else?</p>
      <p className={styles.gateLede}>
        {prompt ??
          'Friends, siblings, Webelos or Cub Scouts joining in — add each one by name so we can plan tents, food and leadership.'}
      </p>
      <input type="hidden" name="guests" value={JSON.stringify(guests)} />
      {unpicked.length > 0 && (
        <div className={styles.guestAgain}>
          <p className={styles.pickPrompt}>Guests you&rsquo;ve brought before</p>
          <div className={styles.pickChips}>
            {unpicked.map((p) => (
              <button
                key={p.personId}
                type="button"
                className={styles.pickChip}
                onClick={() => addAgain(p)}
                aria-label={`Add ${p.name} again`}
              >
                <span className={styles.pickName}>{p.name}</span>
                <span className={styles.pickSub}>{PARTICIPANT_CLASS_LABEL[p.cls]} · add again</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {guests.length > 0 && (
        <ul className={styles.guestRows}>
          {guests.map((g, i) => {
            const match = matchFor(g);
            const adult = g.cls === 'adult_guest';
            return (
              <li key={i} className={`${styles.guestRow} ${adult ? styles.guestRowAdult : ''}`}>
                <input
                  type="text"
                  className={styles.gateInput}
                  value={g.name}
                  placeholder="Name"
                  aria-label={`Guest name ${i + 1}`}
                  maxLength={80}
                  readOnly={g.personId != null}
                  title={g.personId != null ? 'A guest on record — remove the row to start over' : undefined}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                {adult && (
                  <input
                    type="tel"
                    className={styles.gateInput}
                    value={g.phone}
                    placeholder="Phone (optional, for carpools)"
                    aria-label={`Guest phone ${i + 1}`}
                    maxLength={40}
                    autoComplete="off"
                    onChange={(e) => update(i, { phone: e.target.value })}
                  />
                )}
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
                {/* Patrick, 2026-08-23: "I typed in a name … I'm confused as to
                    what to do next." There IS no next step — a typed row is on
                    the signup — so say so, per row, the moment a name exists. */}
                {g.name.trim() && !match && (
                  <p className={styles.guestStatus}>
                    ✓ {g.name.trim()} is coming with your household — included when you press Submit / Save changes.
                  </p>
                )}
                {!g.name.trim() && (
                  <p className={styles.guestStatus}>Type their name — that’s all; there’s no separate add step.</p>
                )}
                {match && (
                  <p className={styles.guestMatch}>
                    Looks like {match.name}, who you&rsquo;ve brought before.{' '}
                    <button
                      type="button"
                      className={styles.linkBtn}
                      aria-label={`Use ${match.name} again`}
                      onClick={() => update(i, { personId: match.personId, name: match.name, phone: g.phone || match.phone || '' })}
                    >
                      Use {match.name} again
                    </button>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className={styles.guestAdd} onClick={add}>
        {guests.length > 0 ? '+ Add another guest' : '+ Add a guest'}
      </button>
    </div>
  );
}

export function GuestCountField({
  count,
  note,
  onChange,
  prompt
}: {
  count: number;
  note: string;
  onChange: (next: { count: number; note: string }) => void;
  /** The builder's guest_prompt, if the leader wrote one. */
  prompt?: string | null;
}) {
  return (
    <div className={styles.guestBlock}>
      <p className={styles.dayHead}>Bringing guests?</p>
      <p className={styles.gateLede}>
        {prompt ?? 'How many guests are you bringing? They’re counted for seating and food, not named.'}
      </p>
      <div className={styles.guestCountRow}>
        <label className={styles.rideField}>
          <span className={styles.rideLeg}>Guests</span>
          <input
            type="number"
            className={styles.gateInput}
            min={0}
            max={200}
            value={count}
            aria-label="Number of guests"
            onChange={(e) => onChange({ count: Math.max(0, Math.min(200, Number(e.target.value) || 0)), note })}
          />
        </label>
        <input
          type="text"
          className={styles.gateInput}
          value={note}
          placeholder="Who are they? (optional — grandparents, a neighbor…)"
          aria-label="Who are the guests? (optional)"
          maxLength={200}
          onChange={(e) => onChange({ count, note: e.target.value })}
        />
      </div>
    </div>
  );
}
