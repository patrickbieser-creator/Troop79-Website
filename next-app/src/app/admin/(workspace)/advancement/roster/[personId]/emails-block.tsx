'use client';

/**
 * Email addresses — the "Takes effect immediately" block inside Contact &
 * sign-in (Phase 3). One list, every address with its label and primary /
 * verified / unverified / bounced tags; Make primary and Remove per row;
 * an add row underneath. The guards are the roster editor's, ported:
 * the only address cannot be removed, nor the primary (set another first),
 * and a bounced address cannot become primary. Removing a VERIFIED address
 * confirms first — verification is the one thing a leader cannot put back.
 *
 * Every action refetches the list through getPersonEmails so the rows shown
 * are what the server holds (the two-way trigger on person_emails can move
 * the primary under us), then router.refresh() for the header and side
 * cards.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDate } from '@/lib/format-date';
import type { PersonEmailLabel, PersonEmailRow } from '@/lib/person-emails';
import { Button } from '../../../../_components/button';
import { Badge } from '../../../_components/badge';
import {
  addPersonEmailAction,
  getPersonEmails,
  removePersonEmailAction,
  setPersonPrimaryEmailAction
} from '../person-actions';
import { ConfirmDialog, ImmediateBlock, useImmediate } from './immediate';
import type { PersonKind } from './record-types';
import styles from './person-record.module.css';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function EmailsBlock({
  personId,
  kind,
  emails,
  onChanged
}: {
  personId: number;
  kind: PersonKind;
  emails: PersonEmailRow[];
  onChanged: (next: PersonEmailRow[]) => void;
}) {
  const router = useRouter();
  const imm = useImmediate();
  const [newEmail, setNewEmail] = useState('');
  const [newLabel, setNewLabel] = useState<PersonEmailLabel>('home');
  const [removing, setRemoving] = useState<PersonEmailRow | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  async function refresh() {
    onChanged(await getPersonEmails(personId));
    router.refresh();
  }

  function add() {
    const value = newEmail.trim();
    if (!EMAIL_RE.test(value)) {
      imm.fail('That does not look like an email address.');
      return;
    }
    if (emails.some((e) => e.email.toLowerCase() === value.toLowerCase())) {
      imm.fail('That address is already on file.');
      return;
    }
    const first = emails.length === 0;
    void imm
      .run(
        () => addPersonEmailAction(personId, value, newLabel),
        refresh,
        `Added ${value}${first ? ' as primary' : ''}. It is unverified until they sign in with it.`
      )
      .then((ok) => {
        if (ok) {
          setNewEmail('');
          setNewLabel('home');
        }
      });
  }

  function makePrimary(e: PersonEmailRow) {
    void imm.run(
      () => setPersonPrimaryEmailAction(personId, e.id),
      refresh,
      `${e.email} is now primary — sign-in links and the Bugle go there.`
    );
  }

  function remove(e: PersonEmailRow) {
    if (e.verifiedAt) {
      setDialogError(null);
      setRemoving(e);
      return;
    }
    void imm.run(() => removePersonEmailAction(personId, e.id), refresh, 'Address removed.');
  }

  function confirmRemove() {
    if (!removing) return;
    const target = removing;
    void imm
      .run(() => removePersonEmailAction(personId, target.id), refresh, 'Address removed.')
      .then((ok) => {
        if (ok) setRemoving(null);
        else setDialogError('Could not remove that address — see the message above.');
      });
  }

  const onlyOne = emails.length <= 1;

  return (
    <ImmediateBlock title="Email addresses" state={imm}>
      {emails.length ? (
        <ul className={styles.list}>
          {emails.map((e) => (
            <li key={e.id}>
              <span className={styles.grow}>
                {e.email} <span className={styles.muted}>{e.label}</span>
              </span>
              <span className={styles.pills}>
                {e.isPrimary ? <Badge variant="info">primary</Badge> : null}
                {e.verifiedAt ? (
                  <Badge variant="success" title={`Verified ${fmtDate(e.verifiedAt)}`}>
                    verified
                  </Badge>
                ) : (
                  <Badge variant="neutral">unverified</Badge>
                )}
                {e.bouncedAt ? (
                  <Badge variant="danger" title={`Bounced ${fmtDate(e.bouncedAt)}`}>
                    bounced
                  </Badge>
                ) : null}
              </span>
              <span className={styles.rowActions}>
                {!e.isPrimary && (
                  <Button
                    size="sm"
                    disabled={imm.busy || e.bouncedAt != null}
                    title={e.bouncedAt ? 'A bounced address cannot be primary' : undefined}
                    onClick={() => makePrimary(e)}
                  >
                    Make primary
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={imm.busy || onlyOne || e.isPrimary}
                  title={
                    onlyOne
                      ? 'The only address on file — add another before removing this one'
                      : e.isPrimary
                        ? 'Set another address as primary first'
                        : undefined
                  }
                  onClick={() => remove(e)}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No addresses on file{kind === 'scout' ? ' — signs in through a parent' : ''}.</p>
      )}

      <div className={styles.addRow}>
        <input
          type="email"
          aria-label="New email address"
          placeholder="name@example.com"
          value={newEmail}
          disabled={imm.busy}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <select
          aria-label="Label"
          value={newLabel}
          disabled={imm.busy}
          onChange={(e) => setNewLabel(e.target.value as PersonEmailLabel)}
        >
          <option value="home">home</option>
          <option value="work">work</option>
          <option value="other">other</option>
        </select>
        <Button
          size="sm"
          disabled={imm.busy || !newEmail.trim()}
          title={newEmail.trim() ? undefined : 'Type an address first'}
          onClick={add}
        >
          Add address
        </Button>
      </div>

      {removing && (
        <ConfirmDialog
          spec={{
            title: `Remove ${removing.email}?`,
            body: (
              <p className={styles.panelCopy}>
                This address is verified; removing it means it cannot be used to sign in until it is added and
                verified again.
              </p>
            ),
            okLabel: 'Remove address',
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
