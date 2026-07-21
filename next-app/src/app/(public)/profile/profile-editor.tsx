'use client';

import { useState, useTransition } from 'react';
import { gradeFromGradYear, gradeLabel, gradYearFromGrade } from '@/lib/demographics';
import { FIELD_LABEL, type ChangeRequestRow } from '@/lib/change-requests';
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

/**
 * One scout's self-service edit form (Plans/Scout-Self-Service-Demographics.md).
 * Prefilled with the LIVE record, not any pending proposal — the pending
 * request (if one exists) is surfaced separately as a warning, since
 * submitting here overwrites it rather than merging with it.
 */
export default function ProfileEditor({
  scout,
  pending,
  submitAction
}: {
  scout: ScoutProfileFields;
  pending: ChangeRequestRow | null;
  submitAction: (formData: FormData) => Promise<void>;
}) {
  const [addr1, setAddr1] = useState(scout.address_line1 ?? '');
  const [addr2, setAddr2] = useState(scout.address_line2 ?? '');
  const [city, setCity] = useState(scout.city ?? '');
  const [stateAbbr, setStateAbbr] = useState(scout.state ?? '');
  const [zip, setZip] = useState(scout.zip ?? '');
  const [phone, setPhone] = useState(scout.phone ?? '');
  const [email, setEmail] = useState(scout.email ?? '');
  const [school, setSchool] = useState(scout.school ?? '');
  const [grade, setGrade] = useState<string>(() => {
    const g = gradeFromGradYear(scout.graduation_year);
    return g === null ? '' : String(g);
  });
  const [swimClass, setSwimClass] = useState(scout.swim_class ?? '');
  const [birthdate, setBirthdate] = useState(scout.birthdate ?? '');
  const [thingsWeShouldKnow, setThingsWeShouldKnow] = useState(scout.things_we_should_know ?? '');
  const [isPending, startTransition] = useTransition();

  function submit() {
    const fd = new FormData();
    fd.set('scoutId', scout.id);
    fd.set('address_line1', addr1);
    fd.set('address_line2', addr2);
    fd.set('city', city);
    fd.set('state', stateAbbr);
    fd.set('zip', zip);
    fd.set('phone', phone);
    fd.set('email', email);
    fd.set('school', school);
    fd.set('graduation_year', grade === '' ? '' : String(gradYearFromGrade(Number(grade))));
    fd.set('swim_class', swimClass);
    fd.set('birthdate', birthdate);
    fd.set('things_we_should_know', thingsWeShouldKnow);
    startTransition(() => submitAction(fd));
  }

  return (
    <>
      {pending && (
        <p className={styles.warnNote}>
          An update for {scout.displayName} submitted{' '}
          {new Date(pending.submitted_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
          })}{' '}
          is still awaiting review ({Object.keys(pending.proposed_changes).map((f) => FIELD_LABEL[f as keyof typeof FIELD_LABEL]).join(', ')}).
          Submitting this form will replace it — the earlier update will not also apply.
        </p>
      )}

      <div className={styles.editGrid}>
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
        <label className={styles.editField}>
          <span className={styles.editLabel}>Phone</span>
          <input className={styles.editInput} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(414) 555-1234" />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Email</span>
          <input className={styles.editInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>School</span>
          <input className={styles.editInput} value={school} onChange={(e) => setSchool(e.target.value)} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Grade</span>
          <select className={styles.editInput} value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">—</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
              <option key={g} value={g}>{gradeLabel(g)}</option>
            ))}
          </select>
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Swim Classification</span>
          <select className={styles.editInput} value={swimClass} onChange={(e) => setSwimClass(e.target.value)}>
            <option value="">—</option>
            <option value="swimmer">Swimmer</option>
            <option value="beginner">Beginner</option>
            <option value="nonswimmer">Non-swimmer</option>
          </select>
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Birthdate</span>
          <input className={styles.editInput} type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
        </label>
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Things We Should Know — food allergies, medical conditions, special needs</span>
          <textarea
            className={styles.editInput}
            rows={3}
            value={thingsWeShouldKnow}
            onChange={(e) => setThingsWeShouldKnow(e.target.value)}
            placeholder="e.g. Peanut allergy (EpiPen in backpack), asthma inhaler"
          />
        </label>
      </div>
      <p className={styles.helpText}>
        Changes are reviewed by a leader before they take effect on {scout.displayName}&rsquo;s
        record — you won&rsquo;t see a change reflected here until it&rsquo;s approved.
      </p>
      <div className={styles.editActions}>
        <button type="button" className={styles.editSaveBtn} disabled={isPending} onClick={submit}>
          {isPending ? 'Submitting…' : 'Submit update'}
        </button>
      </div>
    </>
  );
}
