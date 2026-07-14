'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ageOn, yptStatus } from '@/lib/demographics';
import type { Leader } from '@/lib/supabase/types';
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

function addressLine(l: Leader): string | null {
  const line1 = [l.address_line1, l.address_line2].filter(Boolean).join(' ');
  const line2 = [l.city, [l.state, l.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const full = [line1, line2].filter(Boolean).join(', ');
  return full || null;
}

interface Props {
  adults: Leader[];
  today: string;
}

export function AdultsTable({ adults, today }: Props) {
  const [openCode, setOpenCode] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = openCode ? adults.find((l) => l.code === openCode) : null;

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
            <th>Name</th>
            <th>Initials</th>
            <th>Role</th>
            <th>Age</th>
            <th>YPT</th>
            <th>BSA ID</th>
            <th>Health Form</th>
            <th>Contact</th>
          </tr>
        </thead>
        <tbody>
          {adults.map((l) => {
            const ypt = yptStatus(l.ypt_completed, today);
            return (
              <tr key={l.code}>
                <td>
                  <button type="button" className={styles.nameBtn} onClick={() => setOpenCode(l.code)}>
                    {l.name}
                  </button>
                </td>
                <td className={styles.mono}>{l.code}</td>
                <td>{l.role ?? <span className={styles.muted}>—</span>}</td>
                <td>{ageOn(l.birthdate, today) ?? <span className={styles.muted}>—</span>}</td>
                <td>
                  {ypt.status === 'current' && (
                    <span className={`${styles.badge} ${styles.badgeOk}`}>thru {fmtDate(ypt.expires)}</span>
                  )}
                  {ypt.status === 'expiring' && (
                    <span className={`${styles.badge} ${styles.badgeWarn}`}>expires {fmtDate(ypt.expires)}</span>
                  )}
                  {ypt.status === 'expired' && (
                    <span className={`${styles.badge} ${styles.badgeBad}`}>expired {fmtDate(ypt.expires)}</span>
                  )}
                  {ypt.status === 'missing' && (
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>not on file</span>
                  )}
                </td>
                <td className={styles.mono}>{l.bsa_member_id ?? '—'}</td>
                <td>{l.health_form_date ? fmtDate(l.health_form_date) : <span className={styles.muted}>—</span>}</td>
                <td>
                  {[l.phone, l.email].filter(Boolean).join(' · ') || (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dialog
        ref={dialogRef}
        className={styles.detailDialog}
        onClose={() => setOpenCode(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpenCode(null);
        }}
      >
        {open && <AdultDetail leader={open} today={today} onClose={() => setOpenCode(null)} />}
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

function AdultDetail({ leader: l, today, onClose }: { leader: Leader; today: string; onClose: () => void }) {
  const age = ageOn(l.birthdate, today);
  const ypt = yptStatus(l.ypt_completed, today);
  const address = addressLine(l);

  return (
    <div className={styles.detailInner}>
      <div className={styles.detailHeader}>
        <div>
          <h3>{l.name}</h3>
          <p>
            {l.role ?? 'Adult leader'} · initials <span className={styles.mono}>{l.code}</span>
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href={`/admin/advancement/lookups?editLeader=${l.code}`} className={styles.editLink}>
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
          <Field label="Birthdate" value={l.birthdate ? `${fmtDate(l.birthdate)} (age ${age})` : null} />
          <Field label="BSA Member ID" value={l.bsa_member_id} />
          <Field
            label="YPT Completed"
            value={
              l.ypt_completed
                ? `${fmtDate(l.ypt_completed)} — ${ypt.status} (expires ${fmtDate(ypt.expires)})`
                : null
            }
          />
          <Field label="Health Form Date" value={l.health_form_date ? fmtDate(l.health_form_date) : null} />
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionHead}>Contact</div>
        <div className={styles.detailGrid}>
          <Field label="Address" value={address} />
          <Field label="Phone" value={l.phone} />
          <Field label="Email" value={l.email} />
        </div>
      </div>
    </div>
  );
}
