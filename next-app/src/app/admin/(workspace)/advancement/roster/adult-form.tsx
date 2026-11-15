'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPerson } from './person-actions';
import type { HouseholdOption } from './people-table';
import styles from './roster.module.css';
// Field CSS converged onto lookups' family (D-139 answered, 2026-08-21) —
// roster.module.css's hand-copied .editGrid/.editField block is deleted.
// The fields sit in a FormPanel (2026-08-26 sweep) — .fieldGrid carries no
// tint of its own any more, since this dialog has no DialogBody to supply one.
import fields from '../lookups/lookups.module.css';
import { Notice } from '../../_components/notice';
import { Dialog } from '../../_components/dialog';
import { Button } from '../../../_components/button';
import { FormPanel } from '../../../_components/form-panel';
import { SegmentedControl } from '../../_components/segmented-control';
import saveState from '../../_components/save-state.module.css';
import { HOUSEHOLD_LINK_OPTIONS, linkField } from '@/lib/household-links';

/**
 * "Add Adult" — the same shape as the Scout editor's create path (a dialog off
 * the table toolbar, one server action, close on success), for the other half
 * of the roster.
 *
 * Deliberately create-only. Everything afterwards — roles over time,
 * relationships, household moves, active/inactive — already has a home in the
 * PersonEditor, and duplicating any of it here would give two screens an
 * opinion about the same row. This asks only for what it takes to exist:
 * a name, a way to reach them, and optionally the role and household that
 * are already known at the moment they're added.
 */

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'No role yet — just an adult on record' },
  { value: 'adult_leader', label: 'Adult leader' },
  { value: 'committee_member', label: 'Committee member' },
  { value: 'chartered_org_rep', label: 'Chartered org rep' },
  { value: 'merit_badge_counselor', label: 'Merit badge counselor' },
  { value: 'external_contact', label: 'External contact' }
];

export function AdultForm({
  households,
  onClose,
  onCreated
}: {
  households: HouseholdOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [householdId, setHouseholdId] = useState('');
  const [addr1, setAddr1] = useState('');
  const [addr2, setAddr2] = useState('');
  const [city, setCity] = useState('');
  const [stateAbbr, setStateAbbr] = useState('');
  const [zip, setZip] = useState('');
  // How the new adult relates to each scout in the chosen household; '' = not answered yet.
  const [relations, setRelations] = useState<Record<number, '' | 'parent_of' | 'guardian_of' | 'none'>>({});
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const householdScouts = households.find((h) => String(h.id) === householdId)?.scouts ?? [];
  const unanswered = householdScouts.filter((s) => !relations[s.personId]);

  // Mounted only while open — showModal() once on mount (Esc/backdrop free).
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = dialogRef.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  function save() {
    setError(null);
    // A shared household grants nothing: each scout in it needs an answer (lib/household-links).
    if (unanswered.length > 0) {
      setTried(true);
      return;
    }
    const fd = new FormData();
    fd.set('first_name', firstName);
    fd.set('last_name', lastName);
    fd.set('primary_email', email);
    fd.set('primary_phone', phone);
    fd.set('role', role);
    fd.set('household_id', householdId);
    fd.set('address_line1', addr1);
    fd.set('address_line2', addr2);
    fd.set('city', city);
    fd.set('state', stateAbbr);
    fd.set('zip', zip);
    for (const s of householdScouts) fd.set(linkField(s.personId), relations[s.personId] ?? '');
    startTransition(async () => {
      const res = await createPerson(fd);
      if (!res.ok) {
        setError(res.error ?? 'Could not add this person.');
        return;
      }
      onCreated();
      onClose();
    });
  }

  const canSave = firstName.trim() !== '' && lastName.trim() !== '' && !isPending;

  return (
    // Shared Dialog (Phase B, 2026-08-21) — was the same hand-rolled fixed
    // overlay as PersonEditor's (no Escape/backdrop close). Mounted only
    // while open, so showModal() runs once on mount.
    <Dialog ref={dialogRef} className={styles.editorDialog} onClose={onClose} aria-label="Add an adult">
      <div className={styles.editorPanel}>
      <div className={styles.editorHead}>
        <div>
          <h2>Add an adult</h2>
          <p className={styles.editorSub}>
            A leader, committee member, counselor, or a parent with no scout in the troop.
          </p>
        </div>
        <Button size="sm" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
      </div>

      {error && <Notice>{error}</Notice>}

      <FormPanel>
      <div className={fields.fieldGrid}>
        <label className={fields.editField}>
          <span className={fields.editLabel}>First Name</span>
          <input
            className={fields.editInput}
            value={firstName}
            disabled={isPending}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Required"
          />
        </label>
        <label className={fields.editField}>
          <span className={fields.editLabel}>Last Name</span>
          <input
            className={fields.editInput}
            value={lastName}
            disabled={isPending}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Required"
          />
        </label>
        <label className={fields.editField}>
          <span className={fields.editLabel}>Email</span>
          <input
            className={fields.editInput}
            type="email"
            value={email}
            disabled={isPending}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className={fields.editField}>
          <span className={fields.editLabel}>Phone</span>
          <input
            className={fields.editInput}
            type="tel"
            value={phone}
            disabled={isPending}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label className={fields.editField}>
          <span className={fields.editLabel}>Role</span>
          <select
            className={fields.editInput}
            value={role}
            disabled={isPending}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={fields.editField}>
          <span className={fields.editLabel}>Household</span>
          <select
            className={fields.editInput}
            value={householdId}
            disabled={isPending}
            onChange={(e) => {
              setHouseholdId(e.target.value);
              setRelations({});
              setTried(false);
            }}
          >
            <option value="">— none —</option>
            {households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        {householdScouts.map((s) => {
          const bad = tried && !relations[s.personId];
          return (
            <div key={s.personId} className={bad ? `${fields.editFieldFull} ${saveState.bad}` : fields.editFieldFull}>
              <span className={fields.editLabel}>Related to {s.name} as</span>
              <SegmentedControl
                name={`adult-relation-${s.personId}`}
                label={`How this adult is related to ${s.name}`}
                value={relations[s.personId] ?? ''}
                options={HOUSEHOLD_LINK_OPTIONS}
                disabled={isPending}
                onChange={(v) => setRelations((r) => ({ ...r, [s.personId]: v }))}
              />
              {bad && <p className={saveState.badNote}>Choose one. Only a parent or guardian can add {s.name}&rsquo;s health forms.</p>}
            </div>
          );
        })}
        <label className={fields.editFieldFull}>
          <span className={fields.editLabel}>Address Line 1</span>
          <input
            className={fields.editInput}
            value={addr1}
            disabled={isPending}
            onChange={(e) => setAddr1(e.target.value)}
          />
        </label>
        <label className={fields.editFieldFull}>
          <span className={fields.editLabel}>Address Line 2</span>
          <input
            className={fields.editInput}
            value={addr2}
            disabled={isPending}
            onChange={(e) => setAddr2(e.target.value)}
          />
        </label>
        <label className={fields.editField}>
          <span className={fields.editLabel}>City</span>
          <input
            className={fields.editInput}
            value={city}
            disabled={isPending}
            onChange={(e) => setCity(e.target.value)}
          />
        </label>
        <label className={fields.editField}>
          <span className={fields.editLabel}>State</span>
          <input
            className={fields.editInput}
            value={stateAbbr}
            maxLength={2}
            disabled={isPending}
            onChange={(e) => setStateAbbr(e.target.value)}
            placeholder="WI"
          />
        </label>
        <label className={fields.editField}>
          <span className={fields.editLabel}>ZIP</span>
          <input
            className={fields.editInput}
            value={zip}
            disabled={isPending}
            onChange={(e) => setZip(e.target.value)}
          />
        </label>
      </div>

      <p className={styles.editorHint}>
        Roles, other relationships and household moves are all editable afterwards by opening the person.
      </p>
      </FormPanel>

      <div className={fields.editActions}>
        {tried && unanswered.length > 0 && (
          <span className={saveState.problem} role="alert">
            Can&rsquo;t add yet: say how they&rsquo;re related to {unanswered[0].name}
            {unanswered.length > 1 && <span className={saveState.problemMore}> (+{unanswered.length - 1} more)</span>}
          </span>
        )}
        <Button size="sm" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={!canSave}>
          {isPending ? 'Adding…' : 'Add adult'}
        </Button>
      </div>
      </div>
    </Dialog>
  );
}
