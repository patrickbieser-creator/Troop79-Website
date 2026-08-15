'use client';

import { useState, useTransition } from 'react';
import type { ChangeRequestRow } from '@/lib/change-requests';
import ProfileEditor, { type ScoutProfileFields } from './profile-editor';
import AdultEditor, { type AdultProfileFields } from './adult-editor';
import styles from './profile.module.css';

/**
 * The household roster on /profile: everyone in the family, one selected at a
 * time to edit.
 *
 * REPLACES A STACK OF ACCORDIONS. The page used to render one <details> per
 * SCOUT and nothing for the adults, so a parent could correct their child's
 * address but not their own phone number — and with two or three scouts open
 * at once it was never obvious whose form you were typing into. One selected
 * member, one form, is both narrower and more capable.
 *
 * Selection is client state seeded from the server (`initialKey`), not a
 * navigation: the page already loads every member's fields, so switching is
 * instant, while a submit still round-trips and comes back pointed at the
 * same member through ?member=.
 */

export type MemberKey = string;

export interface HouseholdMemberView {
  key: MemberKey;
  name: string;
  /** "Scout", or the adult's relationship when one is recorded. */
  role: string;
  kind: 'scout' | 'adult';
  hasPending: boolean;
}

interface Props {
  members: HouseholdMemberView[];
  scouts: Record<MemberKey, ScoutProfileFields>;
  adults: Record<MemberKey, AdultProfileFields>;
  pending: Record<MemberKey, ChangeRequestRow>;
  initialKey: MemberKey | null;
  submitScoutAction: (formData: FormData) => Promise<void>;
  submitAdultAction: (formData: FormData) => Promise<void>;
  addMemberAction: (formData: FormData) => Promise<void>;
  /** False when the household has no stored row or no scout — the RPC behind
   *  "add a member" needs both, so the form is hidden rather than failing. */
  canAddMember: boolean;
}

export default function HouseholdMembers({
  members,
  scouts,
  adults,
  pending,
  initialKey,
  submitScoutAction,
  submitAdultAction,
  addMemberAction,
  canAddMember
}: Props) {
  const [selected, setSelected] = useState<MemberKey | null>(
    initialKey && members.some((m) => m.key === initialKey) ? initialKey : (members[0]?.key ?? null)
  );
  const [adding, setAdding] = useState(false);

  const current = members.find((m) => m.key === selected) ?? null;

  return (
    <div className={styles.household}>
      <div className={styles.memberBar} role="tablist" aria-label="Household members">
        {members.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={m.key === selected}
            className={m.key === selected ? styles.memberChipActive : styles.memberChip}
            onClick={() => {
              setSelected(m.key);
              setAdding(false);
            }}
          >
            <span className={styles.memberName}>{m.name}</span>
            <span className={styles.memberRole}>{m.role}</span>
            {m.hasPending && (
              <span className={styles.memberFlag} title="An update is awaiting review">
                pending
              </span>
            )}
          </button>
        ))}
        {canAddMember && (
          <button
            type="button"
            className={adding ? styles.memberChipActive : styles.memberAddChip}
            onClick={() => setAdding((v) => !v)}
          >
            + Add a member
          </button>
        )}
      </div>

      {adding && canAddMember && (
        <AddMemberForm action={addMemberAction} onCancel={() => setAdding(false)} />
      )}

      {!adding && current && (
        /*
         * key={current.key} IS LOAD-BEARING — do not remove it.
         *
         * Both editors seed every field with useState(member.field ?? ''),
         * which runs only on mount. Without a key, selecting a second member
         * of the SAME kind reuses the mounted instance at this position and
         * React keeps its state, so the form shows the PREVIOUS member's
         * values under the new member's name — reported 2026-08-14 as
         * "Patrick and Jamie Lynn show Maya's profile".
         *
         * The old page rendered one editor per scout inside separate keyed
         * <details> elements, so each member had its own instance and the
         * problem could not arise. Collapsing them into one switcher position
         * is what made the key necessary. Keying the section (rather than each
         * editor) resets the whole panel, so it holds for both branches.
         */
        <section
          key={current.key}
          className={styles.memberPanel}
          aria-label={`Editing ${current.name}`}
        >
          <h2 className={styles.memberPanelTitle}>{current.name}</h2>
          {current.kind === 'scout' ? (
            <ProfileEditor
              scout={scouts[current.key]}
              pending={pending[current.key] ?? null}
              submitAction={submitScoutAction}
            />
          ) : (
            <AdultEditor
              adult={adults[current.key]}
              pending={pending[current.key] ?? null}
              submitAction={submitAdultAction}
            />
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Adding an adult writes immediately rather than queueing for review — there
 * is nothing to diff against yet, and the RPC LINKS to an existing person when
 * the email is already on record instead of creating a duplicate, which is the
 * failure mode a review step would have been guarding against.
 */
function AddMemberForm({
  action,
  onCancel
}: {
  action: (formData: FormData) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isPending, startTransition] = useTransition();

  function submit() {
    const fd = new FormData();
    fd.set('name', name);
    fd.set('relationship', relationship);
    fd.set('email', email);
    fd.set('phone', phone);
    startTransition(() => action(fd));
  }

  return (
    <section className={styles.memberPanel} aria-label="Add a household member">
      <h2 className={styles.memberPanelTitle}>Add a member</h2>
      <p className={styles.helpText}>
        For another parent, a guardian, or an adult who helps with pickup. Adding someone here puts
        them on the troop roster right away so they can be signed up for events. Scouts are added by
        a leader — ask if one is missing.
      </p>
      <div className={styles.editGrid}>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Name</span>
          <input
            className={styles.editInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Required"
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Relationship</span>
          <input
            className={styles.editInput}
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            placeholder="Mom, Dad, Grandparent…"
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Email</span>
          <input
            className={styles.editInput}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Phone</span>
          <input
            className={styles.editInput}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(414) 555-1234"
          />
        </label>
      </div>
      <p className={styles.helpText}>
        If that email already belongs to someone on record, they are linked to your household
        instead of a second copy being created.
      </p>
      <div className={styles.editActions}>
        <button type="button" className={styles.editCancelBtn} disabled={isPending} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.editSaveBtn}
          disabled={isPending || !name.trim()}
          onClick={submit}
        >
          {isPending ? 'Adding…' : 'Add to household'}
        </button>
      </div>
    </section>
  );
}
