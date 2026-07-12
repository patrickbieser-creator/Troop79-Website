'use client';

import { useState, useTransition } from 'react';
import styles from './lookups.module.css';

type ActionResult = { ok: boolean; error?: string };

export interface AssignPerson {
  /** leader code or scout id. */
  key: string;
  name: string;
  /** Role (leaders) or rank (scouts) — shown under the name. */
  sub: string | null;
  skillIds: string[];
}

export interface AssignSkill {
  id: string;
  name: string;
}

interface Props {
  people: AssignPerson[];
  skills: AssignSkill[];
  /** 'leader_code' or 'scout_id' — the FormData field the action expects. */
  keyField: string;
  noun: string;
  onSave: (formData: FormData) => Promise<ActionResult>;
}

/**
 * Per-person skill assignment: each row shows current skills; Edit expands an
 * inline checkbox set. One save action replaces the person's full skill set.
 * Used for both Leader Skills (all skills) and Scout Instructors (only
 * youth-teachable skills are passed in).
 */
export function SkillAssignEditor({ people, skills, keyField, noun, onSave }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const skillName = new Map(skills.map((s) => [s.id, s.name]));

  function open(person: AssignPerson) {
    setOpenKey(person.key);
    setDraft(new Set(person.skillIds));
    setErr(null);
  }

  function toggle(skillId: string) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  }

  function save(person: AssignPerson) {
    setErr(null);
    const fd = new FormData();
    fd.set(keyField, person.key);
    fd.set('skill_ids', JSON.stringify([...draft]));
    startTransition(async () => {
      const res = await onSave(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      setOpenKey(null);
    });
  }

  return (
    <>
      {err && (
        <div className={styles.editError} style={{ marginBottom: 10 }}>
          {err}
        </div>
      )}
      <table className={styles.table}>
        <thead>
          <tr>
            <th style={{ width: '32%' }}>{noun}</th>
            <th>Skills</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {people.length === 0 ? (
            <tr>
              <td colSpan={3} className={styles.muted}>
                None eligible yet.
              </td>
            </tr>
          ) : (
            people.map((p) => (
              <tr key={p.key}>
                <td>
                  <strong>{p.name}</strong>
                  {p.sub && (
                    <>
                      <br />
                      <span className={styles.muted}>{p.sub}</span>
                    </>
                  )}
                </td>
                <td>
                  {openKey === p.key ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                      {skills.map((s) => (
                        <label
                          key={s.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 12,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={draft.has(s.id)}
                            onChange={() => toggle(s.id)}
                          />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  ) : p.skillIds.length === 0 ? (
                    <span className={styles.muted}>—</span>
                  ) : (
                    p.skillIds.map((id) => skillName.get(id) ?? id).join(', ')
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {openKey === p.key ? (
                    <>
                      <button
                        type="button"
                        className={styles.addBtn}
                        onClick={() => save(p)}
                        disabled={isPending}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className={styles.editBtn}
                        onClick={() => setOpenKey(null)}
                        disabled={isPending}
                        style={{ marginLeft: 6 }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className={styles.editBtn} onClick={() => open(p)}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
