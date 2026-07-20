'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addRole,
  endRole,
  deleteRole,
  setHousehold,
  addRelationship,
  removeRelationship,
  searchPeople,
  getPersonDetail,
  type GrantableRole,
  type RelationshipInput,
  type PersonDetail
} from './person-actions';
import styles from './roster.module.css';

export interface DirectoryPerson {
  person_id: number;
  display_name: string;
  primary_email: string | null;
  primary_phone: string | null;
  bsa_member_id: string | null;
  scout_id: string | null;
  inactive_reason: string | null;
  roles: string;
  tab: 'active_scout' | 'inactive_scout' | 'leader' | 'adult';
  has_legacy_pointer: boolean;
}

export interface PersonRoleRow {
  id: number;
  person_id: number;
  role: string;
  start_date: string | null;
  end_date: string | null;
}

export interface RelationshipRow {
  id: number;
  person_id: number;
  related_person_id: number;
  type: 'parent_of' | 'guardian_of' | 'sibling_of' | 'emergency_contact_for';
  is_guardian: boolean;
}

export interface HouseholdOption {
  id: number;
  label: string;
}

const ROLE_LABEL: Record<string, string> = {
  adult_leader: 'Adult leader',
  committee_member: 'Committee member',
  chartered_org_rep: 'Chartered org rep',
  merit_badge_counselor: 'Merit badge counselor',
  external_contact: 'External contact',
  youth_member: 'Youth member'
};

/** Only these three put someone on the Leaders tab. A merit badge counselor
 *  with no other role is an Adult — the "outside merit badge counselor" case. */
const GRANTABLE: GrantableRole[] = [
  'adult_leader',
  'committee_member',
  'chartered_org_rep',
  'merit_badge_counselor',
  'external_contact'
];

const RELATION_WORDS: Record<RelationshipRow['type'], string> = {
  parent_of: 'parent of',
  guardian_of: 'guardian of',
  sibling_of: 'sibling of',
  emergency_contact_for: 'emergency contact for'
};

export function PeopleTable({
  people,
  roles,
  relationships,
  households,
  householdByPerson,
  nameById
}: {
  people: DirectoryPerson[];
  roles: PersonRoleRow[];
  relationships: RelationshipRow[];
  households: HouseholdOption[];
  householdByPerson: Record<number, number>;
  nameById: Record<number, string>;
}) {
  const router = useRouter();
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [q, setQ] = useState('');

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return people;
    return people.filter(
      (p) =>
        p.display_name.toLowerCase().includes(term) ||
        (p.primary_email ?? '').toLowerCase().includes(term)
    );
  }, [people, q]);

  return (
    <div>
      <div className={styles.tableToolbar}>
        <input
          className={styles.searchInput}
          placeholder="Search name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className={styles.toolbarCount}>
          {visible.length} of {people.length}
        </span>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Roles</th>
            <th>Household</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visible.map((p) => {
            const hh = householdByPerson[p.person_id];
            return (
              <tr key={p.person_id}>
                <td>
                  <button className={styles.linkBtn} onClick={() => setOpenFor(p.person_id)}>
                    {p.display_name}
                  </button>
                  {!p.has_legacy_pointer && (
                    <span
                      className={styles.warnTag}
                      title="Not yet reachable in the family signup picker — needs a household or relationship."
                    >
                      not in picker
                    </span>
                  )}
                </td>
                <td>{p.primary_email || <span className={styles.muted}>—</span>}</td>
                <td>{p.primary_phone || <span className={styles.muted}>—</span>}</td>
                <td>
                  {p.roles
                    ? p.roles
                        .split(', ')
                        .map((r) => ROLE_LABEL[r] ?? r)
                        .join(', ')
                    : <span className={styles.muted}>none</span>}
                </td>
                <td>
                  {hh ? (
                    households.find((h) => h.id === hh)?.label
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td>
                  <button className={styles.smallBtn} onClick={() => setOpenFor(p.person_id)}>
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={6} className={styles.muted}>
                Nobody matches that search.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {openFor !== null && (
        <PersonEditor
          person={people.find((p) => p.person_id === openFor)!}
          households={households}
          seed={{
            householdId: householdByPerson[openFor] ?? null,
            roles: roles
              .filter((r) => r.person_id === openFor)
              .map((r) => ({ id: r.id, role: r.role, start_date: r.start_date, end_date: r.end_date })),
            relationships: relationships
              .filter((r) => r.person_id === openFor || r.related_person_id === openFor)
              .map((r) => {
                const outgoing = r.person_id === openFor;
                return {
                  id: r.id,
                  outgoing,
                  type: r.type,
                  isGuardian: r.is_guardian,
                  otherName: nameById[outgoing ? r.related_person_id : r.person_id] ?? 'someone'
                };
              })
          }}
          onClose={() => setOpenFor(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function PersonEditor({
  person,
  households,
  seed,
  onClose,
  onChanged
}: {
  person: DirectoryPerson;
  households: HouseholdOption[];
  seed: PersonDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newRole, setNewRole] = useState<GrantableRole>('adult_leader');
  const [relType, setRelType] = useState<RelationshipInput>('parent_of');
  const [isGuardian, setIsGuardian] = useState(false);

  // The editor renders what the SERVER says this person is, re-read after every
  // change. Relying on revalidatePath + router.refresh() to feed new props into
  // an already-open dialog silently failed: the writes landed, the dialog kept
  // showing its original props, and every save looked like it had done nothing.
  const [detail, setDetail] = useState<PersonDetail>(seed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Fresh read on open, so a dialog opened after someone else's edit is current.
  useEffect(() => {
    let live = true;
    getPersonDetail(person.person_id)
      .then((d) => { if (live) setDetail(d); })
      .catch(() => {});
    return () => { live = false; };
  }, [person.person_id]);

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMessage: string) {
    setError(null);
    setSaved(null);
    setBusy(true);
    fn()
      .then(async (res) => {
        if (!res.ok) { setError(res.error ?? 'Something went wrong.'); return; }
        setDetail(await getPersonDetail(person.person_id));
        setSaved(okMessage);
        onChanged();
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
      .finally(() => setBusy(false));
  }

  const disabled = busy;
  const householdId = detail.householdId;
  const current = detail.roles.filter((r) => !r.end_date);
  const ended = detail.roles.filter((r) => r.end_date);
  const relationships = detail.relationships;

  return (
    <div className={styles.editorOverlay} role="dialog" aria-modal="true">
      <div className={styles.editorPanel}>
        <div className={styles.editorHead}>
          <div>
            <h2>{person.display_name}</h2>
            <p className={styles.editorSub}>
              {person.tab === 'leader' ? 'Leader' : 'Adult'}
              {person.scout_id && ` · former scout ${person.scout_id}`}
              {person.bsa_member_id && ` · BSA ${person.bsa_member_id}`}
            </p>
          </div>
          <button className={styles.smallBtn} onClick={onClose}>
            Close
          </button>
        </div>

        {error && <div className={styles.rowError}>{error}</div>}
        {saved && <div className={styles.savedNote}>{saved}</div>}

        {!person.has_legacy_pointer && (
          <div className={styles.editorWarn}>
            This person cannot yet be found in the family signup picker. Giving them a household,
            or a relationship to someone in one, is what makes their family reachable.
          </div>
        )}

        {/* ── Household ─────────────────────────────────────────────── */}
        <section className={styles.editorSection}>
          <h3>Household</h3>
          <p className={styles.editorHint}>
            Picking anyone in a household brings up the whole family at signup. Household
            membership is independent of any role — it does not change when someone starts or
            stops helping out.
          </p>
          <select
            className={styles.select}
            value={householdId ?? ''}
            disabled={disabled}
            onChange={(e) =>
              act(
                () => setHousehold(person.person_id, e.target.value ? Number(e.target.value) : null),
                e.target.value ? 'Household updated.' : 'Removed from household.'
              )
            }
          >
            <option value="">— no household —</option>
            {households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </section>

        {/* ── Roles ─────────────────────────────────────────────────── */}
        <section className={styles.editorSection}>
          <h3>Roles</h3>
          <p className={styles.editorHint}>
            Holding a leader, committee, or chartered-org role is what puts someone on the Leaders
            tab. Ending it moves them back to Adults — it never touches their household or
            relationships. A merit badge counselor with no other role stays an Adult.
          </p>

          {current.length === 0 && <p className={styles.muted}>No current role.</p>}
          <ul className={styles.chipList}>
            {current.map((r) => (
              <li key={r.id} className={styles.roleChip}>
                {ROLE_LABEL[r.role] ?? r.role}
                <button
                  className={styles.chipBtn}
                  disabled={disabled}
                  onClick={() => act(() => endRole(r.id), 'Role ended — they move to Adults.')}
                >
                  End
                </button>
              </li>
            ))}
          </ul>

          {ended.length > 0 && (
            <>
              <p className={styles.editorHint}>Previously held:</p>
              <ul className={styles.chipList}>
                {ended.map((r) => (
                  <li key={r.id} className={styles.roleChipEnded}>
                    {ROLE_LABEL[r.role] ?? r.role} <span className={styles.muted}>to {r.end_date}</span>
                    <button
                      className={styles.chipBtn}
                      disabled={disabled}
                      onClick={() => act(() => deleteRole(r.id), 'Role deleted.')}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={styles.inlineRow}>
            <select
              className={styles.select}
              value={newRole}
              disabled={disabled}
              onChange={(e) => setNewRole(e.target.value as GrantableRole)}
            >
              {GRANTABLE.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button
              className={styles.smallBtn}
              disabled={disabled}
              onClick={() => act(() => addRole(person.person_id, newRole), 'Role added.')}
            >
              Add role
            </button>
          </div>
        </section>

        {/* ── Relationships ─────────────────────────────────────────── */}
        <section className={styles.editorSection}>
          <h3>Relationships</h3>
          <p className={styles.editorHint}>
            Relationships persist through every change of role or status — an adult can be the
            sibling of a scout, and a guardian at a different address is still a guardian.
          </p>

          {relationships.length === 0 && <p className={styles.muted}>None recorded.</p>}
          <ul className={styles.relList}>
            {relationships.map((r) => (
              <li key={r.id} className={styles.relItem}>
                <span>
                  {r.outgoing ? (
                    <>
                      <strong>{person.display_name}</strong>{' '}
                      is {RELATION_WORDS[r.type as RelationshipRow['type']] ?? r.type}{' '}
                      <strong>{r.otherName}</strong>
                    </>
                  ) : (
                    <>
                      <strong>{r.otherName}</strong>{' '}
                      is {RELATION_WORDS[r.type as RelationshipRow['type']] ?? r.type}{' '}
                      <strong>{person.display_name}</strong>
                    </>
                  )}
                  {r.isGuardian && <span className={styles.guardianTag}>guardian</span>}
                </span>
                <button
                  className={styles.chipBtn}
                  disabled={disabled}
                  onClick={() => act(() => removeRelationship(r.id), 'Relationship removed.')}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className={styles.inlineRow}>
            <span className={styles.relPrefix}>This person is</span>
            <select
              className={styles.select}
              value={relType}
              disabled={disabled}
              onChange={(e) => setRelType(e.target.value as RelationshipInput)}
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
                disabled={disabled}
                onChange={(e) => setIsGuardian(e.target.checked)}
              />
              has guardianship
            </label>
          </div>
          <PersonPicker
            label="…of whom"
            disabled={disabled}
            onPick={(otherId) =>
              act(
                () => addRelationship(person.person_id, otherId, relType, isGuardian),
                'Relationship saved.'
              )
            }
          />
        </section>
      </div>
    </div>
  );
}

function PersonPicker({
  label,
  disabled,
  onPick
}: {
  label: string;
  disabled: boolean;
  onPick: (personId: number) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<
    { id: number; display_name: string; primary_email: string | null }[]
  >([]);
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
        className={styles.searchInput}
        value={q}
        placeholder="Type at least two letters"
        disabled={disabled}
        onChange={(e) => search(e.target.value)}
      />
      {searching && <span className={styles.muted}> searching…</span>}
      {picked && !q && <span className={styles.pickedTag}>✓ {picked} added</span>}
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
                {p.primary_email && <span className={styles.muted}> {p.primary_email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
