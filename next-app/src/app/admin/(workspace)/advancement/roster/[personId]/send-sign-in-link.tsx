'use client';

/**
 * Header "Send sign-in link" (Phase 3) — ported from the roster editor.
 * When more than one deliverable address is on file a select picks the
 * destination (default: the primary); with none the button is greyed and
 * its title says why — a scout with no email of their own "signs in through
 * a parent". The outcome (sent with the masked address and expiry minutes /
 * rate-limited / unreachable / failed) is handed to the shell, which shows
 * it as a Notice under the header where there is room for a sentence.
 */
import { useState } from 'react';
import type { PersonEmailRow } from '@/lib/person-emails';
import { Button } from '../../../../_components/button';
import { sendSignInLink } from '../person-actions';
import type { PersonKind } from './record-types';
import styles from './person-record.module.css';

/** Copy for every way sendSignInLink() can fail to send — a leader acting
 *  from the roster is allowed to be told the truth. */
const SEND_LINK_REASON: Record<'unreachable' | 'rate-limited' | 'failed', string> = {
  unreachable: 'Add an email address first (Contact & sign-in).',
  'rate-limited': 'Already sent recently — try again in a few minutes.',
  failed: "Couldn't send the link — try again."
};

export interface SendLinkResult {
  variant: 'success' | 'error';
  message: string;
}

export function SendSignInLink({
  personId,
  kind,
  emails,
  onResult
}: {
  personId: number;
  kind: PersonKind;
  emails: PersonEmailRow[];
  onResult: (result: SendLinkResult) => void;
}) {
  const [emailId, setEmailId] = useState('');
  const [busy, setBusy] = useState(false);
  const deliverable = emails.filter((e) => !e.bouncedAt);
  const none = deliverable.length === 0;
  // The pick survives an address being added or removed underneath it:
  // fall back to the primary (then the first deliverable) whenever the
  // chosen id is no longer on the list.
  const fallback = deliverable.find((e) => e.isPrimary) ?? deliverable[0];
  const chosen = deliverable.some((e) => String(e.id) === emailId) ? emailId : fallback ? String(fallback.id) : '';

  function send() {
    setBusy(true);
    sendSignInLink(personId, chosen ? Number(chosen) : undefined)
      .then((res) => {
        onResult(
          res.ok
            ? { variant: 'success', message: `Link sent to ${res.masked} — good for ${res.expiresMinutes} minutes.` }
            : { variant: 'error', message: SEND_LINK_REASON[res.reason] }
        );
      })
      .catch(() => onResult({ variant: 'error', message: 'Something went wrong.' }))
      .finally(() => setBusy(false));
  }

  return (
    <div className={styles.headerActions}>
      {deliverable.length > 1 && (
        <select aria-label="Send to" value={chosen} disabled={busy} onChange={(e) => setEmailId(e.target.value)}>
          {deliverable.map((e) => (
            <option key={e.id} value={String(e.id)}>
              {e.email}
              {e.isPrimary ? ' (primary)' : ''}
            </option>
          ))}
        </select>
      )}
      <Button
        size="sm"
        disabled={busy || none}
        title={
          none
            ? kind === 'scout'
              ? 'No email on file — signs in through a parent'
              : 'Add an email address first (Contact & sign-in)'
            : undefined
        }
        onClick={send}
      >
        {busy ? 'Sending…' : 'Send sign-in link'}
      </Button>
    </div>
  );
}
