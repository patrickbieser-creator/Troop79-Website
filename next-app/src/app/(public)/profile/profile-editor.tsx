'use client';

import { useTransition } from 'react';
import { gradeFromGradYear, gradeLabel, gradYearFromGrade } from '@/lib/demographics';
import { EDITABLE_SCOUT_FIELDS, type ChangeRequestRow } from '@/lib/change-requests';
import { displayValue, pendingFields, type DraftValues } from '@/lib/profile-draft';
// First use outside admin. Its popover portal falls back to document.body
// when #admin-popover-root isn't on the page, and its stylesheet now chains
// every --admin-* read through the public token to a literal — it did NOT
// when this import was added, which is why the field rendered unstyled here
// until 2026-08-14. Left where it lives rather than relocated: one public
// consumer isn't yet a pattern.
import { DateField } from '@/app/_components/date-field';
import { EditField } from './edit-field';
import { EditorActions } from './editor-actions';
import styles from './profile.module.css';

export interface ScoutProfileFields {
  id: string;
  displayName: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  school: string | null;
  graduation_year: number | null;
  swim_class: string | null;
  birthdate: string | null;
  things_we_should_know: string | null;
}

const SWIM_LABEL: Record<string, string> = {
  swimmer: 'Swimmer',
  beginner: 'Beginner',
  nonswimmer: 'Non-swimmer'
};

/**
 * One scout's self-service edit form (Plans/Scout-Self-Service-Demographics.md).
 *
 * PREFILLED WITH THE PENDING PROPOSAL, NOT THE LIVE RECORD — reversed
 * 2026-08-15. It used to show the live values with a banner naming which
 * fields were awaiting review, which meant a family lost sight of its own
 * submission the moment it was made: no proofreading it, no copying a
 * corrected address out of it, and switching members and back wiped it from
 * view. The form is now the record of what is queued, with each pending
 * field's live value shown underneath so the thing a leader still sees is
 * never hidden. See lib/profile-draft.ts for the live/effective/draft model.
 *
 * The values live in HouseholdMembers, not here: they have to outlive this
 * component, which unmounts every time the family switches member.
 */
export default function ProfileEditor({
  scout,
  pending,
  values,
  dirty,
  onChange,
  onDiscard,
  submitAction,
  withdrawAction
}: {
  scout: ScoutProfileFields;
  pending: ChangeRequestRow | null;
  values: DraftValues;
  /** Whether `values` differs from what is already live-or-queued. */
  dirty: boolean;
  onChange: (field: string, value: string) => void;
  onDiscard: () => void;
  submitAction: (formData: FormData) => Promise<void>;
  withdrawAction: (formData: FormData) => Promise<void>;
}) {
  const [isSubmitting, startTransition] = useTransition();
  const queued = pendingFields(pending);

  // The draft holds `graduation_year` (what the record stores) while the
  // control offers grade (what a family knows), so the two convert at the
  // boundary rather than the draft carrying a shape the diff can't compare.
  const gradYear = values.graduation_year === '' ? null : Number(values.graduation_year);
  const gradeNow = gradeFromGradYear(Number.isFinite(gradYear as number) ? gradYear : null);
  const liveGrade = gradeFromGradYear(scout.graduation_year);

  function submit() {
    const fd = new FormData();
    fd.set('scoutId', scout.id);
    for (const field of EDITABLE_SCOUT_FIELDS) fd.set(field, values[field] ?? '');
    startTransition(() => submitAction(fd));
  }

  return (
    <>
      {pending && (
        <p className={styles.warnNote}>
          The information below is the update you submitted{' '}
          {new Date(pending.submitted_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
          })}
          , still awaiting a leader&rsquo;s review. {scout.displayName}&rsquo;s record keeps its
          current information until then — the fields marked below show what it still says. Edit
          and submit again to replace this update, or undo it to take it out of the queue.
        </p>
      )}

      <div className={styles.editGrid}>
        <EditField
          label="Address Line 1"
          full
          name="address_line1"
          queued={queued}
          previous={displayValue(scout.address_line1)}
        >
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              value={values.address_line1 ?? ''}
              onChange={(e) => onChange('address_line1', e.target.value)}
            />
          )}
        </EditField>
        <EditField
          label="Address Line 2"
          full
          name="address_line2"
          queued={queued}
          previous={displayValue(scout.address_line2)}
        >
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              value={values.address_line2 ?? ''}
              onChange={(e) => onChange('address_line2', e.target.value)}
              placeholder="Apt / unit (optional)"
            />
          )}
        </EditField>
        <EditField label="City" name="city"
          queued={queued} previous={displayValue(scout.city)}>
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              value={values.city ?? ''}
              onChange={(e) => onChange('city', e.target.value)}
            />
          )}
        </EditField>
        <EditField label="State" name="state"
          queued={queued} previous={displayValue(scout.state)}>
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              value={values.state ?? ''}
              onChange={(e) => onChange('state', e.target.value)}
              maxLength={2}
              placeholder="WI"
            />
          )}
        </EditField>
        <EditField label="ZIP" name="zip"
          queued={queued} previous={displayValue(scout.zip)}>
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              value={values.zip ?? ''}
              onChange={(e) => onChange('zip', e.target.value)}
              placeholder="53202"
            />
          )}
        </EditField>
        <EditField label="Phone" name="phone"
          queued={queued} previous={displayValue(scout.phone)}>
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              type="tel"
              value={values.phone ?? ''}
              onChange={(e) => onChange('phone', e.target.value)}
              placeholder="(414) 555-1234"
            />
          )}
        </EditField>
        <EditField label="Email" name="email"
          queued={queued} previous={displayValue(scout.email)}>
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              type="email"
              value={values.email ?? ''}
              onChange={(e) => onChange('email', e.target.value)}
            />
          )}
        </EditField>
        <EditField
          label="School"
          name="school"
          queued={queued}
          previous={displayValue(scout.school)}
        >
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              value={values.school ?? ''}
              onChange={(e) => onChange('school', e.target.value)}
            />
          )}
        </EditField>
        <EditField
          label="Grade"
          name="graduation_year"
          queued={queued}
          previous={liveGrade === null ? '' : gradeLabel(liveGrade)}
        >
          {(a) => (
            <select
              {...a}
              className={styles.editInput}
              value={gradeNow === null ? '' : String(gradeNow)}
              onChange={(e) =>
                onChange(
                  'graduation_year',
                  e.target.value === '' ? '' : String(gradYearFromGrade(Number(e.target.value)))
                )
              }
            >
              <option value="">—</option>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                <option key={g} value={g}>
                  {gradeLabel(g)}
                </option>
              ))}
            </select>
          )}
        </EditField>
        <EditField
          label="Swim Classification"
          name="swim_class"
          queued={queued}
          previous={scout.swim_class ? (SWIM_LABEL[scout.swim_class] ?? scout.swim_class) : ''}
        >
          {(a) => (
            <select
              {...a}
              className={styles.editInput}
              value={values.swim_class ?? ''}
              onChange={(e) => onChange('swim_class', e.target.value)}
            >
              <option value="">—</option>
              <option value="swimmer">Swimmer</option>
              <option value="beginner">Beginner</option>
              <option value="nonswimmer">Non-swimmer</option>
            </select>
          )}
        </EditField>
        <EditField
          label="Birthdate"
          name="birthdate"
          queued={queued}
          previous={displayValue(scout.birthdate)}
        >
          {(a) => (
            <DateField
              {...a}
              value={values.birthdate ?? ''}
              onChange={(e) => onChange('birthdate', e.target.value)}
            />
          )}
        </EditField>
        <EditField
          label="Things We Should Know — food allergies, medical conditions, special needs"
          full
          name="things_we_should_know"
          queued={queued}
          previous={displayValue(scout.things_we_should_know)}
        >
          {(a) => (
            <textarea
              {...a}
              className={styles.editInput}
              rows={3}
              value={values.things_we_should_know ?? ''}
              onChange={(e) => onChange('things_we_should_know', e.target.value)}
              placeholder="e.g. Peanut allergy (EpiPen in backpack), asthma inhaler"
            />
          )}
        </EditField>
      </div>
      <p className={styles.helpText}>
        Changes are reviewed by a leader before they take effect on {scout.displayName}&rsquo;s
        record.
      </p>
      <EditorActions
        entityType="scout"
        entityId={scout.id}
        hasPending={pending !== null}
        dirty={dirty}
        isSubmitting={isSubmitting}
        onSubmit={submit}
        onDiscard={onDiscard}
        withdrawAction={withdrawAction}
      />
    </>
  );
}
