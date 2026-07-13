'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createScout, promoteScoutToAdult, updateScout } from './actions';
import { INACTIVE_REASON_LABEL, type InactiveReason } from '@/lib/supabase/types';
import { ageOn, gradeFromGradYear, gradeLabel, gradYearFromGrade } from '@/lib/demographics';
import { useLookupTable } from './use-lookup-table';
import styles from './lookups.module.css';

export interface ScoutRow {
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

interface Props {
  rows: ScoutRow[];
  ranks: { id: string; display_name: string }[];
  parentsByScout: Map<string, ParentRow[]>;
}

const REASON_ORDER: InactiveReason[] = [
  'dropped_out',
  'transferred',
  'moved_away',
  'aged_out',
  'other'
];

export function ScoutEditor({ rows, ranks, parentsByScout }: Props) {
  const [openFor, setOpenFor] = useState<ScoutRow | 'new' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const t = useLookupTable(rows, (s) => `${s.display_name} ${s.id} ${s.bsa_member_id ?? ""}`);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (openFor && !dlg.open) dlg.showModal();
    if (!openFor && dlg.open) dlg.close();
  }, [openFor]);

  return (
    <>
      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setOpenFor('new')}
        >
          + Add Scout
        </button>
      </div>
      {t.searchEl}
      <div className={t.scrollClass}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Scout</th>
            <th>Internal ID</th>
            <th>Rank</th>
            <th>BSA Member ID</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((s) => {
            const rankLabel = s.current_rank
              ? ranks.find((r) => r.id === s.current_rank)?.display_name ?? s.current_rank
              : '—';
            return (
              <tr key={s.id}>
                <td>
                  {s.display_name}
                  {s.patrol && (
                    <span className={styles.subText}>{s.patrol} Patrol</span>
                  )}
                </td>
                <td className={styles.codeCell}>{s.id}</td>
                <td>
                  {s.current_rank ? (
                    rankLabel
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td>
                  {s.bsa_member_id ?? (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td>
                  <span
                    className={`${styles.tag} ${s.active ? styles.tagActive : styles.tagInactive}`}
                  >
                    {s.active ? 'Active' : 'Inactive'}
                  </span>
                  {!s.active && s.inactive_reason && (
                    <span className={styles.subText}>
                      {INACTIVE_REASON_LABEL[s.inactive_reason]}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className={styles.editBtn}
                    onClick={() => setOpenFor(s)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {t.footerEl}

      <dialog
        ref={dialogRef}
        className={`${styles.editDialog} ${styles.editDialogLarge}`}
        onClose={() => setOpenFor(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpenFor(null);
        }}
      >
        {openFor && (
          <ScoutForm
            row={openFor === 'new' ? null : openFor}
            initialParents={
              openFor !== 'new' ? parentsByScout.get(openFor.id) ?? [] : []
            }
            ranks={ranks}
            onClose={() => setOpenFor(null)}
          />
        )}
      </dialog>
    </>
  );
}

interface ParentDraft {
  name: string;
  relationship: string;
  phone: string;
  email: string;
  same_address_as_scout: boolean;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
}

function emptyParent(): ParentDraft {
  return {
    name: '',
    relationship: '',
    phone: '',
    email: '',
    same_address_as_scout: true,
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    zip: ''
  };
}

function parentRowToDraft(p: ParentRow): ParentDraft {
  return {
    name: p.name,
    relationship: p.relationship ?? '',
    phone: p.phone ?? '',
    email: p.email ?? '',
    same_address_as_scout: p.same_address_as_scout,
    address_line1: p.address_line1 ?? '',
    address_line2: p.address_line2 ?? '',
    city: p.city ?? '',
    state: p.state ?? '',
    zip: p.zip ?? ''
  };
}

function ScoutForm({
  row,
  initialParents,
  ranks,
  onClose
}: {
  row: ScoutRow | null;
  initialParents: ParentRow[];
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
  const [birthdate, setBirthdate] = useState(row?.birthdate ?? '');
  const [gender, setGender] = useState<string>(row?.gender ?? '');
  const [school, setSchool] = useState(row?.school ?? '');
  const [grade, setGrade] = useState<string>(() => {
    const g = gradeFromGradYear(row?.graduation_year ?? null);
    return g === null ? '' : String(g);
  });
  const [swimClass, setSwimClass] = useState<string>(row?.swim_class ?? '');
  const [parents, setParents] = useState<ParentDraft[]>(
    initialParents.length > 0
      ? initialParents.map(parentRowToDraft)
      : [emptyParent()]
  );
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const currentRankLabel = row?.current_rank
    ? ranks.find((r) => r.id === row.current_rank)?.display_name ?? row.current_rank
    : null;

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
    fd.set('birthdate', birthdate);
    fd.set('gender', gender);
    fd.set('school', school);
    fd.set('graduation_year', grade === '' ? '' : String(gradYearFromGrade(Number(grade))));
    fd.set('swim_class', swimClass);
    fd.set(
      'parents',
      JSON.stringify(
        parents
          .filter((p) => p.name.trim() !== '')
          .map((p) => ({
            name: p.name,
            relationship: p.relationship || null,
            phone: p.phone || null,
            email: p.email || null,
            same_address_as_scout: p.same_address_as_scout,
            address_line1: p.same_address_as_scout ? null : p.address_line1 || null,
            address_line2: p.same_address_as_scout ? null : p.address_line2 || null,
            city: p.same_address_as_scout ? null : p.city || null,
            state: p.same_address_as_scout ? null : p.state || null,
            zip: p.same_address_as_scout ? null : p.zip || null
          }))
      )
    );
    startTransition(async () => {
      const res = isNew ? await createScout(fd) : await updateScout(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      onClose();
    });
  }

  function updateParent(i: number, patch: Partial<ParentDraft>) {
    setParents((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addParent() {
    setParents((prev) => [...prev, emptyParent()]);
  }
  function removeParent(i: number) {
    setParents((prev) => prev.filter((_, idx) => idx !== i));
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

      <FormSection
        title="Parents / Guardians"
        actions={
          <button type="button" className={styles.editBtn} onClick={addParent}>
            + Add another
          </button>
        }
      >
        {parents.map((p, i) => (
          <ParentSubform
            key={i}
            value={p}
            onChange={(patch) => updateParent(i, patch)}
            onRemove={parents.length > 1 ? () => removeParent(i) : undefined}
            index={i}
          />
        ))}
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
            className={styles.editBtn}
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

function ParentSubform({
  value,
  onChange,
  onRemove,
  index
}: {
  value: ParentDraft;
  onChange: (patch: Partial<ParentDraft>) => void;
  onRemove?: () => void;
  index: number;
}) {
  return (
    <div className={styles.parentRow}>
      <div className={styles.parentRowHeader}>
        <span className={styles.parentRowLabel}>Parent {index + 1}</span>
        {onRemove && (
          <button
            type="button"
            className={`${styles.editBtn} ${styles.dangerBtn}`}
            onClick={onRemove}
          >
            Remove
          </button>
        )}
      </div>
      <div className={styles.editGrid}>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Name</span>
          <input
            type="text"
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={styles.editInput}
            placeholder="Required"
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Relationship</span>
          <input
            type="text"
            value={value.relationship}
            onChange={(e) => onChange({ relationship: e.target.value })}
            className={styles.editInput}
            placeholder="Mom / Dad / Guardian"
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Phone</span>
          <input
            type="tel"
            value={value.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            className={styles.editInput}
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Email</span>
          <input
            type="email"
            value={value.email}
            onChange={(e) => onChange({ email: e.target.value })}
            className={styles.editInput}
          />
        </label>
        <div className={styles.editFieldFull}>
          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={value.same_address_as_scout}
              onChange={(e) =>
                onChange({ same_address_as_scout: e.target.checked })
              }
            />
            <span>Same address as scout</span>
          </label>
        </div>
        {!value.same_address_as_scout && (
          <>
            <label className={styles.editFieldFull}>
              <span className={styles.editLabel}>Address Line 1</span>
              <input
                type="text"
                value={value.address_line1}
                onChange={(e) => onChange({ address_line1: e.target.value })}
                className={styles.editInput}
              />
            </label>
            <label className={styles.editFieldFull}>
              <span className={styles.editLabel}>Address Line 2</span>
              <input
                type="text"
                value={value.address_line2}
                onChange={(e) => onChange({ address_line2: e.target.value })}
                className={styles.editInput}
              />
            </label>
            <label className={styles.editField}>
              <span className={styles.editLabel}>City</span>
              <input
                type="text"
                value={value.city}
                onChange={(e) => onChange({ city: e.target.value })}
                className={styles.editInput}
              />
            </label>
            <div className={styles.editTinyGrid}>
              <label>
                <span className={styles.editLabel}>State</span>
                <input
                  type="text"
                  value={value.state}
                  onChange={(e) => onChange({ state: e.target.value })}
                  className={styles.editInput}
                  maxLength={2}
                />
              </label>
              <label>
                <span className={styles.editLabel}>ZIP</span>
                <input
                  type="text"
                  value={value.zip}
                  onChange={(e) => onChange({ zip: e.target.value })}
                  className={styles.editInput}
                />
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
