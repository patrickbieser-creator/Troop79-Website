'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { fillMissingRankRequirements } from './actions';
import type { Finding } from './types';
import styles from './audits.module.css';

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function AuditCard({
  finding,
  leaders
}: {
  finding: Finding;
  leaders: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set(finding.missing.map((m) => m.code)));
  const [date, setDate] = useState(finding.qualifyingDate || todayISO());
  const [by, setBy] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(code: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function save() {
    if (checked.size === 0) {
      setStatus({ kind: 'err', msg: 'Select at least one requirement.' });
      return;
    }
    if (!date || !by) {
      setStatus({ kind: 'err', msg: 'Date and Signed-Off By are required.' });
      return;
    }
    const items = finding.missing
      .filter((m) => checked.has(m.code))
      .map((m) => ({ code: m.code, label: m.label }));

    const fd = new FormData();
    fd.set('scout_id', finding.scoutId);
    fd.set('date', date);
    fd.set('by', by);
    fd.set('items', JSON.stringify(items));

    startTransition(async () => {
      const res = await fillMissingRankRequirements(fd);
      if (!res.ok) {
        setStatus({ kind: 'err', msg: res.error ?? 'Save failed' });
        return;
      }
      setStatus({ kind: 'ok', msg: `Saved ${res.inserted}.` });
      router.refresh();
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <Link href={`/scouts/${finding.scoutId}`} className={styles.scoutLink}>
            {finding.scoutName}
          </Link>
          <span className={styles.rankTag}>{finding.groupLabel}</span>
        </div>
        <div className={styles.borContext}>{finding.contextLine}</div>
      </div>

      {finding.detailLines && finding.detailLines.length > 0 && (
        <div className={styles.detailLines}>
          {finding.detailLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}

      <div className={styles.missingList}>
        {finding.missing.map((m) => (
          <label key={m.code} className={styles.missingRow}>
            <input
              type="checkbox"
              checked={checked.has(m.code)}
              onChange={() => toggle(m.code)}
            />
            <span className={styles.missingCode}>{m.shortCode}</span>
            <span>
              {m.parentLabel && (
                <span className={styles.missingParent}>{m.parentLabel}: </span>
              )}
              {m.label}
            </span>
          </label>
        ))}
      </div>

      <div className={styles.fillRow}>
        <label className={styles.fillField}>
          <span>Date Completed</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className={styles.fillField}>
          <span>Signed Off By</span>
          <select value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="">— Leader —</option>
            {leaders.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={save}
          disabled={isPending || checked.size === 0 || !date || !by}
        >
          {isPending ? 'Saving…' : `Fill In (${checked.size})`}
        </button>
        {status && (
          <span className={status.kind === 'ok' ? styles.statusOk : styles.statusErr}>
            {status.msg}
          </span>
        )}
      </div>
    </div>
  );
}
