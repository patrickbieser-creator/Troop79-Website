'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  acceptSuggestion,
  rejectSuggestion,
  retargetRow,
  createPersonFromRow,
  searchPeople,
  addRelationship,
  removeRelationship,
  type RelationshipInput
} from './actions';
import styles from './roster-import.module.css';

export interface BatchSummary {
  id: number;
  source_label: string;
  source_filename: string | null;
  row_count: number;
  status: string;
  created_at: string;
}

export interface PersonRelationship {
  id: number;
  direction: 'outgoing' | 'incoming';
  type: 'parent_of' | 'guardian_of' | 'sibling_of' | 'emergency_contact_for';
  isGuardian: boolean;
  otherName: string;
}

export interface FieldChange {
  field: string;
  csv_value: string;
  db_value: string;
  kind: 'fill' | 'conflict' | 'same';
}

export interface QueueRow {
  import_row_id: number;
  batch_id: number;
  line_no: number;
  import_name: string;
  role_code: string | null;
  import_email: string | null;
  import_bsa: string | null;
  relationship_text: string | null;
  suggestion_id: number;
  person_id: number | null;
  person_name: string | null;
  confidence: 'bsa_member_id' | 'email' | 'name_only' | 'none' | 'manual';
  evidence: Record<string, unknown>;
  field_changes: FieldChange[];
  status: string;
  conflict_count: number;
  fill_count: number;
  candidate_count: number;
}

const CONFIDENCE_LABEL: Record<QueueRow['confidence'], string> = {
  bsa_member_id: 'BSA member ID',
  email: 'Email + name',
  name_only: 'Name only',
  none: 'No match',
  manual: 'Chosen by hand'
};

/** Reads inside the sentence "<A> is <word> <B>". */
const RELATION_WORDS: Record<PersonRelationship['type'], string> = {
  parent_of: 'parent of',
  guardian_of: 'guardian of',
  sibling_of: 'sibling of',
  emergency_contact_for: 'emergency contact for'
};

const FIELD_LABEL: Record<string, string> = {
  display_name: 'Name',
  primary_email: 'Email',
  primary_phone: 'Phone',
  bsa_member_id: 'BSA ID',
  birthdate: 'Birthdate',
  gender: 'Gender'
};

/**
 * Which fields start ticked.
 *
 * 'fill' — stored value is empty, so taking the file's value adds information
 * without destroying any. Safe to pre-tick.
 * 'conflict' — both sides hold a value and they disagree. NEVER pre-ticked:
 * the file is known to contain stale entries, so a reviewer who clicks straight
 * through must not silently overwrite good data with old data.
 */
function defaultChosen(changes: FieldChange[]): string[] {
  return changes.filter((c) => c.kind === 'fill').map((c) => c.field);
}

export function ReviewClient({
  batches,
  activeBatch,
  rows,
  decidedCount,
  relationshipsByPerson
}: {
  batches: BatchSummary[];
  activeBatch: BatchSummary;
  rows: QueueRow[];
  decidedCount: number;
  relationshipsByPerson: Record<number, PersonRelationship[]>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [chosen, setChosen] = useState<Record<number, string[]>>({});
  const [filter, setFilter] = useState<'all' | QueueRow['confidence']>('all');
  const [error, setError] = useState<string | null>(null);

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.confidence] = (acc[r.confidence] ?? 0) + 1;
    return acc;
  }, {});

  const visible = filter === 'all' ? rows : rows.filter((r) => r.confidence === filter);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Something went wrong.');
      else router.refresh();
    });
  }

  const fieldsFor = (r: QueueRow) => chosen[r.suggestion_id] ?? defaultChosen(r.field_changes);

  return (
    <div>
      {batches.length > 1 && (
        <div className={styles.batchBar}>
          <span className={styles.fieldLabel}>Batch</span>
          <select
            className={styles.select}
            value={activeBatch.id}
            onChange={(e) => router.push(`?batch=${e.target.value}`)}
          >
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.source_label} — {b.row_count} rows
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.summary}>
        <strong>{rows.length}</strong> awaiting a decision · <strong>{decidedCount}</strong> decided
        {activeBatch.source_filename && (
          <span className={styles.filename}> · {activeBatch.source_filename}</span>
        )}
      </div>

      <div className={styles.filterRow}>
        <button
          className={filter === 'all' ? styles.chipActive : styles.chip}
          onClick={() => setFilter('all')}
        >
          All {rows.length}
        </button>
        {(['bsa_member_id', 'email', 'manual', 'name_only', 'none'] as const).map((c) =>
          counts[c] ? (
            <button
              key={c}
              className={filter === c ? styles.chipActive : styles.chip}
              onClick={() => setFilter(c)}
            >
              {CONFIDENCE_LABEL[c]} {counts[c]}
            </button>
          ) : null
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {visible.length === 0 && (
        <div className={styles.empty}>Nothing left in this view — every row has been decided.</div>
      )}

      <div className={styles.list}>
        {visible.map((r) => {
          const isOpen = openRow === r.suggestion_id;
          const weak = r.confidence === 'name_only';
          const isNew = r.person_id === null;
          return (
            <div key={r.suggestion_id} className={styles.card}>
              <button className={styles.cardHead} onClick={() => setOpenRow(isOpen ? null : r.suggestion_id)}>
                <span className={styles.lineNo}>L{r.line_no}</span>
                <span className={styles.names}>
                  <strong>{r.import_name}</strong>
                  {r.role_code && <span className={styles.roleCode}>{r.role_code}</span>}
                  <span className={styles.arrow}>→</span>
                  {isNew ? (
                    <em className={styles.newPerson}>new person</em>
                  ) : (
                    <strong>{r.person_name}</strong>
                  )}
                </span>
                <span className={weak ? styles.badgeWeak : styles.badge}>
                  {CONFIDENCE_LABEL[r.confidence]}
                </span>
                {r.conflict_count > 0 && (
                  <span className={styles.badgeConflict}>{r.conflict_count} conflict{r.conflict_count > 1 ? 's' : ''}</span>
                )}
                {r.fill_count > 0 && <span className={styles.badgeFill}>{r.fill_count} to fill</span>}
              </button>

              {isOpen && (
                <div className={styles.cardBody}>
                  {weak && (
                    <div className={styles.warn}>
                      Matched on name alone. Two people can share a name, and a wrong merge here
                      combines two real records — confirm this is the same human before accepting.
                    </div>
                  )}

                  <div className={styles.metaRow}>
                    {r.import_bsa && <span>BSA {r.import_bsa}</span>}
                    {r.import_email && <span>{r.import_email}</span>}
                  </div>

                  {r.relationship_text && (
                    <div className={styles.relBlock}>
                      <span className={styles.fieldLabel}>Relationship, as written in the file</span>
                      <div className={styles.relText}>{r.relationship_text}</div>
                      <p className={styles.relHint}>
                        Not interpreted automatically — the file words this both ways round. Record
                        it yourself once this row is linked to a person.
                      </p>
                    </div>
                  )}

                  {r.field_changes.length > 0 && (
                    <table className={styles.fieldTable}>
                      <thead>
                        <tr>
                          <th>Take</th>
                          <th>Field</th>
                          <th>From file</th>
                          <th>On record</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.field_changes.map((f) => {
                          const picked = fieldsFor(r).includes(f.field);
                          return (
                            <tr key={f.field} className={f.kind === 'conflict' ? styles.rowConflict : undefined}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={picked}
                                  disabled={f.kind === 'same'}
                                  onChange={(e) => {
                                    const cur = fieldsFor(r);
                                    setChosen({
                                      ...chosen,
                                      [r.suggestion_id]: e.target.checked
                                        ? [...cur, f.field]
                                        : cur.filter((x) => x !== f.field)
                                    });
                                  }}
                                />
                              </td>
                              <td>{FIELD_LABEL[f.field] ?? f.field}</td>
                              <td className={styles.csvVal}>{f.csv_value || <em>—</em>}</td>
                              <td className={styles.dbVal}>
                                {f.db_value || <em className={styles.emptyVal}>empty</em>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  <div className={styles.actions}>
                    {isNew ? (
                      <button
                        className={styles.primaryBtn}
                        disabled={pending}
                        onClick={() => run(() => createPersonFromRow(r.import_row_id))}
                      >
                        Create new person
                      </button>
                    ) : (
                      <button
                        className={styles.primaryBtn}
                        disabled={pending}
                        onClick={() => run(() => acceptSuggestion(r.suggestion_id, fieldsFor(r)))}
                      >
                        Accept — same person
                      </button>
                    )}
                    <button
                      className={styles.secondaryBtn}
                      disabled={pending}
                      onClick={() => run(() => rejectSuggestion(r.suggestion_id))}
                    >
                      Not a match
                    </button>
                  </div>

                  <PersonPicker
                    label={isNew ? 'Or link to someone already on record' : 'Or pick a different person'}
                    disabled={pending}
                    onPick={(personId) => run(() => retargetRow(r.import_row_id, personId))}
                  />

                  {!isNew && r.person_id !== null && (
                    <RelationshipEntry
                      personId={r.person_id}
                      personName={r.person_name ?? r.import_name}
                      sourceLabel={r.relationship_text}
                      existing={relationshipsByPerson[r.person_id] ?? []}
                      disabled={pending}
                      onDone={(fn) => run(fn)}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Type-ahead over people, used for retargeting and relationship entry. */
function PersonPicker({
  label,
  disabled,
  onPick
}: {
  label: string;
  disabled: boolean;
  onPick: (personId: number) => void;
}) {
  // Picking a name used to clear the box and show nothing, so a successful
  // choice looked identical to a click that did not register. The name stays
  // on screen until the server round-trip re-renders the list above.
  const [picked, setPicked] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: number; display_name: string; primary_email: string | null }[]>([]);
  const [searching, startSearch] = useTransition();

  function search(value: string) {
    setQ(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => setResults(await searchPeople(value)));
  }

  return (
    <div className={styles.pickerBlock}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        className={styles.fieldInput}
        value={q}
        placeholder="Type at least two letters"
        onChange={(e) => search(e.target.value)}
        disabled={disabled}
      />
      {searching && <span className={styles.searching}>searching…</span>}
      {picked && !q && <span className={styles.picked}>✓ {picked} selected</span>}
      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((p) => (
            <li key={p.id}>
              <button
                className={styles.resultBtn}
                disabled={disabled}
                onClick={() => {
                  setPicked(p.display_name);
                  onPick(p.id);
                  setQ('');
                  setResults([]);
                }}
              >
                {p.display_name}
                {p.primary_email && <span className={styles.resultEmail}>{p.primary_email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Hand entry of a relationship edge. Deliberately manual: the file's wording
 * is shown above, and the reviewer states the edge rather than a parser
 * guessing at it.
 */
function RelationshipEntry({
  personId,
  personName,
  sourceLabel,
  existing,
  disabled,
  onDone
}: {
  personId: number;
  personName: string;
  sourceLabel: string | null;
  existing: PersonRelationship[];
  disabled: boolean;
  onDone: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [type, setType] = useState<RelationshipInput>('parent_of');
  const [isGuardian, setIsGuardian] = useState(false);

  return (
    <div className={styles.relEntry}>
      <span className={styles.fieldLabel}>
        Relationships on record{existing.length > 0 ? ` (${existing.length})` : ''}
      </span>
      {existing.length === 0 ? (
        <p className={styles.relNone}>None recorded yet.</p>
      ) : (
        <ul className={styles.relList}>
          {existing.map((rel) => (
            <li key={`${rel.id}-${rel.direction}`} className={styles.relItem}>
              <span>
                {rel.direction === 'outgoing' ? (
                  <>
                    <strong>{personName}</strong> is {RELATION_WORDS[rel.type]}{' '}
                    <strong>{rel.otherName}</strong>
                  </>
                ) : (
                  <>
                    <strong>{rel.otherName}</strong> is {RELATION_WORDS[rel.type]}{' '}
                    <strong>{personName}</strong>
                  </>
                )}
                {rel.isGuardian && <span className={styles.guardianTag}>guardian</span>}
              </span>
              <button
                className={styles.removeBtn}
                disabled={disabled}
                onClick={() => onDone(() => removeRelationship(rel.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <span className={styles.fieldLabel}>Record another relationship</span>
      <div className={styles.relControls}>
        <span className={styles.relPrefix}>This person is</span>
        <select
          className={styles.select}
          value={type}
          onChange={(e) => setType(e.target.value as RelationshipInput)}
          disabled={disabled}
        >
          <option value="parent_of">parent of</option>
        <option value="child_of">child of</option>
          <option value="guardian_of">guardian of</option>
          <option value="sibling_of">sibling of</option>
          <option value="emergency_contact_for">emergency contact for</option>
        </select>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={isGuardian}
            onChange={(e) => setIsGuardian(e.target.checked)}
            disabled={disabled}
          />
          has guardianship
        </label>
      </div>
      <p className={styles.relHint}>
        &ldquo;Child of&rdquo; records the same fact as the parent&rsquo;s own entry, just stated from
        this end — so enter it from whichever record you happen to be on. Guardianship is recorded
        separately from living arrangements, so a parent at a different address is still a guardian.
      </p>
      <PersonPicker
        label="…of whom"
        disabled={disabled}
        onPick={(relatedId) =>
          onDone(() => addRelationship(personId, relatedId, type, isGuardian, sourceLabel ?? undefined))
        }
      />
    </div>
  );
}
