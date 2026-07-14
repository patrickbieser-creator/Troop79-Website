'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createLeader, deleteLeader, updateLeader } from './actions';
import { useLookupTable } from './use-lookup-table';
import { ageOn, yptStatus } from '@/lib/demographics';
import type { ScoutRow } from './scout-editor';
import styles from './lookups.module.css';

export type LeaderType = 'adult' | 'youth' | 'source';

export interface LeaderRow {
  code: string;
  name: string;
  role: string | null;
  is_person: boolean;
  scout_id: string | null;
  can_login: boolean;
  login_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  health_form_date: string | null;
  birthdate: string | null;
  bsa_member_id: string | null;
  ypt_completed: string | null;
}

interface Props {
  rows: LeaderRow[];
  /** adult | youth (initials of an active scout) | source (Camp, Clinic, …). */
  typeByCode: Record<string, LeaderType>;
  scouts: Pick<ScoutRow, 'id' | 'display_name'>[];
  /** The "First L." label each adult would get if login_name were blank. */
  defaultLoginLabelByCode: Record<string, string>;
}

const TYPE_LABEL: Record<LeaderType, string> = {
  adult: 'Adult',
  youth: 'Youth',
  source: 'Source'
};

export function LeaderEditor({ rows, typeByCode, scouts, defaultLoginLabelByCode }: Props) {
  const [openFor, setOpenFor] = useState<LeaderRow | 'new' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ code: string; msg: string } | null>(null);
  const [, startTransition] = useTransition();
  const t = useLookupTable(rows, (l) => `${l.code} ${l.name} ${l.role ?? ""}`);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (openFor && !dlg.open) dlg.showModal();
    if (!openFor && dlg.open) dlg.close();
  }, [openFor]);

  function onDelete(code: string) {
    if (
      !window.confirm(
        `Delete leader "${code}"? Only allowed when no ledger rows reference this signer.`
      )
    ) {
      return;
    }
    setBusyCode(code);
    setRowErr(null);
    const fd = new FormData();
    fd.set('code', code);
    startTransition(async () => {
      const res = await deleteLeader(fd);
      setBusyCode(null);
      if (!res.ok) {
        setRowErr({ code, msg: res.error ?? 'Delete failed' });
      }
    });
  }

  return (
    <>
      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setOpenFor('new')}
        >
          + Add Leader
        </button>
      </div>
      {t.searchEl}
      <div className={t.scrollClass}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Initials</th>
            <th>Name</th>
            <th>Type</th>
            <th>Role</th>
            <th>Contact</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((l) => (
            <tr key={l.code}>
              <td className={styles.codeCell}>{l.code}</td>
              <td>
                {l.name}
                {rowErr?.code === l.code && (
                  <span className={styles.rowError}>{rowErr.msg}</span>
                )}
              </td>
              <td>
                <span
                  className={`${styles.tag} ${
                    typeByCode[l.code] === 'youth'
                      ? styles.tagMb
                      : typeByCode[l.code] === 'source'
                        ? ''
                        : styles.tagRank
                  }`}
                >
                  {TYPE_LABEL[typeByCode[l.code] ?? 'adult']}
                </span>
                {typeByCode[l.code] !== 'source' && !l.can_login && (
                  <span
                    className={styles.tag}
                    style={{ marginLeft: 4 }}
                    title="Won't appear in the admin login autocomplete and can't sign in as a leader"
                  >
                    No login
                  </span>
                )}
              </td>
              <td>{l.role ?? <span className={styles.muted}>—</span>}</td>
              <td className={styles.contactCell}>
                {l.phone && <span className={styles.contactItem}>{l.phone}</span>}
                {l.email && <span className={styles.contactItem}>{l.email}</span>}
                {!l.phone && !l.email && <span className={styles.muted}>—</span>}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button
                  type="button"
                  className={styles.editBtn}
                  onClick={() => setOpenFor(l)}
                  disabled={busyCode === l.code}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`${styles.editBtn} ${styles.dangerBtn}`}
                  onClick={() => onDelete(l.code)}
                  disabled={busyCode === l.code}
                >
                  {busyCode === l.code ? '…' : 'Delete'}
                </button>
              </td>
            </tr>
          ))}
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
          <LeaderForm
            row={openFor === 'new' ? null : openFor}
            scouts={scouts}
            defaultLoginLabel={
              openFor !== 'new' ? defaultLoginLabelByCode[openFor.code] : undefined
            }
            onClose={() => setOpenFor(null)}
          />
        )}
      </dialog>
    </>
  );
}

function typeOf(row: LeaderRow | null): LeaderType {
  if (!row) return 'adult';
  if (!row.is_person) return 'source';
  if (row.scout_id) return 'youth';
  return 'adult';
}

function LeaderForm({
  row,
  scouts,
  defaultLoginLabel,
  onClose
}: {
  row: LeaderRow | null;
  scouts: Pick<ScoutRow, 'id' | 'display_name'>[];
  defaultLoginLabel?: string;
  onClose: () => void;
}) {
  const isNew = row === null;
  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [role, setRole] = useState(row?.role ?? '');
  const [type, setType] = useState<LeaderType>(typeOf(row));
  const [scoutId, setScoutId] = useState(row?.scout_id ?? '');
  const [canLogin, setCanLogin] = useState(row?.can_login ?? true);
  const [loginName, setLoginName] = useState(row?.login_name ?? '');
  const [addr1, setAddr1] = useState(row?.address_line1 ?? '');
  const [addr2, setAddr2] = useState(row?.address_line2 ?? '');
  const [city, setCity] = useState(row?.city ?? '');
  const [stateAbbr, setStateAbbr] = useState(row?.state ?? '');
  const [zip, setZip] = useState(row?.zip ?? '');
  const [phone, setPhone] = useState(row?.phone ?? '');
  const [email, setEmail] = useState(row?.email ?? '');
  const [healthFormDate, setHealthFormDate] = useState(row?.health_form_date ?? '');
  const [birthdate, setBirthdate] = useState(row?.birthdate ?? '');
  const [bsaMemberId, setBsaMemberId] = useState(row?.bsa_member_id ?? '');
  const [yptCompleted, setYptCompleted] = useState(row?.ypt_completed ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    if (type === 'youth' && !scoutId) {
      setErr('Pick which scout these initials belong to.');
      return;
    }
    const fd = new FormData();
    fd.set('original_code', row?.code ?? code);
    fd.set('code', code);
    fd.set('name', name);
    fd.set('role', role);
    fd.set('is_person', type === 'source' ? 'false' : 'true');
    fd.set('scout_id', type === 'youth' ? scoutId : '');
    fd.set('can_login', String(canLogin));
    fd.set('login_name', loginName);
    fd.set('address_line1', addr1);
    fd.set('address_line2', addr2);
    fd.set('city', city);
    fd.set('state', stateAbbr);
    fd.set('zip', zip);
    fd.set('phone', phone);
    fd.set('email', email);
    fd.set('health_form_date', healthFormDate);
    fd.set('birthdate', birthdate);
    fd.set('bsa_member_id_leader', bsaMemberId);
    fd.set('ypt_completed', yptCompleted);
    startTransition(async () => {
      const res = isNew ? await createLeader(fd) : await updateLeader(fd);
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
        <h3>{isNew ? 'Add Leader' : `Edit ${row?.code} — ${row?.name}`}</h3>
        <p>
          Initials are how the leader appears in every ledger sign-off. Keep
          them short and unique. Contact info is optional but helps the
          Advancement Chair reach out about clinics + signoffs.
        </p>
      </div>

      <div className={styles.editSection}>
        <div className={styles.editSectionHeader}>
          <h4>Identity</h4>
        </div>
        <div className={styles.editGrid}>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Initials / Code</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${styles.editInput} ${styles.editInputMono}`}
              placeholder="e.g. PB"
              required
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.editInput}
              required
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LeaderType)}
              className={styles.editInput}
            >
              <option value="adult">Adult</option>
              <option value="youth">Youth (linked to a scout)</option>
              <option value="source">Source (Camp, Clinic, …)</option>
            </select>
          </label>
          {type === 'youth' && (
            <label className={styles.editField}>
              <span className={styles.editLabel}>Scout</span>
              <select
                value={scoutId}
                onChange={(e) => setScoutId(e.target.value)}
                className={styles.editInput}
                required
              >
                <option value="">— Pick a scout —</option>
                {scouts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name} ({s.id})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={styles.editFieldFull}>
            <span className={styles.editLabel}>Role (optional)</span>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={styles.editInput}
              placeholder="e.g. Assistant Scoutmaster, Merit Badge Counselor"
            />
          </label>
          {type !== 'source' && (
            <>
              <label className={styles.editField} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={canLogin}
                  onChange={(e) => setCanLogin(e.target.checked)}
                />
                <span className={styles.editLabel} style={{ marginBottom: 0 }}>
                  Can sign in to /admin/login
                </span>
              </label>
              <label className={styles.editFieldFull}>
                <span className={styles.editLabel}>Login name (optional override)</span>
                <input
                  type="text"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  className={styles.editInput}
                  placeholder={
                    defaultLoginLabel
                      ? `Blank uses the auto-generated "${defaultLoginLabel}"`
                      : 'Blank uses an auto-generated "First L." label'
                  }
                />
              </label>
            </>
          )}
        </div>
        {type === 'youth' && (
          <p className={styles.muted}>
            While this scout is active, these initials count as a youth leader.
            Once the scout ages out (Scouts &amp; BSA IDs → uncheck Active),
            they automatically count as an adult everywhere — Meeting Plan,
            Leader Skills, Roll Call — with no further change needed here.
          </p>
        )}
      </div>

      <div className={styles.editSection}>
        <div className={styles.editSectionHeader}>
          <h4>Contact</h4>
        </div>
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
            <span className={styles.editLabel}>
              YPT Completed
              {yptCompleted
                ? ` · ${yptStatus(yptCompleted).status} (expires ${yptStatus(yptCompleted).expires})`
                : ''}
            </span>
            <input
              type="date"
              value={yptCompleted}
              onChange={(e) => setYptCompleted(e.target.value)}
              className={styles.editInput}
            />
          </label>
        </div>
      </div>

      {err && <div className={styles.editError}>{err}</div>}

      <div className={styles.editActions}>
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
          disabled={isPending || !code.trim() || !name.trim()}
        >
          {isPending ? 'Saving…' : isNew ? 'Create Leader' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
