'use client';

/**
 * "Offer something" on a teacher's card (Phase 2 of Plans/Meeting-Requests-And-Teaching-Offers.md): a skill, a
 * requirement or something else, on one or more dates, with a note. Each date is its own commitment. Problems are
 * marked in place.
 */
import { Button } from '@/app/_components/button';
import type { OfferChoices } from '@/lib/meeting-board-supply';
import type { OfferWhat } from './teach-actions';
import styles from './meeting.module.css';

type OfferType = OfferWhat['type'];
export interface Draft {
  type: OfferType;
  skillId: string;
  key: string;
  title: string;
  dates: number[];
  note: string;
}

const TYPES: { type: OfferType; label: string }[] = [
  { type: 'skill', label: 'A skill' },
  { type: 'req', label: 'A requirement' },
  { type: 'ff', label: 'Something else' }
];

export function OfferForm({
  ids,
  draft,
  choices,
  junior,
  errors,
  pending,
  onChange,
  onSubmit,
  onCancel
}: {
  ids: string;
  draft: Draft;
  choices: OfferChoices;
  junior: boolean;
  errors: { what?: string; dates?: string };
  pending: boolean;
  onChange: (d: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const whatId = `${ids}-offer-what`;
  return (
    <form
      className={styles.offerForm}
      noValidate
      aria-label="Offer something"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <div className={styles.fieldLabel} id={`${ids}-offer-type`}>
          What
        </div>
        <div className={styles.seg} role="radiogroup" aria-labelledby={`${ids}-offer-type`}>
          {TYPES.map((t) => (
            <button key={t.type} type="button" role="radio" aria-checked={draft.type === t.type} className={styles.segButton} onClick={() => set({ type: t.type })}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.field} ${errors.what ? styles.badBox : ''}`}>
        {draft.type === 'skill' && (
          <>
            <label htmlFor={whatId}>Skill</label>
            <select id={whatId} value={draft.skillId} aria-invalid={!!errors.what} onChange={(e) => set({ skillId: e.target.value })}>
              <option value="">Choose…</option>
              {choices.skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className={styles.helper}>
              {choices.skills.length
                ? 'Scouts who picked any requirement in this skill get matched to you.'
                : `Nothing in What I can teach yet${junior ? ' that a Junior Leader can teach' : ''}.`}
            </p>
          </>
        )}
        {draft.type === 'req' && (
          <>
            <label htmlFor={whatId}>Requirement</label>
            <select id={whatId} value={draft.key} aria-invalid={!!errors.what} onChange={(e) => set({ key: e.target.value })}>
              <option value="">Choose…</option>
              {choices.requirements.map((g) => (
                <optgroup key={g.rank} label={g.rank}>
                  {g.options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </>
        )}
        {draft.type === 'ff' && (
          <>
            <label htmlFor={whatId}>What you&rsquo;ll teach</label>
            <input id={whatId} type="text" maxLength={80} value={draft.title} aria-invalid={!!errors.what} onChange={(e) => set({ title: e.target.value })} />
          </>
        )}
      </div>
      {errors.what && <p className={styles.badNote}>{errors.what}</p>}

      <fieldset className={`${styles.field} ${errors.dates ? styles.badBox : ''}`}>
        <legend>Dates</legend>
        <div className={styles.dates}>
          {choices.dates.map((d) => (
            <label key={d.entryId} className={styles.check}>
              <input
                type="checkbox"
                checked={draft.dates.includes(d.entryId)}
                onChange={(e) => set({ dates: e.target.checked ? [...draft.dates, d.entryId] : draft.dates.filter((x) => x !== d.entryId) })}
              />
              {d.label}
            </label>
          ))}
        </div>
        <p className={styles.helper}>Merit badge nights and weeks with no sign-ups aren&rsquo;t listed.</p>
      </fieldset>
      {errors.dates && <p className={styles.badNote}>{errors.dates}</p>}

      <div className={styles.field}>
        <label htmlFor={`${ids}-offer-note`}>
          Note <span className={styles.opt}>(optional)</span>
        </label>
        <textarea id={`${ids}-offer-note`} maxLength={200} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
      </div>

      <div className={styles.formActions}>
        <Button type="submit" disabled={pending}>
          Post offer
        </Button>
        <button type="button" className={styles.linkBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
