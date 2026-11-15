'use client';

/**
 * The record page's numbered sections (Plans/Person-Record-One-Save.md). Every field is
 * always editable and writes into the ONE draft the shell owns; nothing here saves. A
 * changed field gets the navy outline, a field with a problem the red one and a note.
 *
 *   Adult: 1 Name & membership · 2 Training & health · 3 Contact & sign-in · 4 Family · 5 Roles
 *   Scout: 1 Name & troop · 2 School & health · 3 Contact & sign-in · 4 Family
 */
import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '../../../../_components/button';
import { FormSection } from '../../../../_components/form-panel';
import { SegmentedControl } from '../../../_components/segmented-control';
import { SchoolCombobox } from '../../../_components/school-combobox';
import { addSchool } from '../../lookups/school-actions';
import { SWIM_CLASS_LABEL, gradeLabel } from '@/lib/demographics';
import { fmtDate } from '@/lib/format-date';
import { INACTIVE_REASON_LABEL } from '@/lib/supabase/types';
import type { PersonEmailRow } from '@/lib/person-emails';
import { familyOptions, savedChoice, type FamilyChoice, type PersonFieldKey, type RecordDraft, type DraftEmail } from './record-draft';
import { searchFamilyCandidates, type LinkChange } from './save-record-actions';
import { GRANTABLE_ROLES, ROLE_LABEL, type FamilyRow, type PersonRecord } from './record-types';
import styles from './record.module.css';

const ROSTER = '/admin/advancement/roster';
const KIND_LABEL = { scout: 'Scout', leader: 'Leader', adult: 'Adult' } as const;
const GRADES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export interface SectionProps {
  record: PersonRecord;
  draft: RecordDraft;
  saved: RecordDraft;
  setDraft: (fn: (d: RecordDraft) => RecordDraft) => void;
  /** The problem message for a control id, shown only after a Save was tried. */
  problem: (fieldId: string) => string | null;
  disabled: boolean;
  /** The family's pending-update banner for a section, or null. */
  banner: (section: 'identity' | 'details' | 'contact' | 'family') => ReactNode;
}

/* ── Field chrome ─────────────────────────────────────────────────────── */

/** A numbered FormSection that is also a named region, so assistive tech (and tests) can find it. */
function Section({ num, title, children }: { num: number; title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <FormSection num={num} title={title}>
        {children}
      </FormSection>
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  changed,
  problem,
  full,
  children
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  changed?: boolean;
  problem?: string | null;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={[styles.field, full ? styles.full : '', changed ? styles.changed : ''].filter(Boolean).join(' ')}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children}
      {problem ? (
        <p className={styles.problem} id={`${id}-problem`}>
          {problem}
        </p>
      ) : hint ? (
        <p className={styles.hint}>{hint}</p>
      ) : null}
    </div>
  );
}

function useFieldHelpers({ draft, saved, setDraft, problem, disabled }: SectionProps) {
  const changed = (k: PersonFieldKey) => draft.f[k].trim() !== saved.f[k].trim();
  const set = (k: PersonFieldKey, v: string) => setDraft((d) => ({ ...d, f: { ...d.f, [k]: v } }));
  const text = (k: PersonFieldKey, label: string, opts: { type?: string; hint?: ReactNode; full?: boolean; area?: boolean; autoComplete?: string } = {}) => {
    const id = `pr-${k}`;
    const p = problem(id);
    const common = {
      id,
      value: draft.f[k],
      disabled,
      'aria-invalid': p ? true : undefined,
      'aria-describedby': p ? `${id}-problem` : undefined
    };
    return (
      <Field id={id} label={label} hint={opts.hint} changed={changed(k)} problem={p} full={opts.full}>
        {opts.area ? (
          <textarea {...common} rows={3} onChange={(e) => set(k, e.target.value)} />
        ) : (
          <input {...common} type={opts.type ?? 'text'} autoComplete={opts.autoComplete ?? 'off'} onChange={(e) => set(k, e.target.value)} />
        )}
      </Field>
    );
  };
  return { changed, set, text };
}

/* ── Status (inside section 1) ────────────────────────────────────────── */

function StatusField(props: SectionProps & { isScout: boolean }) {
  const { draft, saved, setDraft, problem, disabled, isScout } = props;
  const changed = draft.active !== saved.active || (!draft.active && draft.reason !== saved.reason);
  const p = problem('pr-reason');
  return (
    <div className={[styles.field, styles.full, changed ? styles.changed : ''].filter(Boolean).join(' ')}>
      <span className={styles.label} id="pr-status-label">
        Status
      </span>
      <SegmentedControl
        name="pr-status"
        label="Status"
        value={draft.active ? 'active' : 'inactive'}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' }
        ]}
        disabled={disabled}
        onChange={(v) =>
          setDraft((d) => ({ ...d, active: v === 'active', reason: v === 'active' ? '' : d.active ? '' : d.reason }))
        }
      />
      {!draft.active &&
        (isScout ? (
          <>
            <label className={styles.label} htmlFor="pr-reason">
              Why inactive?
            </label>
            <select
              id="pr-reason"
              value={draft.reason}
              disabled={disabled}
              aria-invalid={p ? true : undefined}
              onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
            >
              <option value="">Pick a reason…</option>
              {Object.entries(INACTIVE_REASON_LABEL).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <label className={styles.label} htmlFor="pr-reason">
              Reason (optional)
            </label>
            <input
              id="pr-reason"
              type="text"
              value={draft.reason}
              disabled={disabled}
              onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
            />
          </>
        ))}
      {p ? <p className={styles.problem}>{p}</p> : !draft.active && draft.active !== saved.active ? <p className={styles.hint}>Takes effect when you save.</p> : null}
    </div>
  );
}

/* ── 1 Name ───────────────────────────────────────────────────────────── */

export function NameSection(props: SectionProps & { num: number }) {
  const { record, draft, saved, setDraft, disabled } = props;
  const { text } = useFieldHelpers(props);
  const isScout = draft.scout != null;
  const webelos = !!record.scout?.is_webelos;
  const sc = draft.scout;
  const scChanged = (k: 'patrol' | 'junior_leader_override') => !!sc && !!saved.scout && sc[k] !== saved.scout[k];
  return (
    <Section num={props.num} title={isScout ? 'Name & troop' : 'Name & membership'}>
      {props.banner(isScout ? 'identity' : 'details')}
      <div className={styles.grid}>
        {text('first_name', 'First name', { autoComplete: 'off' })}
        {text('last_name', 'Last name')}
        {text('suffix', 'Suffix', { hint: 'Jr., III' })}
        {text('nickname', 'Goes by')}
        {text('bsa_member_id', 'BSA ID')}
        {!isScout && text('birthdate', 'Birthdate', { type: 'date' })}
        {sc && (
          <>
            <Field id="pr-patrol" label="Patrol" changed={scChanged('patrol')}>
              <input
                id="pr-patrol"
                type="text"
                value={sc.patrol}
                disabled={disabled}
                onChange={(e) => setDraft((d) => ({ ...d, scout: { ...d.scout!, patrol: e.target.value } }))}
              />
            </Field>
            <div className={[styles.field, scChanged('junior_leader_override') ? styles.changed : ''].join(' ')}>
              <span className={styles.label}>Junior leader</span>
              <SegmentedControl
                name="pr-jl"
                label="Junior leader"
                value={(sc.junior_leader_override || 'auto') as 'auto' | 'yes' | 'no'}
                options={[
                  { value: 'auto', label: 'By position' },
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' }
                ]}
                disabled={disabled}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, scout: { ...d.scout!, junior_leader_override: v === 'auto' ? '' : v } }))
                }
              />
            </div>
          </>
        )}
        {!webelos && <StatusField {...props} isScout={isScout} />}
      </div>
    </Section>
  );
}

/* ── 2 Training & health (adult) / School & health (scout) ────────────── */

export function HealthSection(props: SectionProps & { num: number }) {
  const { record, draft, saved, setDraft, disabled } = props;
  const { text } = useFieldHelpers(props);
  const sc = draft.scout;
  if (!sc) {
    return (
      <Section num={props.num} title="Training & health">
        <div className={styles.grid}>
          {text('ypt_completed', 'YPT completed', { type: 'date', hint: 'Youth Protection Training is good for two years.' })}
          {text('health_form_date', 'Health form', { type: 'date' })}
          {text('things_we_should_know', 'Things we should know', { area: true, full: true })}
        </div>
      </Section>
    );
  }
  const changedSc = (k: 'school_id' | 'grade' | 'swim_class') => !!saved.scout && sc[k] !== saved.scout[k];
  const setSc = (k: 'school_id' | 'grade' | 'swim_class', v: string) => setDraft((d) => ({ ...d, scout: { ...d.scout!, [k]: v } }));
  return (
    <Section num={props.num} title="School & health">
      {props.banner('details')}
      <div className={styles.grid}>
        {text('birthdate', 'Birthdate', { type: 'date' })}
        <Field id="pr-gender" label="Gender" changed={draft.f.gender !== saved.f.gender}>
          <select
            id="pr-gender"
            value={draft.f.gender}
            disabled={disabled}
            onChange={(e) => setDraft((d) => ({ ...d, f: { ...d.f, gender: e.target.value } }))}
          >
            <option value="">—</option>
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>
        </Field>
        <div className={[styles.field, styles.full, changedSc('school_id') ? styles.changed : ''].join(' ')}>
          <SchoolCombobox
            id="pr-school_id"
            schools={record.schools ?? []}
            value={sc.school_id ? Number(sc.school_id) : null}
            disabled={disabled}
            onChange={(id) => setSc('school_id', id == null ? '' : String(id))}
            onAddSchool={addSchool}
          />
        </div>
        <Field id="pr-grade" label="Grade" changed={changedSc('grade')}>
          <select id="pr-grade" value={sc.grade} disabled={disabled} onChange={(e) => setSc('grade', e.target.value)}>
            <option value="">—</option>
            {GRADES.map((g) => (
              <option key={g} value={String(g)}>
                {gradeLabel(g)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="pr-swim_class" label="Swim class" changed={changedSc('swim_class')}>
          <select id="pr-swim_class" value={sc.swim_class} disabled={disabled} onChange={(e) => setSc('swim_class', e.target.value)}>
            <option value="">—</option>
            {Object.entries(SWIM_CLASS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        {text('health_form_date', 'Health form', { type: 'date' })}
        {text('things_we_should_know', 'Things we should know', { area: true, full: true })}
      </div>
    </Section>
  );
}

/* ── 3 Contact & sign-in ──────────────────────────────────────────────── */

function emailState(row: PersonEmailRow | undefined): string {
  if (!row) return 'new';
  if (row.bouncedAt) return 'bounced';
  return row.verifiedAt ? `verified ${fmtDate(row.verifiedAt.slice(0, 10))}` : 'not verified yet';
}

export function ContactSection(props: SectionProps & { num: number }) {
  const { record, draft, saved, setDraft, problem, disabled } = props;
  const { text } = useFieldHelpers(props);
  const [adding, setAdding] = useState('');
  const addRef = useRef<HTMLInputElement>(null);
  const savedRows = new Map(record.emails.map((e) => [e.email.toLowerCase(), e]));
  const savedSet = new Set(saved.emails.map((e) => e.email.toLowerCase()));
  const removed = saved.emails.filter((e) => !draft.emails.some((x) => x.email.toLowerCase() === e.email.toLowerCase()));

  function update(fn: (list: DraftEmail[], primary: string) => { list: DraftEmail[]; primary: string }) {
    setDraft((d) => {
      const next = fn(d.emails, d.primary);
      const primary = next.list.some((e) => e.email.trim().toLowerCase() === next.primary)
        ? next.primary
        : (next.list[0]?.email.trim().toLowerCase() ?? '');
      return { ...d, emails: next.list, primary };
    });
  }

  function add() {
    const email = adding.trim().toLowerCase();
    if (!email) return;
    update((list, primary) => ({ list: [...list, { email, label: 'home' }], primary: primary || email }));
    setAdding('');
    addRef.current?.focus();
  }

  return (
    <Section num={props.num} title="Contact & sign-in">
      {props.banner('contact')}
      <div className={styles.grid}>
        <div className={`${styles.field} ${styles.full}`}>
          <span className={styles.label}>Email addresses</span>
          {draft.emails.length > 0 || removed.length > 0 ? (
            <ul className={styles.list} aria-label="Email addresses">
              {draft.emails.map((e, i) => {
                const key = e.email.toLowerCase();
                const row = savedRows.get(key);
                const isNew = !savedSet.has(key);
                const labelChanged = !isNew && saved.emails.find((s) => s.email.toLowerCase() === key)?.label !== e.label;
                const primaryChanged = (draft.primary === key) !== (saved.primary === key);
                const p = problem(`pr-email-${i}`);
                return (
                  <li key={key + i} className={[styles.row, isNew || labelChanged || primaryChanged ? styles.rowChanged : ''].join(' ')}>
                    <span className={styles.rowName}>
                      {isNew ? (
                        <input
                          id={`pr-email-${i}`}
                          className={styles.input}
                          type="email"
                          aria-label="Email address"
                          aria-invalid={p ? true : undefined}
                          value={e.email}
                          disabled={disabled}
                          onChange={(ev) =>
                            update((list, primary) => {
                              const was = list[i].email.trim().toLowerCase();
                              const nextEmail = ev.target.value;
                              return {
                                list: list.map((x, j) => (j === i ? { ...x, email: nextEmail } : x)),
                                primary: primary === was ? nextEmail.trim().toLowerCase() : primary
                              };
                            })
                          }
                        />
                      ) : (
                        <span id={`pr-email-${i}`} tabIndex={-1}>
                          {e.email}
                        </span>
                      )}{' '}
                      <span className={styles.rowMeta}>{isNew ? 'new' : emailState(row)}</span>
                      {p && <span className={styles.problem}> {p}</span>}
                    </span>
                    <span className={styles.rowCtl}>
                      <select
                        aria-label={`Label for ${e.email}`}
                        value={e.label}
                        disabled={disabled}
                        onChange={(ev) =>
                          update((list, primary) => ({
                            list: list.map((x, j) => (j === i ? { ...x, label: ev.target.value as DraftEmail['label'] } : x)),
                            primary
                          }))
                        }
                      >
                        <option value="home">Home</option>
                        <option value="work">Work</option>
                        <option value="other">Other</option>
                      </select>
                    </span>
                    <label className={styles.radio}>
                      <input
                        type="radio"
                        name="pr-primary"
                        checked={draft.primary === key}
                        disabled={disabled}
                        onChange={() => update((list) => ({ list, primary: key }))}
                      />
                      Primary
                    </label>
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={disabled}
                      onClick={() => update((list, primary) => ({ list: list.filter((_, j) => j !== i), primary }))}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
              {removed.map((e) => (
                <li key={`removed-${e.email}`} className={`${styles.row} ${styles.rowRemoved}`}>
                  <span className={styles.rowName}>{e.email}</span>
                  <span className={styles.rowMeta}>removed on save</span>
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={disabled}
                    onClick={() => update((list, primary) => ({ list: [...list, e], primary: primary || e.email.toLowerCase() }))}
                  >
                    Undo
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint}>
              {draft.scout ? 'No address of their own — they sign in through a parent.' : 'No email address on file.'}
            </p>
          )}
          <div className={styles.addRow}>
            <input
              ref={addRef}
              id="pr-email-add"
              className={styles.input}
              type="email"
              aria-label="Add an email address"
              placeholder="name@example.com"
              value={adding}
              disabled={disabled}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button size="sm" variant="quiet" disabled={disabled || !adding.trim()} onClick={add}>
              + Email
            </Button>
          </div>
          <p className={styles.hint}>An address is verified the first time a sign-in code or link sent to it is used.</p>
        </div>
        {text('primary_phone', 'Phone', { type: 'tel' })}
        <span />
        {text('address_line1', 'Address', { full: true })}
        {text('address_line2', 'Address line 2', { full: true })}
        {text('city', 'City')}
        <div className={styles.grid}>
          {text('state', 'State')}
          {text('zip', 'ZIP')}
        </div>
      </div>
    </Section>
  );
}

/* ── 4 Family ─────────────────────────────────────────────────────────── */

export function FamilySection(
  props: SectionProps & {
    num: number;
    from: string;
    /** Links ending with the old household, for the remove question (preview). */
    endable: LinkChange[];
  }
) {
  const { record, draft, saved, setDraft, problem, disabled, from, endable } = props;
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Omit<FamilyRow, 'links' | 'inHousehold'>[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const me = { name: record.displayName, youth: !!record.youth };
  const householdChanged = draft.householdId !== saved.householdId;
  const rows = record.family ?? [];
  const pHousehold = problem('pr-household');

  // While the household is changing, its old members still show (their links are the question);
  // people added on Save show at the end.
  const listed: (FamilyRow & { pending?: boolean })[] = [
    ...rows,
    ...draft.addMembers
      .filter((m) => !rows.some((r) => r.personId === m.personId))
      .map((m) => ({ ...m, inHousehold: true, active: true, links: [], pending: true }))
  ];

  function search(v: string) {
    setQ(v);
    if (v.trim().length < 2) {
      setHits([]);
      return;
    }
    const mine = ++seq.current;
    void searchFamilyCandidates(v).then((r) => {
      if (seq.current === mine) {
        const taken = new Set([record.personId, ...listed.filter((x) => x.inHousehold).map((x) => x.personId)]);
        setHits(r.filter((h) => !taken.has(h.personId)));
      }
    });
  }

  function addMember(h: Omit<FamilyRow, 'links' | 'inHousehold'>) {
    setDraft((d) => ({
      ...d,
      addMembers: [...d.addMembers, { personId: h.personId, name: h.name, youth: h.youth, kind: h.kind }],
      family: { ...d.family, [String(h.personId)]: '' }
    }));
    setQ('');
    setHits([]);
    setOpen(false);
  }

  const endNames = [...new Set(endable.filter((l) => l.change === 'removed').map((l) => describe(l)))];

  return (
    <Section num={props.num} title="Family">
      {props.banner('family')}
      <div className={[styles.field, householdChanged ? styles.changed : ''].join(' ')}>
        <label className={styles.label} htmlFor="pr-household">
          Household
        </label>
        <select
          id="pr-household"
          value={draft.householdId}
          disabled={disabled}
          aria-invalid={pHousehold ? true : undefined}
          onChange={(e) => setDraft((d) => ({ ...d, householdId: e.target.value, endLinks: false }))}
        >
          <option value="">Not in a household</option>
          {record.households.map((h) => (
            <option key={h.id} value={String(h.id)}>
              {h.label}
            </option>
          ))}
        </select>
        {pHousehold && <p className={styles.problem}>{pHousehold}</p>}
        {householdChanged && saved.householdId && endNames.length > 0 && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={draft.endLinks}
              disabled={disabled}
              onChange={(e) => setDraft((d) => ({ ...d, endLinks: e.target.checked }))}
            />
            <span>Also remove {joinNames(endNames)}?</span>
          </label>
        )}
      </div>

      {listed.length > 0 ? (
        <ul className={styles.list} aria-label="Family">
          {listed.map((row) => {
            const key = String(row.personId);
            const savedValue = savedChoice(row);
            const value = (draft.family[key] ?? savedValue) as FamilyChoice;
            const options = familyOptions(me, row, savedValue);
            const changed = value !== (saved.family[key] ?? '') || !!row.pending;
            const others = row.links.filter((l) => !['parent_of', 'guardian_of', 'sibling_of'].includes(l.type));
            return (
              <li key={key} className={[styles.row, changed ? styles.rowChanged : ''].join(' ')}>
                <span className={styles.rowName}>
                  {row.pending ? row.name : <Link href={`${ROSTER}/${row.personId}?from=${from}`}>{row.name}</Link>}{' '}
                  <span className={styles.rowMeta}>
                    {KIND_LABEL[row.kind]}
                    {row.active ? '' : ' · inactive'}
                    {row.pending ? ' · joins the household on save' : row.inHousehold ? '' : ' · another household'}
                    {others.length > 0 ? ` · ${others.map((l) => (l.type === 'emergency_contact_for' ? 'emergency contact' : l.type)).join(', ')}` : ''}
                  </span>
                </span>
                <span className={styles.rowCtl}>
                  {options.length > 1 ? (
                    <select
                      aria-label={`How ${record.displayName} and ${row.name} are related`}
                      value={value}
                      disabled={disabled}
                      onChange={(e) => setDraft((d) => ({ ...d, family: { ...d.family, [key]: e.target.value as FamilyChoice } }))}
                    >
                      {options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={styles.rowMeta}>{options[0].label}</span>
                  )}
                </span>
                {row.pending && (
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={disabled}
                    onClick={() =>
                      setDraft((d) => {
                        const family = { ...d.family };
                        delete family[key];
                        return { ...d, addMembers: d.addMembers.filter((m) => m.personId !== row.personId), family };
                      })
                    }
                  >
                    Undo
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.hint}>No family on file yet.</p>
      )}

      <div className={styles.addRow}>
        {open ? (
          <>
            <input
              className={styles.input}
              type="search"
              aria-label="Person to add to the household"
              placeholder="Search by name…"
              value={q}
              autoFocus
              disabled={disabled}
              onChange={(e) => search(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
              }}
            />
            <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="quiet" disabled={disabled || !draft.householdId} onClick={() => setOpen(true)} title={!draft.householdId ? 'Pick a household first' : undefined}>
            + Person to household
          </Button>
        )}
      </div>
      {open && hits.length > 0 && (
        <ul className={styles.results}>
          {hits.map((h) => (
            <li key={h.personId}>
              <Button size="sm" variant="quiet" onClick={() => addMember(h)}>
                {h.name} <span className={styles.muted}>· {KIND_LABEL[h.kind]}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim().length >= 2 && hits.length === 0 && <p className={styles.hint}>No one matches.</p>}
    </Section>
  );
}

const PHRASE: Record<string, string> = { parent_of: 'parent of', guardian_of: 'guardian of', sibling_of: 'sibling of' };

/** "Adrian Baquero as parent of Hadley Baquero" — one link in a sentence. */
export function describe(l: LinkChange): string {
  return `${l.person_name} as ${PHRASE[l.type] ?? l.type} ${l.related_name}`;
}

/** Sibling links are stored both ways; say each pair once. */
export function uniqueLinks(links: LinkChange[]): LinkChange[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const key =
      l.type === 'sibling_of'
        ? `${l.change}:sib:${Math.min(l.person_id, l.related_person_id)}:${Math.max(l.person_id, l.related_person_id)}`
        : `${l.change}:${l.type}:${l.person_id}:${l.related_person_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function joinNames(list: string[]): string {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/* ── 5 Roles (adults) ─────────────────────────────────────────────────── */

export function RolesSection(props: SectionProps & { num: number }) {
  const { record, draft, saved, setDraft, problem, disabled } = props;
  const [picking, setPicking] = useState('');
  const available = GRANTABLE_ROLES.filter((r) => !draft.roles.includes(r));
  const ended = saved.roles.filter((r) => !draft.roles.includes(r));
  const past = record.detail.roles.filter((r) => r.end_date);
  const initialsChanged = draft.initials.trim() !== saved.initials || draft.initialsRetired !== saved.initialsRetired;
  const pInitials = problem('pr-initials');
  return (
    <Section num={props.num} title="Roles">
      {draft.roles.length > 0 || ended.length > 0 ? (
        <ul className={styles.list} aria-label="Roles">
          {draft.roles.map((r) => {
            const held = record.detail.roles.find((x) => x.role === r && !x.end_date);
            const isNew = !saved.roles.includes(r);
            return (
              <li key={r} className={[styles.row, isNew ? styles.rowChanged : ''].join(' ')}>
                <span className={styles.rowName}>{ROLE_LABEL[r] ?? r}</span>
                <span className={styles.rowMeta}>{isNew ? 'granted on save' : held?.start_date ? `since ${fmtDate(held.start_date)}` : ''}</span>
                <Button size="sm" variant="quiet" disabled={disabled} onClick={() => setDraft((d) => ({ ...d, roles: d.roles.filter((x) => x !== r) }))}>
                  {isNew ? 'Undo' : 'End'}
                </Button>
              </li>
            );
          })}
          {ended.map((r) => (
            <li key={`ended-${r}`} className={`${styles.row} ${styles.rowRemoved}`}>
              <span className={styles.rowName}>{ROLE_LABEL[r] ?? r}</span>
              <span className={styles.rowMeta}>ends on save</span>
              <Button size="sm" variant="quiet" disabled={disabled} onClick={() => setDraft((d) => ({ ...d, roles: [...d.roles, r].sort() }))}>
                Undo
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>No troop role. Granting one puts them on the Leaders tab.</p>
      )}
      <div className={styles.addRow}>
        <select
          id="pr-role-add"
          className={styles.input}
          aria-label="Grant a role"
          value={picking}
          disabled={disabled || available.length === 0}
          onChange={(e) => {
            const r = e.target.value;
            if (r) setDraft((d) => ({ ...d, roles: [...d.roles, r].sort() }));
            setPicking('');
          }}
        >
          <option value="">+ Role…</option>
          {available.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r] ?? r}
            </option>
          ))}
        </select>
      </div>
      {past.length > 0 && (
        <p className={styles.hint}>
          Past:{' '}
          {past
            .map((r) => `${ROLE_LABEL[r.role] ?? r.role} (${r.start_date ? fmtDate(r.start_date) : '?'} – ${fmtDate(r.end_date)})`)
            .join('; ')}
        </p>
      )}

      <div className={styles.grid}>
        <div className={[styles.field, initialsChanged ? styles.changed : ''].join(' ')}>
          <label className={styles.label} htmlFor="pr-initials">
            Sign-off initials
          </label>
          <input
            id="pr-initials"
            type="text"
            value={draft.initials}
            placeholder={saved.initials ? undefined : record.initialsSuggestion || undefined}
            disabled={disabled}
            aria-invalid={pInitials ? true : undefined}
            onChange={(e) => setDraft((d) => ({ ...d, initials: e.target.value.toUpperCase() }))}
          />
          {pInitials ? (
            <p className={styles.problem}>{pInitials}</p>
          ) : (
            <p className={styles.hint}>
              {record.initials
                ? `Signs ${record.initials.entries} ledger ${record.initials.entries === 1 ? 'entry' : 'entries'}; renaming rewrites them.`
                : 'What they write when signing off advancement.'}
            </p>
          )}
          {(saved.initials || draft.initials.trim()) && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.initialsRetired}
                disabled={disabled}
                onChange={(e) => setDraft((d) => ({ ...d, initialsRetired: e.target.checked }))}
              />
              <span>Retired (kept on old entries, not offered for new ones)</span>
            </label>
          )}
        </div>
      </div>
    </Section>
  );
}
