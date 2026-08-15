'use client';

import { useState, useTransition } from 'react';
import {
  EDITABLE_PERSON_FIELDS,
  EDITABLE_SCOUT_FIELDS,
  type ChangeRequestRow,
  type FieldValue
} from '@/lib/change-requests';
import {
  draftDelta,
  draftFromValues,
  effectiveValues,
  type DraftValues
} from '@/lib/profile-draft';
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
 * IT ALSO OWNS EVERY FORM'S VALUES (2026-08-15). The editors used to hold
 * their own field state, which meant switching member and back threw away
 * whatever had been typed — and a parent working through a household switches
 * constantly, often to copy a corrected address from one member to the next.
 * Keeping the drafts here, keyed by member, is what makes the forms survive a
 * switch; keeping them per-member is what stops one member's values appearing
 * under another's name.
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
  withdrawAction: (formData: FormData) => Promise<void>;
  addMemberAction: (formData: FormData) => Promise<void>;
  /** False when the household has no stored row or no scout — the RPC behind
   *  "add a member" needs both, so the form is hidden rather than failing. */
  canAddMember: boolean;
}

/** The editable field list for a member's kind. */
function fieldsFor(kind: 'scout' | 'adult'): readonly string[] {
  return kind === 'scout' ? EDITABLE_SCOUT_FIELDS : EDITABLE_PERSON_FIELDS;
}

/**
 * What one member's form should show before anyone types: the live record with
 * any pending proposal laid over it (lib/profile-draft.ts). Both profile
 * shapes key their editable columns by the same names the field lists use, so
 * they index directly rather than needing a per-field mapping.
 */
function seedDrafts(
  members: HouseholdMemberView[],
  scouts: Record<MemberKey, ScoutProfileFields>,
  adults: Record<MemberKey, AdultProfileFields>,
  pending: Record<MemberKey, ChangeRequestRow>
): Record<MemberKey, DraftValues> {
  const out: Record<MemberKey, DraftValues> = {};
  for (const m of members) {
    const fields = fieldsFor(m.kind);
    const live = (m.kind === 'scout' ? scouts[m.key] : adults[m.key]) as unknown as
      | Record<string, FieldValue>
      | undefined;
    out[m.key] = draftFromValues(fields, effectiveValues(fields, live ?? {}, pending[m.key] ?? null));
  }
  return out;
}

/**
 * A value that changes exactly when the server's answer changes — the members
 * present, and the identity/timestamp of each pending request. Submitting,
 * replacing and withdrawing all move it; ordinary navigation does not.
 */
function serverStamp(
  members: HouseholdMemberView[],
  pending: Record<MemberKey, ChangeRequestRow>
): string {
  const keys = members.map((m) => m.key).join(',');
  const queued = Object.keys(pending)
    .sort()
    .map((k) => `${k}#${pending[k].id}@${pending[k].submitted_at}`)
    .join('|');
  return `${keys}||${queued}`;
}

export default function HouseholdMembers({
  members,
  scouts,
  adults,
  pending,
  initialKey,
  submitScoutAction,
  submitAdultAction,
  withdrawAction,
  addMemberAction,
  canAddMember
}: Props) {
  const [selected, setSelected] = useState<MemberKey | null>(
    initialKey && members.some((m) => m.key === initialKey) ? initialKey : (members[0]?.key ?? null)
  );
  const [adding, setAdding] = useState(false);
  const [drafts, setDrafts] = useState<Record<MemberKey, DraftValues>>(() =>
    seedDrafts(members, scouts, adults, pending)
  );

  /*
   * Re-seed the drafts when the server's answer changes, during render rather
   * than in an effect — React's documented way to reset state on a prop change.
   *
   * Submitting and withdrawing both finish with redirect(), which is a SOFT
   * navigation back to this same route: the server component re-renders with
   * new props, but this client component stays mounted and its state would
   * otherwise survive. Without this the form would keep showing a proposal
   * that had just been withdrawn, and a replaced one would keep the old
   * submitted_at. Unsubmitted edits on other members are lost at that point,
   * which is honest — a round-trip to the server did happen.
   */
  const stamp = serverStamp(members, pending);
  const [seenStamp, setSeenStamp] = useState(stamp);
  if (seenStamp !== stamp) {
    setSeenStamp(stamp);
    setDrafts(seedDrafts(members, scouts, adults, pending));
  }

  /** Members whose form holds edits that have not been submitted. */
  const dirtyKeys = new Set<MemberKey>();
  for (const m of members) {
    const fields = fieldsFor(m.kind);
    const live = (m.kind === 'scout' ? scouts[m.key] : adults[m.key]) as unknown as
      | Record<string, FieldValue>
      | undefined;
    const effective = effectiveValues(fields, live ?? {}, pending[m.key] ?? null);
    if (Object.keys(draftDelta(fields, drafts[m.key] ?? {}, effective)).length > 0) {
      dirtyKeys.add(m.key);
    }
  }

  const current = members.find((m) => m.key === selected) ?? null;

  function setField(key: MemberKey, field: string, value: string) {
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), [field]: value } }));
  }

  /** Throw away this member's unsubmitted edits — back to live-or-queued. */
  function discard(key: MemberKey) {
    const member = members.find((m) => m.key === key);
    if (!member) return;
    setDrafts((prev) => ({ ...prev, ...seedDrafts([member], scouts, adults, pending) }));
  }

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
            {dirtyKeys.has(m.key) ? (
              <span className={styles.memberEditFlag} title="You have edits you haven't submitted">
                edited
              </span>
            ) : (
              m.hasPending && (
                <span className={styles.memberFlag} title="An update is awaiting review">
                  pending
                </span>
              )
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
         * key={current.key} is belt-and-braces since the field values moved up
         * here — the editors no longer seed anything from props, so the bug it
         * was added for (a props-seeded form reusing its instance and showing
         * the PREVIOUS member's values, reported 2026-08-14 as "Patrick and
         * Jamie Lynn show Maya's profile") can no longer happen at all.
         *
         * KEEP IT ANYWAY. It still resets the transient UI inside an editor —
         * DatePickerField's open popover, EditorActions' undo confirmation —
         * which would otherwise carry across a switch, and it is the guard if
         * an editor ever grows internal state again.
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
              values={drafts[current.key] ?? {}}
              dirty={dirtyKeys.has(current.key)}
              onChange={(field, value) => setField(current.key, field, value)}
              onDiscard={() => discard(current.key)}
              submitAction={submitScoutAction}
              withdrawAction={withdrawAction}
            />
          ) : (
            <AdultEditor
              adult={adults[current.key]}
              pending={pending[current.key] ?? null}
              values={drafts[current.key] ?? {}}
              dirty={dirtyKeys.has(current.key)}
              onChange={(field, value) => setField(current.key, field, value)}
              onDiscard={() => discard(current.key)}
              submitAction={submitAdultAction}
              withdrawAction={withdrawAction}
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
