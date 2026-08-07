'use client';

import { useState, useTransition } from 'react';
import styles from './lookups.module.css';

type ActionResult = { ok: boolean; error?: string };

export interface SuperuserPerson {
  code: string;
  name: string;
  /** Role, shown under the name — same shape as SkillAssignEditor's AssignPerson.sub. */
  sub: string | null;
}

interface Props {
  people: SuperuserPerson[];
  initialCodes: string[];
  onSave: (formData: FormData) => Promise<ActionResult>;
}

/**
 * Flat checkbox list + one Save button — deliberately NOT the per-row-Edit
 * shape SkillAssignEditor uses. A superuser grant is a single boolean per
 * leader, not a per-person multi-select set, so "which of these ~10 people
 * are superusers" reads better as one list with one save than N separate
 * inline editors.
 */
export function SuperuserEditor({ people, initialCodes, onSave }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialCodes));
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function toggle(code: string) {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function save() {
    setErr(null);
    const fd = new FormData();
    fd.set('leader_codes', JSON.stringify([...selected]));
    startTransition(async () => {
      const res = await onSave(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      setSaved(true);
    });
  }

  return (
    <>
      {err && (
        <div className={styles.editError} style={{ marginBottom: 10 }}>
          {err}
        </div>
      )}
      {people.length === 0 ? (
        <p className={styles.muted}>No adult leaders on file.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {people.map((p) => (
            <label
              key={p.code}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
            >
              <input type="checkbox" checked={selected.has(p.code)} onChange={() => toggle(p.code)} />
              <strong>{p.name}</strong>
              {p.sub && <span className={styles.muted}>({p.sub})</span>}
            </label>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className={styles.addBtn} onClick={save} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {saved && <span style={{ fontSize: 12, color: 'var(--forest, #3d5a3e)' }}>Saved ✓</span>}
      </div>
    </>
  );
}
