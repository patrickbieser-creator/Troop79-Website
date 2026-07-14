'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ageOn, gradeFromGradYear, gradeLabel, SWIM_CLASS_LABEL } from '@/lib/demographics';
import type { Scout, ScoutParent } from '@/lib/supabase/types';
import styles from './roster.module.css';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${iso}T12:00:00Z`));
}

function addressLine(p: {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string | null {
  const line1 = [p.address_line1, p.address_line2].filter(Boolean).join(' ');
  const line2 = [p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const full = [line1, line2].filter(Boolean).join(', ');
  return full || null;
}

interface Props {
  scouts: Scout[];
  rankLabel: Record<string, string>;
  parentsByScout: Record<string, ScoutParent[]>;
  today: string;
}

export function ScoutsTable({ scouts, rankLabel, parentsByScout, today }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = openId ? scouts.find((s) => s.id === openId) : null;

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Scout</th>
            <th>Age</th>
            <th>Birthday</th>
            <th>Grade</th>
            <th>School</th>
            <th>Patrol</th>
            <th>Rank</th>
            <th>Swim</th>
            <th>BSA ID</th>
            <th>Health Form</th>
          </tr>
        </thead>
        <tbody>
          {scouts.map((s) => {
            const age = ageOn(s.birthdate, today);
            const grade = gradeFromGradYear(s.graduation_year, today);
            return (
              <tr key={s.id}>
                <td>
                  <button type="button" className={styles.nameBtn} onClick={() => setOpenId(s.id)}>
                    {s.display_name}
                  </button>
                </td>
                <td>{age ?? <span className={styles.muted}>—</span>}</td>
                <td>{s.birthdate ? fmtDate(s.birthdate) : <span className={styles.muted}>—</span>}</td>
                <td>{grade !== null ? gradeLabel(grade) : <span className={styles.muted}>—</span>}</td>
                <td>{s.school ?? <span className={styles.muted}>—</span>}</td>
                <td>{s.patrol ?? <span className={styles.muted}>—</span>}</td>
                <td>{s.current_rank ? (rankLabel[s.current_rank] ?? s.current_rank) : '—'}</td>
                <td>
                  {s.swim_class ? (
                    SWIM_CLASS_LABEL[s.swim_class]
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td className={styles.mono}>{s.bsa_member_id ?? '—'}</td>
                <td>{s.health_form_date ? fmtDate(s.health_form_date) : <span className={styles.muted}>—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dialog
        ref={dialogRef}
        className={styles.detailDialog}
        onClose={() => setOpenId(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpenId(null);
        }}
      >
        {open && (
          <ScoutDetail
            scout={open}
            parents={parentsByScout[open.id] ?? []}
            rankLabel={rankLabel}
            today={today}
            onClose={() => setOpenId(null)}
          />
        )}
      </dialog>
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.detailField}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{value ?? <span className={styles.muted}>—</span>}</span>
    </div>
  );
}

function ScoutDetail({
  scout: s,
  parents,
  rankLabel,
  today,
  onClose
}: {
  scout: Scout;
  parents: ScoutParent[];
  rankLabel: Record<string, string>;
  today: string;
  onClose: () => void;
}) {
  const age = ageOn(s.birthdate, today);
  const grade = gradeFromGradYear(s.graduation_year, today);
  const address = addressLine(s);

  return (
    <div className={styles.detailInner}>
      <div className={styles.detailHeader}>
        <div>
          <h3>{s.display_name}</h3>
          <p>
            {s.current_rank ? (rankLabel[s.current_rank] ?? s.current_rank) : 'No rank'}
            {s.patrol ? ` · ${s.patrol}` : ''}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href={`/admin/advancement/lookups?editScout=${s.id}`} className={styles.editLink}>
            Edit in Lookups &amp; Admin →
          </Link>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionHead}>Demographics</div>
        <div className={styles.detailGrid}>
          <Field label="Birthdate" value={s.birthdate ? `${fmtDate(s.birthdate)} (age ${age})` : null} />
          <Field label="Grade" value={grade !== null ? gradeLabel(grade) : null} />
          <Field label="School" value={s.school} />
          <Field label="Gender" value={s.gender === 'M' ? 'Male' : s.gender === 'F' ? 'Female' : null} />
          <Field label="Swim Class" value={s.swim_class ? SWIM_CLASS_LABEL[s.swim_class] : null} />
          <Field label="BSA Member ID" value={s.bsa_member_id} />
          <Field label="Health Form Date" value={s.health_form_date ? fmtDate(s.health_form_date) : null} />
          <Field label="Joined" value={s.joined_date ? fmtDate(s.joined_date) : null} />
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionHead}>Contact</div>
        <div className={styles.detailGrid}>
          <Field label="Address" value={address} />
          <Field label="Phone" value={s.phone} />
          <Field label="Email" value={s.email} />
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionHead}>
          Parents / Guardians {parents.length > 0 ? `(${parents.length})` : ''}
        </div>
        {parents.length === 0 ? (
          <p className={styles.muted}>None on file.</p>
        ) : (
          parents.map((p, i) => (
            <div key={p.id ?? i} className={styles.parentCard}>
              <div className={styles.detailGrid}>
                <Field label="Name" value={p.name} />
                <Field label="Relationship" value={p.relationship} />
                <Field label="Phone" value={p.phone} />
                <Field label="Email" value={p.email} />
                <Field
                  label="Address"
                  value={p.same_address_as_scout ? 'Same as scout' : addressLine(p)}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
