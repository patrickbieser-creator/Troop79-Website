'use client';

import { useState, useTransition } from 'react';
import { createScout, promoteScoutToAdult, updateScout } from '../lookups/actions';
import { INACTIVE_REASON_LABEL, type InactiveReason } from '@/lib/supabase/types';
import { ScoutRelations } from './scout-relations';
import { PendingUpdatePanel } from './pending-update-panel';
import { ageOn, gradeFromGradYear, gradeLabel, gradYearFromGrade } from '@/lib/demographics';
import type { EditableScoutField } from '@/lib/change-requests';
import styles from '../lookups/lookups.module.css';

export interface ScoutRow {
  /** people.id — the scout's identity in the person spine. */
  person_id: number | null;
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  patrol: string | null;
  current_rank: string | null;
  bsa_member_id: string | null;
  birthdate: string | null;
  gender: 'M' | 'F' | null;
  school: string | null;
  graduation_year: number | null;
  swim_class: 'swimmer' | 'beginner' | 'nonswimmer' | null;
  active: boolean;
  inactive_reason: InactiveReason | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  health_form_date: string | null;
  things_we_should_know: string | null;
}

export interface ParentRow {
  id?: number;
  scout_id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  same_address_as_scout: boolean;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sort_order: number;
}

/** Order the inactive reasons are offered in when a scout is marked inactive.
 *  Server-side validation of the same set lives in lookups/actions.ts. */
const REASON_ORDER: InactiveReason[] = [
  'dropped_out',
  'transferred',
  'moved_away',
  'aged_out',
  'other'
];

export function ScoutForm({
  row,
  ranks,
  onClose
}: {
  row: ScoutRow | null;
  ranks: { id: string; display_name: string }[];
  onClose: () => void;
}) {
  const isNew = row === null;
  const [id, setId] = useState(row?.id ?? '');
  const [firstName, setFirstName] = useState(row?.first_name ?? '');
  const [lastName, setLastName] = useState(row?.last_name ?? '');
  const [patrol, setPatrol] = useState(row?.patrol ?? '');
  const [bsaMemberId, setBsaMemberId] = useState(row?.bsa_member_id ?? '');
  const [active, setActive] = useState(row?.active ?? true);
  const [inactiveReason, setInactiveReason] = useState<InactiveReason | ''>(
    row?.inactive_reason ?? ''
  );
  const [addr1, setAddr1] = useState(row?.address_line1 ?? '');
  const [addr2, setAddr2] = useState(row?.address_line2 ?? '');
  const [city, setCity] = useState(row?.city ?? '');
  const [stateAbbr, setStateAbbr] = useState(row?.state ?? '');
  const [zip, setZip] = useState(row?.zip ?? '');
  const [phone, setPhone] = useState(row?.phone ?? '');
  const [email, setEmail] = useState(row?.email ?? '');
  const [healthFormDate, setHealthFormDate] = useState(row?.health_form_date ?? '');
  const [thingsWeShouldKnow, setThingsWeShouldKnow] = useState(row?.things_we_should_know ?? '');
  const [birthdate, setBirthdate] = useState(row?.birthdate ?? '');
  const [gender, setGender] = useState<string>(row?.gender ?? '');
  const [school, setSchool] = useState(row?.school ?? '');
  const [grade, setGrade] = useState<string>(() => {
    const g = gradeFromGradYear(row?.graduation_year ?? null);
    return g === null ? '' : String(g);
  });
  const [swimClass, setSwimClass] = useState<string>(row?.swim_class ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const currentRankLabel = row?.current_rank
    ? ranks.find((r) => r.id === row.current_rank)?.display_name ?? row.current_rank
    : null;

  const currentValues: Partial<Record<EditableScoutField, string | number | null>> = row
    ? {
        address_line1: row.address_line1,
        address_line2: row.address_line2,
        city: row.city,
        state: row.state,
        zip: row.zip,
        phone: row.phone,
        email: row.email,
        school: row.school,
        graduation_year: row.graduation_year,
        swim_class: row.swim_class,
        birthdate: row.birthdate,
        things_we_should_know: row.things_we_should_know
      }
    : {};

  function submit() {
    setErr(null);
    if (!active && !inactiveReason) {
      setErr('Pick a reason — required when the scout is inactive.');
      return;
    }
    const fd = new FormData();
    fd.set('id', id);
    fd.set('first_name', firstName);
    fd.set('last_name', lastName);
    fd.set('patrol', patrol);
    fd.set('bsa_member_id', bsaMemberId);
    fd.set('active', active ? 'true' : 'false');
    fd.set('inactive_reason', active ? '' : inactiveReason);
    fd.set('address_line1', addr1);
    fd.set('address_line2', addr2);
    fd.set('city', city);
    fd.set('state', stateAbbr);
    fd.set('zip', zip);
    fd.set('phone', phone);
    fd.set('email', email);
    fd.set('health_form_date', healthFormDate);
    fd.set('things_we_should_know', thingsWeShouldKnow);
    fd.set('birthdate', birthdate);
    fd.set('gender', gender);
    fd.set('school', school);
    fd.set('graduation_year', grade === '' ? '' : String(gradYearFromGrade(Number(grade))));
    fd.set('swim_class', swimClass);
    // `parents` is deliberately NOT sent — createScout/updateScout no longer
    // read or handle it at all. Parents are relationships now, saved as they
    // are edited (see scout-relations.tsx / person-actions.ts).
    startTransition(async () => {
      const res = isNew ? await createScout(fd) : await updateScout(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      onClose();
    });
  }


  return (
    <div className={styles.editDialogInner}>
      <div className={styles.editDialogHeader}>
        <h3>{isNew ? 'Add Scout' : `Edit ${row?.display_name}`}</h3>
        <p>
          Internal ID is permanent once created. Current Rank is derived from
          the ledger&rsquo;s rank-award entries and updates automatically when
          a BoR is recorded.
        </p>
      </div>

      {!isNew && row && (
        <PendingUpdatePanel scoutId={row.id} currentValues={currentValues} onApplied={onClose} />
      )}

      <FormSection title="Identity">
        <div className={styles.editGrid}>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Internal ID</span>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              className={`${styles.editInput} ${styles.editInputMono}`}
              placeholder="e.g. F01"
              disabled={!isNew}
              required
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>BSA Member ID</span>
            <input
              type="text"
              value={bsaMemberId}
              onChange={(e) => setBsaMemberId(e.target.value)}
              className={styles.editInput}
              placeholder="(optional)"
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>First Name</span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={styles.editInput}
              required
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Last Name</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={styles.editInput}
              required
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Patrol</span>
            <input
              type="text"
              value={patrol}
              onChange={(e) => setPatrol(e.target.value)}
              className={styles.editInput}
              placeholder="e.g. Hawk"
            />
          </label>
          <div className={styles.editField}>
            <span className={styles.editLabel}>Current Rank · derived</span>
            <div className={styles.readOnlyValue}>
              {currentRankLabel ?? <span className={styles.muted}>— (no rank earned yet)</span>}
            </div>
          </div>
        </div>
      </FormSection>

      <FormSection title="Demographics">
        <div className={styles.editGrid}>
          <label className={styles.editField}>
            <span className={styles.editLabel}>
              Birthdate{ageOn(birthdate || null) !== null ? ` · age ${ageOn(birthdate || null)}` : ''}
            </span>
            <input
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              className={styles.editInput}
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Gender</span>
            <select value={gender} onChange={(e) => setGender(e.target.value)} className={styles.editInput}>
              <option value="">{'—'}</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>School</span>
            <input
              type="text"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              className={styles.editInput}
              placeholder="e.g. Milwaukee German Immersion"
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>
              Grade{grade !== '' ? ` · class of ${gradYearFromGrade(Number(grade))}` : ''}
            </span>
            <select value={grade} onChange={(e) => setGrade(e.target.value)} className={styles.editInput}>
              <option value="">{'—'}</option>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                <option key={g} value={g}>{gradeLabel(g)}</option>
              ))}
            </select>
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Swim classification</span>
            <select value={swimClass} onChange={(e) => setSwimClass(e.target.value)} className={styles.editInput}>
              <option value="">{'—'}</option>
              <option value="swimmer">Swimmer</option>
              <option value="beginner">Beginner</option>
              <option value="nonswimmer">Non-swimmer</option>
            </select>
          </label>
        </div>
        <p className={styles.helpText}>
          Age and grade are derived automatically (grade advances each August 1) {'—'} the stored
          value is the graduation class year.
        </p>
      </FormSection>

      <FormSection title="Contact">
        <div className={styles.editGrid}>
          <label className={styles.editFieldFull}>
            <span className={styles.editLabel}>Address Line 1</span>
            <input
              type="text"
              value={addr1}
              onChange={(e) => setAddr1(e.target.value)}
              className={styles.editInput}
            />
          </label>
          <label className={styles.editFieldFull}>
            <span className={styles.editLabel}>Address Line 2</span>
            <input
              type="text"
              value={addr2}
              onChange={(e) => setAddr2(e.target.value)}
              className={styles.editInput}
              placeholder="Apt / unit (optional)"
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>City</span>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={styles.editInput}
            />
          </label>
          <div className={styles.editTinyGrid}>
            <label>
              <span className={styles.editLabel}>State</span>
              <input
                type="text"
                value={stateAbbr}
                onChange={(e) => setStateAbbr(e.target.value)}
                className={styles.editInput}
                maxLength={2}
                placeholder="WI"
              />
            </label>
            <label>
              <span className={styles.editLabel}>ZIP</span>
              <input
                type="text"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                className={styles.editInput}
                placeholder="53202"
              />
            </label>
          </div>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Phone</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={styles.editInput}
              placeholder="(414) 555-1234"
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.editInput}
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Health Form Date</span>
            <input
              type="date"
              value={healthFormDate}
              onChange={(e) => setHealthFormDate(e.target.value)}
              className={styles.editInput}
            />
          </label>
        </div>
      </FormSection>

      <FormSection title="Things We Should Know">
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Food allergies, medical conditions, special needs</span>
          <textarea
            value={thingsWeShouldKnow}
            onChange={(e) => setThingsWeShouldKnow(e.target.value)}
            className={styles.editInput}
            rows={3}
            placeholder="e.g. Peanut allergy (EpiPen in backpack), asthma inhaler, needs a lower bunk"
          />
        </label>
        <p className={styles.helpText}>
          Visible to leaders only. Feeds a future per-event report listing special needs for
          attending Scouts and adults.
        </p>
      </FormSection>

      <FormSection title="Parents / Guardians">
        <ScoutRelations scoutPersonId={row?.person_id ?? null} />
      </FormSection>

      <FormSection title="Status">
        <div className={styles.statusRadioRow}>
          <label className={styles.statusRadio}>
            <input
              type="radio"
              name={`status-${row?.id ?? 'new'}`}
              checked={active}
              onChange={() => {
                setActive(true);
                setInactiveReason('');
              }}
            />
            <span>Active</span>
          </label>
          <label className={styles.statusRadio}>
            <input
              type="radio"
              name={`status-${row?.id ?? 'new'}`}
              checked={!active}
              onChange={() => setActive(false)}
            />
            <span>Inactive</span>
          </label>
        </div>
        {!active && (
          <select
            value={inactiveReason}
            onChange={(e) => setInactiveReason(e.target.value as InactiveReason | '')}
            className={styles.editInput}
            style={{ marginTop: 6, maxWidth: 320 }}
            required
          >
            <option value="">— Pick a reason —</option>
            {REASON_ORDER.map((r) => (
              <option key={r} value={r}>
                {INACTIVE_REASON_LABEL[r]}
              </option>
            ))}
          </select>
        )}
        <p className={styles.helpText}>
          Inactive scouts disappear from rosters, dashboards, and the Fast Entry
          picker. Their ledger history is preserved.
        </p>
      </FormSection>

      {err && <div className={styles.editError}>{err}</div>}

      <div className={styles.editActions}>
        {!isNew && row?.active && (
          <button
            type="button"
            className={styles.promoteBtn}
            style={{ marginRight: 'auto' }}
            disabled={isPending}
            onClick={() => {
              if (
                !window.confirm(
                  `Promote ${row.display_name} to adult (turned 18)?

` +
                    `• Scout record becomes Inactive (Aged out) — ledger history and clipboard are preserved
` +
                    `• Their sign-off initials become an ADULT leader (created if they don't have initials yet)
` +
                    `• They leave scout rosters, Fast Entry, and Meeting Plan suggestions

` +
                    `Record any outstanding requirement sign-offs (e.g. Eagle BoR) BEFORE promoting.`
                )
              ) {
                return;
              }
              setErr(null);
              const fd = new FormData();
              fd.set('scout_id', row.id);
              startTransition(async () => {
                const res = await promoteScoutToAdult(fd);
                if (!res.ok) {
                  setErr(res.error ?? 'Promotion failed');
                  return;
                }
                onClose();
              });
            }}
          >
            Promote to adult (18+)
          </button>
        )}
        <button
          type="button"
          className={styles.editBtn}
          onClick={onClose}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.editSaveBtn}
          onClick={submit}
          disabled={
            isPending ||
            !firstName.trim() ||
            !lastName.trim() ||
            (isNew && !id.trim()) ||
            (!active && !inactiveReason)
          }
        >
          {isPending ? 'Saving…' : isNew ? 'Create Scout' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function FormSection({
  title,
  actions,
  children
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.editSection}>
      <div className={styles.editSectionHeader}>
        <h4>{title}</h4>
        {actions}
      </div>
      {children}
    </div>
  );
}

