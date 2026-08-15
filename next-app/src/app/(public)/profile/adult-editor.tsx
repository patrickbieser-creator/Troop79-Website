'use client';

import { useState, useTransition } from 'react';
import { fieldLabel, type ChangeRequestRow } from '@/lib/change-requests';
import { DatePickerField } from '@/app/admin/(workspace)/_components/date-picker-field';
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
 * Same contract as the scout form: prefilled from the LIVE `people` row, never
 * from a pending proposal, because submitting REPLACES any pending request
 * rather than merging with it. The pending one is surfaced as a warning so
 * that replacement is a choice, not a surprise.
 */
export default function AdultEditor({
  adult,
  pending,
  submitAction
}: {
  adult: AdultProfileFields;
  pending: ChangeRequestRow | null;
  submitAction: (formData: FormData) => Promise<void>;
}) {
  const [firstName, setFirstName] = useState(adult.first_name ?? '');
  const [lastName, setLastName] = useState(adult.last_name ?? '');
  const [birthdate, setBirthdate] = useState(adult.birthdate ?? '');
  const [email, setEmail] = useState(adult.primary_email ?? '');
  const [phone, setPhone] = useState(adult.primary_phone ?? '');
  const [addr1, setAddr1] = useState(adult.address_line1 ?? '');
  const [addr2, setAddr2] = useState(adult.address_line2 ?? '');
  const [city, setCity] = useState(adult.city ?? '');
  const [stateAbbr, setStateAbbr] = useState(adult.state ?? '');
  const [zip, setZip] = useState(adult.zip ?? '');
  const [isPending, startTransition] = useTransition();

  function submit() {
    const fd = new FormData();
    fd.set('personId', String(adult.personId));
    fd.set('first_name', firstName);
    fd.set('last_name', lastName);
    fd.set('birthdate', birthdate);
    fd.set('primary_email', email);
    fd.set('primary_phone', phone);
    fd.set('address_line1', addr1);
    fd.set('address_line2', addr2);
    fd.set('city', city);
    fd.set('state', stateAbbr);
    fd.set('zip', zip);
    startTransition(() => submitAction(fd));
  }

  return (
    <>
      {pending && (
        <p className={styles.warnNote}>
          An update for {adult.displayName} submitted{' '}
          {new Date(pending.submitted_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
          })}{' '}
          is still awaiting review (
          {Object.keys(pending.proposed_changes).map((f) => fieldLabel('adult', f)).join(', ')}).
          Submitting this form will replace it — the earlier update will not also apply.
        </p>
      )}

      <div className={styles.editGrid}>
        <label className={styles.editField}>
          <span className={styles.editLabel}>First Name</span>
          <input className={styles.editInput} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Last Name</span>
          <input className={styles.editInput} value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Birthdate</span>
          <DatePickerField value={birthdate} onChange={setBirthdate} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Email</span>
          <input className={styles.editInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Phone</span>
          <input className={styles.editInput} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(414) 555-1234" />
        </label>
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Address Line 1</span>
          <input className={styles.editInput} value={addr1} onChange={(e) => setAddr1(e.target.value)} />
        </label>
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Address Line 2</span>
          <input className={styles.editInput} value={addr2} onChange={(e) => setAddr2(e.target.value)} placeholder="Apt / unit (optional)" />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>City</span>
          <input className={styles.editInput} value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>State</span>
          <input className={styles.editInput} value={stateAbbr} onChange={(e) => setStateAbbr(e.target.value)} maxLength={2} placeholder="WI" />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>ZIP</span>
          <input className={styles.editInput} value={zip} onChange={(e) => setZip(e.target.value)} placeholder="53202" />
        </label>
      </div>
      <p className={styles.helpText}>
        Changes are reviewed by a leader before they take effect on {adult.displayName}&rsquo;s
        record — you won&rsquo;t see a change reflected here until it&rsquo;s approved. To change
        who someone is to a scout, or to remove them from the household, ask a leader.
      </p>
      <div className={styles.editActions}>
        <button type="button" className={styles.editSaveBtn} disabled={isPending} onClick={submit}>
          {isPending ? 'Submitting…' : 'Submit update'}
        </button>
      </div>
    </>
  );
}
