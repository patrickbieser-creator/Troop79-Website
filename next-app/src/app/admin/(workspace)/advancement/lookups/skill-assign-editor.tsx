'use client';

import { useState, useTransition } from 'react';
import { SaveButton, SaveFeedback, useSavePhase } from '../../_components/save-state';
import { useLookupTable } from './use-lookup-table';
import styles from './lookups.module.css';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';

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
  const feedback = useSavePhase();
  const t = useLookupTable(people, (p) => `${p.name} ${p.sub ?? ""}`);

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
    feedback.start();
    startTransition(async () => {
      const res = await onSave(fd);
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Save failed');
        return;
      }
      setOpenKey(null);
      feedback.done();
    });
  }

  /** Save standard (2026-08-24): the ticked set vs the person's saved skills. */
  function skillsDirty(person: AssignPerson): boolean {
    const saved = new Set(person.skillIds);
    if (saved.size !== draft.size) return true;
    for (const id of draft) if (!saved.has(id)) return true;
    return false;
  }

  return (
    <>
      <SaveFeedback phase={feedback.phase} />
      {err && <Notice>{err}</Notice>}
      {t.searchEl}
      <div className={t.scrollClass}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.colThird}>{noun}</th>
            <th>Skills</th>
            <th className={styles.cellRight}>Actions</th>
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
            t.rows.map((p) => (
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
                    <div className={styles.skillChecks}>
                      {skills.map((s) => (
                        <label key={s.id} className={styles.skillCheck}>
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
                <td className={styles.cellRightNowrap}>
                  {openKey === p.key ? (
                    <>
                      {/* Navy: Save commits an edit, it doesn't add — the
                          Phase A primary-button decision (2026-08-21). */}
                      <SaveButton
                        dirty={skillsDirty(p)}
                        pending={isPending}
                        onClick={() => save(p)}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        className={styles.gapLeft}
                        onClick={() => setOpenKey(null)}
                        disabled={isPending}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => open(p)}>
                      Edit
                    </Button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
      {t.footerEl}
    </>
  );
}
