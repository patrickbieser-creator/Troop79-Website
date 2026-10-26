'use client';

import { useId, useState, useTransition } from 'react';
import { SaveButton, SaveFeedback, SaveProblem, useSavePhase } from '../../_components/save-state';
import { useLookupTable } from './use-lookup-table';
import styles from './lookups.module.css';
import marks from '../../_components/save-state.module.css';
import { Notice } from '../../_components/notice';
import { AddButton } from '../../_components/add-button';
import { AdminCombobox } from '../../_components/admin-combobox';
import { Button } from '../../../_components/button';

type ActionResult = { ok: boolean; error?: string };

export interface AssignPerson {
  /** person id. */
  key: string;
  name: string;
  /** Role (leaders) or rank (scouts) — shown under the name. */
  sub: string | null;
  skillIds: string[];
}

/** Someone Add may offer: in the pool, holding no skill yet. */
export interface AssignCandidate {
  key: string;
  name: string;
  sub: string | null;
}

export interface AssignSkill {
  id: string;
  name: string;
}

interface Props {
  /** People who teach: each holds at least one skill (teaching-rows.ts). */
  people: AssignPerson[];
  candidates: AssignCandidate[];
  skills: AssignSkill[];
  /** The FormData field the action expects: 'person_id' since teaching skills are keyed to people. */
  keyField: string;
  noun: string;
  onSave: (formData: FormData) => Promise<ActionResult>;
}

/**
 * Per-person skill assignment with full CRUD (2026-10-26): Add picks someone from the pool and ticks their skills;
 * each row's Edit expands an inline checkbox set; Delete clears every skill, so the row goes. All three go through one
 * save action that replaces the person's full skill set, and each change is logged under Recent teaching-skill
 * changes (Undo there). Used for both Adult Skills (all skills) and Scout Instructors (only youth-teachable skills
 * are passed in).
 */
export function SkillAssignEditor({ people, candidates, skills, keyField, noun, onSave }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState('');
  const [addDraft, setAddDraft] = useState<Set<string>>(new Set());
  const [addTried, setAddTried] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const feedback = useSavePhase();
  const t = useLookupTable(people, (p) => `${p.name} ${p.sub ?? ""}`);
  const uid = useId();
  const lower = noun.toLowerCase();
  const article = /^[aeiou]/i.test(noun) ? 'an' : 'a';

  const skillName = new Map(skills.map((s) => [s.id, s.name]));
  const skillList = (ids: string[]) => ids.map((id) => skillName.get(id) ?? id).join(', ');

  function open(person: AssignPerson) {
    setOpenKey(person.key);
    setDraft(new Set(person.skillIds));
    setErr(null);
  }

  function toggleIn(set: React.Dispatch<React.SetStateAction<Set<string>>>, skillId: string) {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  }

  /** One writer for Add, Edit and Delete: replaces the person's whole skill set. */
  function send(personKey: string, skillIds: string[], after: () => void) {
    setErr(null);
    const fd = new FormData();
    fd.set(keyField, personKey);
    fd.set('skill_ids', JSON.stringify(skillIds));
    feedback.start();
    startTransition(async () => {
      const res = await onSave(fd);
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Save failed');
        return;
      }
      after();
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

  function startAdd() {
    const editing = people.find((p) => p.key === openKey);
    if (editing && skillsDirty(editing) && !window.confirm(`Discard your unsaved changes to ${editing.name}'s skills?`)) return;
    setOpenKey(null);
    setAddKey('');
    setAddDraft(new Set());
    setAddTried(false);
    setErr(null);
    setAdding(true);
  }

  // Greyed means "nothing to do" (D-331): the Add button is off only while the panel is empty; an incomplete one
  // keeps it on, and a click marks what is missing instead of saving.
  const addProblems = [
    ...(addKey === '' ? [`Pick ${article} ${lower}`] : []),
    ...(addDraft.size === 0 ? ['Tick at least one skill'] : [])
  ];
  const addEmpty = addKey === '' && addDraft.size === 0;

  function add() {
    if (addProblems.length > 0) {
      setAddTried(true);
      const first = addKey === '' ? document.getElementById(`${uid}-person`) : document.querySelector<HTMLInputElement>(`[data-add-skills="${uid}"] input`);
      first?.focus();
      return;
    }
    send(addKey, [...addDraft], () => setAdding(false));
  }

  /** Edit's Save: unticking every skill removes the person, so it asks first, exactly like Delete. */
  function saveEdit(person: AssignPerson) {
    if (draft.size === 0) remove(person);
    else send(person.key, [...draft], () => setOpenKey(null));
  }

  function remove(person: AssignPerson) {
    if (
      !window.confirm(
        `Remove ${person.name} as a teacher?\n\nThis clears all of their teaching skills (${skillList(person.skillIds)}), so they drop off this list and the Meeting Plan stops matching them to those skills. Each removal is logged under Recent teaching-skill changes, where Undo puts it back.`
      )
    ) {
      return;
    }
    send(person.key, [], () => setOpenKey(null));
  }

  const missingPerson = addTried && addKey === '';
  const missingSkills = addTried && addDraft.size === 0;

  return (
    <>
      <SaveFeedback phase={feedback.phase} />
      <div className={styles.cardToolbar}>
        {t.searchEl}
        <AddButton onClick={startAdd} disabled={adding}>+ Add {noun}</AddButton>
      </div>

      {adding && (
        <div role="group" aria-label={`Add ${noun}`} className={styles.addPanel}>
          <div className={`${styles.inputMax260} ${missingPerson ? marks.bad : ''}`}>
            <AdminCombobox
              id={`${uid}-person`}
              label={`${noun} to add`}
              options={candidates.map((c) => ({ value: c.key, label: c.name, detail: c.sub ?? undefined }))}
              value={addKey}
              onChange={setAddKey}
              invalid={missingPerson}
              placeholder={`Pick ${article} ${lower}…`}
            />
            {missingPerson && <p className={marks.badNote}>Pick who teaches.</p>}
          </div>
          <div
            role="group"
            aria-label="Skills"
            aria-describedby={missingSkills ? `${uid}-skills-note` : undefined}
            data-add-skills={uid}
            className={`${styles.skillChecks} ${missingSkills ? marks.bad : ''}`}
          >
            {skills.map((s) => (
              <label key={s.id} className={styles.skillCheck}>
                <input type="checkbox" checked={addDraft.has(s.id)} onChange={() => toggleIn(setAddDraft, s.id)} />
                {s.name}
              </label>
            ))}
            {missingSkills && (
              <p id={`${uid}-skills-note`} className={marks.badNote}>
                Tick at least one skill.
              </p>
            )}
          </div>
          <div className={styles.addPanelActions}>
            {addTried && addProblems.length > 0 && <SaveProblem reason={addProblems[0]} more={addProblems.length - 1} />}
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)} disabled={isPending}>
              Cancel
            </Button>
            <AddButton onClick={add} disabled={isPending || addEmpty}>
              Add {noun}
            </AddButton>
          </div>
        </div>
      )}

      {err && <Notice>{err}</Notice>}
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
                No one yet. Use + Add {noun} to give someone a teaching skill.
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
                            onChange={() => toggleIn(setDraft, s.id)}
                          />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  ) : (
                    skillList(p.skillIds)
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
                        onClick={() => saveEdit(p)}
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
                    <>
                      <Button variant="secondary" size="sm" aria-label={`Edit ${p.name}`} onClick={() => open(p)} disabled={isPending}>
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        className={styles.gapLeft}
                        aria-label={`Delete ${p.name}`}
                        onClick={() => remove(p)}
                        disabled={isPending}
                      >
                        Delete
                      </Button>
                    </>
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
