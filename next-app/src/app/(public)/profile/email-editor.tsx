'use client';

import { useState, useTransition } from 'react';
import type { PersonEmailRow, PersonEmailLabel } from '@/lib/person-emails';
import styles from './profile.module.css';

/**
 * The signed-in adult's OWN email addresses — /profile's replacement for the
 * old single "primary_email" field (Plans/Retire-Roster-Contact-Columns.md
 * Phase 2). Only rendered for the household member who IS the verified
 * session; every other adult's editor shows their primary_email read-only
 * instead (see adult-editor.tsx) — this component never receives, and could
 * not act on, anyone else's addresses.
 *
 * ONE-CLICK, NOT DIRTY-GATED (next-app/AGENTS.md's Save standard explicitly
 * exempts add/remove/one-click actions like this from the dirty-gate rule) —
 * each control submits and round-trips immediately, the same way
 * addHouseholdMemberAction does. Busy state comes from useTransition so a
 * double-click can't fire twice; the page's own redirect is what actually
 * refreshes the list afterward.
 */
export function EmailEditor({
  emails,
  addAction,
  setPrimaryAction,
  removeAction
}: {
  emails: PersonEmailRow[];
  addAction: (formData: FormData) => Promise<void>;
  setPrimaryAction: (formData: FormData) => Promise<void>;
  removeAction: (formData: FormData) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState<PersonEmailLabel>('home');
  const [isPending, startTransition] = useTransition();

  function submitAdd() {
    if (!email.trim()) return;
    const fd = new FormData();
    fd.set('email', email);
    fd.set('label', label);
    startTransition(() => addAction(fd));
  }

  function submitSetPrimary(emailId: number) {
    const fd = new FormData();
    fd.set('emailId', String(emailId));
    startTransition(() => setPrimaryAction(fd));
  }

  function submitRemove(emailId: number) {
    const fd = new FormData();
    fd.set('emailId', String(emailId));
    startTransition(() => removeAction(fd));
  }

  return (
    <div className={styles.editFieldFull}>
      <span className={styles.editLabel}>Email addresses</span>

      {emails.length === 0 && <p className={styles.helpText}>No addresses on file yet — add one below.</p>}

      <ul className={styles.emailList}>
        {emails.map((e) => {
          const removeDisabled = isPending || emails.length <= 1 || e.isPrimary;
          const removeReason =
            emails.length <= 1
              ? 'This is your only address — add another before removing it.'
              : e.isPrimary
                ? 'Set another address as primary first.'
                : undefined;
          return (
            <li key={e.id} className={styles.emailRow}>
              <span className={styles.emailAddr}>{e.email}</span>
              <span className={styles.emailMeta}>{e.label}</span>
              {e.isPrimary && (
                <span className={styles.pendingTag} aria-hidden="true">
                  primary
                </span>
              )}
              {e.bouncedAt && (
                <span className={styles.pendingTag} aria-hidden="true">
                  bounced
                </span>
              )}
              {e.unsubscribedAt && (
                <span className={styles.pendingTag} aria-hidden="true">
                  unsubscribed
                </span>
              )}
              {!e.isPrimary && (
                <button
                  type="button"
                  className={styles.editCancelBtn}
                  disabled={isPending}
                  onClick={() => submitSetPrimary(e.id)}
                >
                  Make primary
                </button>
              )}
              <button
                type="button"
                className={styles.editCancelBtn}
                disabled={removeDisabled}
                title={removeReason}
                onClick={() => submitRemove(e.id)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>

      <div className={styles.emailAddRow}>
        <input
          className={styles.editInput}
          type="email"
          placeholder="name@example.com"
          value={email}
          disabled={isPending}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="New email address"
        />
        <select
          className={styles.editInput}
          value={label}
          disabled={isPending}
          onChange={(e) => setLabel(e.target.value as PersonEmailLabel)}
          aria-label="Address label"
        >
          <option value="home">home</option>
          <option value="work">work</option>
          <option value="other">other</option>
        </select>
        <button
          type="button"
          className={styles.editSaveBtn}
          disabled={isPending || !email.trim()}
          onClick={submitAdd}
        >
          {isPending ? 'Saving…' : 'Add address'}
        </button>
      </div>
    </div>
  );
}
