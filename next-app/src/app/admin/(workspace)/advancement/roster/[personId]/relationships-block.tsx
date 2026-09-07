'use client';

/**
 * Relationships / Parents & guardians — the "Takes effect immediately"
 * block inside Household & family (Phase 3). Retires Jenna's #3: on the old
 * scout editor these links committed inside a dialog whose bottom Save and
 * Cancel implied otherwise. Here the list is outside any form.
 *
 * Remove confirms and names what stays (the other person keeps their own
 * record; a guardian can no longer sign in on the scout's behalf). "+ Add"
 * opens an inline picker: search everyone on record, or — for a scout —
 * create a new adult from name + optional email/phone. Creation goes
 * through createAdultForScout, which LINKS an existing person when the
 * email is already on record (its `linked` flag), so a parent of two scouts
 * is never entered twice.
 *
 * Refetches through getPersonDetail so the list shows what the server
 * holds, then router.refresh() for the header's "signs in through …" line.
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../../_components/button';
import { Badge } from '../../../_components/badge';
import {
  addRelationship,
  createAdultForScout,
  getPersonDetail,
  linkAdultToScout,
  removeRelationship,
  searchPeople,
  type PersonDetail,
  type RelationshipInput
} from '../person-actions';
import { ConfirmDialog, ImmediateBlock, useImmediate } from './immediate';
import { Field, FieldGrid } from './section-card';
import type { PersonKind } from './record-types';
import styles from './person-record.module.css';

export interface RelationshipRow {
  id: number;
  outgoing: boolean;
  type: string;
  isGuardian: boolean;
  otherName: string;
}

export const REL_WORD: Record<string, string> = {
  parent_of: 'parent of',
  guardian_of: 'guardian of',
  sibling_of: 'sibling of',
  emergency_contact_for: 'emergency contact for'
};

type ScoutLinkType = 'parent_of' | 'guardian_of' | 'emergency_contact_for';

const SCOUT_TYPES: [ScoutLinkType, string][] = [
  ['parent_of', 'Parent'],
  ['guardian_of', 'Guardian'],
  ['emergency_contact_for', 'Emergency contact']
];
const ADULT_TYPES: [RelationshipInput, string][] = [
  ['parent_of', 'parent of'],
  ['child_of', 'child of'],
  ['guardian_of', 'guardian of'],
  ['sibling_of', 'sibling of'],
  ['emergency_contact_for', 'emergency contact for']
];

type Hit = { id: number; display_name: string; primary_email: string | null };

export function RelationshipsBlock({
  personId,
  name,
  kind,
  relationships,
  onChanged
}: {
  personId: number;
  name: string;
  kind: PersonKind;
  relationships: RelationshipRow[];
  onChanged: (detail: PersonDetail) => void;
}) {
  const router = useRouter();
  const imm = useImmediate();
  const scout = kind === 'scout';
  const [mode, setMode] = useState<'closed' | 'search' | 'new'>('closed');
  const [relType, setRelType] = useState<RelationshipInput>('parent_of');
  const [guardian, setGuardian] = useState(scout);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const seqRef = useRef(0);
  const [naName, setNaName] = useState('');
  const [naEmail, setNaEmail] = useState('');
  const [naPhone, setNaPhone] = useState('');
  const [removing, setRemoving] = useState<RelationshipRow | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  async function refresh() {
    onChanged(await getPersonDetail(personId));
    router.refresh();
  }

  function closePicker() {
    setMode('closed');
    setQ('');
    setHits([]);
    setNaName('');
    setNaEmail('');
    setNaPhone('');
  }

  function search(value: string) {
    setQ(value);
    if (value.trim().length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    const mine = seqRef.current + 1;
    seqRef.current = mine;
    setSearching(true);
    void searchPeople(value)
      .then((rows) => {
        // Drop a stale answer that lands after a later keystroke's.
        if (seqRef.current !== mine) return;
        setHits(rows.filter((r) => r.id !== personId));
        setSearching(false);
      })
      .catch(() => {
        if (seqRef.current === mine) setSearching(false);
      });
  }

  function pick(hit: Hit) {
    const fn = scout
      ? () => linkAdultToScout(hit.id, personId, relType as ScoutLinkType, guardian)
      : () => addRelationship(personId, hit.id, relType, guardian);
    void imm.run(fn, refresh, `Linked ${hit.display_name}.`).then((ok) => {
      if (ok) closePicker();
    });
  }

  function createAndLink() {
    const nm = naName.trim();
    if (!nm) return;
    const email = naEmail.trim();
    void imm
      .run(
        () => createAdultForScout(personId, nm, email, naPhone.trim(), relType as ScoutLinkType, guardian),
        refresh,
        (res) =>
          res.linked
            ? `${email} already belongs to someone on record — linked them instead of creating a duplicate.`
            : `Added ${nm} and linked them.`
      )
      .then((ok) => {
        if (ok) closePicker();
      });
  }

  function confirmRemove() {
    if (!removing) return;
    const target = removing;
    void imm
      .run(
        () => removeRelationship(target.id),
        refresh,
        scout ? `Unlinked ${target.otherName}.` : `Removed the relationship with ${target.otherName}.`
      )
      .then((ok) => {
        if (ok) setRemoving(null);
        else setDialogError('Could not remove it — see the message above.');
      });
  }

  const title = scout ? 'Parents & guardians' : 'Relationships';
  const types = scout ? SCOUT_TYPES : ADULT_TYPES;

  return (
    <ImmediateBlock title={title} state={imm}>
      {relationships.length ? (
        <ul className={styles.list}>
          {relationships.map((r) => (
            <li key={r.id}>
              <span className={styles.grow}>
                {r.outgoing ? (
                  <>
                    <strong>{name}</strong> is {REL_WORD[r.type] ?? r.type} <strong>{r.otherName}</strong>
                  </>
                ) : (
                  <>
                    <strong>{r.otherName}</strong> is {REL_WORD[r.type] ?? r.type} <strong>{name}</strong>
                  </>
                )}
              </span>
              <span className={styles.pills}>{r.isGuardian ? <Badge variant="info">guardian</Badge> : null}</span>
              <span className={styles.rowActions}>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={imm.busy}
                  onClick={() => {
                    setDialogError(null);
                    setRemoving(r);
                  }}
                >
                  {scout ? 'Unlink' : 'Remove'}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>
          {scout ? 'No parents or guardians linked yet — this scout cannot sign in until one is.' : 'None recorded.'}
        </p>
      )}

      {mode === 'closed' ? (
        <div className={styles.addRow}>
          <Button size="sm" disabled={imm.busy} onClick={() => setMode('search')}>
            {scout ? '+ Add parent / guardian' : '+ Add relationship'}
          </Button>
        </div>
      ) : (
        <div className={styles.panel}>
          <div className={styles.addRow}>
            <label className={styles.inlineLabel}>
              {scout ? 'Add as' : 'This person is'}
              <select
                value={relType}
                disabled={imm.busy}
                onChange={(e) => setRelType(e.target.value as RelationshipInput)}
              >
                {types.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.inlineLabel}>
              <input type="checkbox" checked={guardian} disabled={imm.busy} onChange={(e) => setGuardian(e.target.checked)} />
              has guardianship
            </label>
            <span className={styles.grow} />
            <Button size="sm" disabled={imm.busy} onClick={closePicker}>
              Cancel
            </Button>
          </div>

          <div className={styles.addRow}>
            <input
              type="search"
              aria-label="Search people"
              placeholder={scout ? 'Search everyone on record (2+ letters)' : '…of whom? Type at least two letters'}
              value={q}
              disabled={imm.busy}
              onChange={(e) => search(e.target.value)}
            />
            {scout && (
              <Button
                size="sm"
                disabled={imm.busy}
                aria-pressed={mode === 'new'}
                onClick={() => setMode(mode === 'new' ? 'search' : 'new')}
              >
                + New adult
              </Button>
            )}
          </div>

          {mode === 'new' && (
            <>
              <FieldGrid>
                <Field label="Name" required>
                  <input value={naName} placeholder="Required" disabled={imm.busy} onChange={(e) => setNaName(e.target.value)} />
                </Field>
                <Field label="Phone">
                  <input type="tel" value={naPhone} disabled={imm.busy} onChange={(e) => setNaPhone(e.target.value)} />
                </Field>
                <Field label="Email" full>
                  <input type="email" value={naEmail} disabled={imm.busy} onChange={(e) => setNaEmail(e.target.value)} />
                </Field>
              </FieldGrid>
              <p className={styles.hint}>
                If this email already belongs to someone on record, they are linked instead of a second copy being
                created.
              </p>
              <div className={styles.actions}>
                <Button size="sm" variant="primary" disabled={imm.busy || !naName.trim()} onClick={createAndLink}>
                  Add and link
                </Button>
              </div>
            </>
          )}

          {searching && <p className={styles.hint}>Searching…</p>}
          {!searching && q.trim().length >= 2 && hits.length === 0 && <p className={styles.hint}>No one matches.</p>}
          {hits.length > 0 && (
            <ul className={styles.results}>
              {hits.map((h) => (
                <li key={h.id}>
                  <Button size="sm" variant="quiet" className={styles.resultBtn} disabled={imm.busy} onClick={() => pick(h)}>
                    {h.display_name}
                    {h.primary_email ? <span className={styles.muted}> · {h.primary_email}</span> : null}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {removing && (
        <ConfirmDialog
          spec={{
            title: `${scout ? 'Unlink' : 'Remove relationship with'} ${removing.otherName}?`,
            body: (
              <ul className={styles.consequences}>
                <li>{removing.otherName} stays on record with their own contact details and household</li>
                {scout && removing.isGuardian ? <li>They can no longer sign in on {name}&rsquo;s behalf</li> : null}
                <li>Reversible by linking them again</li>
              </ul>
            ),
            okLabel: scout ? 'Unlink' : 'Remove',
            danger: true
          }}
          busy={imm.busy}
          error={dialogError}
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </ImmediateBlock>
  );
}
