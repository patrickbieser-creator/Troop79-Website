'use client';

import { useTransition } from 'react';
import { EDITABLE_PERSON_FIELDS, type ChangeRequestRow } from '@/lib/change-requests';
import { displayValue, pendingFields, type DraftValues } from '@/lib/profile-draft';
import { DateField } from '@/app/_components/date-field';
import { EditField } from './edit-field';
import { EditorActions } from './editor-actions';
import styles from './profile.module.css';

export interface AdultProfileFields {
  personId: number;
  displayName: string;
  /** Shown as context, not edited here — a relationship is a leader's record. */
  relationship: string | null;
  first_name: string | null;
  last_name: string | null;
  birthdate: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * One adult's self-service edit form — the grown-up counterpart to
 * ProfileEditor, and the reason /profile lists the whole household rather
 * than only its scouts.
 *
 * Same contract as the scout form, including the 2026-08-15 reversal: the
 * fields show the PENDING proposal when one exists, with the live value
 * underneath, rather than showing the live record and describing the proposal
 * in a banner. See lib/profile-draft.ts.
 */
export default function AdultEditor({
  adult,
  pending,
  values,
  dirty,
  onChange,
  onDiscard,
  submitAction,
  withdrawAction
}: {
  adult: AdultProfileFields;
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

  function submit() {
    const fd = new FormData();
    fd.set('personId', String(adult.personId));
    for (const field of EDITABLE_PERSON_FIELDS) fd.set(field, values[field] ?? '');
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
          , still awaiting a leader&rsquo;s review. {adult.displayName}&rsquo;s record keeps its
          current information until then — the fields marked below show what it still says. Edit
          and submit again to replace this update, or undo it to take it out of the queue.
        </p>
      )}

      <div className={styles.editGrid}>
        <EditField
          label="First Name"
          name="first_name"
          queued={queued}
          previous={displayValue(adult.first_name)}
        >
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              value={values.first_name ?? ''}
              onChange={(e) => onChange('first_name', e.target.value)}
            />
          )}
        </EditField>
        <EditField
          label="Last Name"
          name="last_name"
          queued={queued}
          previous={displayValue(adult.last_name)}
        >
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              value={values.last_name ?? ''}
              onChange={(e) => onChange('last_name', e.target.value)}
            />
          )}
        </EditField>
        <EditField
          label="Birthdate"
          name="birthdate"
          queued={queued}
          previous={displayValue(adult.birthdate)}
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
          label="Email"
          name="primary_email"
          queued={queued}
          previous={displayValue(adult.primary_email)}
        >
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              type="email"
              value={values.primary_email ?? ''}
              onChange={(e) => onChange('primary_email', e.target.value)}
            />
          )}
        </EditField>
        <EditField
          label="Phone"
          name="primary_phone"
          queued={queued}
          previous={displayValue(adult.primary_phone)}
        >
          {(a) => (
            <input
              {...a}
              className={styles.editInput}
              type="tel"
              value={values.primary_phone ?? ''}
              onChange={(e) => onChange('primary_phone', e.target.value)}
              placeholder="(414) 555-1234"
            />
          )}
        </EditField>
        <EditField
          label="Address Line 1"
          full
          name="address_line1"
          queued={queued}
          previous={displayValue(adult.address_line1)}
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
          previous={displayValue(adult.address_line2)}
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
          queued={queued} previous={displayValue(adult.city)}>
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
          queued={queued} previous={displayValue(adult.state)}>
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
          queued={queued} previous={displayValue(adult.zip)}>
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
      </div>
      <p className={styles.helpText}>
        Changes are reviewed by a leader before they take effect on {adult.displayName}&rsquo;s
        record. To change who someone is to a scout, or to remove them from the household, ask a
        leader.
      </p>
      <EditorActions
        entityType="adult"
        entityId={String(adult.personId)}
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
