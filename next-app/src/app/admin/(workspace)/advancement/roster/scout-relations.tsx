'use client';

import { useEffect, useState } from 'react';
import {
  getScoutRelations,
  linkAdultToScout,
  createAdultForScout,
  removeRelationship,
  searchPeople,
  type ScoutRelation
} from './person-actions';
import styles from './roster.module.css';

/**
 * Parents and guardians on a scout record.
 *
 * Replaces the free-text block that wrote a name, a relationship word and
 * contact details onto scout_parents — one row per child, so a parent of two
 * scouts existed as two unlinked copies whose spellings could drift apart.
 * That is exactly the shape that put the same human in the signup picker
 * twice. A parent is now a person, related to this scout, with their contact
 * details stored once against them.
 *
 * The layout is deliberately unchanged: a leader opening a scout still wants
 * to see who to ring and at what number, without clicking through to anybody.
 * Contact details are read-only here because they belong to the adult, not to
 * this scout — editing them is one click away on the person, and editing them
 * here would mean two scouts' records could disagree about one parent's phone
 * number, which is the whole problem being removed.
 *
 * Saves immediately rather than on the form's Save, so a linked parent is a
 * fact about two people rather than a pending edit to this scout.
 */

const TYPE_LABEL: Record<string, string> = {
  parent_of: 'Parent',
  guardian_of: 'Guardian',
  emergency_contact_for: 'Emergency contact'
};

type LinkType = 'parent_of' | 'guardian_of' | 'emergency_contact_for';

export function ScoutRelations({ scoutPersonId }: { scoutPersonId: number | null }) {
  const [relations, setRelations] = useState<ScoutRelation[]>([]);
  // Seeded from the prop rather than set inside the effect: an unsaved scout
  // has nothing to load, and flipping this synchronously in the effect body
  // triggers a cascading render.
  const [loading, setLoading] = useState(scoutPersonId !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'link' | 'create'>('none');
  const [type, setType] = useState<LinkType>('parent_of');
  const [isGuardian, setIsGuardian] = useState(true);

  useEffect(() => {
    if (scoutPersonId === null) return;
    let live = true;
    getScoutRelations(scoutPersonId)
      .then((r) => { if (live) setRelations(r); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [scoutPersonId]);

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMessage: string) {
    if (scoutPersonId === null) return;
    setError(null);
    setSaved(null);
    setBusy(true);
    fn()
      .then(async (res) => {
        if (!res.ok) { setError(res.error ?? 'Something went wrong.'); return; }
        setRelations(await getScoutRelations(scoutPersonId));
        setSaved(okMessage);
        setMode('none');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
      .finally(() => setBusy(false));
  }

  if (scoutPersonId === null) {
    return (
      <p className={styles.editorHint}>
        Save this scout first — parents and guardians attach to their person record, which is
        created on save.
      </p>
    );
  }

  return (
    <div>
      {error && <div className={styles.rowError}>{error}</div>}
      {saved && <div className={styles.savedNote}>{saved}</div>}

      {loading && <p className={styles.editorHint}>Loading…</p>}

      {!loading && relations.length === 0 && (
        <p className={styles.editorHint}>No parents or guardians recorded yet.</p>
      )}

      {relations.map((r) => (
        <div key={r.relationshipId} className={styles.parentRow}>
          <div className={styles.parentRowHeader}>
            <span className={styles.parentRowLabel}>
              {TYPE_LABEL[r.type] ?? r.type}
              {r.isGuardian && <span className={styles.guardianTag}>guardian</span>}
              {!r.active && <span className={styles.chipInactiveTag}>Inactive</span>}
            </span>
            <button
              type="button"
              className={`${styles.editBtn} ${styles.dangerBtn}`}
              disabled={busy}
              onClick={() => act(() => removeRelationship(r.relationshipId), `Unlinked ${r.name}.`)}
            >
              Unlink
            </button>
          </div>
          <div className={styles.editGrid}>
            <div className={styles.editField}>
              <span className={styles.editLabel}>Name</span>
              <div className={styles.readValue}>{r.name}</div>
            </div>
            <div className={styles.editField}>
              <span className={styles.editLabel}>Phone</span>
              <div className={styles.readValue}>
                {r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : <span className={styles.muted}>—</span>}
              </div>
            </div>
            <div className={styles.editFieldFull}>
              <span className={styles.editLabel}>Email</span>
              <div className={styles.readValue}>
                {r.email ? (
                  <a href={`mailto:${r.email}`}>{r.email}</a>
                ) : (
                  <span className={styles.muted}>—</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      <p className={styles.editorHint}>
        Contact details belong to the adult, not to this scout — edit them on the Adults or Leaders
        tab, and every scout they are attached to sees the change.
      </p>

      <div className={styles.inlineRow}>
        <span className={styles.relPrefix}>Add as</span>
        <select
          className={styles.select}
          value={type}
          disabled={busy}
          onChange={(e) => setType(e.target.value as LinkType)}
        >
          <option value="parent_of">Parent</option>
          <option value="guardian_of">Guardian</option>
          <option value="emergency_contact_for">Emergency contact</option>
        </select>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={isGuardian}
            disabled={busy}
            onChange={(e) => setIsGuardian(e.target.checked)}
          />
          has guardianship
        </label>
        <button
          type="button"
          className={styles.editBtn}
          disabled={busy}
          onClick={() => setMode(mode === 'link' ? 'none' : 'link')}
        >
          Find someone on record
        </button>
        <button
          type="button"
          className={styles.editBtn}
          disabled={busy}
          onClick={() => setMode(mode === 'create' ? 'none' : 'create')}
        >
          + New adult
        </button>
      </div>

      {mode === 'link' && (
        <AdultPicker
          disabled={busy}
          onPick={(personId, name) =>
            act(
              () => linkAdultToScout(personId, scoutPersonId, type, isGuardian),
              `Linked ${name}.`
            )
          }
        />
      )}

      {mode === 'create' && (
        <NewAdultForm
          disabled={busy}
          onCreate={(name, email, phone) =>
            act(
              () => createAdultForScout(scoutPersonId, name, email, phone, type, isGuardian),
              `Added ${name}.`
            )
          }
        />
      )}
    </div>
  );
}

function AdultPicker({
  disabled,
  onPick
}: {
  disabled: boolean;
  onPick: (personId: number, name: string) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<
    { id: number; display_name: string; primary_email: string | null }[]
  >([]);

  async function search(value: string) {
    setQ(value);
    setResults(value.trim().length < 2 ? [] : await searchPeople(value));
  }

  return (
    <div className={styles.pickerBlock}>
      <span className={styles.editLabel}>Search everyone on record</span>
      <input
        className={styles.searchInput}
        value={q}
        placeholder="Type at least two letters"
        disabled={disabled}
        onChange={(e) => search(e.target.value)}
      />
      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={styles.resultBtn}
                disabled={disabled}
                onClick={() => onPick(p.id, p.display_name)}
              >
                {p.display_name}
                {p.primary_email && <span className={styles.muted}> {p.primary_email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Creating from here matches on an exact email first, so a parent already on
 *  record is linked rather than duplicated. */
function NewAdultForm({
  disabled,
  onCreate
}: {
  disabled: boolean;
  onCreate: (name: string, email: string, phone: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  return (
    <div className={styles.parentRow}>
      <div className={styles.editGrid}>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Name</span>
          <input
            className={styles.editInput}
            value={name}
            placeholder="Required"
            disabled={disabled}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Phone</span>
          <input
            className={styles.editInput}
            value={phone}
            disabled={disabled}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Email</span>
          <input
            className={styles.editInput}
            value={email}
            disabled={disabled}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      </div>
      <p className={styles.editorHint}>
        If this email already belongs to someone on record, they are linked instead of a second
        copy being created.
      </p>
      <button
        type="button"
        className={styles.editBtn}
        disabled={disabled || !name.trim()}
        onClick={() => onCreate(name, email, phone)}
      >
        Add and link
      </button>
    </div>
  );
}
